# Free Lead Generation — Quebec Fashion/Jewelry/Clothing

Scripts that populate your Twenty CRM with free B2B leads (companies + decision-maker contacts) from public Canadian sources. Designed for Impression Photography's prospecting into Montreal/Quebec fashion/jewelry/clothing businesses.

## What it does

1. **Adds custom fields** to Company + Person (`leadSource`, `industry`, `leadStatus`, `scrapedAt`, `role`, etc.).
2. **Scrapes** four free sources in sequence:
   - **OpenStreetMap Overpass API** — no API key, returns shop name/address/phone/website
   - **Yellow Pages Canada** — HTML scrape across 9 Quebec cities and 13 categories
   - **Quebec REQ** (business registry) — includes registered officers (president, secretary) as real decision-maker names
   - **Website email harvester** — visits each Company's domain and pulls emails from `/contact`, `/about`, `/team`
3. **Dedupes** Companies (by domain or name+postcode) and Persons (by email).
4. **Creates three pinned views** in the Companies sidebar: "Free Leads — All", "Free Leads — With Contacts", "Free Leads — Ready to Enroll".

Leads are **tagged only** — they do NOT auto-enter your 12-touch sequence. Manually flip `leadStatus` to `READY_TO_ENROLL` before triggering outreach.

## Requirements

- Running Twenty CRM instance (local or production)
- A Twenty API key (Settings → APIs & Webhooks → + Create API Key)
- Node 18+ (uses built-in `fetch`)
- `jsdom` available (it is — part of `twenty-server` deps). If you run these scripts from a clean env, install it: `npm install jsdom --no-save`.

## First-time setup

```bash
# 1. Add the custom fields
node scripts/lead-scraping/setup-lead-fields.mjs \
  --url https://crm.impressionphotography.ca \
  --token YOUR_API_KEY

# 2. Create the saved views in the Companies sidebar
node scripts/lead-scraping/setup-free-leads-views.mjs \
  --url https://crm.impressionphotography.ca \
  --token YOUR_API_KEY
```

Both are idempotent — safe to re-run.

## Run the full pipeline

```bash
node scripts/lead-scraping/scrape-all-leads.mjs \
  --url https://crm.impressionphotography.ca \
  --token YOUR_API_KEY
```

Runs OSM → Yellow Pages → REQ → dedupe → website emails → dedupe. Expect 30–90 minutes for a full Quebec-wide run. Hit Ctrl-C and resume any single step later.

## Run individual scrapers

```bash
# Dry-run each source (no DB writes) to inspect sample output:
node scripts/lead-scraping/scrape-osm.mjs           --url ... --token ... --dry-run --limit 10
node scripts/lead-scraping/scrape-yellowpages.mjs   --url ... --token ... --dry-run --limit 10
node scripts/lead-scraping/scrape-req.mjs           --url ... --token ... --dry-run --limit 10

# Commit a small batch to DB:
node scripts/lead-scraping/scrape-osm.mjs           --url ... --token ... --limit 50

# Enrich existing Companies with decision-maker emails from their website:
node scripts/lead-scraping/scrape-website-emails.mjs --url ... --token ... --limit 50

# Dedupe (run after scraping):
node scripts/lead-scraping/dedupe-leads.mjs         --url ... --token ... --dry-run
node scripts/lead-scraping/dedupe-leads.mjs         --url ... --token ...
```

## Flags

- `--url`        — Twenty base URL, e.g. `https://crm.impressionphotography.ca` or `http://localhost:3000`
- `--token`      — API key from Twenty settings
- `--dry-run`    — Print what would happen, don't write to DB
- `--limit N`    — Stop after N leads (useful for tests)

## Expected yields (rough)

| Source                  | Companies | Persons |
|-------------------------|----------:|--------:|
| OpenStreetMap Overpass  | 2,000–4,000 | 0 |
| Yellow Pages            | 3,000–5,000 | 0 |
| Quebec REQ              | 4,000–8,000 | 3,000–6,000 |
| Website email harvester | —         | 1,500–3,000 |

After dedupe, expect **~8,000–12,000 total Companies** with **~4,000–7,000 linked decision-maker Persons**.

## CASL compliance reminder

Canada's Anti-Spam Legislation applies to cold outreach. Scraping public business data is legal. Sending commercial email to a scraped address requires implied or express consent — and every email needs an unsubscribe link and your physical address. Your existing 12-touch workflow should handle both.

## Troubleshooting

- **"Object not found" error** — run `setup-lead-fields.mjs` first.
- **Yellow Pages returns 0 results** — they may have changed DOM selectors. Check one URL manually in a browser and update `parseListing()` in `scrape-yellowpages.mjs`.
- **REQ search hangs** — their site is slow. Delay is already 3s/request; let it run.
- **Website email scraper finds no emails** — a lot of small retailers hide contact info behind forms. Expected ~30% hit rate.
- **Cloudflare 403s on Yellow Pages** — try a different time of day or reduce request rate (bump `minDelayMs` in `http-client.mjs`).

## Re-running weekly

To refresh leads periodically:

```bash
# On the OVH server, add to crontab:
0 3 * * 0 cd /opt/twenty && node scripts/lead-scraping/scrape-all-leads.mjs \
  --url http://localhost:3000 --token $TWENTY_API_TOKEN >> /var/log/twenty-scrape.log 2>&1
```

Stores the token in root's environment: `echo 'export TWENTY_API_TOKEN=...' >> ~/.bashrc`.
