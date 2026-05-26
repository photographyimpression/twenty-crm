-- Rebuild "Needs My Approval" → "🔥 Due Today" (PENDING AND scheduledDate <= today)
-- and create "📅 Upcoming" (PENDING AND scheduledDate in future).
-- Date <= today is expressed as (IS_IN_PAST OR IS_TODAY); NULL scheduledDate is
-- naturally excluded (cascade leaves not-yet-active touches NULL).

DO $$
DECLARE
  v_obj uuid;
  v_ws uuid;
  v_app uuid;
  v_due_view uuid := 'de16537c-39f9-46c6-8f0b-8be05b086c9d'; -- existing "Needs My Approval"
  v_upc_view uuid := 'dc100001-0000-4000-8000-0000000000a1';
  -- field ids
  f_status uuid := '7c5a292d-cc36-4a60-838c-62a7c7cac458';
  f_sched  uuid := 'cf8623fe-6a0b-4406-8f24-ee4d84f7ad6b';
  f_touch  uuid := 'bd202949-8b6c-434d-93a5-e3a29a0dd4f2';
  f_lead   uuid := 'c57f0740-0995-485c-9eba-f579d9eff9fe';
  f_name   uuid := '3fb7ccf9-d503-4bd6-b7fb-794bb1142508';
  f_co     uuid := 'e547ecd6-2e9b-4905-b88c-206f4d2a5bdc';
  f_subj   uuid := '7e85070f-de1a-451b-a77d-cbd520793889';
  f_recip  uuid := '4fd0aeb2-8d29-46e5-81b0-c00218c8e6b6';
  -- group ids (Due Today)
  gA uuid := 'da000001-0000-4000-8000-000000000001'; -- root AND
  gB uuid := 'da000001-0000-4000-8000-000000000002'; -- OR (dates)
  -- group ids (Upcoming)
  uA uuid := 'da000002-0000-4000-8000-000000000001';
BEGIN
  SELECT "objectMetadataId", "workspaceId", "applicationId" INTO v_obj, v_ws, v_app
    FROM core.view WHERE id = v_due_view;

  -- ===== DUE TODAY (repoint existing view) =====
  UPDATE core.view SET name = '🔥 Due Today', icon = 'IconFlame' WHERE id = v_due_view;
  DELETE FROM core."viewFilter" WHERE "viewId" = v_due_view;
  DELETE FROM core."viewFilterGroup" WHERE "viewId" = v_due_view;

  INSERT INTO core."viewFilterGroup" (id,"universalIdentifier","viewId","logicalOperator","parentViewFilterGroupId","workspaceId","applicationId","positionInViewFilterGroup") VALUES
    (gA, gen_random_uuid(), v_due_view, 'AND', NULL, v_ws, v_app, 0),
    (gB, gen_random_uuid(), v_due_view, 'OR',  gA,   v_ws, v_app, 1);

  INSERT INTO core."viewFilter" (id,"universalIdentifier","fieldMetadataId",operand,value,"viewFilterGroupId","viewId","workspaceId","applicationId","positionInViewFilterGroup") VALUES
    (gen_random_uuid(), gen_random_uuid(), f_status, 'IS',        '["PENDING"]'::jsonb, gA, v_due_view, v_ws, v_app, 0),
    (gen_random_uuid(), gen_random_uuid(), f_sched,  'IS_IN_PAST', '{}'::jsonb,          gB, v_due_view, v_ws, v_app, 0),
    (gen_random_uuid(), gen_random_uuid(), f_sched,  'IS_TODAY',   '{}'::jsonb,          gB, v_due_view, v_ws, v_app, 1);

  -- ===== UPCOMING (new view) =====
  DELETE FROM core.view WHERE id = v_upc_view OR (("objectMetadataId" = v_obj) AND name = '📅 Upcoming');
  INSERT INTO core.view (id,"universalIdentifier",name,"objectMetadataId",type,icon,position,"isCompact","isCustom","openRecordIn","workspaceId","applicationId",visibility)
  VALUES (v_upc_view, gen_random_uuid(), '📅 Upcoming', v_obj, 'TABLE','IconCalendarDue', 2, false, true, 'SIDE_PANEL', v_ws, v_app, 'WORKSPACE');

  INSERT INTO core."viewFilterGroup" (id,"universalIdentifier","viewId","logicalOperator","parentViewFilterGroupId","workspaceId","applicationId","positionInViewFilterGroup")
  VALUES (uA, gen_random_uuid(), v_upc_view, 'AND', NULL, v_ws, v_app, 0);

  INSERT INTO core."viewFilter" (id,"universalIdentifier","fieldMetadataId",operand,value,"viewFilterGroupId","viewId","workspaceId","applicationId","positionInViewFilterGroup") VALUES
    (gen_random_uuid(), gen_random_uuid(), f_status, 'IS',           '["PENDING"]'::jsonb, uA, v_upc_view, v_ws, v_app, 0),
    (gen_random_uuid(), gen_random_uuid(), f_sched,  'IS_IN_FUTURE', '{}'::jsonb,           uA, v_upc_view, v_ws, v_app, 1);

  INSERT INTO core."viewSort" (id,"universalIdentifier","fieldMetadataId",direction,"viewId","workspaceId","applicationId") VALUES
    (gen_random_uuid(), gen_random_uuid(), f_sched, 'ASC', v_upc_view, v_ws, v_app);

  INSERT INTO core."viewField" (id,"universalIdentifier","fieldMetadataId","isVisible",size,position,"viewId","workspaceId","applicationId") VALUES
    (gen_random_uuid(), gen_random_uuid(), f_name,  true, 220, 0, v_upc_view, v_ws, v_app),
    (gen_random_uuid(), gen_random_uuid(), f_sched, true, 150, 1, v_upc_view, v_ws, v_app),
    (gen_random_uuid(), gen_random_uuid(), f_lead,  true, 160, 2, v_upc_view, v_ws, v_app),
    (gen_random_uuid(), gen_random_uuid(), f_co,    true, 160, 3, v_upc_view, v_ws, v_app),
    (gen_random_uuid(), gen_random_uuid(), f_subj,  true, 300, 4, v_upc_view, v_ws, v_app),
    (gen_random_uuid(), gen_random_uuid(), f_touch, true,  90, 5, v_upc_view, v_ws, v_app);

  RAISE NOTICE 'Due Today rebuilt + Upcoming created';
END $$;

SELECT v.name, (SELECT count(*) FROM core."viewFilter" WHERE "viewId"=v.id) AS filters,
               (SELECT count(*) FROM core."viewFilterGroup" WHERE "viewId"=v.id) AS groups
FROM core.view v WHERE v.name IN ('🔥 Due Today','📅 Upcoming') ORDER BY v.position;
