#!/usr/bin/env node

// Setup script for per-niche email signatures.
//
// Adds:
//   - `niche` SELECT field on Person (project / clothing / jewel / amazon / ppm)
//   - EmailSignature custom object (niche, name, signatureHtml)
//   - Seeds 5 EmailSignature rows for Impression's photography niches
//
// Usage:
//   node scripts/setup-email-signatures.mjs --url https://crm.impressionphotography.ca --token YOUR_API_KEY
//
// For local dev:
//   node scripts/setup-email-signatures.mjs --url http://localhost:3000 --token YOUR_API_KEY

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const tokenIndex = args.indexOf('--token');

const BASE_URL = urlIndex !== -1 ? args[urlIndex + 1] : process.env.TWENTY_URL || 'http://localhost:3000';
const TOKEN = tokenIndex !== -1 ? args[tokenIndex + 1] : process.env.TWENTY_API_TOKEN;

if (!TOKEN) {
  console.error('Error: API token required.');
  console.error('Usage: node scripts/setup-email-signatures.mjs --url https://your-crm.com --token YOUR_API_KEY');
  process.exit(1);
}

const METADATA_URL = `${BASE_URL}/metadata`;
const API_URL = `${BASE_URL}/graphql`;

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

async function apiQuery(query, variables = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) {
    throw new Error(`API error: ${JSON.stringify(data.errors)}`);
  }
  return data.data;
}

