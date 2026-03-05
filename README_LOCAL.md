# Expo Asset Management - Single Linux Installation Guide

Use this guide when running the full stack on one Linux machine (no k3s).

## Prerequisites

- Ubuntu/Linux machine
- Node.js 18+
- npm
- MongoDB installed locally and running

## 1) Install dependencies

From project root:

```bash
npm install
cd server && npm install
cd ../client && npm install
cd ..
```

## 2) Configure backend environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and set at minimum:

```env
MONGO_URI=mongodb://127.0.0.1:27017/expo-stores
PORT=5000
JWT_SECRET=change_to_random_secret
COOKIE_SECRET=change_to_random_secret
COOKIE_SECURE=false
SEED_DEFAULTS=true
```

## Default login accounts

With `SEED_DEFAULTS=true`, startup ensures these accounts exist with these passwords:

- `superadmin@expo.com` / `superadmin123`
- `scy@expo.com` / `admin123`
- `it@expo.com` / `admin123`
- `noc@expo.com` / `admin123`

## 3) Start MongoDB

If installed as a service:

```bash
sudo systemctl start mongod || sudo systemctl start mongodb
```

## 4) Run backend and frontend

Open terminal 1:

```bash
cd server
npm run dev
```

Open terminal 2:

```bash
cd client
npm run dev -- --host --port 5173
```

## 5) Access application

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5000`

If your backend is configured to another port, use that port.

## Common fixes

- Port already in use:
  - change `PORT` in `server/.env`
  - or stop old process using that port
- Login fails:
  - verify MongoDB is running
  - verify `MONGO_URI` database exists and is reachable
- Frontend not opening:
  - ensure `npm run dev -- --host --port 5173` is running in `client/`
