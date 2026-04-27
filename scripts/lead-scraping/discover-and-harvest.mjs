#!/usr/bin/env node

// For each company without a domain: search DuckDuckGo HTML for its name +
// city, pick the most likely business website from results, then scrape
// /contact, /about, /team for decision-maker emails. Creates Person records
// with best-effort role inference.
//
// Idempotent & resumable: on each tick, it re-reads the CSV but skips any
// company that already has a domain or a linked Person in the DB.
//
// Usage:
//   node scripts/lead-scraping/discover-and-harvest.mjs \
//     --url https://crm.impressionphotography.ca --token TOKEN \
//     --csv /tmp/scrape-logs/greater-montreal-companies-no-domain.csv \
//     [--limit N]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  init,
  createPerson,
  throttledMutation,
} from '../lib/twenty-api.mjs';
import {
  throttledFetch,
  extractEmails,
  classifyEmail,
  guessNameFromEmail,
  inferRole,
  normalizeDomain,
  sleep,
} from '../lib/http-client.mjs';

const JSDOM_PATH = new URL(
  '../../packages/twenty-server/node_modules/jsdom/lib/api.js',
  import.meta.url,
);

// jsdom is optional — gives us name extraction near mailto: links. If not
// available the script still works using regex-only email harvesting.
const loadJsdom = async () => {
  for (const spec of [JSDOM_PATH.href, 'jsdom', '/tmp/scraper/node_modules/jsdom/lib/api.js']) {
    try {
      const mod = await import(spec);
      if (mod.JSDOM) return mod.JSDOM;
    } catch { /* try next */ }
  }
  console.warn('  (jsdom unavailable — falling back to regex-only email parsing)');
  return null;
};

const CONTACT_PATHS = [
  '/',
  '/contact',
  '/contactez-nous',
  '/nous-joindre',
  '/about',
  '/a-propos',
  '/notre-equipe',
  '/team',
  '/our-team',
  '/equipe',
];

// Sites to ignore in search results — they aren't the company's own website.
const RESULT_BLOCKLIST = /(yellowpages|yelp|facebook|instagram|linkedin|twitter|tiktok|youtube|pinterest|wikipedia|trustpilot|glassdoor|bbb\.org|googleusercontent|ebay|amazon|canadianbusinessdirectory|manta|411\.ca|canpages|shop\.app|goaffpro|shopify\.com|wix\.com|squarespace\.com|google\.com|maps\.apple|tripadvisor|foursquare|houzz|kijiji)/i;

const parseCsv = (path) => {
  const lines = readFileSync(path, 'utf-8').trim().split('\n');
  return lines.map((line) => {
    const [id, name, city, industry] = line.split('|');
    return { id, name: name || '', city: city || '', industry: industry || '' };
  }).filter((r) => r.id && r.name);
};

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Try likely domain patterns first — no search engine, no rate limit.
// Returns the first pattern that resolves and matches the company name.
const guessDomains = (companyName) => {
  const slug = companyName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(inc|ltée?|ltd|corp|enrg|enr|llc|co)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
  if (!slug || slug.length < 3 || slug.length > 30) return [];
  // Most common TLDs for Quebec/Canada businesses
  return [`${slug}.ca`, `${slug}.com`, `${slug}.shop`, `www.${slug}.ca`];
};

// Brave Search HTML. Strict anti-bot: delay ≥ 8s per request.
const webSearch = async (query) => {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
  try {
    const html = await throttledFetch(url, {
      minDelayMs: 8500,
      timeoutMs: 20000,
      headers: {
        'User-Agent': BROWSER_UA,
        'X-Scraper-Contact': '',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-CA,en;q=0.9,fr-CA;q=0.8',
        'Referer': 'https://search.brave.com/',
      },
    });
    const domains = [];
    // Brave result blocks: <a href="https://..." class="result-header...">
    // or <a class="h" href="https://...">
    const rx = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*(?:result-header|h\s|snippet-url|heading-serpresult)[^"]*"/g;
    let m;
    while ((m = rx.exec(html)) !== null) {
      const raw = m[1];
      if (RESULT_BLOCKLIST.test(raw)) continue;
      const domain = normalizeDomain(raw);
      if (domain && !domains.includes(domain)) domains.push(domain);
      if (domains.length >= 5) break;
    }
    // Fallback: any anchor tag with https href + heuristic score
    if (domains.length === 0) {
      const anchorRx = /<a[^>]*href="(https?:\/\/[^"]+)"/g;
      let mm;
      while ((mm = anchorRx.exec(html)) !== null) {
        const raw = mm[1];
        if (RESULT_BLOCKLIST.test(raw)) continue;
        if (/brave\.com|search-static\.brave|microsoft|googleapis|cloudflare|cdn\./.test(raw)) continue;
        const domain = normalizeDomain(raw);
        if (domain && !domains.includes(domain)) domains.push(domain);
        if (domains.length >= 5) break;
      }
    }
    return domains;
  } catch {
    return [];
  }
};

