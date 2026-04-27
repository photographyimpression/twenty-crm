#!/usr/bin/env node

// For each Company with a domainName but no linked Person, fetches the homepage
// + a few common contact pages, regex-extracts emails, and creates Person
// records (priority: named emails like sarah@shop.com over info@/contact@).
//
// Usage:
//   node scripts/lead-scraping/scrape-website-emails.mjs --url https://crm.impressionphotography.ca --token YOUR_API_KEY [--dry-run] [--limit 50]

import {
  init,
  findAllCompanies,
  createPerson,
  updateCompany,
} from '../lib/twenty-api.mjs';
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

const fetchEmailsForDomain = async (domain) => {
  const emailsWithContext = new Map();
  for (const path of CONTACT_PATHS) {
    const url = `https://${domain}${path}`;
    try {
      const html = await throttledFetch(url, { minDelayMs: 1500, timeoutMs: 12000 });
      const emails = extractEmails(html);
      for (const email of emails) {
        if (!emailsWithContext.has(email)) {
          const roleHint = inferRole(html);
          emailsWithContext.set(email, { pageUrl: url, role: roleHint });
        }
      }
    } catch {
      // Skip 404s, 403s, Cloudflare blocks silently
    }
  }
  return [...emailsWithContext.entries()].map(([email, ctx]) => ({ email, ...ctx }));
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

const main = async () => {
  const { client, limit, dryRun } = init();
  console.log(`\nWebsite email harvester`);
  console.log(`Dry run: ${dryRun}  Limit: ${limit ?? 'none'}\n`);

  console.log('Fetching Companies with domain but no linked Person...');
  const all = await findAllCompanies(client, { filter: {} });
  const candidates = all.filter((c) => {
    const domain = c.domainName?.primaryLinkUrl;
    const hasPeople = (c.people?.edges?.length || 0) > 0;
    return domain && !hasPeople && c.leadSource; // only enriched scraped leads
  });
  console.log(`Candidates: ${candidates.length}`);

  const work = limit ? candidates.slice(0, limit) : candidates;
  let companiesEnriched = 0;
  let personsCreated = 0;
  let failed = 0;

  for (const company of work) {
    const domain = company.domainName.primaryLinkUrl;
    try {
      const emails = await fetchEmailsForDomain(domain);
      if (emails.length === 0) continue;

      emails.sort((a, b) => {
        const aNamed = classifyEmail(a.email) === 'named' ? 0 : 1;
        const bNamed = classifyEmail(b.email) === 'named' ? 0 : 1;
        return aNamed - bNamed;
      });

      if (dryRun) {
        console.log(`\n${company.name} (${domain}):`);
        for (const e of emails.slice(0, 3)) console.log(`  ${e.email} [${classifyEmail(e.email)}] role=${e.role}`);
        continue;
      }

      const top = emails.slice(0, 2);
      for (const e of top) {
        try {
          await createPerson(client, buildPersonPayload(e, company.id));
          personsCreated++;
        } catch (err) {
          if (failed < 5) console.error(`  Person FAIL ${company.name} ${e.email}: ${err.message}`);
        }
      }
      try {
        await updateCompany(client, company.id, { leadStatus: 'CONTACT_FOUND' });
      } catch (err) {
        if (failed < 5) console.error(`  Status update FAIL ${company.name}: ${err.message}`);
      }
      companiesEnriched++;
      if (companiesEnriched % 20 === 0) {
        console.log(`  Progress: ${companiesEnriched} enriched, ${personsCreated} persons, ${failed} failed`);
      }
    } catch (err) {
      failed++;
      if (failed < 5) console.error(`  FAIL ${company.name}: ${err.message}`);
    }
  }

  console.log(`\n--- Done: ${companiesEnriched} companies enriched, ${personsCreated} persons created, ${failed} failed ---`);
};

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
