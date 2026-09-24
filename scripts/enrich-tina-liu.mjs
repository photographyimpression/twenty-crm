#!/usr/bin/env node
// One-shot: enters research findings for Tina Liu / StyleLine Brands.
// Updates Person (jobTitle, city), Company (industry SHOES, NYC address),
// and files a research note on the person record.
//
// Usage:
//   node scripts/enrich-tina-liu.mjs --url https://crm.impressionphotography.ca --token $TOKEN

const PERSON_ID = 'e548c624-344e-47e9-92fe-49ba7ff42afb';
const COMPANY_ID = 'd8b27d20-f0e1-469d-96fe-e038909e4450';

const NOTE_BODY = [
  '## 🔎 Research — who Tina Liu is (Sep 24, 2026)',
  '',
  '**Tina (Ey Vean) Liu is a co-principal of the J/SLIDES footwear brand** — the shoes in her',
  'product snapshot are her own brand. Great fit for the 50–200 photos ask (e-commerce relaunch).',
  '',
  '### The business',
  '- **J/SLIDES** — NYC women\'s footwear brand ("elevated footwear for real life"), founded Dec 2014 as',
  '  **Styleline Studios, LLC** (NY) by Jay Litvack, Dimitri Mavridakis and Tina Liu.',
  '  Parent: **Styleline Studios International Limited** (Hong Kong).',
  '- **Styleline Brands Group** is her new venture name — stylelinebrands.com (registered Dec 2024, not live yet),',
  '  jslidesfootwear.com (won back in the dispute below) and shopjslides.com (Apr 2024).',
  '- Shoes are manufactured in Asia (Taiwan/China); ~409 import shipments on record, paused Apr 2024 during litigation.',
  '- New US trademark "URBAN SPORT" (footwear) filed June 2025 — actively rebuilding.',
  '',
  '### Litigation context (why the reboot)',
  '- Partner Jay/Lillian Litvack was terminated Nov 2023; dispute over the J/SLIDES mark and domains followed.',
  '- Styleline won: preliminary injunction July 2025 (E.D.N.Y. 2:24-cv-1192) and the domain decision May 2025.',
  '- Earlier cases: Buscemi v. Styleline (2017), Crosson v. Styleline (2018), Matisse Footwear v. Styleline (2021).',
  '',
  '### Contact & places',
  '| | |',
  '|---|---|',
  '| Her email | tina@stylelinebrands.com |',
  '| Team emails | hagop@stylelinebrands.com · customercare@stylelinebrands.com · customercare@jslidesfootwear.com |',
  '| Instagram | [@shopjslides](https://instagram.com/shopjslides) (active brand account) |',
  '| US office | 27 W 24th St, Ste 800, New York, NY 10010 |',
  '| HK office | Unit 7F-15, Valiant Industrial Centre, 2-12 Au Pui Wan St, Fo Tan, Shatin |',
  '| Tina based in | Hong Kong (per court filings) |',
  '',
  '### ⚠️ Phone number',
  'No published phone anywhere — their sites are email-only, directories/court filings redact or mask it.',
  'ImportYeti holds a masked 2022 customs number ending **842** (not usable).',
  'Best routes: reply on the existing thread, email hagop@stylelinebrands.com, or DM @shopjslides.',
  '',
  '### Sources',
  '- [ADR Forum decision — Styleline v. Litvack (May 2025)](https://www.adrforum.com/globalassets/site-media/documents/united%20states/2025/2025_05_16%20fa2409001902809.pdf)',
  '- [E.D.N.Y. 2:24-cv-1192 (preliminary injunction, July 2025)](https://www.govinfo.gov)',
  '- [ImportYeti — Styleline Studios LLC](https://www.importyeti.com/company/styleline-studios-llc)',
  '- [JSLIDES Footwear site (Styleline Brands Group)](https://www.jslidesfootwear.com/pages/contact)',
  '- Justia Trademarks (URBAN SPORT filing, June 2025); Panjiva/ImportGenius (HK address); ZoomInfo (NYC office)',
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
    `mutation U($id: UUID!, $data: PersonUpdateInput!) { updatePerson(id: $id, data: $data) { id jobTitle city } }`,
    { id: PERSON_ID, data: { jobTitle: 'Co-Founder — J/SLIDES / Styleline Brands', city: 'Hong Kong' } },
  );
  console.log('Person updated:', JSON.stringify(r1.updatePerson));

  const r2 = await q(
    `mutation U($id: UUID!, $data: CompanyUpdateInput!) { updateCompany(id: $id, data: $data) { id industry } }`,
    {
      id: COMPANY_ID,
      data: {
        industry: 'SHOES',
        address: { addressStreet1: '27 W 24th St, Ste 800', addressCity: 'New York', addressState: 'NY', addressPostcode: '10010', addressCountry: 'US' },
      },
    },
  );
  console.log('Company updated:', JSON.stringify(r2.updateCompany));

  const r3 = await q(
    `mutation C($data: NoteCreateInput!) { createNote(data: $data) { id } }`,
    { data: { title: '🔎 Research: Tina Liu = J/SLIDES co-principal (no public phone found)', bodyV2: { markdown: NOTE_BODY } } },
  );
  await q(
    `mutation L($data: NoteTargetCreateInput!) { createNoteTarget(data: $data) { id } }`,
    { data: { noteId: r3.createNote.id, targetPersonId: PERSON_ID } },
  );
  await q(
    `mutation L($data: NoteTargetCreateInput!) { createNoteTarget(data: $data) { id } }`,
    { data: { noteId: r3.createNote.id, targetCompanyId: COMPANY_ID } },
  );
  console.log('Research note created and linked to person + company.');
};

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
