# Expo Stores (SCY Asset) — Application Guide

End-to-end description of the web application: authentication, roles, navigation, major workflows, and how the client and server fit together. For deployment and infrastructure, see **`README.md`**, **`README_LOCAL.md`**, **`DEPLOY.md`**, **`DEPLOY_CHECKLIST.md`**, and **`OFFLINE_AIRGAP_DEPLOYMENT.md`**. For database backup operations, see **`HOW_TO_BACKUP_DATABASE.md`**.

**Version:** The shipped UI version is driven by `package.json` (root, `client/`, `server/` should align). The Portal footer reads **`client/package.json`** via `client/src/appMeta.js`.

---

## Table of contents

1. [Architecture](#1-architecture)
2. [Authentication and session](#2-authentication-and-session)
3. [Roles and access rules](#3-roles-and-access-rules)
4. [Store selection and branding](#4-store-selection-and-branding)
5. [Application shell (Layout)](#5-application-shell-layout)
6. [Routes and features by area](#6-routes-and-features-by-area)
7. [Typical business workflows](#7-typical-business-workflows)
8. [Backend API map](#8-backend-api-map)
9. [Security and operations](#9-security-and-operations)
10. [Related documentation](#10-related-documentation)

---

## 1. Architecture

| Layer | Technology | Notes |
|-------|------------|--------|
| **Client** | React 18, Vite, React Router, Tailwind-style utilities | Lazy-loaded routes except Dashboard and PPM panels (stability on refresh). |
| **Server** | Node.js, Express, Mongoose (MongoDB) | REST API under `/api` (exact mount depends on reverse proxy; dev client proxies `/api` to the API port). |
| **Auth** | HTTP-only cookies + CSRF | Not JWT-in-header for normal browser use. |
| **Assets / files** | `server/uploads/` (including `uploads/branding/` for logos) | Static serving rules in `server/server.js`; branding subtree exposed for login and gate-pass flows. |

---

## 2. Authentication and session

### 2.1 Public routes (no login)

| Path | Purpose |
|------|---------|
| `/login` | Email and password. Client primes **`GET /api/auth/csrf-token`**, then logs in via the auth API. |
| `/forgot-password` | Starts password reset (email / token flow). |
| `/reset-password` | Completes reset using the link/token from email. |

### 2.2 Session bootstrap

On load, **`AuthProvider`** (`client/src/context/AuthContext.jsx`):

1. Calls **`/api/auth/csrf-token`** to stabilize cookies before auth.
2. Clears stale in-memory user, then calls **`/api/auth/me`**.
3. If valid: sets **`user`**, persists a copy in **`localStorage`** (`user`), restores **`activeStore`** from `localStorage` where applicable.
4. Fetches **public branding** from **`/api/system/public-config`** (logo, theme) and applies **`data-theme`** on `<html>` and favicon.

### 2.3 Logout

Logout clears the session cookie and client state, then navigates to **`/login`**.

### 2.4 Canonical default accounts (keep — do not delete from seeds)

These users are **created or normalized on every server bootstrap** by **`server/utils/seedStoresAndUsers.js`**. They are the **standard** logins for local development, demos, and smoke tests. **Do not remove them or drop them from the seeder** without an explicit product / security decision and documentation updates in the same change.

| Email | Role / context | Default password (when env does not override) |
|-------|----------------|--------------------------------------------------|
| **`superadmin@expo.com`** | Super Admin (no assigned store) | **`superadmin123`**, unless **`DEFAULT_SUPERADMIN_PASSWORD`** is set in **`server/.env`** (recommended for any shared host: set a strong value there — **never commit** that file with real secrets). |
| **`scy@expo.com`** | Admin → **SCY ASSET** store | **`admin123`** |
| **`it@expo.com`** | Admin → **IT ASSET** store | **`admin123`** |
| **`noc@expo.com`** | Admin → **NOC ASSET** store | **`admin123`** |

**Password sync on restart**

- By default, **`ENFORCE_DEFAULT_ACCOUNTS`** is treated as **on** so the known default hashes are **re-applied** on startup (safe for disposable dev DBs; predictable for QA).
- Set **`ENFORCE_DEFAULT_ACCOUNTS=false`** in the **server** environment when you want **custom passwords** for these same emails to **persist** across restarts (after users change passwords in the app).
- Super Admin’s plain text default is resolved in code via **`DEFAULT_SUPERADMIN_PASSWORD`** first, then falls back to **`superadmin123`** — see **`server/utils/seedStoresAndUsers.js`** (`resolveSuperAdminPlainPassword`).

**Security (production)**

- Treat the table above as **default / lab only**. For production, use **strong unique passwords**, **`ENFORCE_DEFAULT_ACCOUNTS=false`** once accounts are hardened, and restrict network access to the admin UI.
- **Never** commit **`server/.env`** with production passwords. Use **`server/.env.example`** only as a template.

**Single source of truth in code:** `server/utils/seedStoresAndUsers.js` (and Cursor rule **`.cursor/rules/expo-default-accounts.mdc`** for AI assistants).

---

## 3. Roles and access rules

Primary roles used in routing and the sidebar:

| Role | Typical use |
|------|-------------|
| **Super Admin** | Global portal, system health, all-store operations; when impersonating or selecting a store, treated like Admin for most operational routes. |
| **Admin** | Day-to-day store management: assets, setup, procurement, passes, technicians, etc. |
| **Viewer** | Read-oriented access to assets, stores, products, etc.; may use **Portal** where configured. |
| **Technician** | Scanner, assigned assets, tool panel, requests, PPM execution. |
| **Manager** | PPM manager section and broader Admin-like nav where `ProtectedRoute` / sidebar allows. |

**`ProtectedRoute`** (`client/src/App.jsx`):

- Unauthenticated users are redirected to **`/login`** (with `state.from` for return navigation).
- **`Super Admin`** is generally allowed wherever **`Admin`** is allowed unless a route is explicitly narrower.
- **Manager** (role name containing “Manager”) is mapped to Admin/Manager-only routes per route definition.
- **Technicians** hitting **`/`** are redirected to **`/scanner`** (`DashboardWrapper`).

---

## 4. Store selection and branding

- Most users have an **assigned store**; **`activeStore`** is kept in context and **`localStorage`**.
- **Super Admin** (and some **Viewer** flows) may need to open **`/portal`** first to choose a workspace when no store is selected.
- Store-optional paths include **`/portal`** and **`/system-health`** (Super Admin) per `App.jsx`.
- **Branding** (logo + theme) is resolved per store when **`storeId`** is passed to **`/api/system/public-config`**.

---

## 5. Application shell (Layout)

Most authenticated pages render inside **`Layout`** (`client/src/components/Layout.jsx`):

- **Sidebar** — navigation, collapse, product-driven asset shortcuts, PPM badge, logout, change password.
- **Header** — system / DB status pills (from **`/api/healthz`**), PPM notification popover (where enabled), profile menu, **maintenance vendor scope** on the **Dashboard** (`/`): **All / vendor** buttons update `?maintenance_vendor=` and sync with dashboard stats (with client-side caching/prefetch for responsiveness).
- **Outlet** — the active page component.

---

## 6. Routes and features by area

Source of truth for paths: **`client/src/App.jsx`**. Navigation labels: **`client/src/components/Sidebar.jsx`**.

### 6.1 Portal (global)

| Path | Who | Features (high level) |
|------|-----|-------------------------|
| **`/portal`** | Super Admin, Viewer (global) | Store overview, deletion requests, **Add Members** entry, **email configuration** (per store), **application / gate pass logos**, **database backup & restore** (local `mongodump` / file restore, artifact list), optional **controlled database reset**, other admin utilities. Version string in footer comes from **`client/package.json`**. |

### 6.2 Platform health

| Path | Who | Features |
|------|-----|----------|
| **`/system-health`** | Super Admin | Live JSON-backed snapshot: application metadata, MongoDB ping, filesystem writability, process/host memory. “Copy JSON” may include fields not shown as cards. |

### 6.3 Dashboard

| Path | Who | Features |
|------|-----|----------|
| **`/`** | Admin, Viewer, Manager | Fleet KPIs, analytics sections (charts, utilization, locations/products, growth, etc.), customizable layout (persisted per user in `localStorage`), **maintenance vendor** filter in header for SCY-style contexts, recent asset rows, low-stock bell where applicable. |
| **`/`** | Technician | Redirect to **`/scanner`**. |

### 6.4 Events

| Path | Who |
|------|-----|
| **`/events/recent-activity`** | Admin, Technician |
| **`/events/system-logs`** | Admin |

### 6.5 Assets and serials

| Path | Who | Features |
|------|-----|----------|
| **`/assets`** | Admin, Viewer | Full **Assets Management**: filters (status, product, location, maintenance vendor, etc.), CRUD, bulk edit, import/export, assign / reserve / faulty flows, optional email CC and gate pass on assign, column configuration, links to asset history. |
| **`/asset/:id`** | Admin, Viewer, Technician | **Asset history** / audit-style timeline for one asset. |
| **`/assets/no-serial`** | Admin, Viewer, Technician | **No-serial** inventory workflows. |

### 6.6 People and locations

| Path | Who |
|------|-----|
| **`/technicians`** | Admin |
| **`/add-members`** | Admin |
| **`/stores`** | Admin, Viewer | Store / location hierarchy (“Locations” in sidebar). |

### 6.7 Gate passes and products

| Path | Who |
|------|-----|
| **`/passes`** | Admin |
| **`/products`** | Admin, Viewer | Read-only catalog in router configuration. |
| **`/setup/products`** | Admin | Product administration inside Setup. |
| **`/products/:productName`** | Admin, Viewer | Product detail view. |

### 6.8 Tools, consumables, spare parts

| Path | Who |
|------|-----|
| **`/tools`** | Admin, Viewer |
| **`/tools/panel`** | Technician, Admin |
| **`/consumables`** | Admin, Viewer |
| **`/spare-parts`** | Admin, Viewer, Technician |

### 6.9 Procurement and lifecycle

| Path | Who |
|------|-----|
| **`/vendors`** | Admin, Viewer |
| **`/purchase-orders`** | Admin, Viewer |
| **`/receive-process`** | Admin |
| **`/disposal-process`** | Admin |
| **`/permits`** | Admin |

### 6.10 Technician workspace

| Path | Who |
|------|-----|
| **`/scanner`** | Technician, Admin |
| **`/my-assets`** | Technician |
| **`/tech-request`** | Technician |

### 6.11 Admin queues

| Path | Who |
|------|-----|
| **`/admin-requests`** | Admin, Viewer |
| **`/admin-tech-assets`** | Admin |

### 6.12 PPM (Preventive Maintenance)

| Path | Who |
|------|-----|
| **`/ppm`** | Admin, Viewer, Technician, Manager |
| **`/ppm/history`** | Same |
| **`/ppm/manager-section`** | Manager |
| **`/ppm/panel`** | Redirects to **`/ppm`** |

Sidebar shows **PPM** submenu and optional **badge**; header can load **PPM notification history**; client-side ack/read state uses **`localStorage`** keys namespaced by user/store (see `client/src/utils/ppmDashboardAlertsAck.js`).

### 6.13 Setup (store admin)

| Path | Who |
|------|-----|
| **`/setup`** | Admin | SMTP and notification recipients, maintenance vendor names (used on dashboard and assets), themes, column defaults, and other per-store configuration (large surface area — explore the page and **`server/routes/system.js`** for APIs). |

---

## 7. Typical business workflows

### 7.1 Onboarding a user

1. **Admin** (or Super Admin via Portal) creates users / assigns stores.  
2. User opens **`/login`**, selects or inherits **store** context.  
3. **Technician** lands on **Scanner**; **Admin** lands on **Dashboard**.

### 7.2 Procure → receive → register assets

1. **Vendors** / **Purchase orders** as needed.  
2. **`/receive-process`** for inbound handling.  
3. **`/assets`** to create or **bulk import** rows; tie to **Products** taxonomy.

### 7.3 Assign asset to technician or external recipient

1. From **`/assets`**, open **Assign**.  
2. Choose **Technician** or **Other**; fill contact and **installation location** (required for technician path).  
3. Optionally tick **Notify manager / viewer / admin** lists (resolved from Portal email config + store admins — see assign CC preview API).  
4. Optionally enable **Gate pass** (ticket, moving from/to, justification; phone rules for external).  
5. Optional **Send gate pass by email**.  
6. **Checkbox preferences** for CC and gate-pass email can persist in the browser (`client/src/utils/assignModalPrefs.js`, key `assign_asset_modal_prefs_v1:<user>`).  
7. Submit → server updates asset assignment and triggers emails / PDFs per configuration.

### 7.4 Faulty asset and spare replacement

From **Assets**, use the **faulty / replacement** flow: pick replacement candidate, optional **In Use** transfer, gate pass and CC similar to assign. **Faulty modal** has its own **`localStorage`** prefs (`faulty_replacement_modal_prefs_v1:...`).

### 7.5 Technician day

**Scanner** → scan / update status → **My assets** → **Tool panel** / **Tech request** → **PPM** tasks as assigned.

### 7.6 Backups (Super Admin)

From **Portal** → **Backups & database**:

- **Local full backup** (`mongodump` archive) → **Download** → copy offline or USB.  
- **Restore** from a trusted `.archive.gz` via file upload (`mongorestore` on server — gated by env flags; see **`HOW_TO_BACKUP_DATABASE.md`**).  
- **Optional database reset** (destructive, password-protected).

Server may still expose **PBM-related** APIs for advanced deployments; the Portal UI focuses on **local file** backup/restore.

### 7.7 Branding

**Portal** or **Setup**: upload **application logo** and **gate pass logo** → stored under **`server/uploads/branding/`** (directory created on demand). Public **`logoUrl`** / theme come from **`/api/system/public-config`**.

---

## 8. Backend API map

Route modules live under **`server/routes/``** and are mounted from **`server/server.js`** (and related entrypoints). All are prefixed with **`/api`** in normal deployment.

| Module | Responsibility (summary) |
|--------|----------------------------|
| **`auth.js`** | Login, logout, session, CSRF, password reset, **`/auth/me`**. |
| **`users.js`** | Users, technicians, roles, invitations. |
| **`stores.js`** | Stores, hierarchy, **`assign-cc-preview`**, maintenance vendor list. |
| **`assets.js`** | Asset CRUD, stats (including dashboard aggregates), assign, reserve, bulk, import/export, history, faulty replacement — largest surface. |
| **`requests.js`** | Technician requests and admin handling. |
| **`passes.js`** | Gate passes. |
| **`permits.js`** | Permits. |
| **`products.js`** | Product tree. |
| **`vendors.js`**, **`purchaseOrders.js`** | Procurement. |
| **`tools.js`**, **`consumables.js`**, **`spareParts.js`** | Tooling and stock. |
| **`ppm.js`** | PPM schedules, work orders, notifications, dashboard alerts. |
| **`noSerialAssets.js`** | No-serial stock. |
| **`assetCategories.js`** | Categories. |
| **`system.js`** | Public config, logos, themes, email config, backups (local dump/restore, artifacts), operations status, seeds, reset, metrics wiring, maintenance vendors, etc. |

For a machine-readable list of mounted routes in a given build, the repo may include helper scripts (e.g. under **`scripts/`**); **`npm run verify:release`** includes sanity checks.

---

## 9. Security and operations

- **Helmet**, **CORS**, **compression**, **express-mongo-sanitize**, **rate limiting** (global and route-specific for heavy operations).  
- **Production** requires explicit **CORS origin**, **cookie secret**, and related env (see **`server/server.js`** validation and **`server/.env.example`**).  
- **Health:** **`/api/healthz`**, **`/api/readyz`** (used by Layout for status pills).  
- **Optional Prometheus metrics** when enabled (`ENABLE_METRICS`, etc.).  
- **Release verification:** **`npm run verify:release`** from repo root.

---

## 10. Related documentation

| Document | Use |
|----------|-----|
| **`README.md`** | IP / VLAN production layout and main deploy entrypoints. |
| **`README_LOCAL.md`** | Single-machine dev. |
| **`README_SERVER_INSTALL.md`** | Server install steps. |
| **`DEPLOY.md`**, **`DEPLOY_CHECKLIST.md`** | Docker / Compose and checklist. |
| **`HOW_TO_BACKUP_DATABASE.md`** | Backup and restore procedures. |
| **`OFFLINE_AIRGAP_DEPLOYMENT.md`** | Air-gapped / offline deployment. |
| **`MASTER_GEMINI_INSTRUCTIONS.md`** / **`MASTER_GEMINI_INSTRUCTIONS_MINIMAL.md`** | Long-form AI / operator runbooks. |
| **`Makefile`** | Common dev and env targets. |

---

*This guide describes the application behaviour as reflected in the repository. When behaviour and docs diverge, trust the code paths referenced above and update this file in the same change.*
