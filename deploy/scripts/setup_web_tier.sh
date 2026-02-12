#!/usr/bin/env bash
set -euo pipefail
DOMAIN="${DOMAIN:-example.com}"
APP_IP="${APP_IP:-10.0.0.2}"
EMAIL="${EMAIL:-admin@example.com}"
CLIENT_DIR="${CLIENT_DIR:-/var/www/expo-stores/client}"
REPO_DIR="${REPO_DIR:-/opt/expo-stores}"
sudo apt update
sudo apt install -y nginx snapd rsync
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
sudo mkdir -p "$CLIENT_DIR"
if [ -d "$REPO_DIR/client/dist" ]; then
  sudo rsync -a "$REPO_DIR/client/dist/" "$CLIENT_DIR/"
fi
sudo certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" || true
CONF_SRC="$REPO_DIR/deploy/nginx/expo-stores.conf"
CONF_DST="/etc/nginx/sites-available/expo-stores"
sudo cp "$CONF_SRC" "$CONF_DST"
sudo sed -i "s/example.com/$DOMAIN/g" "$CONF_DST"
sudo sed -i "s/APP_VM_PRIVATE_IP/$APP_IP/g" "$CONF_DST"
sudo ln -sf "$CONF_DST" /etc/nginx/sites-enabled/expo-stores
sudo nginx -t
sudo systemctl reload nginx
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