async function listObjects() {
  const data = await metadataQuery(`
    query {
      objects(paging: { first: 200 }) {
        edges {
          node {
            id
            nameSingular
            namePlural
            fields(paging: { first: 100 }) {
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
  return data.objects.edges.map(e => e.node);
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
  if (defaultValue !== undefined) input.defaultValue = defaultValue;

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

async function createObject({ nameSingular, namePlural, labelSingular, labelPlural, description, icon }) {
  const data = await metadataQuery(`
    mutation CreateOneObject($input: CreateOneObjectInput!) {
      createOneObject(input: $input) {
        id
        nameSingular
        namePlural
      }
    }
  `, {
    input: {
      object: {
        nameSingular,
        namePlural,
        labelSingular,
        labelPlural,
        description: description || '',
        icon: icon || 'IconSignature',
      },
    },
  });
  return data.createOneObject;
}

const NICHE_OPTIONS = [
  { label: 'Product / General Photography', value: 'PRODUCT', position: 0, color: 'sky' },
  { label: 'Clothing Photography',           value: 'CLOTHING', position: 1, color: 'pink' },
  { label: 'Jewellery Photography',          value: 'JEWEL', position: 2, color: 'purple' },
  { label: 'Amazon Photography',             value: 'AMAZON', position: 3, color: 'orange' },
  { label: 'Product Photography Montreal',   value: 'PPM', position: 4, color: 'green' },
];

// The signature HTML lives in scripts/sig-assets/<niche>.html — extracted
// verbatim from Moshe's Outlook drafts (May 2026), with cid: image refs
// rewritten to https://crm.impressionphotography.ca/sig-images/<name>.jpg
// (deployed by scripts/deploy-sig-assets.sh — run that once to host the
// images on the OVH nginx).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sigAsset = (file) => readFileSync(join(__dirname, 'sig-assets', file), 'utf8').trim();

const SIGNATURES = [
  { niche: 'PRODUCT',  name: 'Standard / Product',            signatureHtml: sigAsset('product.html')  },
  { niche: 'CLOTHING', name: 'Clothing',                      signatureHtml: sigAsset('clothing.html') },
  { niche: 'JEWEL',    name: 'Jewellery',                     signatureHtml: sigAsset('jewel.html')    },
  { niche: 'AMAZON',   name: 'Amazon',                        signatureHtml: sigAsset('amazon.html')   },
  { niche: 'PPM',      name: 'Product Photography Montreal', signatureHtml: sigAsset('ppm.html')      },
];

async function main() {
  console.log(`\nConnecting to ${BASE_URL}...\n`);

  const objects = await listObjects();
  const objectMap = Object.fromEntries(objects.map(o => [o.nameSingular, o]));

  // 1) Add `niche` to Person (idempotent — "already used" error is treated as success)
  console.log('Step 1: Add niche field to Person');
  const person = objectMap['person'];
  if (!person) {
    throw new Error('Person object not found');
  }
  try {
    const result = await createField({
      objectMetadataId: person.id,
      name: 'niche',
      label: 'Niche',
      type: 'SELECT',
      description: 'Photography niche — drives auto-selected email signature when {{signature}} placeholder is used.',
      options: NICHE_OPTIONS,
      defaultValue: "'PRODUCT'",
    });
    console.log(`  OK: Created person.niche → ${result.id}`);
  } catch (err) {
    if (/already used by another field/i.test(err.message) || /NOT_AVAILABLE/.test(err.message)) {
      console.log('  SKIP: person.niche already exists');
    } else {
      console.error(`  FAIL: person.niche → ${err.message}`);
      throw err;
    }
  }

  // 2) Create EmailSignature object (idempotent — "already exists" treated as success)
  console.log('\nStep 2: Create EmailSignature object');
  let emailSignature = objectMap['emailSignature'];
  if (emailSignature) {
    console.log(`  SKIP: emailSignature object already exists → ${emailSignature.id}`);
  } else {
    try {
      const result = await createObject({
        nameSingular: 'emailSignature',
        namePlural: 'emailSignatures',
        labelSingular: 'Email Signature',
        labelPlural: 'Email Signatures',
        description: 'Per-niche email signature applied when {{signature}} placeholder is used in an email body.',
        icon: 'IconSignature',
      });
      console.log(`  OK: Created emailSignature → ${result.id}`);
      const refreshed = await listObjects();
      emailSignature = refreshed.find(o => o.nameSingular === 'emailSignature');
    } catch (err) {
      if (/already used|NOT_AVAILABLE/i.test(err.message)) {
        console.log('  SKIP: emailSignature object already exists, refetching...');
        const refreshed = await listObjects();
        emailSignature = refreshed.find(o => o.nameSingular === 'emailSignature');
      } else {
        console.error(`  FAIL: emailSignature object → ${err.message}`);
        throw err;
      }
    }
  }

  if (!emailSignature) {
    throw new Error('emailSignature object could not be located after create attempt.');
  }

  // 3) Add fields to EmailSignature (idempotent)
  console.log('\nStep 3: Add fields to EmailSignature');

  const fieldsToCreate = [
    {
      name: 'niche',
      label: 'Niche',
      type: 'SELECT',
      description: 'Which photography niche this signature belongs to.',
      options: NICHE_OPTIONS,
      defaultValue: "'PRODUCT'",
    },
    {
      name: 'signatureHtml',
      label: 'Signature HTML',
      type: 'TEXT',
      description: 'HTML body that will replace the {{signature}} placeholder in outgoing emails.',
    },
  ];

  for (const field of fieldsToCreate) {
    try {
      const result = await createField({
        objectMetadataId: emailSignature.id,
        ...field,
      });
      console.log(`  OK: Created emailSignature.${field.name} (${field.type}) → ${result.id}`);
    } catch (err) {
      if (/already used|NOT_AVAILABLE/i.test(err.message)) {
        console.log(`  SKIP: emailSignature.${field.name} already exists`);
      } else {
        console.error(`  FAIL: emailSignature.${field.name} → ${err.message}`);
      }
    }
  }

  // 4) Seed signature rows
  console.log('\nStep 4: Seed signature rows');
  // First check existing rows
  let existingByNiche = {};
  try {
    const data = await apiQuery(`
      query {
        emailSignatures(first: 100) {
          edges {
            node {
              id
              niche
              name
            }
          }
        }
      }
    `);
    existingByNiche = Object.fromEntries(
      data.emailSignatures.edges.map(e => [e.node.niche, e.node])
    );
  } catch (err) {
    console.log(`  (Could not list existing signatures: ${err.message}. Will attempt creation.)`);
  }

  for (const sig of SIGNATURES) {
    const existing = existingByNiche[sig.niche];
    if (existing) {
      // Update existing row so re-runs pull in the latest HTML from sig-assets/.
      try {
        await apiQuery(`
          mutation U($id: UUID!, $data: EmailSignatureUpdateInput!) {
            updateEmailSignature(id: $id, data: $data) { id }
          }
        `, {
          id: existing.id,
          data: { name: sig.name, signatureHtml: sig.signatureHtml },
        });
        console.log(`  UPDATE: ${sig.niche} (${sig.name}) → ${existing.id}`);
      } catch (err) {
        console.error(`  FAIL update ${sig.niche} → ${err.message}`);
      }
      continue;
    }
    try {
      const result = await apiQuery(`
        mutation CreateOneEmailSignature($data: EmailSignatureCreateInput!) {
          createEmailSignature(data: $data) {
            id
            niche
            name
          }
        }
      `, {
        data: {
          niche: sig.niche,
          name: sig.name,
          signatureHtml: sig.signatureHtml,
        },
      });
      if (!result || !result.createEmailSignature) {
        throw new Error(`Mutation returned no data: ${JSON.stringify(result)}`);
      }
      console.log(`  CREATE: ${sig.niche} (${sig.name}) → ${result.createEmailSignature.id}`);
    } catch (err) {
      console.error(`  FAIL: ${sig.niche} → ${err.message}`);
    }
  }

  // 5) Add new fields to default views so they're visible in CRM UI.
  //    Custom fields are created with no view-fields by default; users would
  //    have to manually edit the layout to see them. We pre-add them here.
  console.log('\nStep 5: Surface new fields in default views');

  async function findFieldByName(objectId, fieldName) {
    const data = await metadataQuery(`
      query Obj($id: UUID!) {
        object(id: $id) {
          id
          fields(paging: { first: 200 }) { edges { node { id name } } }
        }
      }
    `, { id: objectId });
    const edge = data.object?.fields?.edges?.find(e => e.node.name === fieldName);
    return edge?.node;
  }

  const personNicheField = await findFieldByName(person.id, 'niche');
  const sigNicheField = await findFieldByName(emailSignature.id, 'niche');
  const sigHtmlField = await findFieldByName(emailSignature.id, 'signatureHtml');

  // For each (objectMetadataId, fields[]) pair, get all views and add the
  // fields if not already present. We add to ALL views the object has so the
  // field is visible everywhere.
  async function addFieldsToObjectViews(objectMetadataId, fieldsToAdd) {
    if (!fieldsToAdd.length) return;
    let views;
    try {
      const data = await metadataQuery(`
        query Views($oid: String) {
          getCoreViews(objectMetadataId: $oid) {
            id
            name
            type
            viewFields { id fieldMetadataId }
          }
        }
      `, { oid: objectMetadataId });
      views = data.getCoreViews ?? [];
    } catch (err) {
      console.error(`  FAIL: load views for ${objectMetadataId} → ${err.message}`);
      return;
    }
    if (!views.length) {
      console.log(`  (No views found for ${objectMetadataId} — skipping)`);
      return;
    }
    for (const view of views) {
      const existingFieldIds = new Set((view.viewFields ?? []).map(f => f.fieldMetadataId));
      let positionStart = (view.viewFields ?? []).length;
      for (const field of fieldsToAdd) {
        if (existingFieldIds.has(field.id)) {
          console.log(`  SKIP: ${field.name} already on view "${view.name ?? view.id}"`);
          continue;
        }
        try {
          await metadataQuery(`
            mutation CreateCoreViewField($input: CreateViewFieldInput!) {
              createCoreViewField(input: $input) { id }
            }
          `, {
            input: {
              fieldMetadataId: field.id,
              viewId: view.id,
              isVisible: true,
              size: 200,
              position: positionStart++,
            },
          });
          console.log(`  OK: Added ${field.name} to view "${view.name ?? view.id}"`);
        } catch (err) {
          console.error(`  FAIL: ${field.name} on "${view.name ?? view.id}" → ${err.message}`);
        }
      }
    }
  }

  if (personNicheField) {
    await addFieldsToObjectViews(person.id, [personNicheField]);
  }
  if (sigNicheField || sigHtmlField) {
    await addFieldsToObjectViews(emailSignature.id, [sigNicheField, sigHtmlField].filter(Boolean));
  }

  console.log('\n--- Setup Complete ---');
  console.log('Next steps:');
  console.log('  1. Open Email Signatures in the CRM sidebar — verify the 5 signatures look right');
  console.log('  2. Open any Person — set their Niche field');
  console.log('  3. Send an email containing the literal text {{signature}} in its body');
  console.log('     (via EmailComposer or workflow Send Email action)');
  console.log('  4. The {{signature}} placeholder is replaced server-side with the recipient\'s niche signature');
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
