#!/usr/bin/env bash
set -euo pipefail
APP_IP="${APP_IP:-10.0.0.2}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-ChangeMeStrong!}"
APP_USER="${APP_USER:-appuser}"
APP_PASS="${APP_PASS:-ChangeMeStrongApp!}"
sudo apt update
sudo apt install -y mongodb
sudo systemctl enable --now mongod || true
CONF_TMP="/tmp/mongod.conf"
cat > "$CONF_TMP" <<'EOF'
storage:
  dbPath: /var/lib/mongodb
  journal:
    enabled: true
systemLog:
  destination: file
  path: /var/log/mongodb/mongod.log
  logAppend: true
net:
  bindIp: 127.0.0.1,APP_VM_PRIVATE_IP
  port: 27017
security:
  authorization: enabled
setParameter:
  enableLocalhostAuthBypass: false
EOF
sudo cp "$CONF_TMP" /etc/mongod.conf
sudo sed -i "s/APP_VM_PRIVATE_IP/$APP_IP/g" /etc/mongod.conf
sudo systemctl restart mongod
mongo <<EOF
use admin
db.createUser({user: "${ADMIN_USER}", pwd: "${ADMIN_PASS}", roles:[{role:"root", db:"admin"}]})
EOF
mongo -u "${ADMIN_USER}" -p "${ADMIN_PASS}" --authenticationDatabase admin <<EOF
use expo-stores
db.createUser({user: "${APP_USER}", pwd: "${APP_PASS}", roles:[{role:"readWrite", db:"expo-stores"}]})
EOF
sudo ufw allow from ${APP_IP} to any port 27017 proto tcp || true
sudo ufw deny 27017/tcp || true
