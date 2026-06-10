#!/usr/bin/env node

// Metadata setup for the Post-Quote Follow-Up sequence.
// 1. Adds the POST_QUOTE_FOLLOWUP option to Person.sequenceTag (SELECT field)
//    via updateOneField so the workspace enum migration + cache invalidation
//    happen through Twenty itself (no manual cache flush needed).
// 2. Adds a nullable TEXT field `sequenceKey` to the Approval object so the
//    Command Center can tell which sequence created each approval.
//
// Usage:
//   node scripts/setup-postquote-metadata.mjs --url https://crm.impressionphotography.ca --token YOUR_API_KEY

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const tokenIndex = args.indexOf('--token');

const BASE_URL = urlIndex !== -1 ? args[urlIndex + 1] : process.env.TWENTY_URL || 'http://localhost:3000';
const TOKEN = tokenIndex !== -1 ? args[tokenIndex + 1] : process.env.TWENTY_API_TOKEN;

if (!TOKEN) {
  console.error('Error: API token required (--token or TWENTY_API_TOKEN).');
  process.exit(1);
}

const METADATA_URL = `${BASE_URL}/metadata`;

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${TOKEN}`,
};

const NEW_SEQUENCE_TAG_OPTION = {
  // Fixed id so reruns stay idempotent and deterministic
  id: '0645d89d-fa48-444a-9378-b0997a968413',
  label: 'Post-Quote Follow-Up',
  value: 'POST_QUOTE_FOLLOWUP',
  color: 'purple',
  position: 1,
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

// The nested fields connection under `objects` returns a truncated set on this
// deployment, so discover custom fields through the root `fields` query instead.
async function getCustomFields() {
  const data = await metadataQuery(`
    query {
      fields(paging: { first: 1000 }, filter: { isCustom: { is: true } }) {
        edges {
          node {
            id
            name
            type
            options
            object {
              id
              nameSingular
            }
          }
        }
      }
    }
  `);
  return data.fields.edges.map((edge) => edge.node);
}

async function addSequenceTagOption(customFields) {
  const sequenceTagField = customFields.find(
    (field) => field.name === 'sequenceTag' && field.object?.nameSingular === 'person',
  );
  if (!sequenceTagField) throw new Error('person.sequenceTag field not found');

  const currentOptions = sequenceTagField.options || [];
  if (currentOptions.some((option) => option.value === NEW_SEQUENCE_TAG_OPTION.value)) {
    console.log('SKIP: sequenceTag already has POST_QUOTE_FOLLOWUP option');
    return;
  }

  // Preserve existing options (ids included) so stored values keep resolving
  const updatedOptions = [...currentOptions, NEW_SEQUENCE_TAG_OPTION];

  const data = await metadataQuery(`
    mutation UpdateOneField($input: UpdateOneFieldMetadataInput!) {
      updateOneField(input: $input) {
        id
        name
        options
      }
    }
  `, {
    input: {
      id: sequenceTagField.id,
      update: { options: updatedOptions },
    },
  });
  console.log('OK: sequenceTag options now:', JSON.stringify(data.updateOneField.options.map((option) => option.value)));
}

async function getApprovalObjectId() {
  const data = await metadataQuery(`
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
  const approval = data.objects.edges.find((edge) => edge.node.nameSingular === 'approval');
  if (!approval) throw new Error('approval object not found');
  return approval.node.id;
}

async function addSequenceKeyField(customFields) {
  const alreadyExists = customFields.some(
    (field) => field.name === 'sequenceKey' && field.object?.nameSingular === 'approval',
  );
  if (alreadyExists) {
    console.log('SKIP: approval.sequenceKey already exists');
    return;
  }

  const approvalObjectId = await getApprovalObjectId();

  const data = await metadataQuery(`
    mutation CreateOneField($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) {
        id
        name
        type
      }
    }
  `, {
    input: {
      field: {
        objectMetadataId: approvalObjectId,
        name: 'sequenceKey',
        label: 'Sequence Key',
        type: 'TEXT',
        description: 'Which sequence created this approval (e.g. PRE_PHONE_EMAIL, POST_QUOTE_FOLLOWUP)',
        isNullable: true,
      },
    },
  });
  console.log(`OK: created approval.sequenceKey → ${data.createOneField.id}`);
}

async function main() {
  console.log(`Connecting to ${BASE_URL}...`);
  const customFields = await getCustomFields();
  await addSequenceTagOption(customFields);
  await addSequenceKeyField(customFields);
  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
