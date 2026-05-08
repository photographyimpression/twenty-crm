#!/usr/bin/env bash
# Upload signature logo images to OVH server and add an nginx /sig-images/
# location so https://crm.impressionphotography.ca/sig-images/<name>.jpg
# serves the file. Idempotent — safe to re-run.
#
# Usage: bash scripts/deploy-sig-assets.sh

set -euo pipefail

SERVER=root@15.204.91.183
IMAGES_DIR="$(cd "$(dirname "$0")" && pwd)/sig-assets"
NGINX_CONF=/etc/nginx/sites-enabled/crm.impressionphotography.ca.conf

echo ">>> uploading images from $IMAGES_DIR"
ssh "$SERVER" "mkdir -p /var/www/sig-images && chmod 755 /var/www/sig-images"
scp "$IMAGES_DIR"/*.jpg "$SERVER":/var/www/sig-images/
ssh "$SERVER" "ls -la /var/www/sig-images/"

echo ">>> ensuring nginx /sig-images/ location exists in HTTPS server block"
ssh "$SERVER" 'python3 << "EOF"
path = "'"$NGINX_CONF"'"
with open(path) as f: cfg = f.read()
addition = """    # Static signature images (per-niche email signatures)
    location /sig-images/ {
        alias /var/www/sig-images/;
        access_log off;
        expires 7d;
        add_header Cache-Control "public";
    }

"""
target = "    client_max_body_size 100M;\n\n    location / {\n        proxy_pass http://localhost:3000;"
new = "    client_max_body_size 100M;\n\n" + addition + "    location / {\n        proxy_pass http://localhost:3000;"
https_block = cfg.split("listen 443")[1] if "listen 443" in cfg else ""
if "alias /var/www/sig-images" in https_block:
    print("already present")
elif target in cfg:
    cfg = cfg.replace(target, new, 1)
    with open(path, "w") as f: f.write(cfg)
    print("inserted into HTTPS block")
else:
    raise SystemExit("could not find anchor; inspect nginx config manually")
EOF
nginx -t && systemctl reload nginx && echo "nginx reloaded"'

echo ">>> verifying images respond"
for f in product clothing amazon jewellery; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "https://crm.impressionphotography.ca/sig-images/$f.jpg")
  echo "  $f.jpg -> $status"
done

echo ">>> done."
