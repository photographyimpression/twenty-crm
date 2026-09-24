#!/usr/bin/env node
// One-shot: adds Tina Liu (StyleLine Brands) from the Sep 21, 2026 website
// "Get Free Quote in 60 Seconds" submission. Creates Company + Person
// (CUSTOMER / CLOTHING niche), and a note carrying the form answers and the
// product-snapshot link. Person creation auto-links the synced email thread
// via MessageParticipantPersonListener.
//
// Usage:
//   node scripts/add-tina-liu-quote-customer.mjs --url https://crm.impressionphotography.ca --token $TOKEN

import { init, createCompany, createPerson } from './lib/twenty-api.mjs';

const SNAPSHOT_URL =
  'https://www.impressionphotography.ca/wp-content/uploads/wpforms/3638-00f2cee5f5f2f1c9308fa5b977e7548d/1825-e795e0ec59603ce00fc8ef78f934055a.jpeg';

const run = async () => {
  const { client, dryRun } = init();

  const company = {
    name: 'StyleLine Brands',
    domainName: {
      primaryLinkUrl: 'https://stylelinebrands.com',
      primaryLinkLabel: 'stylelinebrands.com',
    },
    industry: 'FASHION',
  };

  if (dryRun) {
    console.log('DRY RUN — would create:', JSON.stringify({ company, person: { name: { firstName: 'Tina', lastName: 'Liu' } } }, null, 2));
    return;
  }

  const createdCompany = await createCompany(client, company);
  console.log(`Company created: ${createdCompany.id} (${createdCompany.name})`);

  const person = await createPerson(client, {
    name: { firstName: 'Tina', lastName: 'Liu' },
    emails: { primaryEmail: 'tina@stylelinebrands.com', additionalEmails: [] },
    contactType: 'CUSTOMER',
    niche: 'CLOTHING',
    companyId: createdCompany.id,
  });
  console.log(`Person created: ${person.id}`);

  const noteBody = [
    '## Website quote request — Mon, Sep 21, 2026, 11:27 AM',
    '',
    '| Question | Answer |',
    '|---|---|',
    '| What are we shooting? | **Apparel / Fashion** |',
    '| How many photos? | **50–200** |',
    '| Work email | tina@stylelinebrands.com |',
    '',
    `Product snapshot (from the form): [1825.jpeg](${SNAPSHOT_URL})`,
    '',
    '## Thread so far',
    '',
    '1. **Sep 21, 11:27 AM** — quote request received via website form',
    '2. **Sep 21, 2:04 PM** — holiday-closure auto-reply sent',
    '3. **Sep 23, 5:20 PM** — Moshe replied asking for a phone number; noted stylelinebrands.com is not a live site yet',
    '',
    '_No phone number on file yet._',
  ].join('\n');

  const noteData = await client.apiQuery(
    `mutation Create($data: NoteCreateInput!) { createNote(data: $data) { id } }`,
    { data: { title: '📷 Quote request — Apparel/Fashion, 50–200 photos', bodyV2: { markdown: noteBody } } },
  );
  const noteId = noteData.createNote.id;
  console.log(`Note created: ${noteId}`);

  await client.apiQuery(
    `mutation Link($data: NoteTargetCreateInput!) { createNoteTarget(data: $data) { id } }`,
    { data: { noteId, targetPersonId: person.id } },
  );
  console.log('Note linked to person.');
  console.log('\nDone.');
};

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
