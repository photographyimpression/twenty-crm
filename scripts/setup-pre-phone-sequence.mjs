#!/usr/bin/env node

// Setup script for the Pre-Phone Email Sequence workflow + Person.sequenceTag field.
//
// Creates:
//   1. Person.sequenceTag SELECT field (idempotent) — the tag that gates entry
//      into outreach sequences. Today: just "PRE_PHONE_EMAIL". Add more values
//      here as new sequences are introduced.
//   2. "Pre-Phone Email Sequence" workflow (active) — fires when sequenceTag
//      changes on a Person, creates 12 PENDING approval records (subject,
//      body, recipient, lead+company name pre-filled). Touches use the
//      3-3-3-3 cadence: 3 direct asks → 3 trust builders → 3 offers →
//      3 breakup. Single goal: capture the lead's phone number.
//   3. workflowAutomatedTrigger row that registers person.updated as the
//      event source.
//
// The signature is NOT inlined in the email body. EmailSendService.sendNewEmail
// auto-appends the recipient's per-niche signature (Person.niche → emailSignature)
// when the approval is sent. See:
//   packages/twenty-server/src/engine/core-modules/tool/tools/email-tool/utils/resolve-signature-placeholder.util.ts
//
// PREREQS: scripts/setup-approvals-object.mjs has been run (the Approval object
// + 10 fields must exist).
//
// Usage:
//   1. Create an API key in Twenty CRM: Settings > APIs & Webhooks > + Create API Key
//   2. Run: node scripts/setup-pre-phone-sequence.mjs --url https://crm.impressionphotography.ca --token YOUR_API_KEY
//
// For local dev:
//   node scripts/setup-pre-phone-sequence.mjs --url http://localhost:3000 --token YOUR_API_KEY

import { Client } from 'pg';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const tokenIndex = args.indexOf('--token');
const dbUrlIndex = args.indexOf('--db-url');

const BASE_URL = urlIndex !== -1 ? args[urlIndex + 1] : process.env.TWENTY_URL || 'http://localhost:3000';
const TOKEN = tokenIndex !== -1 ? args[tokenIndex + 1] : process.env.TWENTY_API_TOKEN;
const PG_URL = dbUrlIndex !== -1 ? args[dbUrlIndex + 1] : process.env.PG_DATABASE_URL;

if (!TOKEN) {
  console.error('Error: API token required.');
  console.error('Usage: node scripts/setup-pre-phone-sequence.mjs --url https://your-crm.com --token YOUR_API_KEY [--db-url postgres://...]');
  console.error('Create an API key in Twenty CRM: Settings > APIs & Webhooks > + Create API Key');
  process.exit(1);
}

if (!PG_URL) {
  console.error('Error: --db-url or PG_DATABASE_URL required.');
  console.error('The workflow + version + automated trigger rows are inserted directly via SQL because the public GraphQL API does not expose these tables.');
  console.error('Format: postgres://USER:PASS@HOST:5432/DBNAME');
  process.exit(1);
}

const METADATA_URL = `${BASE_URL}/metadata`;
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

async function gql(query, variables = {}) {
  const res = await fetch(METADATA_URL, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors, null, 2));
  return data.data;
}

// --- 1) Add sequenceTag SELECT field to Person --------------------------------

const SEQUENCE_OPTIONS = [
  { label: 'Pre-Phone Email Sequence', value: 'PRE_PHONE_EMAIL', position: 0, color: 'sky' },
];

async function ensureSequenceTagField() {
  console.log('Step 1: ensure person.sequenceTag SELECT field exists');
  const data = await gql(
    `{ objects(paging: { first: 100 }) { edges { node { id nameSingular fields(paging: { first: 200 }) { edges { node { id name type } } } } } } }`,
  );
  const personObj = data.objects.edges.find((e) => e.node.nameSingular === 'person');
  if (!personObj) throw new Error('Person object not found');
  const existing = personObj.node.fields.edges.find((e) => e.node.name === 'sequenceTag');
  if (existing) {
    console.log(`  SKIP: person.sequenceTag already exists (id=${existing.node.id})`);
    return;
  }
  const result = await gql(
    `mutation Create($input: CreateOneFieldMetadataInput!) { createOneField(input: $input) { id } }`,
    {
      input: {
        field: {
          objectMetadataId: personObj.node.id,
          name: 'sequenceTag',
          label: 'Sequence',
          type: 'SELECT',
          description: 'Tag-based trigger for outreach sequences. Set to Pre-Phone Email Sequence to fire the 12-email pre-phone workflow.',
          options: SEQUENCE_OPTIONS,
          isNullable: true,
        },
      },
    },
  );
  console.log(`  OK: created person.sequenceTag (id=${result.createOneField.id})`);
}

