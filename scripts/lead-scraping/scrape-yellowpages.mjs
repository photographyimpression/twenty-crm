#!/usr/bin/env node

// Scrapes Yellow Pages Canada (yellowpages.ca) for fashion / jewelry / clothing
// businesses across major Quebec cities.
//
// Usage:
//   node scripts/lead-scraping/scrape-yellowpages.mjs --url https://crm.impressionphotography.ca --token YOUR_API_KEY [--dry-run] [--limit 50]
//
// Notes:
//   - Parses HTML with jsdom (lazy-loaded from twenty-server deps)
//   - 2-second delay between pages per host, respects robots.txt best-effort
//   - Caps at 50 pages per category to avoid runaway scraping

import { init, createCompany } from '../lib/twenty-api.mjs';
import { throttledFetch, normalizeDomain } from '../lib/http-client.mjs';

const JSDOM_PATH = new URL(
  '../../packages/twenty-server/node_modules/jsdom/lib/api.js',
  import.meta.url,
);

const loadJsdom = async () => {
  try {
    const { JSDOM } = await import(JSDOM_PATH.href);
    return JSDOM;
  } catch {
    try {
      const { JSDOM } = await import('jsdom');
      return JSDOM;
    } catch (err) {
      console.error('Could not load jsdom. Install it or run from twenty-server workspace.');
      throw err;
    }
  }
};

const CITIES = [
  'Montreal+QC',
  'Laval+QC',
  'Longueuil+QC',
  'Quebec+QC',
  'Gatineau+QC',
  'Sherbrooke+QC',
  'Trois-Rivieres+QC',
  'Saguenay+QC',
  'Levis+QC',
];

const CATEGORIES = [
  { slug: 'Jewellers', industry: 'JEWELRY' },
  { slug: 'Clothing+Stores', industry: 'CLOTHING' },
  { slug: 'Fashion+Accessories', industry: 'ACCESSORIES' },
  { slug: 'Boutiques', industry: 'FASHION' },
  { slug: 'Bridal+Shops', industry: 'BRIDAL' },
  { slug: 'Shoe+Stores', industry: 'SHOES' },
  { slug: 'Leather+Goods', industry: 'LEATHER' },
  { slug: 'Tailors', industry: 'TEXTILE' },
  { slug: 'Jewellery+Designers', industry: 'JEWELRY' },
  { slug: 'Womens+Clothing+Retail', industry: 'CLOTHING' },
  { slug: 'Mens+Clothing+Retail', industry: 'CLOTHING' },
  { slug: 'Childrens+Clothing+Stores', industry: 'CLOTHING' },
  { slug: 'Watch+Repair', industry: 'JEWELRY' },
];

const MAX_PAGES_PER_CATEGORY = 50;

const parseListing = (JSDOM, html) => {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const results = [];

  const cleanName = (s) =>
    (s || '')
      .trim()
      .replace(/^\d+\s+/, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*Get directions\s*$/i, '')
      .trim();

  const cleanPhone = (s) => {
    if (!s) return null;
    const digits = s.replace(/[^\d+]/g, '');
    return digits.length >= 10 ? s.replace(/\s*Phone Number\s*/i, '').trim() : null;
  };

  const cleanAddr = (s) =>
    (s || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\s*Get directions\s*$/i, '')
      .trim();

  const cards = doc.querySelectorAll('.listing');
  for (const card of cards) {
    const name = cleanName(card.querySelector('.listing__name--link, h3.listing__name a, [itemprop="name"]')?.textContent || '');
    if (!name) continue;

    const phone = cleanPhone(card.querySelector('.mlr__item--phone, [itemprop="telephone"]')?.textContent || '');

    const addressText = cleanAddr(card.querySelector('.listing__address, [itemprop="address"]')?.textContent || '');

    // Look for the external website link specifically, not relative profile links
    let website = null;
    const websiteCandidate = card.querySelector('.mlr__item--website a[href]')?.getAttribute('href');
    if (websiteCandidate && /^https?:\/\//i.test(websiteCandidate)) {
      website = websiteCandidate;
    }

    const detailHref = card.querySelector('.listing__name--link, h3.listing__name a')?.getAttribute('href') || null;

    results.push({ name, phone, address: addressText || null, website, detailHref });
  }
  return results;
};

