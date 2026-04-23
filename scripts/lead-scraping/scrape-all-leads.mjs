#!/usr/bin/env node

// Master orchestrator: runs every scraper in sequence, then dedupes, then
// enriches with website email harvester. Pass through --dry-run / --limit.
//
// Usage:
//   node scripts/lead-scraping/scrape-all-leads.mjs --url https://crm.impressionphotography.ca --token YOUR_API_KEY [--dry-run] [--limit 100]

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const STEPS = [
  { label: 'OSM Overpass', script: 'scrape-osm.mjs' },
  { label: 'Yellow Pages', script: 'scrape-yellowpages.mjs' },
  { label: 'Quebec REQ', script: 'scrape-req.mjs' },
  { label: 'Dedupe (first pass)', script: 'dedupe-leads.mjs' },
  { label: 'Website email harvester', script: 'scrape-website-emails.mjs' },
  { label: 'Dedupe (final)', script: 'dedupe-leads.mjs' },
];

const runStep = (script, args) =>
  new Promise((resolve, reject) => {
    const child = spawn('node', [join(__dirname, script), ...args], { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
    child.on('error', reject);
  });

const main = async () => {
  const args = process.argv.slice(2);
  const started = Date.now();
  console.log('\n=== Free Lead Generation — Orchestrator ===\n');

  for (const step of STEPS) {
    console.log(`\n>>> ${step.label}\n`);
    try {
      await runStep(step.script, args);
    } catch (err) {
      console.error(`\nStep "${step.label}" failed: ${err.message}`);
      console.error('Continuing to next step. Re-run this step individually afterwards if needed.');
    }
  }

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\n=== All steps complete in ${mins} min ===`);
  console.log('Open Twenty CRM → Companies → "Free Leads" view to review results.');
};

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
