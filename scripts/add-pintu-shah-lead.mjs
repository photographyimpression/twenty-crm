#!/usr/bin/env node
// One-shot: adds Pintu Shah from the Tue, Sep 15, 2026, 8:39 AM amazonphoto.ca
// AP Quote Request (still flagged/unanswered in Outlook). Creates Person
// (LEAD / AMAZON niche, phone on file, no company given), a note carrying the
// request in sequence, then — in a separate update, because the enrollment
// workflow listens on person.updated — tags sequenceTag=PRE_PHONE_EMAIL so
// the 12-touch Pre-Phone sequence enrolls him.
//
// Note: he gave no company, so the 5 touch subjects that reference
// {{company.name}} (touches 1, 2, 7, 8, 10) render with a blank — tweak or
// reject those in the Command Center before approving. Phone is already on
// file, so Touch 1's "what's your number" ask may be worth rejecting too.
//
// Usage:
//   TWENTY_API_TOKEN=... node scripts/add-pintu-shah-lead.mjs --url https://crm.impressionphotography.ca

import { init, createPerson, throttledMutation } from './lib/twenty-api.mjs';

const EMAIL = 'shahpintu321@gmail.com';

const run = async () => {
  const { client, dryRun } = init();

  // Dedupe guard
  const existingPerson = await client.apiQuery(
    `query { people(filter: { emails: { primaryEmail: { eq: "${EMAIL}" } } }, first: 1) {
      edges { node { id } } } }`,
  );
  if (existingPerson.people.edges.length > 0) {
    throw new Error(`Person with ${EMAIL} already exists (${existingPerson.people.edges[0].node.id}) — not creating a duplicate.`);
  }

  if (dryRun) {
    console.log(`DRY RUN — would create Person Pintu Shah <${EMAIL}>, note, then tag PRE_PHONE_EMAIL.`);
    return;
  }

  const person = await createPerson(client, {
    name: { firstName: 'Pintu', lastName: 'Shah' },
    emails: { primaryEmail: EMAIL, additionalEmails: [] },
    phones: { primaryPhoneNumber: '+15197025875', additionalPhones: [] },
    contactType: 'LEAD',
    niche: 'AMAZON',
  });
  console.log(`Person created: ${person.id}`);

  const noteBody = [
    '## AP quote request — Tue, Sep 15, 2026, 8:39 AM',
    '',
    'Submitted through the **amazonphoto.ca** quote form (Amazon-sellers microsite). Still flagged in Outlook, unanswered.',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Name | Pintu Shah |',
    '| Email | shahpintu321@gmail.com |',
    '| Phone | (519) 702-5875 — Ontario (Kitchener/Waterloo/London region) |',
    '| Company | — (not provided) |',
    '',
    'Form carried contact info only — no product details, quantities, or timeline.',
    '',
    '## Thread so far',
    '',
    '1. **Sep 15, 8:39 AM** — quote request received via amazonphoto.ca form',
    '2. **No reply sent yet** — unanswered lead (as of Oct 11, 2026)',
    '',
    '## Vetting notes (Oct 11, 2026)',
    '',
    '- Nothing phish-shaped: real form on our own microsite, a Canadian phone number provided, no links or attachments.',
    '- No public footprint for the Gmail or the phone number — normal for a private individual.',
    '- **Phone already on file** — Touch 1 (asks for a number) can be rejected in the Command Center; consider going straight to a call (Touch 7-style).',
    '- No company given — the touch subjects that reference the company name (touches 1, 2, 7, 8, 10) render with a blank spot.',
    '',
    '_Enrolled in the **Pre-Phone Email sequence** (12 touches) on Oct 11, 2026. Touches appear in the Command Center as PENDING and send only on approval._',
  ].join('\n');

  const noteData = await client.apiQuery(
    `mutation Create($data: NoteCreateInput!) { createNote(data: $data) { id } }`,
    { data: { title: '📷 AP quote request — Amazon seller (Pintu Shah)', bodyV2: { markdown: noteBody } } },
  );
  const noteId = noteData.createNote.id;
  console.log(`Note created: ${noteId}`);

  await client.apiQuery(
    `mutation Link($data: NoteTargetCreateInput!) { createNoteTarget(data: $data) { id } }`,
    { data: { noteId, targetPersonId: person.id } },
  );
  console.log('Note linked to person.');

  // Enrollment: the "Pre-Phone Email Sequence" workflow triggers on
  // person.updated watching sequenceTag — set the tag in a separate update.
  const tagged = await throttledMutation(
    () => client.apiQuery(
      `mutation Tag($id: UUID!, $data: PersonUpdateInput!) { updatePerson(id: $id, data: $data) { id sequenceTag } }`,
      { id: person.id, data: { sequenceTag: 'PRE_PHONE_EMAIL' } },
    ),
    'tagPerson-PRE_PHONE_EMAIL',
  );
  console.log(`sequenceTag set: ${tagged.updatePerson.sequenceTag}`);

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
