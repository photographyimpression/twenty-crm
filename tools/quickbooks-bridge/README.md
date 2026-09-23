# QuickBooks bridge (studio Mac)

Local helper behind the CRM's QuickBooks card (person record, right rail).
Three actions, all driven through Moshe's logged-in Safari session:

- **Add to QuickBooks** (`/quickbooks`) — opens the QBO Customers list in a
  dedicated tab, clicks **New customer**, fills First/Last name, Company,
  display name, Email, Phone and a provenance note, clicks **Save**, and
  reports the outcome (saved / duplicate / not-logged-in / error). On
  `saved` it extracts the new customer's `nameId` from the landing URL and
  the popup postMessages it back so the CRM stores `quickbooksNameId` on
  the person — the card then switches to the two actions below.
- **Open in QuickBooks** (`/open?nameId=…`) — deep-links the bridge tab to
  `customerdetail?nameId=…`.
- **Create invoice** (`/invoice?nameId=…`) — deep-links to
  `invoice?nameId=…`; QuickBooks pre-fills the customer when the form loads
  in the active tab. Finishing the invoice (lines, Save) happens in Safari.

## How the Safari tab is tracked

The bridge owns ONE tab (never a pile): `open-tab.scpt` reuses the tracked
tab `(window id, tab index)` — persisted to a state file — or the tab still
carrying the `#crm-bridge` URL hash, else creates a fresh one, then makes it
the ACTIVE tab of its window (QuickBooks only mounts forms in the active
tab) WITHOUT activating Safari, so the user's foreground app is untouched.

**Never probe unknown tabs with `do JavaScript`** — busy pages (e.g. a
mounting invoice form) block the Apple event for minutes. That is why the
window.name scan was removed; identity is the state file + URL hash.

## One-time setup (already done on the studio Mac)

1. Safari → Settings → Developer → **Allow remote automation** ✓ and
   **Allow JavaScript from Apple Events** ✓ (toggled 2026-09-11).
2. `person.quickbooksNameId` field created via
   `scripts/setup-quickbooks-nameid.mjs` (2026-09-23).
3. Install + start the LaunchAgent:

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
- One run at a time (serialized); each run reuses the single bridge tab.
- The invoice page does not answer `do JavaScript` while it mounts in a
  background window — invoice mode therefore navigates and reports ready
  without probing; the prefill is applied by QuickBooks from the URL.
