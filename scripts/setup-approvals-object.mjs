#!/usr/bin/env node

// Setup script for the Approvals object fields and relations.
// Creates all custom fields needed for the 12-Touch Lead Workflow approval queue.
//
// Usage:
//   1. Create an API key in Twenty CRM: Settings > APIs & Webhooks > + Create API Key
//   2. Run: node scripts/setup-approvals-object.mjs --url https://crm.impressionphotography.ca --token YOUR_API_KEY
//
// For local dev:
//   node scripts/setup-approvals-object.mjs --url http://localhost:3000 --token YOUR_API_KEY

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const tokenIndex = args.indexOf('--token');

const BASE_URL = urlIndex !== -1 ? args[urlIndex + 1] : process.env.TWENTY_URL || 'http://localhost:3000';
const TOKEN = tokenIndex !== -1 ? args[tokenIndex + 1] : process.env.TWENTY_API_TOKEN;

if (!TOKEN) {
  console.error('Error: API token required.');
  console.error('Usage: node scripts/setup-approvals-object.mjs --url https://your-crm.com --token YOUR_API_KEY');
  console.error('Create an API key in Twenty CRM: Settings > APIs & Webhooks > + Create API Key');
  process.exit(1);
}

const METADATA_URL = `${BASE_URL}/metadata`;
const API_URL = `${BASE_URL}/api`;

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${TOKEN}`,
};

async function metadataQuery(query, variables = {}) {
  const res = await fetch(METADATA_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) {
    throw new Error(`Metadata API error: ${JSON.stringify(data.errors)}`);
  }
  return data.data;
}

async function findApprovalObject() {
  const data = await metadataQuery(`
    query {
      objects(paging: { first: 100 }) {
        edges {
          node {
            id
            nameSingular
            namePlural
            fields(paging: { first: 50 }) {
              edges {
                node {
                  id
                  name
                  type
                }
              }
            }
          }
        }
      }
    }
  `);
  const obj = data.objects.edges.find(e => e.node.nameSingular === 'approval');
  if (!obj) {
    throw new Error('Approval object not found. Create it first in Settings > Data Model > Add Object.');
  }
  return obj.node;
}

async function createField({ objectMetadataId, name, label, type, description, options, defaultValue, isNullable }) {
  const input = {
    objectMetadataId,
    name,
    label,
    type,
    description: description || '',
    isNullable: isNullable !== false,
  };
  if (options) input.options = options;
  if (defaultValue) input.defaultValue = defaultValue;

  const data = await metadataQuery(`
    mutation CreateOneField($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) {
        id
        name
        type
      }
    }
  `, { input: { field: input } });
  return data.createOneField;
}

async function createRelation({ objectMetadataId, relatedObjectId, name, label, relationType, description }) {
  const data = await metadataQuery(`
    mutation CreateOneRelation($input: CreateOneRelationInput!) {
      createOneRelation(input: $input) {
        id
      }
    }
  `, {
    input: {
      relation: {
        fromObjectMetadataId: relatedObjectId,
        fromLabel: label,
        fromName: name,
        fromDescription: description || '',
        toObjectMetadataId: objectMetadataId,
        toLabel: 'Approval',
        toName: 'approval',
        toDescription: '',
        relationType: relationType || 'ONE_TO_MANY',
      },
    },
  });
  return data.createOneRelation;
}

async function main() {
  console.log(`\nConnecting to ${BASE_URL}...\n`);

  // Find the Approval object
  const approval = await findApprovalObject();
  console.log(`Found Approval object: ${approval.id}`);
  const existingFields = new Set(approval.fields.edges.map(e => e.node.name));
  console.log(`Existing fields: ${[...existingFields].join(', ')}\n`);

  // Define fields to create
  const fieldsToCreate = [
    {
      name: 'actionType',
      label: 'Action Type',
      type: 'SELECT',
      description: 'Type of outbound action',
      options: [
        { label: 'Send Email', value: 'SEND_EMAIL', position: 0, color: 'blue' },
        { label: 'LinkedIn Connect', value: 'LINKEDIN_CONNECT', position: 1, color: 'purple' },
        { label: 'LinkedIn DM', value: 'LINKEDIN_DM', position: 2, color: 'purple' },
        { label: 'SMS Notify', value: 'SMS_NOTIFY', position: 3, color: 'green' },
        { label: 'Phone Task', value: 'PHONE_TASK', position: 4, color: 'orange' },
      ],
      defaultValue: "'SEND_EMAIL'",
    },
    {
      name: 'approvalStatus',
      label: 'Approval Status',
      type: 'SELECT',
      description: 'Current approval state',
      options: [
        { label: 'Pending', value: 'PENDING', position: 0, color: 'yellow' },
        { label: 'Approved', value: 'APPROVED', position: 1, color: 'green' },
        { label: 'Rejected', value: 'REJECTED', position: 2, color: 'red' },
        { label: 'Completed', value: 'COMPLETED', position: 3, color: 'sky' },
        { label: 'Failed', value: 'FAILED', position: 4, color: 'gray' },
      ],
      defaultValue: "'PENDING'",
    },
    {
      name: 'scheduledDate',
      label: 'Scheduled Date',
      type: 'DATE_TIME',
      description: 'When this touch should fire (Day 0, 1, 3, etc.)',
    },
    {
      name: 'touchNumber',
      label: 'Touch Number',
      type: 'NUMBER',
      description: 'Touch sequence number (1-12)',
    },
    {
      name: 'emailSubject',
      label: 'Email Subject',
      type: 'TEXT',
      description: 'Subject line for email actions',
    },
    {
      name: 'emailBody',
      label: 'Email Body',
      type: 'TEXT',
      description: 'Email body content for preview and sending',
    },
    {
      name: 'recipientEmail',
      label: 'Recipient Email',
      type: 'TEXT',
      description: 'Target email address',
    },
    {
      name: 'webhookUrl',
      label: 'Webhook URL',
      type: 'TEXT',
      description: 'n8n webhook URL for LinkedIn/SMS actions',
    },
    {
      name: 'connectedAccountId',
      label: 'Connected Account ID',
      type: 'TEXT',
      description: 'Twenty connected account ID for sending emails',
    },
    {
      name: 'leadName',
      label: 'Lead Name',
      type: 'TEXT',
      description: 'Lead full name for quick reference',
    },
    {
      name: 'companyName',
      label: 'Company Name',
      type: 'TEXT',
      description: 'Company name for quick reference',
    },
    {
      name: 'productType',
      label: 'Product Type',
      type: 'TEXT',
      description: 'Product type from form (Jewelry, Amazon, General, Other)',
    },
  ];

  // Create fields
  for (const field of fieldsToCreate) {
    if (existingFields.has(field.name)) {
      console.log(`  SKIP: "${field.label}" already exists`);
      continue;
    }
    try {
      const result = await createField({
        objectMetadataId: approval.id,
        ...field,
      });
      console.log(`  OK: Created "${field.label}" (${field.type}) → ${result.id}`);
    } catch (err) {
      console.error(`  FAIL: "${field.label}" → ${err.message}`);
    }
  }

  // Find Person, Company, Opportunity objects for relations
  console.log('\nSetting up relations...');
  const allObjects = await metadataQuery(`
    query {
      objects(paging: { first: 100 }) {
        edges {
          node {
            id
            nameSingular
          }
        }
      }
    }
  `);

  const objectMap = {};
  for (const edge of allObjects.objects.edges) {
    objectMap[edge.node.nameSingular] = edge.node.id;
  }

  const relationsToCreate = [
    { relatedName: 'person', label: 'Person', name: 'approvals', description: 'Approvals linked to this person' },
    { relatedName: 'company', label: 'Company', name: 'approvals', description: 'Approvals linked to this company' },
    { relatedName: 'opportunity', label: 'Opportunity', name: 'approvals', description: 'Approvals linked to this opportunity' },
  ];

  for (const rel of relationsToCreate) {
    const relatedObjectId = objectMap[rel.relatedName];
    if (!relatedObjectId) {
      console.error(`  SKIP: ${rel.relatedName} object not found`);
      continue;
    }
    try {
      await createRelation({
        objectMetadataId: approval.id,
        relatedObjectId,
        name: rel.name,
        label: rel.label,
        description: rel.description,
      });
      console.log(`  OK: Created relation to ${rel.label}`);
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log(`  SKIP: Relation to ${rel.label} already exists`);
      } else {
        console.error(`  FAIL: Relation to ${rel.label} → ${err.message}`);
      }
    }
  }

  console.log('\n--- Setup Complete ---');
  console.log('Next steps:');
  console.log('1. Open Twenty CRM > Approvals in sidebar to verify');
  console.log('2. Create an API key if you haven\'t already');
  console.log('3. Deploy the workflow code changes');
  console.log('4. Configure your connected email account in the workflow');
  console.log('5. POST test data to the webhook to verify');
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
