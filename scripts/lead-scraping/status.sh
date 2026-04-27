#!/usr/bin/env bash
# Print a status snapshot of the lead-scraping pipeline.
# Safe to run from either Claude Code session — read-only.

set -u

echo "=== Lead Scraping Status $(date) ==="
echo ""

echo "--- Active processes ---"
pgrep -fl "scrape-|dedupe-leads|setup-lead|setup-free-leads" || echo "(no scrapers running)"
echo ""

echo "--- Latest log tails ---"
for f in /tmp/scrape-logs/*.log; do
  [ -f "$f" ] || continue
  echo "== $(basename "$f") =="
  tail -3 "$f" 2>/dev/null
  echo ""
done

echo "--- DB: Company counts by leadSource ---"
ssh root@15.204.91.183 'docker exec twenty-db-1 psql -U twenty -d default -c "SELECT \"leadSource\", count(*) FROM workspace_arem42qbur9jiys0e9bx25k0f.company WHERE \"leadSource\" IS NOT NULL GROUP BY \"leadSource\" ORDER BY count(*) DESC;"' 2>/dev/null

echo "--- DB: Person counts by leadSource ---"
ssh root@15.204.91.183 'docker exec twenty-db-1 psql -U twenty -d default -c "SELECT \"leadSource\", count(*) FROM workspace_arem42qbur9jiys0e9bx25k0f.person WHERE \"leadSource\" IS NOT NULL GROUP BY \"leadSource\" ORDER BY count(*) DESC;"' 2>/dev/null

echo "--- DB: Industries ---"
ssh root@15.204.91.183 'docker exec twenty-db-1 psql -U twenty -d default -c "SELECT industry, count(*) FROM workspace_arem42qbur9jiys0e9bx25k0f.company WHERE industry IS NOT NULL GROUP BY industry ORDER BY count(*) DESC;"' 2>/dev/null

echo "--- DB: Lead statuses ---"
ssh root@15.204.91.183 'docker exec twenty-db-1 psql -U twenty -d default -c "SELECT \"leadStatus\", count(*) FROM workspace_arem42qbur9jiys0e9bx25k0f.company WHERE \"leadStatus\" IS NOT NULL GROUP BY \"leadStatus\" ORDER BY count(*) DESC;"' 2>/dev/null

echo ""
echo "=== End status ==="
