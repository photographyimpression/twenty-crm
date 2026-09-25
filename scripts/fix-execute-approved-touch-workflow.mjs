#!/usr/bin/env node

// Fixes the prod "Execute Approved Touch" workflow.
//
// The version that was actually running on prod had a single empty
// UPDATE_RECORD step (no SEND_EMAIL, no IF check) — meaning approvals
// could be marked Approved but no email ever went out. The intended
// design (per prefill-workflows.ts) is: IF approvalStatus=APPROVED →
// SEND_EMAIL → mark COMPLETED.
//
// This script re-applies the intended design over the live workflow,
// keeping the workflowId/versionId stable so any references survive.
//
// Usage:
//   node scripts/fix-execute-approved-touch-workflow.mjs --db-url postgres://USER:PASS@HOST:5432/DBNAME
//
// Idempotent — safe to run multiple times.

import { Client } from 'pg';

const args = process.argv.slice(2);
const dbUrlIndex = args.indexOf('--db-url');
const PG_URL = dbUrlIndex !== -1 ? args[dbUrlIndex + 1] : process.env.PG_DATABASE_URL;

if (!PG_URL) {
  console.error('Error: --db-url or PG_DATABASE_URL required. Format: postgres://USER:PASS@HOST:5432/DBNAME');
  process.exit(1);
}

const STEP = {
  ifApproved: 'c2000001-0001-4000-8000-000000000001',
  filterGroup: 'c2000001-0002-4000-8000-000000000002',
  filterApproved: 'c2000001-0003-4000-8000-000000000003',
  branchYes: 'c2000001-0004-4000-8000-000000000004',
  branchNo: 'c2000001-0005-4000-8000-000000000005',
  sendEmail: 'c2000001-0006-4000-8000-000000000006',
  markCompleted: 'c2000001-0007-4000-8000-000000000007',
};

const trigger = {
  name: 'Approval status changed',
  type: 'DATABASE_EVENT',
  settings: {
    eventName: 'approval.updated',
    outputSchema: {},
    fields: ['approvalStatus'],
  },
  nextStepIds: [STEP.ifApproved],
};

const steps = [
  {
    id: STEP.ifApproved,
    name: 'Is approvalStatus = APPROVED?',
    type: 'IF_ELSE',
    valid: true,
    settings: {
      input: {
        stepFilterGroups: [{ id: STEP.filterGroup, logicalOperator: 'AND' }],
        // SELECT type — TEXT type rejects the IS operand for SELECT enums.
        stepFilters: [{
          id: STEP.filterApproved,
          type: 'SELECT',
          stepOutputKey: '{{trigger.properties.after.approvalStatus}}',
          operand: 'IS',
          value: 'APPROVED',
          stepFilterGroupId: STEP.filterGroup,
        }],
        branches: [
          { id: STEP.branchYes, filterGroupId: STEP.filterGroup, nextStepIds: [STEP.sendEmail] },
          { id: STEP.branchNo, nextStepIds: [] },
        ],
      },
      outputSchema: {},
      errorHandlingOptions: { retryOnFailure: { value: false }, continueOnFailure: { value: false } },
    },
    __typename: 'WorkflowAction',
    nextStepIds: null,
  },
  {
    id: STEP.sendEmail,
    name: 'Send Email',
    type: 'SEND_EMAIL',
    valid: true,
    settings: {
      input: {
        // Empty connectedAccountId — composer falls back to the workspace's
        // first connected message channel (Outlook/Microsoft for this user).
        // EmailSendService runs resolveSignaturePlaceholder before send,
        // so the recipient's per-niche signature is auto-attached.
        connectedAccountId: '',
        recipients: { to: '{{trigger.properties.after.recipientEmail}}' },
        subject: '{{trigger.properties.after.emailSubject}}',
        body: '{{trigger.properties.after.emailBody}}',
      },
      outputSchema: {},
      errorHandlingOptions: { retryOnFailure: { value: true }, continueOnFailure: { value: false } },
    },
    __typename: 'WorkflowAction',
    nextStepIds: [STEP.markCompleted],
  },
  {
    id: STEP.markCompleted,
    name: 'Mark Approval Completed',
    type: 'UPDATE_RECORD',
    valid: true,
    settings: {
      input: {
        objectName: 'approval',
        objectRecordId: '{{trigger.recordId}}',
        fieldsToUpdate: ['approvalStatus'],
        objectRecord: { approvalStatus: 'COMPLETED' },
      },
      outputSchema: {},
      errorHandlingOptions: { retryOnFailure: { value: true }, continueOnFailure: { value: false } },
    },
    __typename: 'WorkflowAction',
    nextStepIds: null,
  },
];

async function getWorkspaceSchema(pg) {
  const { rows } = await pg.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'workspace_%' LIMIT 1;`,
  );
  if (rows.length === 0) throw new Error('No workspace schema found in DB');
  return rows[0].schema_name;
}

async function main() {
  const pg = new Client({ connectionString: PG_URL });
  await pg.connect();
  try {
    const schema = await getWorkspaceSchema(pg);
    console.log(`Schema: ${schema}`);

    const { rows } = await pg.query(
      `SELECT w.id AS "workflowId", v.id AS "versionId" FROM "${schema}"."workflow" w JOIN "${schema}"."workflowVersion" v ON v."workflowId" = w.id WHERE w.name = 'Execute Approved Touch';`,
    );
    if (rows.length === 0) throw new Error('Execute Approved Touch workflow not found in this workspace');
    const { workflowId, versionId } = rows[0];

    await pg.query(
      `UPDATE "${schema}"."workflowVersion" SET trigger = $1::jsonb, steps = $2::jsonb, status = 'ACTIVE' WHERE id = $3`,
      [JSON.stringify(trigger), JSON.stringify(steps), versionId],
    );
    console.log(`Updated workflowVersion ${versionId} (3 steps)`);

    await pg.query(
      `UPDATE "${schema}"."workflowAutomatedTrigger" SET settings = $1::jsonb WHERE "workflowId" = $2`,
      [JSON.stringify({ eventName: 'approval.updated', outputSchema: {}, fields: ['approvalStatus'] }), workflowId],
    );
    console.log(`Updated automated trigger for workflow ${workflowId}`);

    console.log('\nDone. Approving an Approval record will now fire SEND_EMAIL via the workspace\'s connected account, with the per-niche signature auto-appended.');
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error('FAIL:', err.message || err);
  process.exit(1);
});