const verifyDomainMatchesCompany = (html, companyName) => {
  const lower = html.slice(0, 10000).toLowerCase();
  const tokens = companyName
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 4 && !['inc', 'ltd', 'ltee', 'enrg', 'enr', 'boutique', 'fashion', 'store', 'corp', 'co', 'the'].includes(t));
  if (tokens.length === 0) return true; // nothing to verify against, accept
  // accept if any token appears in <title>/H1/description area
  return tokens.some((t) => lower.includes(t));
};

const fetchEmailsWithNames = async (JSDOM, domain) => {
  // Collect candidate emails with optional nearby name context.
  const results = new Map(); // email -> { pageUrl, role, name }
  for (const path of CONTACT_PATHS) {
    const url = `https://${domain}${path}`;
    let html;
    try {
      html = await throttledFetch(url, { minDelayMs: 1500, timeoutMs: 10000 });
    } catch {
      continue;
    }
    // regex emails
    const emails = extractEmails(html);
    if (emails.length === 0) continue;

    // try jsdom parse to find name context near mailto: (optional)
    let nameForEmail = {};
    if (JSDOM) {
      try {
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        const mailtos = doc.querySelectorAll('a[href^="mailto:"]');
        for (const a of mailtos) {
          const href = a.getAttribute('href') || '';
          const email = href.replace(/^mailto:/, '').split('?')[0].toLowerCase();
          if (!email || nameForEmail[email]) continue;
          let node = a;
          let context = a.textContent || '';
          for (let i = 0; i < 6 && node.previousElementSibling; i++) {
            node = node.previousElementSibling;
            context = `${node.textContent || ''} ${context}`;
            if (/[A-Z][a-z]+ [A-Z][a-z]+/.test(context)) break;
          }
          const nameMatch = context.match(/([A-Z][a-zA-Zéèàîïôû-]+)\s+([A-Z][a-zA-Zéèàîïôû-]+)/);
          nameForEmail[email] = {
            name: nameMatch ? { firstName: nameMatch[1], lastName: nameMatch[2] } : null,
            role: inferRole(context),
          };
        }
      } catch { /* ignore parse failure */ }
    }

    for (const email of emails) {
      if (results.has(email)) continue;
      const ctx = nameForEmail[email] || { name: null, role: inferRole(html) };
      results.set(email, { pageUrl: url, ...ctx });
    }
  }
  return [...results.entries()].map(([email, ctx]) => ({ email, ...ctx }));
};

const buildPersonPayload = ({ email, role, name }, companyId) => {
  const fromEmail = guessNameFromEmail(email);
  const firstName = (name?.firstName) || fromEmail.firstName || '—';
  const lastName = (name?.lastName) || fromEmail.lastName || '';
  const confidence = name ? 85 : classifyEmail(email) === 'named' ? 70 : 40;
  return {
    name: { firstName, lastName },
    emails: { primaryEmail: email, additionalEmails: [] },
    personRole: (role || 'OTHER').toUpperCase(),
    leadSource: 'WEBSITE_SCRAPE',
    confidenceScore: confidence,
    companyId,
  };
};

const updateCompany = async (client, id, data) =>
  throttledMutation(async () => client.apiQuery(`
    mutation UpdateCompany($id: UUID!, $data: CompanyUpdateInput!) {
      updateCompany(id: $id, data: $data) { id }
    }
  `, { id, data }), `updateCompany(${id})`);

// State file so crash/restart skips already-processed companies.
// Override with STATE_FILE env var when running multiple parallel workers.
const STATE_FILE = process.env.STATE_FILE || '/tmp/scrape-logs/discover-and-harvest.state';
const loadState = () => {
  if (!existsSync(STATE_FILE)) return new Set();
  return new Set(readFileSync(STATE_FILE, 'utf-8').split('\n').filter(Boolean));
};
const saveState = (state) => {
  writeFileSync(STATE_FILE, [...state].join('\n') + '\n');
};