// --- 2) Build workflow JSON ---------------------------------------------------

const WORKFLOW_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const VERSION_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
const AUTOTRIGGER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5f';

const STEP = {
  ifPrePhone: 'b1000001-0001-4000-8000-000000000001',
  filterGroup: 'b1000001-0002-4000-8000-000000000002',
  filterTag: 'b1000001-0003-4000-8000-000000000003',
  branchYes: 'b1000001-0004-4000-8000-000000000004',
  branchNo: 'b1000001-0005-4000-8000-000000000005',
  touch1: 'b1000001-1001-4000-8000-000000000001',
  touch2: 'b1000001-1002-4000-8000-000000000002',
  touch3: 'b1000001-1003-4000-8000-000000000003',
  touch4: 'b1000001-1004-4000-8000-000000000004',
  touch5: 'b1000001-1005-4000-8000-000000000005',
  touch6: 'b1000001-1006-4000-8000-000000000006',
  touch7: 'b1000001-1007-4000-8000-000000000007',
  touch8: 'b1000001-1008-4000-8000-000000000008',
  touch9: 'b1000001-1009-4000-8000-000000000009',
  touch10: 'b1000001-100a-4000-8000-00000000000a',
  touch11: 'b1000001-100b-4000-8000-00000000000b',
  touch12: 'b1000001-100c-4000-8000-00000000000c',
};

// person.updated event payload exposes the full updated record at
// trigger.properties.after, with relations enriched. Use that path for
// template variables (NOT trigger.object — that key does not exist).
const FIRST = '{{trigger.properties.after.name.firstName}}';
const COMPANY = '{{trigger.properties.after.company.name}}';
const EMAIL = '{{trigger.properties.after.emails.primaryEmail}}';
const LASTNAME = '{{trigger.properties.after.name.lastName}}';
const NICHE = '{{trigger.properties.after.niche}}';

