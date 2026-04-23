#!/usr/bin/env node

// Deduplicates scraped Company and Person records.
// Companies: match by normalized domain, fall back to (normalized name + postcode).
// Persons: match by email (case-insensitive), fall back to (firstName + lastName + companyId).
//
// Merge strategy: keep the oldest record (lowest createdAt), soft-delete the rest.
//
// Usage:
//   node scripts/lead-scraping/dedupe-leads.mjs --url https://crm.impressionphotography.ca --token YOUR_API_KEY [--dry-run]

import { init, findAllCompanies } from '../lib/twenty-api.mjs';

const normalizeName = (name) =>
  (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(inc|ltd|ltee|ltée|corp|corporation|enr|reg'd|llc|co)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const normalizeDomain = (input) => (input || '').toLowerCase().replace(/^www\./, '').trim() || null;

const deleteCompany = async (client, id) => {
  await client.apiQuery(`
    mutation DeleteCompany($id: UUID!) {
      deleteCompany(id: $id) { id }
    }
  `, { id });
};

const deletePerson = async (client, id) => {
  await client.apiQuery(`
    mutation DeletePerson($id: UUID!) {
      deletePerson(id: $id) { id }
    }
  `, { id });
};

const fetchAllPersons = async (client) => {
  const results = [];
  let cursor = null;
  while (true) {
    const data = await client.apiQuery(`
      query FindPersons($first: Int, $after: String) {
        people(first: $first, after: $after) {
          edges {
            node {
              id
              createdAt
              name { firstName lastName }
              emails { primaryEmail }
              companyId
              leadSource
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { first: 60, after: cursor });
    results.push(...data.people.edges.map((e) => e.node));
    if (!data.people.pageInfo.hasNextPage) break;
    cursor = data.people.pageInfo.endCursor;
  }
  return results;
};

const dedupeCompanies = async (client, dryRun) => {
  const all = await findAllCompanies(client);
  const scraped = all.filter((c) => c.leadSource);
  console.log(`Loaded ${all.length} total companies (${scraped.length} scraped)`);

  const groups = new Map();
  for (const c of scraped) {
    const domain = normalizeDomain(c.domainName?.primaryLinkUrl);
    const key = domain || `${normalizeName(c.name)}|${(c.address?.addressPostcode || '').toUpperCase()}`;
    if (!key || key === '|') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  let duplicatesRemoved = 0;
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const [, ...dupes] = group;
    for (const d of dupes) {
      if (dryRun) {
        console.log(`  DRY: would delete duplicate ${d.name} (${d.id}) [key=${key}]`);
      } else {
        try {
          await deleteCompany(client, d.id);
        } catch (err) {
          console.error(`  FAIL delete ${d.name}: ${err.message}`);
          continue;
        }
      }
      duplicatesRemoved++;
    }
  }
  console.log(`Companies: ${duplicatesRemoved} duplicates ${dryRun ? 'found' : 'removed'}`);
};

const dedupePersons = async (client, dryRun) => {
  const all = await fetchAllPersons(client);
  const scraped = all.filter((p) => p.leadSource);
  console.log(`Loaded ${all.length} total people (${scraped.length} scraped)`);

  const groups = new Map();
  for (const p of scraped) {
    const email = (p.emails?.primaryEmail || '').toLowerCase();
    const fullName = `${p.name?.firstName || ''} ${p.name?.lastName || ''}`.trim().toLowerCase();
    const key = email || `${fullName}|${p.companyId || ''}`;
    if (!key || key === '|') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  let duplicatesRemoved = 0;
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const [, ...dupes] = group;
    for (const d of dupes) {
      if (dryRun) {
        console.log(`  DRY: would delete duplicate person ${d.name?.firstName} ${d.name?.lastName} (${d.id}) [key=${key}]`);
      } else {
        try {
          await deletePerson(client, d.id);
        } catch (err) {
          console.error(`  FAIL delete ${d.id}: ${err.message}`);
          continue;
        }
      }
      duplicatesRemoved++;
    }
  }
  console.log(`People: ${duplicatesRemoved} duplicates ${dryRun ? 'found' : 'removed'}`);
};

const main = async () => {
  const { client, dryRun } = init();
  console.log(`\nLead deduplication ${dryRun ? '(dry run)' : '(destructive)'}\n`);
  await dedupeCompanies(client, dryRun);
  await dedupePersons(client, dryRun);
  console.log('\n--- Dedupe complete ---');
};

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
