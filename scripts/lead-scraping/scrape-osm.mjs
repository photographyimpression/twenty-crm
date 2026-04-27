#!/usr/bin/env node

// Scrapes fashion / jewelry / clothing businesses from OpenStreetMap Overpass API.
// 100% free, no API key. Covers all of Quebec by default.
//
// Usage:
//   node scripts/lead-scraping/scrape-osm.mjs --url https://crm.impressionphotography.ca --token YOUR_API_KEY [--dry-run] [--limit 50]

import { init, createCompany } from '../lib/twenty-api.mjs';
import { fetchJson, normalizeDomain, sleep } from '../lib/http-client.mjs';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

// Quebec province bounding box (approximate). south,west,north,east
const QUEBEC_BBOX = '44.9,-79.8,62.6,-57.0';

// Map OSM shop= tag values to our industry enum.
const SHOP_TO_INDUSTRY = {
  jewelry: 'JEWELRY',
  jewellery: 'JEWELRY',
  watches: 'JEWELRY',
  clothes: 'CLOTHING',
  fashion: 'FASHION',
  boutique: 'FASHION',
  shoes: 'SHOES',
  bag: 'ACCESSORIES',
  leather: 'LEATHER',
  tailor: 'TEXTILE',
  fabric: 'TEXTILE',
  wedding: 'BRIDAL',
  bridal: 'BRIDAL',
  accessories: 'ACCESSORIES',
};

const SHOP_TAGS = Object.keys(SHOP_TO_INDUSTRY).join('|');

const buildQuery = (bbox) => `
[out:json][timeout:120];
(
  node[shop~"^(${SHOP_TAGS})$"](${bbox});
  way[shop~"^(${SHOP_TAGS})$"](${bbox});
  relation[shop~"^(${SHOP_TAGS})$"](${bbox});
);
out center tags;
`;

const fetchFromOverpass = async (query) => {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`  Querying ${endpoint}...`);
      const result = await fetchJson(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeoutMs: 180000,
      });
      return result.elements || [];
    } catch (err) {
      console.error(`  ${endpoint} failed: ${err.message}`);
      lastErr = err;
      await sleep(2000);
    }
  }
  throw lastErr;
};

const elementToLead = (el) => {
  const tags = el.tags || {};
  const name = tags.name || tags['name:fr'] || tags['name:en'];
  if (!name) return null;

  const shop = (tags.shop || '').toLowerCase();
  const industry = SHOP_TO_INDUSTRY[shop] || 'FASHION';

  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || null;
  const city = tags['addr:city'] || null;
  const postcode = tags['addr:postcode'] || null;
  const province = tags['addr:state'] || tags['addr:province'] || 'Quebec';

  const phone = tags.phone || tags['contact:phone'] || null;
  const website = tags.website || tags['contact:website'] || null;
  const domain = normalizeDomain(website);
  const email = tags.email || tags['contact:email'] || null;
  const osmUrl = `https://www.openstreetmap.org/${el.type}/${el.id}`;

  return { name, industry, street, city, postcode, province, phone, website, domain, email, osmUrl };
};

const buildCompanyPayload = (lead) => {
  const payload = {
    name: lead.name,
    leadSource: 'OPENSTREETMAP',
    leadStatus: 'NEW',
    industry: lead.industry,
    scrapedAt: new Date().toISOString(),
    sourceUrl: lead.osmUrl,
  };
  if (lead.domain) {
    payload.domainName = { primaryLinkUrl: `https://${lead.domain}`, primaryLinkLabel: lead.domain };
  }
  if (lead.street || lead.city) {
    payload.address = {
      addressStreet1: lead.street || null,
      addressCity: lead.city || null,
      addressPostcode: lead.postcode || null,
      addressState: lead.province || null,
      addressCountry: 'Canada',
    };
  }
  return payload;
};

const main = async () => {
  const { client, limit, dryRun } = init();
  console.log(`\nOSM Overpass scraper — Quebec fashion/jewelry/clothing`);
  console.log(`Dry run: ${dryRun}  Limit: ${limit ?? 'none'}\n`);

  const query = buildQuery(QUEBEC_BBOX);
  const elements = await fetchFromOverpass(query);
  console.log(`\nReceived ${elements.length} OSM elements`);

  const leads = [];
  for (const el of elements) {
    const lead = elementToLead(el);
    if (lead) leads.push(lead);
    if (limit && leads.length >= limit) break;
  }
  console.log(`Parsed ${leads.length} valid leads with names\n`);

  if (dryRun) {
    console.log('--- Sample (first 5) ---');
    for (const lead of leads.slice(0, 5)) {
      console.log(JSON.stringify(lead, null, 2));
    }
    console.log('\n--dry-run: no records written');
    return;
  }

  // In-script dedupe: skip repeat domains or (name+street) pairs
  const seen = new Set();
  const unique = [];
  for (const lead of leads) {
    const key = lead.domain || `${lead.name.toLowerCase()}|${(lead.street || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(lead);
  }
  console.log(`After in-script dedupe: ${unique.length} unique leads`);

  let created = 0;
  let failed = 0;
  let dupeSkipped = 0;
  for (const lead of unique) {
    try {
      await createCompany(client, buildCompanyPayload(lead));
      created++;
      if (created % 25 === 0) console.log(`  Progress: ${created} created, ${failed} failed, ${dupeSkipped} dup`);
    } catch (err) {
      const msg = err.message || '';
      if (/duplicate|already in use/i.test(msg)) {
        dupeSkipped++;
      } else {
        failed++;
        if (failed < 10) console.error(`  FAIL ${lead.name}: ${msg.slice(0, 150)}`);
      }
    }
  }

  console.log(`\n--- Done: ${created} created, ${dupeSkipped} dup-skipped, ${failed} failed ---`);
};

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