// 12 touches, 3-3-3-3 cadence. Single goal: get the phone number.
// No {{signature}} marker — EmailSendService auto-appends the per-niche
// signature when the approval is sent.
const TOUCHES = [
  { n: 1, days: 0, subject: `Your pricing request — ${COMPANY}`,
    body: `Hi ${FIRST},\n\nThanks for reaching out about pricing!\n\nTo give you accurate numbers and answer your questions properly, a quick 5-minute call works much better than email back-and-forth. What's the best phone number to reach you?\n\nLooking forward to learning about ${COMPANY}.` },
  { n: 2, days: 1, subject: `Re: Your pricing request — ${COMPANY}`,
    body: `Hi ${FIRST},\n\nJust following up — what's the best number to reach you? Happy to call at a time that works for you.\n\n(If you prefer, just reply with your number and a good time window.)` },
  { n: 3, days: 3, subject: `Quick check — is now a bad time, ${FIRST}?`,
    body: `Hi ${FIRST},\n\nWanted to check in once more. Pricing for ${COMPANY} is something I want to get right for you, and 5 minutes on the phone makes that much easier than emails back-and-forth.\n\nDrop me your number and I'll keep it brief. Or if now's not a good week, just let me know when to circle back.` },
  { n: 4, days: 7, subject: `Quick before/after from a recent shoot`,
    body: `Hi ${FIRST},\n\nWhile we figure out a time to chat, you might enjoy this — a recent before/after from a similar shoot:\n\n[BEFORE_AFTER_LINK]\n\nThe right photography typically lifts product-page conversion by 15–30%. Worth 5 minutes on the phone to see if we're a fit?\n\nBest number to reach you?` },
  { n: 5, days: 10, subject: `How a similar brand grew their conversions`,
    body: `Hi ${FIRST},\n\nQuick story — last quarter we shot for a brand similar to ${COMPANY}. Within 60 days their listing conversion went from 8% to 14%. Same product, just better photography.\n\nI'd love to walk you through what we did and whether it could work for ${COMPANY}. Quick call?` },
  { n: 6, days: 14, subject: `Portfolio piece you might like, ${FIRST}`,
    body: `Hi ${FIRST},\n\nFresh from this week's shoot — thought this might be relevant for ${COMPANY}:\n\n[PORTFOLIO_LINK]\n\nHappy to talk through the lighting and styling we used. What's a good number to call you at?` },
  { n: 7, days: 18, subject: `Free test shot for ${COMPANY}?`,
    body: `Hi ${FIRST},\n\nDifferent angle: I'm doing a shoot for a similar brand next week and I'll have studio time set up. If you can get me one product, I'll shoot it free so you can see the quality before committing to anything.\n\nLocal Montreal pickup or you can ship — whichever works.\n\nReply with your number and I'll set it up.` },
  { n: 8, days: 22, subject: `Special package for ${COMPANY}`,
    body: `Hi ${FIRST},\n\nI have a special package this month for businesses like ${COMPANY} — worth around $400 in extras at no charge.\n\nWould love to discuss whether it fits what you're trying to accomplish. Best way to reach you?` },
  { n: 9, days: 28, subject: `5 minutes, when works?`,
    body: `Hi ${FIRST},\n\nLast try at a time-friendly route — what if we did a 5-minute call this week? Just enough for me to understand your project and tell you if we're a fit.\n\nDrop me your number and a window (e.g., "Tuesday afternoon") and I'll work around you.` },
  { n: 10, days: 35, subject: `Still considering photography for ${COMPANY}?`,
    body: `Hi ${FIRST},\n\nI haven't heard back, so I wanted to check — is photography for ${COMPANY} still on your radar this quarter?\n\nIf yes, what's the best way to keep the conversation going?\nIf no, just let me know and I'll stop bugging you.` },
  { n: 11, days: 45, subject: `Closing your file`,
    body: `Hi ${FIRST},\n\nI'll be closing your inquiry on my end since I haven't heard back. No worries — timing is everything.\n\nIf pricing comes back into focus for ${COMPANY}, just reply to this email and I'll pick up where we left off.\n\nWishing you great success.` },
  { n: 12, days: 60, subject: `Last note from me`,
    body: `Hi ${FIRST},\n\nOne last note — I'm clearing your file from my follow-up list today.\n\nIf you ever need product photography for ${COMPANY}, just reply to any of my emails and I'll be there.\n\nAll the best,` },
];

const stepIdByN = (n) => STEP[`touch${n}`];

const makeApprovalStep = (touch, nextStepId) => ({
  id: stepIdByN(touch.n),
  name: `Create Approval: Touch ${touch.n}`,
  type: 'CREATE_RECORD',
  valid: true,
  settings: {
    input: {
      objectName: 'approval',
      objectRecord: {
        name: `Touch ${touch.n}: ${touch.subject}`,
        actionType: 'SEND_EMAIL',
        approvalStatus: 'PENDING',
        touchNumber: touch.n,
        emailSubject: touch.subject,
        emailBody: touch.body,
        recipientEmail: EMAIL,
        leadName: `${FIRST} ${LASTNAME}`,
        companyName: COMPANY,
        productType: NICHE,
      },
    },
    outputSchema: {},
    errorHandlingOptions: {
      retryOnFailure: { value: false },
      continueOnFailure: { value: true },
    },
  },
  __typename: 'WorkflowAction',
  nextStepIds: nextStepId ? [nextStepId] : null,
});

const ifElseStep = {
  id: STEP.ifPrePhone,
  name: 'Is sequenceTag = Pre-Phone Email?',
  type: 'IF_ELSE',
  valid: true,
  settings: {
    input: {
      stepFilterGroups: [{ id: STEP.filterGroup, logicalOperator: 'AND' }],
      stepFilters: [
        {
          id: STEP.filterTag,
          type: 'SELECT',
          stepOutputKey: '{{trigger.properties.after.sequenceTag}}',
          operand: 'IS',
          value: 'PRE_PHONE_EMAIL',
          stepFilterGroupId: STEP.filterGroup,
        },
      ],
      branches: [
        { id: STEP.branchYes, filterGroupId: STEP.filterGroup, nextStepIds: [STEP.touch1] },
        { id: STEP.branchNo, nextStepIds: [] },
      ],
    },
    outputSchema: {},
    errorHandlingOptions: {
      retryOnFailure: { value: false },
      continueOnFailure: { value: false },
    },
  },
  __typename: 'WorkflowAction',
  nextStepIds: null,
};

