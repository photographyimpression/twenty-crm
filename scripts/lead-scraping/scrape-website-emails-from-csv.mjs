#!/usr/bin/env node

// Variant of scrape-website-emails.mjs that reads company IDs + domains from
// a pipe-delimited CSV (id|name|domain) instead of paginating via GraphQL.
// Avoids hitting rate-limit on the initial 24k-row company fetch.
//
// Usage:
//   node scripts/lead-scraping/scrape-website-emails-from-csv.mjs \
//     --url https://crm.impressionphotography.ca --token TOKEN \
//     --csv /tmp/scrape-logs/domains.csv

import { readFileSync } from 'node:fs';
import { init, createPerson, throttledMutation } from '../lib/twenty-api.mjs';
import {
  throttledFetch,
  extractEmails,
  classifyEmail,
  guessNameFromEmail,
  inferRole,
} from '../lib/http-client.mjs';

const CONTACT_PATHS = [
  '/',
  '/contact',
  '/contact-us',
  '/contactez-nous',
  '/nous-joindre',
  '/about',
  '/about-us',
  '/a-propos',
  '/notre-equipe',
  '/team',
];

const parseCsvArg = () => {
  const i = process.argv.indexOf('--csv');
  if (i === -1) {
    console.error('Usage: --csv /path/to/domains.csv');
    process.exit(1);
  }
  return process.argv[i + 1];
};

const fetchEmailsForDomain = async (domain) => {
  const emails = new Map();
  for (const path of CONTACT_PATHS) {
    const url = `https://${domain}${path}`;
    try {
      const html = await throttledFetch(url, { minDelayMs: 1500, timeoutMs: 12000 });
      for (const email of extractEmails(html)) {
        if (!emails.has(email)) {
          emails.set(email, { pageUrl: url, role: inferRole(html) });
        }
      }
    } catch {
      // skip
    }
  }
  return [...emails.entries()].map(([email, ctx]) => ({ email, ...ctx }));
};

const buildPersonPayload = ({ email, role }, companyId) => {
  const { firstName, lastName } = guessNameFromEmail(email);
  const confidence = classifyEmail(email) === 'named' ? 70 : 40;
  return {
    name: { firstName: firstName || '—', lastName: lastName || '' },
    emails: { primaryEmail: email, additionalEmails: [] },
    personRole: (role || 'OTHER').toUpperCase(),
    leadSource: 'WEBSITE_SCRAPE',
    confidenceScore: confidence,
    companyId,
  };
};

const updateCompanyStatus = (client, id) =>
  throttledMutation(async () => client.apiQuery(`
    mutation UpdateCompany($id: UUID!, $data: CompanyUpdateInput!) {
      updateCompany(id: $id, data: $data) { id }
    }
  `, { id, data: { leadStatus: 'CONTACT_FOUND' } }), `updateCompany(${id})`);

const main = async () => {
  const { client, limit } = init();
  const csvPath = parseCsvArg();
  const lines = readFileSync(csvPath, 'utf-8').trim().split('\n');
  const rows = lines.map((line) => {
    const [id, name, domain] = line.split('|');
    return { id, name, domain };
  }).filter((r) => r.id && r.domain);

  const work = limit ? rows.slice(0, limit) : rows;
  console.log(`\nEmail harvester (CSV mode) — ${work.length} companies with domains\n`);

  let enriched = 0;
  let personsCreated = 0;
  let noEmail = 0;
  let failed = 0;

  for (const row of work) {
    const domain = row.domain.replace(/^https?:\/\//, '').replace(/^www\./, '');
    try {
      const emails = await fetchEmailsForDomain(domain);
      if (emails.length === 0) {
        noEmail++;
        continue;
      }
      emails.sort((a, b) => {
        const aNamed = classifyEmail(a.email) === 'named' ? 0 : 1;
        const bNamed = classifyEmail(b.email) === 'named' ? 0 : 1;
        return aNamed - bNamed;
      });
      const top = emails.slice(0, 2);
      let anyCreated = false;
      for (const e of top) {
        try {
          await createPerson(client, buildPersonPayload(e, row.id));
          personsCreated++;
          anyCreated = true;
        } catch (err) {
          if (/duplicate|already in use/i.test(err.message)) {
            anyCreated = true; // already exists, still enriched
            continue;
          }
          if (failed < 10) console.error(`  Person FAIL ${row.name} ${e.email}: ${err.message.slice(0, 120)}`);
          failed++;
        }
      }
      if (!anyCreated) {
        // No persons actually got linked (all failed for non-dup reasons); skip status update
        continue;
      }
      try {
        await updateCompanyStatus(client, row.id);
      } catch (err) {
        if (failed < 10) console.error(`  Status update FAIL ${row.name}: ${err.message.slice(0, 120)}`);
      }
      enriched++;
      if (enriched % 10 === 0) console.log(`  Progress: ${enriched} enriched, ${personsCreated} persons, ${noEmail} no-email, ${failed} failed`);
    } catch (err) {
      failed++;
      if (failed < 10) console.error(`  FAIL ${row.name}: ${err.message.slice(0, 120)}`);
    }
  }

  console.log(`\n--- Done ---`);
  console.log(`Companies enriched: ${enriched}`);
  console.log(`Persons created:    ${personsCreated}`);
  console.log(`No email found:     ${noEmail}`);
  console.log(`Failed:             ${failed}`);
};

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
