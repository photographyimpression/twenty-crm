#!/usr/bin/env node

// Creates custom fields on Company + Person for lead-scraping tracking.
// Idempotent: skips fields that already exist.
//
// Usage:
//   node scripts/lead-scraping/setup-lead-fields.mjs --url https://crm.impressionphotography.ca --token YOUR_API_KEY

import { init, findObjectByName, createField } from '../lib/twenty-api.mjs';

const COMPANY_FIELDS = [
  {
    name: 'leadSource',
    label: 'Lead Source',
    type: 'SELECT',
    description: 'Where this lead originated from',
    options: [
      { label: 'OpenStreetMap', value: 'OPENSTREETMAP', position: 0, color: 'blue' },
      { label: 'Yellow Pages', value: 'YELLOWPAGES', position: 1, color: 'yellow' },
      { label: 'Quebec REQ', value: 'REQ', position: 2, color: 'purple' },
      { label: 'Website Scrape', value: 'WEBSITE_SCRAPE', position: 3, color: 'green' },
      { label: 'Manual', value: 'MANUAL', position: 4, color: 'gray' },
    ],
  },
  {
    name: 'industry',
    label: 'Industry',
    type: 'SELECT',
    description: 'Primary product category',
    options: [
      { label: 'Jewelry', value: 'JEWELRY', position: 0, color: 'yellow' },
      { label: 'Fashion', value: 'FASHION', position: 1, color: 'pink' },
      { label: 'Clothing', value: 'CLOTHING', position: 2, color: 'blue' },
      { label: 'Accessories', value: 'ACCESSORIES', position: 3, color: 'purple' },
      { label: 'Shoes', value: 'SHOES', position: 4, color: 'orange' },
      { label: 'Bridal', value: 'BRIDAL', position: 5, color: 'red' },
      { label: 'Textile', value: 'TEXTILE', position: 6, color: 'green' },
      { label: 'Leather', value: 'LEATHER', position: 7, color: 'gray' },
    ],
  },
  {
    name: 'leadStatus',
    label: 'Lead Status',
    type: 'SELECT',
    description: 'Workflow stage for outreach',
    options: [
      { label: 'New', value: 'NEW', position: 0, color: 'gray' },
      { label: 'Enriched', value: 'ENRICHED', position: 1, color: 'blue' },
      { label: 'Contact Found', value: 'CONTACT_FOUND', position: 2, color: 'purple' },
      { label: 'Ready to Enroll', value: 'READY_TO_ENROLL', position: 3, color: 'green' },
      { label: 'Enrolled', value: 'ENROLLED', position: 4, color: 'sky' },
      { label: 'Rejected', value: 'REJECTED', position: 5, color: 'red' },
    ],
    defaultValue: "'NEW'",
  },
  {
    name: 'scrapedAt',
    label: 'Scraped At',
    type: 'DATE_TIME',
    description: 'When this lead was first imported',
  },
  {
    name: 'sourceUrl',
    label: 'Source URL',
    type: 'TEXT',
    description: 'Original listing URL from the source',
  },
  {
    name: 'scrapeNotes',
    label: 'Scrape Notes',
    type: 'TEXT',
    description: 'Free-text notes from the scraper (e.g., NAICS code, merge history)',
  },
];

const PERSON_FIELDS = [
  {
    name: 'role',
    label: 'Role',
    type: 'SELECT',
    description: 'Decision-maker type at the company',
    options: [
      { label: 'Owner', value: 'OWNER', position: 0, color: 'green' },
      { label: 'CEO', value: 'CEO', position: 1, color: 'blue' },
      { label: 'CMO', value: 'CMO', position: 2, color: 'purple' },
      { label: 'Marketing', value: 'MARKETING', position: 3, color: 'pink' },
      { label: 'Creative', value: 'CREATIVE', position: 4, color: 'yellow' },
      { label: 'Manager', value: 'MANAGER', position: 5, color: 'sky' },
      { label: 'Other', value: 'OTHER', position: 6, color: 'gray' },
    ],
  },
  {
    name: 'leadSource',
    label: 'Lead Source',
    type: 'SELECT',
    description: 'Where this contact was discovered',
    options: [
      { label: 'OpenStreetMap', value: 'OPENSTREETMAP', position: 0, color: 'blue' },
      { label: 'Yellow Pages', value: 'YELLOWPAGES', position: 1, color: 'yellow' },
      { label: 'Quebec REQ', value: 'REQ', position: 2, color: 'purple' },
      { label: 'Website Scrape', value: 'WEBSITE_SCRAPE', position: 3, color: 'green' },
      { label: 'Manual', value: 'MANUAL', position: 4, color: 'gray' },
    ],
  },
  {
    name: 'confidenceScore',
    label: 'Confidence Score',
    type: 'NUMBER',
    description: '0 to 100 — how sure we are about name + email pairing',
  },
];

const ensureFields = async (client, object, desiredFields) => {
  const existing = new Set(object.fields.edges.map((e) => e.node.name));
  for (const field of desiredFields) {
    if (existing.has(field.name)) {
      console.log(`  SKIP: "${field.label}" already exists on ${object.nameSingular}`);
      continue;
    }
    try {
      const result = await createField(client, { objectMetadataId: object.id, ...field });
      console.log(`  OK:   Created "${field.label}" (${field.type}) on ${object.nameSingular} → ${result.id}`);
    } catch (err) {
      console.error(`  FAIL: "${field.label}" on ${object.nameSingular} → ${err.message}`);
    }
  }
};

const main = async () => {
  const { url, client } = init();
  console.log(`\nConnecting to ${url}...\n`);

  const company = await findObjectByName(client, 'company');
  console.log(`Found Company object: ${company.id}`);
  await ensureFields(client, company, COMPANY_FIELDS);

  const person = await findObjectByName(client, 'person');
  console.log(`\nFound Person object: ${person.id}`);
  await ensureFields(client, person, PERSON_FIELDS);

  console.log('\n--- Setup Complete ---');
  console.log('Next: run node scripts/lead-scraping/scrape-all-leads.mjs --url ... --token ...');
};

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