const allSteps = [
  ifElseStep,
  ...TOUCHES.map((t, idx) => makeApprovalStep(t, idx < TOUCHES.length - 1 ? stepIdByN(t.n + 1) : null)),
];

const trigger = {
  name: 'Person tagged Pre-Phone Email',
  type: 'DATABASE_EVENT',
  settings: { eventName: 'person.updated', outputSchema: {}, fields: ['sequenceTag'] },
  nextStepIds: [STEP.ifPrePhone],
};

const triggerSettings = { eventName: 'person.updated', outputSchema: {}, fields: ['sequenceTag'] };

// --- 3) Insert workflow into DB -----------------------------------------------

async function getWorkspaceSchema(pg) {
  const { rows } = await pg.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'workspace_%' LIMIT 1;`,
  );
  if (rows.length === 0) throw new Error('No workspace schema found in DB');
  return rows[0].schema_name;
}

async function deployWorkflow() {
  console.log('Step 2: deploy "Pre-Phone Email Sequence" workflow');
  const pg = new Client({ connectionString: PG_URL });
  await pg.connect();
  try {
    const schema = await getWorkspaceSchema(pg);
    console.log(`  Using schema: ${schema}`);

    await pg.query('BEGIN');
    // Idempotent: clear any prior install
    await pg.query(`DELETE FROM "${schema}"."workflowAutomatedTrigger" WHERE id = $1`, [AUTOTRIGGER_ID]);
    await pg.query(`DELETE FROM "${schema}"."workflowVersion" WHERE id = $1`, [VERSION_ID]);
    await pg.query(`DELETE FROM "${schema}"."workflowRun" WHERE "workflowId" = $1`, [WORKFLOW_ID]);
    await pg.query(`DELETE FROM "${schema}"."workflow" WHERE id = $1`, [WORKFLOW_ID]);

    await pg.query(
      `INSERT INTO "${schema}"."workflow"
        (id, name, "lastPublishedVersionId", statuses, position, "createdBySource", "createdByName", "updatedBySource", "updatedByName")
       VALUES ($1, $2, $3, ARRAY['ACTIVE']::"${schema}"."workflow_statuses_enum"[], 10, 'SYSTEM', 'System', 'SYSTEM', 'System')`,
      [WORKFLOW_ID, 'Pre-Phone Email Sequence', VERSION_ID],
    );

    await pg.query(
      `INSERT INTO "${schema}"."workflowVersion"
        (id, name, trigger, steps, status, position, "workflowId")
       VALUES ($1, 'v1', $2::jsonb, $3::jsonb, 'ACTIVE', 1, $4)`,
      [VERSION_ID, JSON.stringify(trigger), JSON.stringify(allSteps), WORKFLOW_ID],
    );

    await pg.query(
      `INSERT INTO "${schema}"."workflowAutomatedTrigger"
        (id, type, settings, "workflowId", "createdBySource", "createdByName", "updatedBySource", "updatedByName", position)
       VALUES ($1, 'DATABASE_EVENT'::"${schema}"."workflowAutomatedTrigger_type_enum", $2::jsonb, $3, 'SYSTEM', 'System', 'SYSTEM', 'System', 1)`,
      [AUTOTRIGGER_ID, JSON.stringify(triggerSettings), WORKFLOW_ID],
    );

    await pg.query('COMMIT');
    console.log(`  OK: workflow ${WORKFLOW_ID} (active), version ${VERSION_ID}, trigger registered`);
  } catch (err) {
    await pg.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await pg.end();
  }
}

// --- main ---------------------------------------------------------------------

async function main() {
  console.log(`\nConnecting to ${BASE_URL}...\n`);
  await ensureSequenceTagField();
  await deployWorkflow();
  console.log('\nDone. Tag any Person with Sequence = "Pre-Phone Email Sequence" to enroll them.');
  console.log(`Workflow runs are visible in the CRM Workflows tab. Approvals appear under the Approvals tab as PENDING.`);
}

main().catch((err) => {
  console.error('\nFAIL:', err.message || err);
  process.exit(1);
});
