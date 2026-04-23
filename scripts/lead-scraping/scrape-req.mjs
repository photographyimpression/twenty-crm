#!/usr/bin/env node

// Scrapes the Quebec business registry (REQ) via its public search API.
// Queries businesses by NAICS / activity description and pulls registered
// officers (président, secrétaire, etc.) as Person records — this is the key
// source for owner / C-level names.
//
// Usage:
//   node scripts/lead-scraping/scrape-req.mjs --url https://crm.impressionphotography.ca --token YOUR_API_KEY [--dry-run] [--limit 200]
//
// Data source: https://www.registreentreprises.gouv.qc.ca/RQAnonymeGR/GR/GR03/GR03A2_19A_PIU_RechEnt_PC/PageRechSimple.aspx
// (scraping public listing pages; delay 3s between requests, hard cap 500 per keyword)

import { init, createCompany, createPerson } from '../lib/twenty-api.mjs';
import { throttledFetch, normalizeDomain, inferRole } from '../lib/http-client.mjs';

const JSDOM_PATH = new URL(
  '../../packages/twenty-server/node_modules/jsdom/lib/api.js',
  import.meta.url,
);

const loadJsdom = async () => {
  try {
    const { JSDOM } = await import(JSDOM_PATH.href);
    return JSDOM;
  } catch {
    const { JSDOM } = await import('jsdom');
    return JSDOM;
  }
};

const SEARCH_KEYWORDS = [
  { q: 'bijouterie', industry: 'JEWELRY' },
  { q: 'joaillerie', industry: 'JEWELRY' },
  { q: 'jewellery', industry: 'JEWELRY' },
  { q: 'jewelry', industry: 'JEWELRY' },
  { q: 'boutique vêtements', industry: 'CLOTHING' },
  { q: 'boutique mode', industry: 'FASHION' },
  { q: 'couture', industry: 'FASHION' },
  { q: 'prêt-à-porter', industry: 'FASHION' },
  { q: 'chaussures', industry: 'SHOES' },
  { q: 'maroquinerie', industry: 'LEATHER' },
  { q: 'accessoires mode', industry: 'ACCESSORIES' },
  { q: 'mariée', industry: 'BRIDAL' },
  { q: 'tissus', industry: 'TEXTILE' },
];

const BASE = 'https://www.registreentreprises.gouv.qc.ca/RQAnonymeGR/GR/GR03/GR03A2_19A_PIU_RechEnt_PC';
const SEARCH_URL = `${BASE}/PageRechSimple.aspx`;
const HARD_CAP_PER_KEYWORD = 500;

const parseSearchResults = (JSDOM, html) => {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const rows = doc.querySelectorAll('table.tableauFormulaireListe tbody tr, table.ListeResultats tbody tr');
  const results = [];
  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) continue;
    const link = cells[0].querySelector('a[href]');
    const name = (cells[0].textContent || '').trim();
    const neq = (cells[1]?.textContent || '').trim();
    const status = (cells[2]?.textContent || '').trim();
    if (name && link) {
      results.push({
        name,
        neq,
        status,
        detailHref: link.getAttribute('href'),
      });
    }
  }
  return results;
};

const parseDetailPage = (JSDOM, html) => {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const fieldText = (labelPattern) => {
    const allText = doc.body.textContent || '';
    const match = allText.match(new RegExp(`${labelPattern}\\s*:?\\s*([^\\n\\r]{2,200})`, 'i'));
    return match ? match[1].trim() : null;
  };

  const address = fieldText("Adresse du domicile|Adresse de l'établissement|Adresse du siège|Adresse");
  const phone = fieldText('Téléphone|Telephone');
  const website = fieldText('Site Internet|Site web|Website');
  const email = fieldText('Courrier électronique|Email');

  const officers = [];
  const officerRows = doc.querySelectorAll('table.tableauFormulaireListe tr, table.ListeAdministrateurs tr');
  for (const row of officerRows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) continue;
    const title = (cells[0].textContent || '').trim();
    const fullName = (cells[1].textContent || '').trim();
    if (!fullName || !title) continue;
    if (/en date|date d'entrée/i.test(fullName)) continue;
    const parts = fullName.split(/\s+/);
    const firstName = parts[0] || null;
    const lastName = parts.slice(1).join(' ') || null;
    officers.push({ title, firstName, lastName, role: inferRole(title) });
  }

  return { address, phone, website, email, officers };
};

