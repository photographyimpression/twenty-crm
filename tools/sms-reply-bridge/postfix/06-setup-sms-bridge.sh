#!/bin/bash
# Set up the SMS reply bridge inside the docker-mailserver container.
# Idempotent: safe to re-run after container restart/recreate.
#
# Wires sms-reply@productphotographymontreal.ca (with plus-addressing)
# to a Node pipe that forwards the reply body back as an SMS via Telnyx.
#
# Prerequisites:
#   - docker-mailserver running as container `mailserver`
#   - /opt/sms-reply-bridge/ exists on the HOST (copied from this repo)
#   - /opt/sms-reply-bridge/.env exists, chmod 600, with TELNYX_API_KEY etc.

set -e

CONTAINER=mailserver
BRIDGE_HOST_DIR=/opt/sms-reply-bridge
BRIDGE_USER=smsbridge
DOMAIN=productphotographymontreal.ca
REPLY_ADDR="sms-reply@${DOMAIN}"

echo "==> SMS reply bridge setup"

# --- Host-side sanity ---
[[ -d "$BRIDGE_HOST_DIR" ]] || { echo "ERROR: $BRIDGE_HOST_DIR missing on host"; exit 1; }
[[ -f "$BRIDGE_HOST_DIR/.env" ]] || { echo "ERROR: $BRIDGE_HOST_DIR/.env missing — copy .env.example and fill in"; exit 1; }
[[ -f "$BRIDGE_HOST_DIR/src/bridge.js" ]] || { echo "ERROR: bridge.js missing"; exit 1; }
[[ -d "$BRIDGE_HOST_DIR/node_modules" ]] || { echo "ERROR: run 'npm install --omit=dev' in $BRIDGE_HOST_DIR first"; exit 1; }

# --- Bind-mount /opt/sms-reply-bridge into the mailserver container ---
if ! docker inspect "$CONTAINER" --format '{{range .Mounts}}{{.Source}}->{{.Destination}}{{"\n"}}{{end}}' | grep -q "^${BRIDGE_HOST_DIR}->/opt/sms-reply-bridge$"; then
  echo "  ! ${BRIDGE_HOST_DIR} is NOT bind-mounted into container."
  echo "    Add to /opt/mailserver/02-docker-compose.yml under mailserver.volumes:"
  echo "      - ${BRIDGE_HOST_DIR}:/opt/sms-reply-bridge:ro"
  echo "    then docker compose up -d --force-recreate mailserver"
  exit 1
fi
echo "  + bridge dir mounted into container"

# --- Create unprivileged user inside container ---
if ! docker exec "$CONTAINER" id "$BRIDGE_USER" >/dev/null 2>&1; then
  docker exec "$CONTAINER" useradd -r -s /sbin/nologin "$BRIDGE_USER" || true
  echo "  + ${BRIDGE_USER} user created in container"
else
  echo "  = ${BRIDGE_USER} user exists"
fi

# --- Ensure node is available in container ---
if ! docker exec "$CONTAINER" sh -c 'command -v node >/dev/null 2>&1'; then
  echo "  ! node not found in container; installing nodejs..."
  docker exec "$CONTAINER" sh -c 'apt-get update && apt-get install -y --no-install-recommends nodejs'
fi
NODE_VERSION=$(docker exec "$CONTAINER" node --version)
echo "  + node ${NODE_VERSION} in container"

# --- Audit log file ---
docker exec "$CONTAINER" sh -c "touch /var/log/sms-reply-bridge.log && chown ${BRIDGE_USER}:${BRIDGE_USER} /var/log/sms-reply-bridge.log"
echo "  + audit log writable by ${BRIDGE_USER}"

# --- Create the sms-reply mailbox so Postfix accepts mail to it ---
# (plus-addressing is on by default — sms-reply+TOKEN@... routes here)
if ! docker exec "$CONTAINER" setup email list 2>/dev/null | grep -q "^\* ${REPLY_ADDR}"; then
  PASS=$(openssl rand -base64 24)
  docker exec "$CONTAINER" setup email add "${REPLY_ADDR}" "${PASS}" >/dev/null 2>&1
  echo "  + ${REPLY_ADDR} mailbox created (password discarded — pipe transport bypasses it)"
else
  echo "  = ${REPLY_ADDR} mailbox exists"
fi

# --- Install transport map ---
TRANSPORT_SRC=/opt/sms-reply-bridge/postfix/transport.sms-reply
TRANSPORT_DST=/etc/postfix/transport-sms-reply
docker exec "$CONTAINER" cp "$TRANSPORT_SRC" "$TRANSPORT_DST"
docker exec "$CONTAINER" postmap hash:"$TRANSPORT_DST"
echo "  + transport map installed"

# Append to existing transport_maps if it isn't already there.
CURRENT_TM=$(docker exec "$CONTAINER" postconf -h transport_maps || echo "")
if echo "$CURRENT_TM" | grep -q "transport-sms-reply"; then
  echo "  = transport_maps already chained"
else
  if [[ -z "$CURRENT_TM" ]]; then
    NEW_TM="hash:${TRANSPORT_DST}"
  else
    NEW_TM="${CURRENT_TM}, hash:${TRANSPORT_DST}"
  fi
  docker exec "$CONTAINER" postconf -e "transport_maps = ${NEW_TM}"
  echo "  + transport_maps chained: ${NEW_TM}"
fi

# --- Install master.cf pipe definition ---
if ! docker exec "$CONTAINER" grep -q "^smsreply  unix" /etc/postfix/master.cf 2>/dev/null; then
  docker exec "$CONTAINER" sh -c 'cat /opt/sms-reply-bridge/postfix/master.cf.extra >> /etc/postfix/master.cf'
  echo "  + master.cf pipe transport appended"
else
  echo "  = master.cf already has smsreply transport"
fi

# --- Reload postfix to pick up changes ---
docker exec "$CONTAINER" postfix reload >/dev/null 2>&1 || docker exec "$CONTAINER" postfix start >/dev/null 2>&1
echo "  + postfix reloaded"

echo ""
echo "==> Setup complete."
echo "    Test from inside the container:"
echo "    docker exec $CONTAINER sh -c 'sendmail -i ${REPLY_ADDR} </opt/sms-reply-bridge/test/fixtures/sample-reply.eml'"
