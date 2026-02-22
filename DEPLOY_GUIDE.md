# Linux (Ubuntu) Deployment Guide

This guide helps you deploy the Expo Asset application on Ubuntu (22.04+). It includes a recommended Docker Compose setup and a manual Node.js + PM2 alternative.

## Prerequisites

- Ubuntu server with sudo access
- A domain name (for HTTPS, recommended)
- Git installed

---

## Option A — Docker Compose (Recommended)

### 1) Install Docker Engine + Compose plugin
```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
```

### 2) Clone the repository
```bash
git clone https://github.com/tariq50243052-tech/Expo-Asset.git
cd Expo-Asset
```

### 3) Configure environment (production)
- Edit docker-compose.yml (service: web → environment) as needed:
  - COOKIE_SECRET: set to a secure random string
  - Optional SMTP_* variables if you plan to use email features
- Defaults included:
  - MONGO_URI=mongodb://mongo:27017/expo_stores
  - COOKIE_SECURE=true
  - ENABLE_CSRF=true

Example addition:
```yaml
services:
  web:
    environment:
      - COOKIE_SECRET=<generate_a_random_32_bytes_value>
```

### 4) Build and start
```bash
docker compose build
docker compose up -d
```

Check status and logs:
```bash
docker compose ps
docker compose logs -f web
```

The app serves on http://<server-ip>:5000 by default.

### 5) Enable HTTPS with Nginx (for Secure cookies)
When COOKIE_SECURE=true and CSRF is enabled, run behind HTTPS. A template is provided:

```bash
sudo apt install -y nginx
sudo cp scripts/deploy/nginx-expo-asset.conf /etc/nginx/sites-available/expo-asset.conf
sudo nano /etc/nginx/sites-available/expo-asset.conf   # set your domain and cert paths
sudo ln -s /etc/nginx/sites-available/expo-asset.conf /etc/nginx/sites-enabled/expo-asset.conf
sudo nginx -t
sudo systemctl restart nginx
```

Issue certificates with Certbot (optional):
```bash
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx -d your-domain.example.com
```

Notes:
- Express is configured with trust proxy so Secure cookies work behind Nginx.
- Ensure Nginx proxies to 127.0.0.1:5000 and sets X-Forwarded-Proto.

---

## Option B — Node.js + PM2 (Manual)

### 1) Install Node.js 18+
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

### 2) Clone the repository

Open your terminal and clone the repository (replace with your actual repo URL):

```bash
git clone https://github.com/tariq50243052-tech/Expo-Asset.git
cd Expo-Asset
```

### 3) Configure Environment Variables

1.  Navigate to the `server` directory:
    ```bash
    cd server
    ```
2.  Create a `.env` file based on the example:
    ```bash
    cp .env.example .env
    ```
3.  Open `.env` and verify the settings:
    ```bash
    nano .env
    ```
    *   **MONGO_URI**: 
        *   **No Password (Default):** `mongodb://127.0.0.1:27017/expo_stores`
        *   **With Password:** `mongodb://username:password@127.0.0.1:27017/expo_stores?authSource=admin`
    *   **JWT_SECRET**: Change this to a secure random string.
    *   **COOKIE_SECRET**: Set to a secure random string (required for production).
    *   **COOKIE_SECURE**: Set `true` if serving over HTTPS via Nginx.
    *   **PORT**: Default is 5000.

4.  Go back to the root directory:
    ```bash
    cd ..
    ```

### 4) Run the Deployment Script

We have provided a script to automate the installation and build process.

1.  Make the script executable:
    ```bash
    chmod +x deploy.sh
    ```
2.  Run the script:
    ```bash
    ./deploy.sh
    ```

This script will:
*   Install server dependencies.
*   Install client dependencies.
*   Build the React client into static files (`client/dist`).

### 5) Start the Application

### Option A: Run manually (for testing)
```bash
cd server
npm start
```
Access the app at `http://localhost:5000`.

### Option B: Run with PM2 (Recommended for Production)
PM2 keeps your application running in the background.

1.  Install PM2 globally:
    ```bash
    sudo npm install -g pm2
    ```
2.  Start the server:
    ```bash
    cd server
    pm2 start server.js --name expo-stores
    ```
3.  (Optional) Set PM2 to start on boot:
    ```bash
    pm2 startup
    pm2 save
    ```

