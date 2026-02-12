#!/usr/bin/env bash
set -euo pipefail
DOMAIN="${DOMAIN:-example.com}"
DB_IP="${DB_IP:-10.0.0.3}"
WEB_IP="${WEB_IP:-10.0.0.1}"
REPO_DIR="${REPO_DIR:-/opt/expo-stores}"
PORT="${PORT:-5000}"
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
sudo npm i -g pm2
if [ ! -d "$REPO_DIR/.git" ]; then
  sudo mkdir -p "$REPO_DIR"
  sudo chown "$USER":"$USER" "$REPO_DIR"
  git clone https://github.com/tariq50243052-tech/Expo-Stores.git "$REPO_DIR"
fi
cd "$REPO_DIR"
npm run install:all
cd server
cat > .env <<EOF
NODE_ENV=production
PORT=${PORT}
MONGO_URI=mongodb://${DB_IP}:27017/expo-stores
JWT_SECRET=$(openssl rand -hex 32)
COOKIE_SECRET=$(openssl rand -hex 32)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_EMAIL=your@gmail.com
SMTP_PASSWORD=your_app_password
FROM_NAME=Expo Stores
CORS_ORIGIN=https://${DOMAIN}
EOF
pm2 start server.js --name expo-stores-api
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null
sudo ufw allow from ${WEB_IP} to any port ${PORT} proto tcp || true
sudo ufw deny ${PORT}/tcp || true