const main = async () => {
  const { client, limit } = init();
  const csvIdx = process.argv.indexOf('--csv');
  if (csvIdx === -1) {
    console.error('Usage: --csv /path/to/companies.csv');
    process.exit(1);
  }
  const csvPath = process.argv[csvIdx + 1];
  const rows = parseCsv(csvPath);
  const JSDOM = await loadJsdom();

  const processed = loadState();
  const work = rows.filter((r) => !processed.has(r.id));
  const slice = limit ? work.slice(0, limit) : work;
  console.log(`\nDiscover + harvest — ${slice.length} companies (of ${rows.length} total, ${processed.size} already processed)\n`);

  let withDomain = 0;
  let personsCreated = 0;
  let noSite = 0;
  let noEmail = 0;
  let failed = 0;
  let i = 0;

  for (const row of slice) {
    i++;
    try {
      // Phase 1a: try pattern-guessed domains first (no search engine cost).
      const cleanName = row.name.replace(/\s*\b(inc|ltée?|ltd|corp|enrg|enr\.?)\b\s*\.?/gi, '').trim();
      const patterns = guessDomains(cleanName);
      let domain = null;
      for (const c of patterns) {
        try {
          const probe = await throttledFetch(`https://${c}/`, { minDelayMs: 800, timeoutMs: 7000 });
          if (verifyDomainMatchesCompany(probe, cleanName)) {
            domain = c;
            break;
          }
        } catch {
          // domain doesn't resolve / wrong content — next pattern
        }
      }

      // Phase 1b: fall back to Brave Search if pattern guess failed.
      if (!domain) {
        const query = `"${cleanName}" ${row.city} Quebec`;
        const candidates = await webSearch(query);
        for (const c of candidates) {
          try {
            const probe = await throttledFetch(`https://${c}/`, { minDelayMs: 1500, timeoutMs: 8000 });
            if (verifyDomainMatchesCompany(probe, cleanName)) {
              domain = c;
              break;
            }
          } catch {
            // next candidate
          }
        }
      }
      if (!domain) {
        noSite++;
        processed.add(row.id);
        continue;
      }

      // Phase 2: harvest emails
      const emails = await fetchEmailsWithNames(JSDOM, domain);
      if (emails.length === 0) {
        noEmail++;
        // still save the domain on the company so future runs can retry
        try {
          await updateCompany(client, row.id, { domainName: { primaryLinkUrl: `https://${domain}`, primaryLinkLabel: domain } });
        } catch { /* ignore */ }
        processed.add(row.id);
        continue;
      }

      // Phase 3: rank + create Persons
      emails.sort((a, b) => {
        const aNamed = a.name ? -2 : (classifyEmail(a.email) === 'named' ? -1 : 0);
        const bNamed = b.name ? -2 : (classifyEmail(b.email) === 'named' ? -1 : 0);
        return aNamed - bNamed;
      });

      try {
        await updateCompany(client, row.id, {
          domainName: { primaryLinkUrl: `https://${domain}`, primaryLinkLabel: domain },
          leadStatus: 'CONTACT_FOUND',
        });
      } catch { /* ignore */ }

      // User's target includes owner/marketing/e-comm/web/creative — take up
      // to 5 per company to cover multiple decision-makers.
      const top = emails.slice(0, 5);
      let created = 0;
      for (const e of top) {
        try {
          await createPerson(client, buildPersonPayload(e, row.id));
          personsCreated++;
          created++;
        } catch (err) {
          if (/duplicate|already in use/i.test(err.message)) continue;
          if (failed < 5) console.error(`  Person FAIL ${row.name} ${e.email}: ${err.message.slice(0, 100)}`);
          failed++;
        }
      }
      if (created > 0) withDomain++;
      processed.add(row.id);

      if (i % 10 === 0) {
        saveState(processed);
        console.log(`  [${i}/${slice.length}] ${withDomain} enriched · ${personsCreated} persons · ${noSite} no-site · ${noEmail} site-but-no-email · ${failed} failed`);
      }
    } catch (err) {
      failed++;
      if (failed < 10) console.error(`  FAIL ${row.name}: ${err.message.slice(0, 100)}`);
      processed.add(row.id);
    }
  }

  saveState(processed);
  console.log(`\n--- Done ---`);
  console.log(`Companies scanned:    ${slice.length}`);
  console.log(`Found a website:      ${withDomain + noEmail}`);
  console.log(`Persons created:      ${personsCreated}`);
  console.log(`No website found:     ${noSite}`);
  console.log(`Website but no email: ${noEmail}`);
  console.log(`Failed:               ${failed}`);
};

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
