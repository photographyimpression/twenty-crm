-- Seed 12-Touch Lead Sequence + Execute Approved Touch workflows
-- Run on your OVH server: docker exec -i twenty-db psql -U postgres -d default < seed-workflows.sql
-- Or: psql -U postgres -d default < seed-workflows.sql

-- Find the workspace schema name
DO $$
DECLARE
  ws_schema TEXT;
BEGIN
  -- Get first workspace schema (format: workspace_XXXX)
  SELECT schema_name INTO ws_schema
  FROM information_schema.schemata
  WHERE schema_name LIKE 'workspace_%'
  LIMIT 1;

  IF ws_schema IS NULL THEN
    RAISE EXCEPTION 'No workspace schema found';
  END IF;

  RAISE NOTICE 'Using schema: %', ws_schema;

  -- Create Workflow A: 12-Touch Lead Sequence
  EXECUTE format('
    INSERT INTO %I.workflow (id, name, "lastPublishedVersionId", statuses, position, "createdBySource", "createdByName")
    VALUES (
      %L, %L, %L, %L::text[], 2, %L, %L
    ) ON CONFLICT (id) DO NOTHING',
    ws_schema,
    'f1a2b3c4-d5e6-4f78-9012-abcdef123456',
    '12-Touch Lead Sequence',
    'a2b3c4d5-e6f7-4890-1234-bcdef1234567',
    '{DRAFT}',
    'SYSTEM',
    'System'
  );

  -- Create Workflow B: Execute Approved Touch
  EXECUTE format('
    INSERT INTO %I.workflow (id, name, "lastPublishedVersionId", statuses, position, "createdBySource", "createdByName")
    VALUES (
      %L, %L, %L, %L::text[], 3, %L, %L
    ) ON CONFLICT (id) DO NOTHING',
    ws_schema,
    'b3c4d5e6-f7a8-4901-2345-cdef12345678',
    'Execute Approved Touch',
    'c4d5e6f7-a8b9-4012-3456-def123456789',
    '{DRAFT}',
    'SYSTEM',
    'System'
  );

  -- Create Version for Workflow A (webhook trigger + all steps)
  EXECUTE format('
    INSERT INTO %I."workflowVersion" (id, name, trigger, steps, status, position, "workflowId")
    VALUES (
      %L, %L, %L::jsonb, %L::jsonb, %L, 1, %L
    ) ON CONFLICT (id) DO NOTHING',
    ws_schema,
    'a2b3c4d5-e6f7-4890-1234-bcdef1234567',
    'v1',
    -- TRIGGER
    '{"name":"Website Pricing Form","type":"WEBHOOK","settings":{"outputSchema":{"firstName":{"type":"TEXT","label":"First Name","value":"John","isLeaf":true},"lastName":{"type":"TEXT","label":"Last Name","value":"Doe","isLeaf":true},"email":{"type":"TEXT","label":"Email","value":"john@example.com","isLeaf":true},"company":{"type":"TEXT","label":"Company","value":"Acme","isLeaf":true},"productType":{"type":"TEXT","label":"Product Type","value":"Jewelry","isLeaf":true}},"httpMethod":"POST"},"nextStepIds":["10000001-0001-4000-8000-000000000001"]}',
    -- STEPS (Company, Person, Opportunity, Task, IF_ELSE, Loom Task, 12 Approval records)
    '[{"id":"10000001-0001-4000-8000-000000000001","name":"Create Company","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"company","objectRecord":{"name":"{{trigger.company}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":false}}},"__typename":"WorkflowAction","nextStepIds":["10000001-0002-4000-8000-000000000002"]},{"id":"10000001-0002-4000-8000-000000000002","name":"Create Person","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"person","objectRecord":{"name":{"firstName":"{{trigger.firstName}}","lastName":"{{trigger.lastName}}"},"emails":{"primaryEmail":"{{trigger.email}}","additionalEmails":[]},"companyId":"{{10000001-0001-4000-8000-000000000001.id}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":false}}},"__typename":"WorkflowAction","nextStepIds":["10000001-0003-4000-8000-000000000003"]},{"id":"10000001-0003-4000-8000-000000000003","name":"Create Opportunity","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"opportunity","objectRecord":{"name":"{{trigger.productType}} photography - {{trigger.company}}","stage":"INCOMING","companyId":"{{10000001-0001-4000-8000-000000000001.id}}","pointOfContactId":"{{10000001-0002-4000-8000-000000000002.id}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":true}}},"__typename":"WorkflowAction","nextStepIds":["10000001-0004-4000-8000-000000000004"]},{"id":"10000001-0004-4000-8000-000000000004","name":"Create Follow-Up Task","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"task","objectRecord":{"title":"Follow up: {{trigger.firstName}} {{trigger.lastName}} @ {{trigger.company}} ({{trigger.productType}})","status":"TODO"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":true}}},"__typename":"WorkflowAction","nextStepIds":["10000001-0007-4000-8000-000000000007"]},{"id":"10000001-0007-4000-8000-000000000007","name":"Touch 1: Pricing Email","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"approval","objectRecord":{"name":"Touch 1: Pricing email to {{trigger.firstName}}","actionType":"SEND_EMAIL","approvalStatus":"PENDING","touchNumber":1,"emailSubject":"Your Pricing Request - Impression Photography","emailBody":"Hello {{trigger.firstName}},\\n\\nThanks for your pricing request!\\n\\nAt what number can I reach you to get more info about your project?\\n\\nMoshe Lerner\\nImpression Photography | Montreal","recipientEmail":"{{10000001-0002-4000-8000-000000000002.emails.primaryEmail}}","leadName":"{{trigger.firstName}} {{trigger.lastName}}","companyName":"{{trigger.company}}","productType":"{{trigger.productType}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":true}}},"__typename":"WorkflowAction","nextStepIds":["10000001-0008-4000-8000-000000000008"]},{"id":"10000001-0008-4000-8000-000000000008","name":"Touch 2: LinkedIn","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"approval","objectRecord":{"name":"Touch 2: LinkedIn connect {{trigger.firstName}}","actionType":"LINKEDIN_CONNECT","approvalStatus":"PENDING","touchNumber":2,"emailSubject":"LinkedIn Connection","emailBody":"Hi {{trigger.firstName}}, saw you requested pricing for {{trigger.productType}} photography.","recipientEmail":"{{10000001-0002-4000-8000-000000000002.emails.primaryEmail}}","leadName":"{{trigger.firstName}} {{trigger.lastName}}","companyName":"{{trigger.company}}","productType":"{{trigger.productType}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":true}}},"__typename":"WorkflowAction","nextStepIds":["10000001-0009-4000-8000-000000000009"]},{"id":"10000001-0009-4000-8000-000000000009","name":"Touch 3: SMS Alert","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"approval","objectRecord":{"name":"Touch 3: SMS alert for {{trigger.firstName}}","actionType":"SMS_NOTIFY","approvalStatus":"PENDING","touchNumber":3,"emailSubject":"New Lead Alert","emailBody":"New lead: {{trigger.firstName}} {{trigger.lastName}} @ {{trigger.company}} ({{trigger.productType}}). Call now!","recipientEmail":"{{10000001-0002-4000-8000-000000000002.emails.primaryEmail}}","leadName":"{{trigger.firstName}} {{trigger.lastName}}","companyName":"{{trigger.company}}","productType":"{{trigger.productType}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":true}}},"__typename":"WorkflowAction","nextStepIds":["10000001-000b-4000-8000-00000000000b"]},{"id":"10000001-000b-4000-8000-00000000000b","name":"Touch 5: Case Study","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"approval","objectRecord":{"name":"Touch 5: Case study for {{trigger.firstName}}","actionType":"SEND_EMAIL","approvalStatus":"PENDING","touchNumber":5,"emailSubject":"Quick question about your {{trigger.productType}} photography","emailBody":"Hi {{trigger.firstName}},\\n\\nI wanted to share a before/after from a recent {{trigger.productType}} shoot.\\n\\nWould you like to hop on a quick 5-min call?\\n\\nMoshe","recipientEmail":"{{10000001-0002-4000-8000-000000000002.emails.primaryEmail}}","leadName":"{{trigger.firstName}} {{trigger.lastName}}","companyName":"{{trigger.company}}","productType":"{{trigger.productType}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":true}}},"__typename":"WorkflowAction","nextStepIds":["10000001-000c-4000-8000-00000000000c"]},{"id":"10000001-000c-4000-8000-00000000000c","name":"Touch 6: Free Test Shot","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"approval","objectRecord":{"name":"Touch 6: Free test shot for {{trigger.company}}","actionType":"SEND_EMAIL","approvalStatus":"PENDING","touchNumber":6,"emailSubject":"Free test shot for {{trigger.company}}","emailBody":"Hi {{trigger.firstName}},\\n\\nI am doing a shoot for a similar {{trigger.productType}} brand next week. Send a single test item and I will shoot it free.\\n\\nLocal Montreal pickup available.\\n\\nMoshe","recipientEmail":"{{10000001-0002-4000-8000-000000000002.emails.primaryEmail}}","leadName":"{{trigger.firstName}} {{trigger.lastName}}","companyName":"{{trigger.company}}","productType":"{{trigger.productType}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":true}}},"__typename":"WorkflowAction","nextStepIds":["10000001-000d-4000-8000-00000000000d"]},{"id":"10000001-000d-4000-8000-00000000000d","name":"Touch 7: Phone Call","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"approval","objectRecord":{"name":"Touch 7: Call {{trigger.firstName}} @ {{trigger.company}}","actionType":"PHONE_TASK","approvalStatus":"PENDING","touchNumber":7,"emailSubject":"Call {{trigger.firstName}} @ {{trigger.company}}","emailBody":"Manual phone call attempt. Reference their {{trigger.productType}} inquiry.","recipientEmail":"{{10000001-0002-4000-8000-000000000002.emails.primaryEmail}}","leadName":"{{trigger.firstName}} {{trigger.lastName}}","companyName":"{{trigger.company}}","productType":"{{trigger.productType}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":true}}},"__typename":"WorkflowAction","nextStepIds":["10000001-000e-4000-8000-00000000000e"]},{"id":"10000001-000e-4000-8000-00000000000e","name":"Touch 8: LinkedIn DM","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"approval","objectRecord":{"name":"Touch 8: LinkedIn DM {{trigger.firstName}}","actionType":"LINKEDIN_DM","approvalStatus":"PENDING","touchNumber":8,"emailSubject":"Portfolio for {{trigger.company}}","emailBody":"Hi {{trigger.firstName}}, thought you might like this recent {{trigger.productType}} shoot.","recipientEmail":"{{10000001-0002-4000-8000-000000000002.emails.primaryEmail}}","leadName":"{{trigger.firstName}} {{trigger.lastName}}","companyName":"{{trigger.company}}","productType":"{{trigger.productType}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":true}}},"__typename":"WorkflowAction","nextStepIds":["10000001-000f-4000-8000-000000000010"]},{"id":"10000001-000f-4000-8000-000000000010","name":"Touch 9: Testimonial","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"approval","objectRecord":{"name":"Touch 9: Testimonial for {{trigger.firstName}}","actionType":"SEND_EMAIL","approvalStatus":"PENDING","touchNumber":9,"emailSubject":"What our clients say about {{trigger.productType}} shoots","emailBody":"Hi {{trigger.firstName}},\\n\\nHere is what a recent client said about working with us.\\n\\nWould love to deliver the same results for {{trigger.company}}.\\n\\nMoshe","recipientEmail":"{{10000001-0002-4000-8000-000000000002.emails.primaryEmail}}","leadName":"{{trigger.firstName}} {{trigger.lastName}}","companyName":"{{trigger.company}}","productType":"{{trigger.productType}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":true}}},"__typename":"WorkflowAction","nextStepIds":["10000001-0010-4000-8000-000000000011"]},{"id":"10000001-0010-4000-8000-000000000011","name":"Touch 10: Call #3","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"approval","objectRecord":{"name":"Touch 10: Call {{trigger.firstName}} #3","actionType":"PHONE_TASK","approvalStatus":"PENDING","touchNumber":10,"emailSubject":"Call {{trigger.firstName}} @ {{trigger.company}} #3","emailBody":"Phone call attempt #3.","recipientEmail":"{{10000001-0002-4000-8000-000000000002.emails.primaryEmail}}","leadName":"{{trigger.firstName}} {{trigger.lastName}}","companyName":"{{trigger.company}}","productType":"{{trigger.productType}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":true}}},"__typename":"WorkflowAction","nextStepIds":["10000001-0011-4000-8000-000000000012"]},{"id":"10000001-0011-4000-8000-000000000012","name":"Touch 11: Special Offer","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"approval","objectRecord":{"name":"Touch 11: Special offer for {{trigger.company}}","actionType":"SEND_EMAIL","approvalStatus":"PENDING","touchNumber":11,"emailSubject":"Special offer for {{trigger.company}} - this week only","emailBody":"Hi {{trigger.firstName}},\\n\\nI have a special package deal for {{trigger.productType}} photography this month.\\n\\nMoshe","recipientEmail":"{{10000001-0002-4000-8000-000000000002.emails.primaryEmail}}","leadName":"{{trigger.firstName}} {{trigger.lastName}}","companyName":"{{trigger.company}}","productType":"{{trigger.productType}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":true}}},"__typename":"WorkflowAction","nextStepIds":["10000001-0012-4000-8000-000000000013"]},{"id":"10000001-0012-4000-8000-000000000013","name":"Touch 12: Breakup","type":"CREATE_RECORD","valid":true,"settings":{"input":{"objectName":"approval","objectRecord":{"name":"Touch 12: Breakup email for {{trigger.firstName}}","actionType":"SEND_EMAIL","approvalStatus":"PENDING","touchNumber":12,"emailSubject":"Is {{trigger.productType}} photography still a priority?","emailBody":"Hi {{trigger.firstName}},\\n\\nI wanted to check in one last time. Is {{trigger.productType}} photography still a priority for {{trigger.company}}?\\n\\nIf not, no worries. I will keep your info on file.\\n\\nBest,\\nMoshe Lerner\\nImpression Photography | Montreal","recipientEmail":"{{10000001-0002-4000-8000-000000000002.emails.primaryEmail}}","leadName":"{{trigger.firstName}} {{trigger.lastName}}","companyName":"{{trigger.company}}","productType":"{{trigger.productType}}"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":false},"continueOnFailure":{"value":true}}},"__typename":"WorkflowAction","nextStepIds":null}]',
    'DRAFT',
    'f1a2b3c4-d5e6-4f78-9012-abcdef123456'
  );

  -- Create Version for Workflow B (database event trigger)
  EXECUTE format('
    INSERT INTO %I."workflowVersion" (id, name, trigger, steps, status, position, "workflowId")
    VALUES (
      %L, %L, %L::jsonb, %L::jsonb, %L, 1, %L
    ) ON CONFLICT (id) DO NOTHING',
    ws_schema,
    'c4d5e6f7-a8b9-4012-3456-def123456789',
    'v1',
    '{"name":"On Approval Status Change","type":"DATABASE_EVENT","settings":{"eventName":"approval.updated","outputSchema":{}},"nextStepIds":["20000001-0001-4000-8000-000000000001"]}',
    '[{"id":"20000001-0001-4000-8000-000000000001","name":"Find Approval","type":"FIND_RECORDS","valid":true,"settings":{"input":{"objectName":"approval","filter":{"gqlOperationFilter":[{"id":{"eq":"{{trigger.recordId}}"}}]},"limit":1},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":true},"continueOnFailure":{"value":false}}},"__typename":"WorkflowAction","nextStepIds":["20000001-0008-4000-8000-000000000008"]},{"id":"20000001-0008-4000-8000-000000000008","name":"Mark Completed","type":"UPDATE_RECORD","valid":true,"settings":{"input":{"objectName":"approval","objectRecordId":"{{20000001-0001-4000-8000-000000000001.first.id}}","objectRecord":{"approvalStatus":"COMPLETED"}},"outputSchema":{},"errorHandlingOptions":{"retryOnFailure":{"value":true},"continueOnFailure":{"value":false}}},"__typename":"WorkflowAction","nextStepIds":null}]',
    'DRAFT',
    'b3c4d5e6-f7a8-4901-2345-cdef12345678'
  );

  RAISE NOTICE 'Both workflows created successfully!';
END $$;
