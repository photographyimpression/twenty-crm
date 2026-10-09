#!/usr/bin/env node
// One-shot: adds Rebecca (Veykan jewelry) from the Sun, Sep 27, 2026, 10:48 PM
// website /pricing form submission. Creates Company + Person (LEAD / JEWEL
// niche), a note carrying the form content in sequence, then — in a separate
// update, because the enrollment workflow listens on person.updated — tags her
// sequenceTag=PRE_PHONE_EMAIL so the 12-touch Pre-Phone sequence enrolls her.
//
// Vetting context (why this is a LEAD worth sequencing, recorded in the note):
// real Montreal ISP IP, no links/attachments, but zero web presence for both
// the brand and the Gmail — Touch 1 asks for a phone number, which tests it.
//
// Usage:
//   TWENTY_API_TOKEN=... node scripts/add-rebecca-veykan-lead.mjs --url https://crm.impressionphotography.ca

import { init, createCompany, createPerson, throttledMutation } from './lib/twenty-api.mjs';

const EMAIL = 'victorrebecca02@gmail.com';

const run = async () => {
  const { client, dryRun } = init();

  // Dedupe guard — abort if she (or the brand) already exists.
  const existingPerson = await client.apiQuery(
    `query { people(filter: { emails: { primaryEmail: { eq: "${EMAIL}" } } }, first: 1) {
      edges { node { id } } } }`,
  );
  if (existingPerson.people.edges.length > 0) {
    throw new Error(`Person with ${EMAIL} already exists (${existingPerson.people.edges[0].node.id}) — not creating a duplicate.`);
  }
  const existingCompany = await client.apiQuery(
    `query { companies(filter: { name: { ilike: "%veykan%" } }, first: 1) { edges { node { id name } } } }`,
  );
  if (existingCompany.companies.edges.length > 0) {
    throw new Error(`Company already exists: ${JSON.stringify(existingCompany.companies.edges[0].node)}`);
  }

  if (dryRun) {
    console.log('DRY RUN — would create Company "Veykan jewelry", Person Rebecca <' + EMAIL + '>, note, then tag PRE_PHONE_EMAIL.');
    return;
  }

  const company = await createCompany(client, { name: 'Veykan jewelry' });
  console.log(`Company created: ${company.id} (${company.name})`);

  const person = await createPerson(client, {
    name: { firstName: 'Rebecca' },
    emails: { primaryEmail: EMAIL, additionalEmails: [] },
    contactType: 'LEAD',
    niche: 'JEWEL',
    companyId: company.id,
  });
  console.log(`Person created: ${person.id}`);

  const noteBody = [
    '## Pricing request — Sun, Sep 27, 2026, 10:48 PM (Montreal)',
    '',
    'Submitted through the website `/pricing` form from an iPhone (Google app).',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Brand | Veykan jewelry |',
    '| Contact | Rebecca (no last name given) |',
    '| Email | Victorrebecca02@gmail.com |',
    '| Phone | — |',
    '',
    'The form carried **contact info only** — no message text, quantities, budget, or timeline.',
    '',
    '## Thread so far',
    '',
    '1. **Sep 27, 10:48 PM** — pricing request received via website form',
    `2. **No reply sent yet** — unanswered lead (as of Oct 9, 2026)`,
    '',
    '## Vetting notes (Oct 9, 2026)',
    '',
    '- Form submitted from a **Montreal-area residential IP** (Bravo Telecom) — consistent with a local founder, not a foreign server.',
    '- Message contained **no links or attachments** — nothing dangerous in it.',
    '- "Veykan jewelry" has **no web presence** (no site, Instagram, or Etsy) and the Gmail has no footprint — either a pre-launch brand or a fake. The sequence asks for a phone number first, which will sort real from fake.',
    '',
    '_Enrolled in the **Pre-Phone Email sequence** (12 touches) on Oct 9, 2026. Touches appear in the Command Center as PENDING and send only on approval._',
  ].join('\n');

  const noteData = await client.apiQuery(
    `mutation Create($data: NoteCreateInput!) { createNote(data: $data) { id } }`,
    { data: { title: '📷 Pricing request — Jewelry (Rebecca @ Veykan jewelry)', bodyV2: { markdown: noteBody } } },
  );
  const noteId = noteData.createNote.id;
  console.log(`Note created: ${noteId}`);

  await client.apiQuery(
    `mutation Link($data: NoteTargetCreateInput!) { createNoteTarget(data: $data) { id } }`,
    { data: { noteId, targetPersonId: person.id } },
  );
  await client.apiQuery(
    `mutation Link($data: NoteTargetCreateInput!) { createNoteTarget(data: $data) { id } }`,
    { data: { noteId, targetCompanyId: company.id } },
  );
  console.log('Note linked to person + company.');

  // Enrollment: the "Pre-Phone Email Sequence" workflow triggers on
  // person.updated watching sequenceTag — so the tag MUST be set in a
  // separate update after creation, not at create time.
  const tagged = await throttledMutation(
    () => client.apiQuery(
      `mutation Tag($id: UUID!, $data: PersonUpdateInput!) { updatePerson(id: $id, data: $data) { id sequenceTag } }`,
      { id: person.id, data: { sequenceTag: 'PRE_PHONE_EMAIL' } },
    ),
    'tagPerson-PRE_PHONE_EMAIL',
  );
  console.log(`sequenceTag set: ${tagged.updatePerson.sequenceTag}`);

  // The workflow runs async — poll until the 12 touches materialize.
  console.log('Waiting for the Pre-Phone workflow to create the touches…');
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const approvals = await client.apiQuery(
      `query { approvals(filter: { recipientEmail: { eq: "${EMAIL}" } }, first: 20) {
        edges { node { touchNumber approvalStatus sequenceKey } } } }`,
    );
    const touches = approvals.approvals.edges.map((e) => e.node);
    if (touches.length >= 12) {
      console.log(`Enrolled: ${touches.length} PRE_PHONE_EMAIL touches created (all ${touches[0].approvalStatus}).`);
      return;
    }
    console.log(`  …${touches.length}/12 touches so far`);
  }
  console.log('WARNING: fewer than 12 touches after 30s — check the workflow run log in the CRM.');
};

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