const splitAddress = (addressText) => {
  if (!addressText) return {};
  const parts = addressText.split(',').map((p) => p.trim());
  return {
    addressStreet1: parts[0] || null,
    addressCity: parts[1] || null,
    addressPostcode: parts[parts.length - 1] || null,
  };
};

const buildCompanyPayload = (lead, category) => {
  const payload = {
    name: lead.name,
    leadSource: 'YELLOWPAGES',
    leadStatus: 'NEW',
    industry: category.industry,
    scrapedAt: new Date().toISOString(),
    sourceUrl: lead.detailHref ? `https://www.yellowpages.ca${lead.detailHref}` : null,
  };
  const domain = normalizeDomain(lead.website);
  if (domain) payload.domainName = { primaryLinkUrl: `https://${domain}`, primaryLinkLabel: domain };
  const addrParts = splitAddress(lead.address);
  if (addrParts.addressStreet1) {
    payload.address = {
      addressStreet1: addrParts.addressStreet1,
      addressCity: addrParts.addressCity || null,
      addressPostcode: addrParts.addressPostcode || null,
      addressState: 'Quebec',
      addressCountry: 'Canada',
    };
  }
  return payload;
};

const scrapeCategoryInCity = async (JSDOM, category, city, limitRemaining) => {
  const leads = [];
  for (let page = 1; page <= MAX_PAGES_PER_CATEGORY; page++) {
    const url = `https://www.yellowpages.ca/search/si/${page}/${category.slug}/${city}`;
    let html;
    try {
      html = await throttledFetch(url, { minDelayMs: 2000, timeoutMs: 20000 });
    } catch (err) {
      console.error(`  FAIL ${url}: ${err.message}`);
      break;
    }
    const pageLeads = parseListing(JSDOM, html);
    if (pageLeads.length === 0) break;
    leads.push(...pageLeads);
    if (limitRemaining && leads.length >= limitRemaining) break;
  }
  return leads;
};

const main = async () => {
  const { client, limit, dryRun } = init();
  console.log(`\nYellow Pages scraper — Quebec fashion/jewelry/clothing`);
  console.log(`Dry run: ${dryRun}  Limit: ${limit ?? 'none'}\n`);

  const JSDOM = await loadJsdom();

  const allLeads = [];
  for (const category of CATEGORIES) {
    for (const city of CITIES) {
      console.log(`Scraping ${category.slug} in ${city}...`);
      const remaining = limit ? Math.max(0, limit - allLeads.length) : null;
      if (remaining === 0) break;
      const leads = await scrapeCategoryInCity(JSDOM, category, city, remaining);
      console.log(`  → ${leads.length} listings`);
      for (const lead of leads) {
        allLeads.push({ ...lead, category });
        if (limit && allLeads.length >= limit) break;
      }
      if (limit && allLeads.length >= limit) break;
    }
    if (limit && allLeads.length >= limit) break;
  }

  console.log(`\nTotal scraped: ${allLeads.length}`);

  if (dryRun) {
    console.log('--- Sample (first 5) ---');
    for (const lead of allLeads.slice(0, 5)) {
      console.log(JSON.stringify(lead, null, 2));
    }
    console.log('\n--dry-run: no records written');
    return;
  }

  let created = 0;
  let failed = 0;
  for (const lead of allLeads) {
    try {
      await createCompany(client, buildCompanyPayload(lead, lead.category));
      created++;
      if (created % 50 === 0) console.log(`  Progress: ${created} created, ${failed} failed`);
    } catch (err) {
      failed++;
      if (failed < 5) console.error(`  FAIL ${lead.name}: ${err.message}`);
    }
  }
  console.log(`\n--- Done: ${created} created, ${failed} failed ---`);
};

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
