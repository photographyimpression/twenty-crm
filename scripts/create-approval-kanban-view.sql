-- Kanban view for the Approval object, grouped by approvalStatus
-- (Pending / Approved / Completed / Rejected). Idempotent.
DO $$
DECLARE
  v_obj uuid; v_ws uuid; v_app uuid;
  v_view uuid := gen_random_uuid();
  v_status_field uuid := '7c5a292d-cc36-4a60-838c-62a7c7cac458'; -- approvalStatus (SELECT)
BEGIN
  SELECT "objectMetadataId","workspaceId","applicationId" INTO v_obj,v_ws,v_app
    FROM core.view WHERE id='21feadf7-1988-4ea1-b88a-70e664c5166c';

  DELETE FROM core.view WHERE "objectMetadataId"=v_obj AND name='📋 Approval Board';

  INSERT INTO core.view (id,"universalIdentifier",name,"objectMetadataId",type,icon,position,
                         "isCompact","isCustom","openRecordIn","workspaceId","applicationId",
                         visibility,"mainGroupByFieldMetadataId")
  VALUES (v_view, gen_random_uuid(), '📋 Approval Board', v_obj, 'KANBAN', 'IconLayoutKanban', 3,
          false, true, 'SIDE_PANEL', v_ws, v_app, 'WORKSPACE', v_status_field);

  -- Visible card fields
  INSERT INTO core."viewField" (id,"universalIdentifier","fieldMetadataId","isVisible",size,position,
                                "viewId","workspaceId","applicationId") VALUES
    (gen_random_uuid(),gen_random_uuid(),'3fb7ccf9-d503-4bd6-b7fb-794bb1142508',true,180,0,v_view,v_ws,v_app), -- name
    (gen_random_uuid(),gen_random_uuid(),'c57f0740-0995-485c-9eba-f579d9eff9fe',true,150,1,v_view,v_ws,v_app), -- leadName
    (gen_random_uuid(),gen_random_uuid(),'e547ecd6-2e9b-4905-b88c-206f4d2a5bdc',true,150,2,v_view,v_ws,v_app), -- companyName
    (gen_random_uuid(),gen_random_uuid(),'bd202949-8b6c-434d-93a5-e3a29a0dd4f2',true,80,3,v_view,v_ws,v_app),  -- touchNumber
    (gen_random_uuid(),gen_random_uuid(),'cf8623fe-6a0b-4406-8f24-ee4d84f7ad6b',true,140,4,v_view,v_ws,v_app);  -- scheduledDate

  RAISE NOTICE 'Created kanban view %', v_view;
END $$;

SELECT name, type, icon,
  (SELECT name FROM core."fieldMetadata" WHERE id=v."mainGroupByFieldMetadataId") AS group_by
FROM core.view v WHERE name='📋 Approval Board';
