-- Data migration + automation for the Contact Type dropdown and Last
-- Activity field. Run AFTER setup-contact-type-and-last-activity.mjs --create
-- (which creates the contactType/lastActivityAt fields via the metadata API,
-- so the person columns exist and caches invalidate properly).
--
-- Single-workspace deployment: the schema name is hardcoded. Replace it if
-- the workspace is ever rebuilt.

\set WORKSPACE_SCHEMA 'workspace_arem42qbur9jiys0e9bx25k0f'

\pset pager off

-- 1. Migrate Contact Type values into the new dropdown field.
UPDATE :"WORKSPACE_SCHEMA".person
SET "contactType" = 'LEAD'
WHERE "ghlContactType" = 'lead';

UPDATE :"WORKSPACE_SCHEMA".person
SET "contactType" = 'CUSTOMER'
WHERE "ghlContactType" = 'customer';

-- Anything unexpected keeps a null (choose on the dropdown later).
SELECT "contactType", count(*) FROM :"WORKSPACE_SCHEMA".person GROUP BY 1 ORDER BY 2 DESC;

-- 2. Repoint the "All People" view column from ghlContactType to contactType
--    (the old field gets archived by --delete-old afterwards).
UPDATE core."viewField"
SET "fieldMetadataId" = (
  SELECT f.id FROM core."fieldMetadata" f
  WHERE f."name" = 'contactType'
    AND f."objectMetadataId" = (
      SELECT id FROM core."objectMetadata" WHERE "nameSingular" = 'person' LIMIT 1
    )
  LIMIT 1
)
WHERE "fieldMetadataId" = (
  SELECT f.id FROM core."fieldMetadata" f
  WHERE f."name" = 'ghlContactType'
    AND f."objectMetadataId" = (
      SELECT id FROM core."objectMetadata" WHERE "nameSingular" = 'person' LIMIT 1
    )
  LIMIT 1
);

-- 3. Backfill Last Activity: newest timeline event, else newest linked note,
--    else the record's own last edit.
UPDATE :"WORKSPACE_SCHEMA".person p
SET "lastActivityAt" = COALESCE(
  (SELECT max(t."createdAt")
     FROM :"WORKSPACE_SCHEMA"."timelineActivity" t
    WHERE t."targetPersonId" = p.id),
  (SELECT max(n."createdAt")
     FROM :"WORKSPACE_SCHEMA"."noteTarget" nt
     JOIN :"WORKSPACE_SCHEMA".note n ON n.id = nt."noteId"
    WHERE nt."targetPersonId" = p.id),
  p."updatedAt"
);

SELECT count(*) AS persons_with_last_activity
FROM :"WORKSPACE_SCHEMA".person WHERE "lastActivityAt" IS NOT NULL;

-- 4. Keep Last Activity fresh. Notes/tasks are linked via their target
--    tables; everything else (messages, edits, linked events) lands on
--    timelineActivity with targetPersonId set. App-level changes fire these
--    rows in the same transaction, so the touch rides along for free.
CREATE OR REPLACE FUNCTION :"WORKSPACE_SCHEMA".fn_touch_person_last_activity()
RETURNS trigger AS $$
BEGIN
  UPDATE :"WORKSPACE_SCHEMA".person
     SET "lastActivityAt" = now()
   WHERE id = NEW."targetPersonId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_note_touch_person ON :"WORKSPACE_SCHEMA"."noteTarget";
CREATE TRIGGER trg_note_touch_person
AFTER INSERT ON :"WORKSPACE_SCHEMA"."noteTarget"
FOR EACH ROW
WHEN (NEW."targetPersonId" IS NOT NULL)
EXECUTE FUNCTION :"WORKSPACE_SCHEMA".fn_touch_person_last_activity();

DROP TRIGGER IF EXISTS trg_task_touch_person ON :"WORKSPACE_SCHEMA"."taskTarget";
CREATE TRIGGER trg_task_touch_person
AFTER INSERT ON :"WORKSPACE_SCHEMA"."taskTarget"
FOR EACH ROW
WHEN (NEW."targetPersonId" IS NOT NULL)
EXECUTE FUNCTION :"WORKSPACE_SCHEMA".fn_touch_person_last_activity();

DROP TRIGGER IF EXISTS trg_timeline_touch_person ON :"WORKSPACE_SCHEMA"."timelineActivity";
CREATE TRIGGER trg_timeline_touch_person
AFTER INSERT ON :"WORKSPACE_SCHEMA"."timelineActivity"
FOR EACH ROW
WHEN (NEW."targetPersonId" IS NOT NULL)
EXECUTE FUNCTION :"WORKSPACE_SCHEMA".fn_touch_person_last_activity();
