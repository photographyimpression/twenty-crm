#!/usr/bin/env node

// Creates three pinned "Free Leads" views on the Companies object:
//   1. Free Leads — All            (leadSource is not empty)
//   2. Free Leads — With Contacts  (leadStatus = CONTACT_FOUND)
//   3. Free Leads — Ready to Enroll (leadStatus = READY_TO_ENROLL)
//
// Idempotent: if a view with the same name already exists, it is skipped.
//
// Usage:
//   node scripts/lead-scraping/setup-free-leads-views.mjs --url https://crm.impressionphotography.ca --token YOUR_API_KEY

import { init, findObjectByName } from '../lib/twenty-api.mjs';

const listCustomFieldsForObject = async (client, objectMetadataId) => {
  const data = await client.metadataQuery(`
    query CustomFields {
      fields(paging: { first: 200 }, filter: { isCustom: { is: true } }) {
        edges { node { id name type object { id nameSingular } } }
      }
    }
  `);
  return (data.fields.edges || [])
    .map((e) => e.node)
    .filter((f) => f.object?.id === objectMetadataId);
};

const listExistingViews = async (client, objectMetadataId) => {
  const data = await client.metadataQuery(`
    query CoreViews($objectMetadataId: String) {
      getCoreViews(objectMetadataId: $objectMetadataId) { id name objectMetadataId }
    }
  `, { objectMetadataId });
  return data.getCoreViews || [];
};

const createView = async (client, input) => {
  const data = await client.metadataQuery(`
    mutation CreateCoreView($input: CreateViewInput!) {
      createCoreView(input: $input) { id name }
    }
  `, { input });
  return data.createCoreView;
};

const createViewFilter = async (client, input) => {
  const data = await client.metadataQuery(`
    mutation CreateCoreViewFilter($input: CreateViewFilterInput!) {
      createCoreViewFilter(input: $input) { id }
    }
  `, { input });
  return data.createCoreViewFilter;
};

const buildViewsSpec = (customFields) => {
  const fieldByName = Object.fromEntries(customFields.map((f) => [f.name, f]));
  const leadSource = fieldByName.leadSource;
  const leadStatus = fieldByName.leadStatus;
  if (!leadSource || !leadStatus) {
    throw new Error('Missing leadSource or leadStatus field. Run setup-lead-fields.mjs first.');
  }

  return [
    {
      name: 'Free Leads — All',
      icon: 'IconSparkles',
      position: 100,
      filters: [
        { fieldMetadataId: leadSource.id, operand: 'IS_NOT_EMPTY', value: {} },
      ],
    },
    {
      name: 'Free Leads — With Contacts',
      icon: 'IconUserCheck',
      position: 101,
      filters: [
        { fieldMetadataId: leadStatus.id, operand: 'IS', value: ['CONTACT_FOUND'] },
      ],
    },
    {
      name: 'Free Leads — Ready to Enroll',
      icon: 'IconRocket',
      position: 102,
      filters: [
        { fieldMetadataId: leadStatus.id, operand: 'IS', value: ['READY_TO_ENROLL'] },
      ],
    },
  ];
};

const main = async () => {
  const { client, url } = init();
  console.log(`\nCreating Free Leads saved views on ${url}...\n`);

  const company = await findObjectByName(client, 'company');
  console.log(`Company object: ${company.id}`);

  const customFields = await listCustomFieldsForObject(client, company.id);
  console.log(`Custom fields on Company: ${customFields.map((f) => f.name).join(', ') || '(none)'}`);

  const existing = await listExistingViews(client, company.id);
  const existingNames = new Set(existing.map((v) => v.name));

  const specs = buildViewsSpec(customFields);
  for (const spec of specs) {
    if (existingNames.has(spec.name)) {
      console.log(`  SKIP: "${spec.name}" already exists`);
      continue;
    }
    try {
      const view = await createView(client, {
        name: spec.name,
        objectMetadataId: company.id,
        icon: spec.icon,
        position: spec.position,
        type: 'TABLE',
        openRecordIn: 'SIDE_PANEL',
        visibility: 'WORKSPACE',
      });
      console.log(`  OK:   Created "${spec.name}" (${view.id})`);
      for (const filter of spec.filters) {
        try {
          await createViewFilter(client, { ...filter, viewId: view.id });
          console.log(`        + filter on ${filter.operand}`);
        } catch (err) {
          console.error(`        filter FAIL: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`  FAIL: "${spec.name}" → ${err.message}`);
    }
  }

  console.log('\n--- Views setup complete ---');
  console.log('Open Twenty CRM → Companies → sidebar → switch to a "Free Leads" view.');
};

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
