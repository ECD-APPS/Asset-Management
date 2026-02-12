#!/usr/bin/env bash
set -euo pipefail

# Ubuntu Dev Setup for Expo Stores
# - Installs prerequisites (git, curl, Node.js 18, MongoDB local)
# - Installs mkcert and generates local HTTPS certs
# - Creates server/.env
# - Installs dependencies and starts dev servers with HTTPS

REPO_DIR="${REPO_DIR:-$HOME/expo-stores}"
PORT_API="${PORT_API:-5000}"
DEV_ORIGIN="${DEV_ORIGIN:-https://localhost:5173}"

log() { echo "[setup] $*"; }

ensure_pkg() {
  if ! dpkg -s "$1" >/dev/null 2>&1; then
    sudo apt install -y "$1"
  fi
}

log "Updating apt and installing core tools"
sudo apt update
ensure_pkg git
ensure_pkg curl
ensure_pkg build-essential
ensure_pkg libssl-dev
ensure_pkg libnss3-tools

log "Installing Node.js 18 (Nodesource)"
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
ensure_pkg nodejs
node -v && npm -v

log "Installing MongoDB (local dev)"
if ! systemctl is-active --quiet mongod; then
  sudo apt install -y mongodb || true
  sudo systemctl enable --now mongodb || true
fi

log "Installing mkcert"
if ! command -v mkcert >/dev/null 2>&1; then
  curl -L https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64 -o mkcert
  chmod +x mkcert
  sudo mv mkcert /usr/local/bin/mkcert
fi
mkcert -install

log "Cloning repository (or using existing)"
if [ ! -d "$REPO_DIR" ]; then
  git clone https://github.com/tariq50243052-tech/Expo-Stores.git "$REPO_DIR"
fi
cd "$REPO_DIR"

log "Generating local HTTPS certificates for Vite"
mkdir -p client/certs
mkcert -key-file client/certs/localhost-key.pem -cert-file client/certs/localhost.pem localhost 127.0.0.1 ::1

log "Creating server/.env"
cat > server/.env <<EOF
NODE_ENV=development
PORT=${PORT_API}
MONGO_URI=mongodb://127.0.0.1:27017/expo-stores
JWT_SECRET=$(openssl rand -hex 32)
COOKIE_SECRET=$(openssl rand -hex 32)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_EMAIL=your@gmail.com
SMTP_PASSWORD=your_app_password
FROM_NAME=Expo Stores
CORS_ORIGIN=${DEV_ORIGIN}
EOF

log "Installing all dependencies"
npm run install:all

log "Starting API dev server (background)"
mkdir -p .logs
pushd server >/dev/null
nohup npm run dev > ../.logs/server-dev.log 2>&1 &
SERVER_PID=$!
popd >/dev/null

log "Starting Client dev server with HTTPS (background)"
pushd client >/dev/null
nohup npm run dev > ../.logs/client-dev.log 2>&1 &
CLIENT_PID=$!
popd >/dev/null

log "Dev servers started"
echo "API:    http://127.0.0.1:${PORT_API}/version"
echo "Client: ${DEV_ORIGIN}"
echo "Server PID: ${SERVER_PID} | Client PID: ${CLIENT_PID}"
echo "Logs:   $REPO_DIR/.logs/server-dev.log and $REPO_DIR/.logs/client-dev.log"