## Troubleshooting

*   **MongoDB Connection Error**: Ensure MongoDB is running (`sudo systemctl status mongod`).
*   **Port In Use**: If port 5000 is taken, change `PORT` in `server/.env`.

---

## Reverse Proxy with Nginx (HTTPS + Secure Cookies)

When running in production with `COOKIE_SECURE=true` and CSRF enabled, serve the app over HTTPS. Below is a minimal Nginx config that forwards HTTPS traffic to the Node app on `127.0.0.1:5000` and sets the `X-Forwarded-Proto` header so Express recognizes TLS.

1. Install Nginx and Certbot (Ubuntu):
   ```bash
   sudo apt update
   sudo apt install -y nginx
   sudo snap install --classic certbot
   sudo ln -s /snap/bin/certbot /usr/bin/certbot
   ```

2. Copy the template and edit domain paths:
   ```bash
   sudo mkdir -p /etc/nginx/sites-available
   sudo cp scripts/deploy/nginx-expo-asset.conf /etc/nginx/sites-available/expo-asset.conf
   sudo nano /etc/nginx/sites-available/expo-asset.conf
   ```
   Replace `your-domain.example.com` with your domain and cert paths.

3. Enable the site and test:
   ```bash
   sudo ln -s /etc/nginx/sites-available/expo-asset.conf /etc/nginx/sites-enabled/expo-asset.conf
   sudo nginx -t
   sudo systemctl restart nginx
   ```

4. Obtain certificates (optional if you already have them):
   ```bash
   sudo certbot --nginx -d your-domain.example.com
   ```

Notes:
- Express is already configured with `app.set('trust proxy', 1)` so Secure cookies work behind Nginx.
- Ensure Docker publishes the app on `127.0.0.1:5000` or adjust the upstream in the file accordingly.

---

## Local 3-Tier Setup (Frontend, API, Database)

This sets up three separate local processes on Linux for development:
- Frontend (Vite React) on port 5173
- API (Express/Node) on port 5000
- MongoDB on port 27017

### 1) Install Prerequisites
```bash
sudo apt update
sudo apt install -y git curl build-essential
```

MongoDB (choose one):
- Option A: Host service (simple for dev)
  ```bash
  sudo apt install -y mongodb || true
  sudo systemctl enable --now mongodb || true
  ```
- Option B: Docker container (isolation, recommended if you have Docker)
  ```bash
  docker run -d --name expo-mongo \
    -p 27017:27017 \
    -v expo_mongo_data:/data/db \
    mongo:6 --bind_ip_all
  ```

Node.js 18+:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

### 2) Clone the Repository
```bash
git clone https://github.com/tariq50243052-tech/Expo-Asset.git
cd Expo-Asset
```

### 3) Configure the API (Tier 2)
Create and edit `server/.env`:
```bash
cp server/.env.example server/.env
nano server/.env
```
Suggested dev values:
```
MONGO_URI=mongodb://127.0.0.1:27017/expo-stores
PORT=5000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
COOKIE_SECRET=$(openssl rand -hex 32)   # replace with a generated value
COOKIE_SECURE=false
# Dev default for CSRF is disabled; to force enable, set:
# ENABLE_CSRF=true
```

Install and run the API:
```bash
cd server
npm install
npm run dev
```
The API will listen on http://localhost:5000.

### 4) Run the Frontend (Tier 1)
In a second terminal:
```bash
cd client
npm install
# If your API is on another host/IP, set VITE_API_HOST before starting:
# VITE_API_HOST=127.0.0.1 npm run dev
npm run dev
```
The frontend will run on http://localhost:5173 and proxy API calls to http://localhost:5000.

### 5) Verification
- API health: `curl http://localhost:5000/healthz` → should show backend/db readiness
- API version: `curl http://localhost:5000/version`
- Browser: open http://localhost:5173 and sign in
- System status badge: should turn green when API and DB are healthy

### 6) LAN Variant (Optional)
Running tiers on different machines in a local network:
- On the API server: set `CORS_ORIGIN=http://<client-host>:5173` in `server/.env`
- On the client machine: start Vite with the API host
  ```bash
  VITE_API_HOST=<api-host-or-ip> npm run dev
  ```
Ensure firewalls allow 5173 (client) and 5000 (API) across machines, and that MongoDB is reachable from the API host (if using a separate DB host).