const splitAddress = (addressText) => {
  if (!addressText) return {};
  const parts = addressText.split(',').map((p) => p.trim()).filter(Boolean);
  const postcodeMatch = addressText.match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i);
  return {
    addressStreet1: parts[0] || null,
    addressCity: parts[1] || null,
    addressPostcode: postcodeMatch ? postcodeMatch[0].toUpperCase() : null,
  };
};

const buildCompanyPayload = (entry, detail, industry) => {
  const payload = {
    name: entry.name,
    leadSource: 'REQ',
    leadStatus: detail.officers.length ? 'CONTACT_FOUND' : 'NEW',
    industry,
    scrapedAt: new Date().toISOString(),
    sourceUrl: `${BASE}/${entry.detailHref}`,
    scrapeNotes: `NEQ: ${entry.neq}; Status: ${entry.status}`,
  };
  const domain = normalizeDomain(detail.website);
  if (domain) payload.domainName = { primaryLinkUrl: domain, primaryLinkLabel: domain };
  const addrParts = splitAddress(detail.address);
  if (addrParts.addressStreet1) {
    payload.address = {
      ...addrParts,
      addressState: 'Quebec',
      addressCountry: 'Canada',
    };
  }
  return payload;
};

const buildPersonPayload = (officer, companyId) => ({
  name: { firstName: officer.firstName, lastName: officer.lastName || '' },
  jobTitle: officer.title,
  role: officer.role?.toUpperCase?.() || 'OTHER',
  leadSource: 'REQ',
  confidenceScore: 90,
  companyId,
});

const main = async () => {
  const { client, limit, dryRun } = init();
  console.log(`\nQuebec REQ scraper — incorporated fashion/jewelry/clothing businesses`);
  console.log(`Dry run: ${dryRun}  Limit: ${limit ?? 'none'}\n`);

  const JSDOM = await loadJsdom();
  const allLeads = [];

  for (const kw of SEARCH_KEYWORDS) {
    console.log(`\nSearching REQ for "${kw.q}"...`);
    const searchUrl = `${SEARCH_URL}?NomAssuj=${encodeURIComponent(kw.q)}&DomSuppr=1`;
    let html;
    try {
      html = await throttledFetch(searchUrl, { minDelayMs: 3000, timeoutMs: 30000 });
    } catch (err) {
      console.error(`  FAIL search: ${err.message}`);
      continue;
    }
    const entries = parseSearchResults(JSDOM, html).slice(0, HARD_CAP_PER_KEYWORD);
    console.log(`  Found ${entries.length} candidates`);

    for (const entry of entries) {
      if (limit && allLeads.length >= limit) break;
      const detailUrl = `${BASE}/${entry.detailHref}`;
      let detailHtml;
      try {
        detailHtml = await throttledFetch(detailUrl, { minDelayMs: 3000, timeoutMs: 30000 });
      } catch (err) {
        console.error(`  Skip ${entry.name}: ${err.message}`);
        continue;
      }
      const detail = parseDetailPage(JSDOM, detailHtml);
      allLeads.push({ entry, detail, industry: kw.industry });
    }
    if (limit && allLeads.length >= limit) break;
  }

  console.log(`\nTotal REQ records: ${allLeads.length}`);

  if (dryRun) {
    console.log('--- Sample (first 3) ---');
    for (const lead of allLeads.slice(0, 3)) {
      console.log(JSON.stringify(lead, null, 2));
    }
    console.log('\n--dry-run: no records written');
    return;
  }

  let companiesCreated = 0;
  let personsCreated = 0;
  let failed = 0;

  for (const { entry, detail, industry } of allLeads) {
    try {
      const company = await createCompany(client, buildCompanyPayload(entry, detail, industry));
      companiesCreated++;
      for (const officer of detail.officers) {
        try {
          await createPerson(client, buildPersonPayload(officer, company.id));
          personsCreated++;
        } catch (err) {
          if (failed < 5) console.error(`  Officer FAIL ${officer.firstName}: ${err.message}`);
        }
      }
      if (companiesCreated % 25 === 0) {
        console.log(`  Progress: ${companiesCreated} companies, ${personsCreated} persons, ${failed} failed`);
      }
    } catch (err) {
      failed++;
      if (failed < 5) console.error(`  FAIL ${entry.name}: ${err.message}`);
    }
  }

  console.log(`\n--- Done: ${companiesCreated} companies, ${personsCreated} persons, ${failed} failed ---`);
};

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
