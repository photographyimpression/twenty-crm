#!/usr/bin/env node
// One-shot: enters phone-hunt results for Tina Liu / Styleline Brands.
// - Person phone: J/Slides customer-service line (their only published number)
// - Company address: Styleline Brands Group USA Inc, Pelham NY (per Saks Ch11 schedule)
// - Note: full intelligence from the OSINT pass with sources
//
// Usage:
//   node scripts/phone-hunt-tina-liu.mjs --url https://crm.impressionphotography.ca --token $TOKEN

const PERSON_ID = 'e548c624-344e-47e9-92fe-49ba7ff42afb';
const COMPANY_ID = 'd8b27d20-f0e1-469d-96fe-e038909e4450';

const NOTE_BODY = [
  '## 📞 Phone hunt results (Sep 24, 2026)',
  '',
  '### The number',
  '**+1 (844) 737-9600** — the J/Slides customer-service line, published on jslidesfootwear.com/contact',
  '(seen via the May 2025 archived copy). It is the **only phone number this company has ever published**.',
  '',
  '⚠️ Caveats: it was their toll-free CS line during wind-down; a 2020 Facebook post attributes the same',
  'toll-free to an unrelated company, so it may have been reassigned. Try it — but the reliable channel',
  'remains email (tina@ replies have been slow; hagop@stylelinebrands.com or IG @shopjslides may be faster).',
  '',
  '### Where else I looked (so nobody re-digs)',
  'Trade databases (ImportYeti/ImportInfo/Panjiva) — masked or paywalled · court filings — phones redacted ·',
  'bankruptcy claims registers — behind Stretto\'s bot-wall · people-search — only unrelated Tina Lius ·',
  'a WHOIS phone on jslides.com (+1 347-871-7726) turned out to be a **scam-flagged recycled number — do not call**.',
  '',
  '### 🆕 New intelligence from this pass',
  '| | |',
  '|---|---|',
  '| New US entity | **Styleline Brands Group USA Inc** (per Saks Global Ch.11 schedules) |',
  '| Its address | **629 5th Ave, Suite 101, Pelham, NY 10803** (small office/mail suite — not a showroom) |',
  '| Saks Global owes them | **$35,625.85** merchandise payable — they sell to Saks/Neiman |',
  '| Old entity | Styleline Studios LLC (27 W 24th St NYC) — dissolving; factored via **Hilldun**, which sued claiming $5.7M over-advance |',
  '| Storefront status | J/Slides site running **liquidation** ("EVERYTHING MUST GO") — old stock clearing while the relaunch preps |',
  '| Company size | 11–50 staff, ~$5.5M revenue (ZoomInfo) |',
  '| Tina\'s supply side | HK-based; ships from Styleline Studios Intl Ltd (Fo Tan + Silvercord, TST) |',
  '| More emails | info@ · marketing@ · customerservice@jslidesfootwear.com |',
  '',
  '### Correction to the earlier research note',
  'The May 2025 UDRP over **jslides.com** actually ended in a **reverse-domain-hijacking finding against',
  'Styleline** (they lost that one). What they WON: the federal preliminary injunction (E.D.N.Y., July 25, 2025)',
  'against Litvack selling J/SLIDES-branded goods. jslides.com stays dead — hence jslidesfootwear.com + stylelinebrands.com.',
  '',
  '### Sales read',
  'Brand in transition: old entity liquidating, new entity (hers) already booked into Saks. Her 50–200 photo',
  'request is almost certainly the relaunch e-commerce shoot. She\'s Hong Kong-based with a tiny US footprint —',
  'shipping samples to Montreal should be easy for her.',
  '',
  '### Sources',
  '- [Saks Global Ch.11 — top creditor list (Styleline Brands Group USA, $35,625.85)](https://cases.stretto.com)',
  '- [Archived jslidesfootwear.com/contact (May 2025) — the 844 number](https://web.archive.org/web/20250506230623/https://jslidesfootwear.com/contact)',
  '- [Domain Name Wire — RDNH finding](https://domainnamewire.com) · [Hilldun v Styleline, 2025 NY Slip Op 32884(U)](https://law.justia.com)',
].join('\n');

const gql = async (url, token, query, variables) => {
  const res = await fetch(`${url}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
};

const run = async () => {
  const url = process.argv[process.argv.indexOf('--url') + 1] || process.env.TWENTY_URL || 'https://crm.impressionphotography.ca';
  const token = process.argv[process.argv.indexOf('--token') + 1] || process.env.TWENTY_API_TOKEN;
  if (!token) throw new Error('token required (--token or TWENTY_API_TOKEN)');
  const q = (query, variables) => gql(url, token, query, variables);

  const r1 = await q(
    `mutation U($id: UUID!, $data: PersonUpdateInput!) { updatePerson(id: $id, data: $data) { id phones { primaryPhoneNumber } } }`,
    { id: PERSON_ID, data: { phones: { primaryPhoneNumber: '+18447379600', primaryPhoneCountryCode: 'US', primaryPhoneCallingCode: '+1' } } },
  );
  console.log('Person phone set:', JSON.stringify(r1.updatePerson));

  const r2 = await q(
    `mutation U($id: UUID!, $data: CompanyUpdateInput!) { updateCompany(id: $id, data: $data) { id } }`,
    {
      id: COMPANY_ID,
      data: {
        address: { addressStreet1: '629 5th Ave, Suite 101', addressCity: 'Pelham', addressState: 'NY', addressPostcode: '10803', addressCountry: 'US' },
      },
    },
  );
  console.log('Company address updated:', JSON.stringify(r2.updateCompany));

  const r3 = await q(
    `mutation C($data: NoteCreateInput!) { createNote(data: $data) { id } }`,
    { data: { title: '📞 Phone found: +1 (844) 737-9600 — company CS line (with caveats) + new intel', bodyV2: { markdown: NOTE_BODY } } },
  );
  await q(
    `mutation L($data: NoteTargetCreateInput!) { createNoteTarget(data: $data) { id } }`,
    { data: { noteId: r3.createNote.id, targetPersonId: PERSON_ID } },
  );
  await q(
    `mutation L($data: NoteTargetCreateInput!) { createNoteTarget(data: $data) { id } }`,
    { data: { noteId: r3.createNote.id, targetCompanyId: COMPANY_ID } },
  );
  console.log('Phone-hunt note created and linked to person + company.');
};

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
