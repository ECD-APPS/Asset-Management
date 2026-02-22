# Expo Stores - Ubuntu Deployment Guide

This guide will help you deploy the Expo Stores application on your local Ubuntu machine.

## Prerequisites

Ensure you have the following installed on your Ubuntu machine:
1.  **Node.js** (v18 or higher recommended)
2.  **Git**
3.  **MongoDB** (Ensure it is running)

## Step 1: Clone the Repository

Open your terminal and clone the repository (replace with your actual repo URL):

```bash
git clone https://github.com/tariq50243052-tech/Expo-Store.git
cd Expo-Store
```

## Step 2: Configure Environment Variables

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
    *   **PORT**: Default is 5000.

4.  Go back to the root directory:
    ```bash
    cd ..
    ```

## Step 3: Run the Deployment Script

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

## Step 4: Start the Application

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
