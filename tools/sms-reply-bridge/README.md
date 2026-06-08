# SMS reply bridge

Turns email replies sent from Outlook to `sms-reply+<token>@productphotographymontreal.ca` into outbound SMS via Telnyx.

## How it works

1. Twenty CRM receives an inbound SMS via Telnyx webhook.
2. The CRM sends Moshe a notification email with `Reply-To: sms-reply+<base64url-token>@productphotographymontreal.ca`. The token encodes the sender's phone number with an HMAC tag.
3. Moshe replies in Outlook. The reply lands in docker-mailserver's Postfix.
4. Postfix's `transport_maps` routes `sms-reply@productphotographymontreal.ca` (and any `+TOKEN` extension) to a `pipe` transport that invokes `node /opt/sms-reply-bridge/src/bridge.js` per message.
5. The bridge parses the RFC822 message, verifies `From: moshe@impressionphotography.ca` + SPF=pass + DKIM=pass, decodes the token, strips quoted history/signature, and POSTs to Telnyx.
6. The bridge then POSTs to the CRM's `/telnyx/sms/log-outbound` endpoint so the conversation thread in the SMS Inbox shows the reply.

## Installation (on OVH)

```bash
# 1. Sync the directory to the server (from this repo, the worktree path)
rsync -av --exclude=node_modules --exclude=.env --exclude=.git tools/sms-reply-bridge/ root@15.204.91.183:/opt/sms-reply-bridge/

# 2. On the server:
cd /opt/sms-reply-bridge
cp .env.example .env
$EDITOR .env                       # fill in TELNYX_API_KEY, TWENTY_API_TOKEN, etc.
chmod 600 .env
npm install --omit=dev

# 3. Add the bind-mount to /opt/mailserver/02-docker-compose.yml under mailserver.volumes:
#      - /opt/sms-reply-bridge:/opt/sms-reply-bridge:ro
#    then: docker compose -f /opt/mailserver/02-docker-compose.yml up -d --force-recreate mailserver

# 4. Run the setup script:
bash /opt/sms-reply-bridge/postfix/06-setup-sms-bridge.sh
```

## Testing

```bash
# Run the bridge tests (no live Telnyx calls, all dry-run):
cd /opt/sms-reply-bridge
node test/run-tests.js
```

To simulate a real reply hitting Postfix end-to-end:

```bash
docker exec -i mailserver sendmail -i sms-reply+<token>@productphotographymontreal.ca < sample-reply.eml
tail -f /var/log/sms-reply-bridge.log
```

## Security

- **Sender authentication is mandatory.** From header must equal `moshe@impressionphotography.ca` AND the Authentication-Results header must show SPF=pass AND DKIM=pass. Without all three, the bridge rejects.
- **Token HMAC**: the plus-addressing token includes an HMAC tag so an attacker can't hand-craft a `sms-reply+...` address pointing at an arbitrary phone number.
- **Audit log**: every accept/reject decision is appended as a JSON line to `/var/log/sms-reply-bridge.log`.

## Files

- `src/bridge.js` — the per-message Node script invoked by Postfix `pipe`.
- `postfix/master.cf.extra` — pipe transport definition appended to `/etc/postfix/master.cf`.
- `postfix/transport.sms-reply` — Postfix transport map routing `sms-reply@...` to the pipe.
- `postfix/06-setup-sms-bridge.sh` — idempotent installer.
- `test/run-tests.js` — smoke tests (all dry-run).
