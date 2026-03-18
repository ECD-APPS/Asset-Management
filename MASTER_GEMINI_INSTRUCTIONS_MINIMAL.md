# MASTER GEMINI INSTRUCTIONS (MINIMAL)

## GEMINI PROMPT

```text
You are my Linux deployment assistant for Expo Stores.
Give Linux bash commands only.
Use sections: desktop, db-vm, app-vm, web-vm.
Do not include sample outputs.
Always include safe checks before risky actions.
Keep these accounts unchanged:
- superadmin@expo.com / superadmin123
- it@expo.com / admin123
- noc@expo.com / admin123
Prefer these scripts when available:
- scripts/check-deploy-readiness.sh
- scripts/deploy-app-safe.sh
- scripts/deploy-web-safe.sh
Environment:
- app-vm: 10.96.133.197
- web-vm: 10.96.133.181
- db-vm: 10.96.133.213
- repo: /opt/Expo
- branch: main
- node: 20.x
Now produce exact command blocks for:
1) fresh install
2) safe update
3) verification
4) rollback
```

## DB-VM (10.96.133.213) FRESH

```bash
sudo apt update
sudo apt install -y gnupg curl
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo sed -i 's/^  bindIp: .*/  bindIp: 127.0.0.1,10.96.133.213/' /etc/mongod.conf
sudo systemctl enable --now mongod
sudo systemctl restart mongod
sudo systemctl status mongod --no-pager
```

```bash
mongosh <<'EOF'
use expo-stores
db.createUser({
  user: "expo_user",
  pwd: "CHANGE_ME_STRONG_PASSWORD",
  roles: [{ role: "readWrite", db: "expo-stores" }]
})
EOF
```

## APP-VM (10.96.133.197) FRESH

```bash
sudo apt update
sudo apt install -y git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
node -v
npm -v
```

```bash
cd /opt
sudo git clone https://github.com/tariq5024-blip/Expo.git
sudo chown -R "$USER:$USER" /opt/Expo
cd /opt/Expo/server
cp .env.vm.example .env
```

```env
MONGO_URI=mongodb://expo_user:CHANGE_ME_STRONG_PASSWORD@10.96.133.213:27017/expo-stores
PORT=5000
JWT_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
COOKIE_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
COOKIE_SECURE=false
ENABLE_CSRF=true
CORS_ORIGIN=http://10.96.133.181
SEED_DEFAULTS=true
```

```bash
cd /opt/Expo
npm ci
cd /opt/Expo/server
npm ci --omit=dev
pm2 start server.js --name expo-app --cwd /opt/Expo/server
pm2 save
pm2 startup
curl -sS http://127.0.0.1:5000/healthz
```

## WEB-VM (10.96.133.181) FRESH

```bash
sudo apt update
sudo apt install -y git curl build-essential nginx rsync
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

```bash
cd /opt
sudo git clone https://github.com/tariq5024-blip/Expo.git
sudo chown -R "$USER:$USER" /opt/Expo
cd /opt/Expo/client
npm ci
npm run build
```

```bash
sudo mkdir -p /var/www/expo/client
sudo rsync -a --delete /opt/Expo/client/dist/ /var/www/expo/client/dist/
sudo cp /opt/Expo/nginx.conf /etc/nginx/sites-available/expo
sudo sed -i 's#http://127.0.0.1:5000#http://10.96.133.197:5000#g' /etc/nginx/sites-available/expo
sudo ln -sf /etc/nginx/sites-available/expo /etc/nginx/sites-enabled/expo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
curl -I http://127.0.0.1/
```

## PREFLIGHT CHECKS

### APP-VM

```bash
cd /opt/Expo
chmod +x scripts/check-deploy-readiness.sh
ROLE=app ./scripts/check-deploy-readiness.sh
```

### WEB-VM

```bash
cd /opt/Expo
chmod +x scripts/check-deploy-readiness.sh
ROLE=web APP_IP=10.96.133.197 APP_PORT=5000 ./scripts/check-deploy-readiness.sh
```

### DB-VM

```bash
cd /opt/Expo
chmod +x scripts/check-deploy-readiness.sh
ROLE=db ./scripts/check-deploy-readiness.sh
```

## SAFE UPDATE

### APP-VM

```bash
cd /opt/Expo
git fetch origin
git checkout main
git pull --ff-only origin main
APP_DIR=/opt/Expo SERVICE_NAME=expo-app HEALTH_URL=http://127.0.0.1:5000/healthz ./scripts/deploy-app-safe.sh
pm2 status
curl -sS http://127.0.0.1:5000/healthz
```

### WEB-VM

```bash
cd /opt/Expo
git fetch origin
git checkout main
git pull --ff-only origin main
APP_DIR=/opt/Expo WEB_ROOT=/var/www/expo/client NGINX_SITE=/etc/nginx/sites-available/expo APP_UPSTREAM=10.96.133.197:5000 HEALTH_URL=http://127.0.0.1/ ./scripts/deploy-web-safe.sh
sudo nginx -t
curl -I http://127.0.0.1/
```

## VERIFY

### WEB-VM

```bash
curl -I http://10.96.133.197:5000/healthz
curl -I http://127.0.0.1/
```

### APP-VM

```bash
nc -zv 10.96.133.213 27017
curl -sS http://127.0.0.1:5000/healthz
```

### BROWSER

```text
http://10.96.133.181
```

## ROLLBACK QUICK

### APP-VM

```bash
pm2 logs expo-app --lines 200
pm2 restart expo-app --update-env
curl -sS http://127.0.0.1:5000/healthz
```

### WEB-VM

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -I http://127.0.0.1/
```

### GIT ROLLBACK (APP-VM + WEB-VM)

```bash
cd /opt/Expo
git log --oneline -n 5
git checkout <previous_stable_commit>
```

```bash
cd /opt/Expo
APP_DIR=/opt/Expo SERVICE_NAME=expo-app HEALTH_URL=http://127.0.0.1:5000/healthz ./scripts/deploy-app-safe.sh
```

```bash
cd /opt/Expo
APP_DIR=/opt/Expo WEB_ROOT=/var/www/expo/client NGINX_SITE=/etc/nginx/sites-available/expo APP_UPSTREAM=10.96.133.197:5000 HEALTH_URL=http://127.0.0.1/ ./scripts/deploy-web-safe.sh
```

