# QuickBooks bridge (studio Mac)

Local helper that lets the CRM's **Add to QuickBooks** button (person record,
right rail) create a customer in the real QuickBooks Online company using
Moshe's logged-in Safari session on this Mac.

- The CRM button opens a small popup served by this helper
  (`http://127.0.0.1:8788/quickbooks?name=…&email=…&phone=…`), so it works
  from any browser viewing the CRM (Edge, Chrome, Safari…).
- The helper drives Safari through AppleScript `do JavaScript`: opens a
  dedicated tab on the QBO Customers list, clicks **New customer**, fills
  First/Last name, Company, display name, Email, Phone and a provenance
  note, clicks **Save**, then reports the outcome (saved / duplicate /
  not-logged-in / error). The Safari tab is left open after a save for a
  quick eyeball.
- Bound to `127.0.0.1:8788` only. Requests that carry a foreign
  `Origin`/`Referer` (any website other than the CRM) are refused.

## One-time setup (already done on the studio Mac)

1. Safari → Settings → Developer → **Allow remote automation** ✓ and
   **Allow JavaScript from Apple Events** ✓ (toggled 2026-09-11).
2. Install + start the LaunchAgent:

   ```bash
   cd tools/quickbooks-bridge && ./deploy-local.sh
   ```

## Running / restarting

The LaunchAgent (`ca.impressionphotography.quickbooks-bridge`) starts at
login and restarts on crash. After editing `server.js`:

```bash
./deploy-local.sh          # rewrites the plist (path pinning) and restarts
```

Logs: `/tmp/quickbooks-bridge.log` and `/tmp/quickbooks-bridge.err.log`.

## Notes & gotchas

- If macOS ever shows a "node wants to control Safari" dialog, click OK —
  it is the one-time Apple Events consent for the LaunchAgent.
- If the QuickBooks session expires, the popup says so; log into QuickBooks
  in Safari normally and press the CRM button again.
- Field targeting is by visible label text ("First name", "Customer display
  name", …), because QBO regenerates element ids per render. If Intuit
  renames labels, update `LABEL_FINDER` targets in `server.js`.
- One run at a time (serialized); each run reuses the single
  `#crm-bridge` tab, so no tab spam.
