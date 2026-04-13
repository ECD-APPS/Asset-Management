# How to back up your Expo Stores database (safely)

This application stores data in **MongoDB**. The **Portal → Database maintenance** screen supports:

1. **Simple local file backup (USB)** — one `.archive.gz` on the same machine as the API (`mongodump`), then **Download** in the Portal and copy the file to a USB drive. **No cloud.** Enabled by default in development; in production set `ENABLE_LOCAL_MONGODUMP=true`.
2. **Percona Backup for MongoDB (PBM)** — cluster snapshots and **Restore** in the Portal when PBM agents and storage are configured.

---

## Easiest path: local full backup for a USB drive (no PBM required)

1. **Install MongoDB Database Tools** on the same computer that runs the Node API so `mongodump` is on your `PATH` (or set `MONGODUMP_PATH` in `server/.env` to the full path of the binary).
2. In **`server/.env`**:
   - **`MONGO_URI`** must already point at your local MongoDB (this is normal for a local-only setup).
   - For **production** or `NODE_ENV=production`, add **`ENABLE_LOCAL_MONGODUMP=true`** (local USB exports are off by default in production until you opt in).
3. **Restart the API** after editing `.env`.
4. Open **Portal → Database maintenance** (Super Admin). You should see the green **“Simple local backup (no cloud)”** box.
5. Click **Create local full backup (USB)** and wait until it finishes.
6. In the table, click **Download** on the new row, save the `.archive.gz` file, then **copy it to your USB drive**.

**Restore from USB / file in the Portal:** In **Database maintenance**, under the same green “Simple local backup” card, use **Choose backup file to restore (.archive.gz)**. Pick the file you copied from the USB (or any compatible `mongodump` gzip archive). The server runs **`mongorestore`** into the database from **`MONGO_URI`**. Everyone should **refresh** the browser afterward; **restart the Node process** if anything still looks cached. Optional env **`LOCAL_MONGORESTORE_DROP=true`** adds **`--drop`** to `mongorestore` (more destructive; default is merge mode).

**Restore later (CLI):** on a machine with MongoDB Database Tools, you can use `mongorestore` manually (test on a **copy** first). Example:

`mongorestore --uri="mongodb://127.0.0.1:27017/expo" --gzip --archive=/path/to/your.archive.gz`

(Adjust URI and database name to match your environment.)

---

## Super Admin password you choose (and changing it later)

- **Do not commit real passwords to git.** Put them only in `server/.env` (which should stay untracked).
- To use a **custom initial password** for `superadmin@expo.com` whenever enforcement runs, set:

  `DEFAULT_SUPERADMIN_PASSWORD=your_password_here`

- After you log in and change the password in the **Portal**, set:

  `ENFORCE_DEFAULT_ACCOUNTS=false`

  so the server **stops overwriting** seed-account passwords on every restart. You can change the password anytime from the Portal; it will then persist until you turn enforcement back on.

---

## Why “Create snapshot” fails with `PBM_MONGODB_URI must be set`

The **Node API process** runs the `pbm` CLI and must know how to authenticate to your cluster as the **PBM user**. If `PBM_MONGODB_URI` is missing or empty, the server **refuses** to start a backup. That is intentional: it avoids giving the impression that a backup ran when nothing could be sent to PBM.

**Fix:** set `PBM_MONGODB_URI` where the **API** runs, then restart the API.

| How you run the API | Where to set the variable |
|---------------------|---------------------------|
| Local (`node` / `npm run dev` in `server/`) | `server/.env` |
| Docker Compose | Root `.env` or `.env.docker` (Compose passes `PBM_MONGODB_URI` into the `app` service — see `docker-compose.yml`) |

After changing env vars, **restart the server** so `process.env` picks them up.

---

## Treat data as the priority (practical safety)

1. **Never rely on a single copy.** Keep at least: production data, a local `.archive.gz` or PBM storage, and verify restores on a test copy.
2. **Test a restore on a non-production environment** before you depend on PBM in a crisis.
3. **PBM needs a correctly configured MongoDB side:** replica set (PBM does not support standalone MongoDB for normal backup flows), `pbm-agent` on data-bearing nodes, and **remote storage** (e.g. S3-compatible) registered in PBM. The URI alone is not enough if agents or storage are missing.
4. **Restoring a snapshot overwrites data** on the target cluster. Use maintenance windows, confirmations in the Portal, and separate staging clusters when validating.

Official PBM setup: [Percona Backup for MongoDB — initial setup](https://docs.percona.com/percona-backup-mongodb/install/initial-setup.html).

---

## Step A — Configure PBM (cluster + storage + user)

Work with your DBA or follow Percona’s guide. In short:

1. MongoDB runs as a **replica set** (required for PBM in normal deployments).
2. Install and run **`pbm-agent`** on MongoDB nodes; configure **remote backup storage** in PBM.
3. Create a **PBM user** in MongoDB (with the roles Percona documents) and build a MongoDB URI for that user, for example:

   `mongodb://pbmUser:STRONG_PASSWORD@mongo-host:27017/?authSource=admin&replicaSet=YOUR_RS_NAME`

4. On the **same machine or container** that runs this Node API, install the **`pbm` CLI** (the repo’s `Dockerfile.app` installs it in the app image; for bare metal, install Percona’s `percona-backup-mongodb` package).

---

## Step B — Point the Expo API at PBM (`PBM_MONGODB_URI`)

### Local development

1. Edit `server/.env` (copy from `server/.env.example` if needed).
2. Add (example — replace with your real user, password, host, and replica set name):

   ```bash
   PBM_MONGODB_URI=mongodb://pbmUser:STRONG_PASSWORD@127.0.0.1:27017/?authSource=admin&replicaSet=rs0
   ```

3. Restart the API (`npm run dev` or your process manager).
4. In the Portal, open **Database maintenance** and use **Refresh list**; the amber “PBM is not configured” banner should disappear once the server sees the variable.

### Docker Compose

1. In the env file you use with Compose (often `.env` next to `docker-compose.yml`), set:

   ```bash
   PBM_MONGODB_URI=mongodb://pbmUser:STRONG_PASSWORD@mongo:27017/?authSource=admin&replicaSet=rs0
   ```

   Hostname `mongo` matches the service name in `docker-compose.yml` when the API container talks to MongoDB.

2. `docker compose up -d` (or recreate the `app` container) so the variable is injected.

**Note:** The sample `docker-compose.yml` in this repo uses a **single-node** `mongo:7` service. PBM typically expects a **replica set**. For serious backups you should run MongoDB as a replica set (even a one-node RS for lab) and complete Percona’s setup. Do not assume the default Compose file alone is production-ready for PBM.

---

## Step C — Create a snapshot from the Portal

1. Log in as **Super Admin**.
2. **Portal → Database maintenance** (or your navigation to the same modal).
3. Confirm there is **no** “PBM is not configured” warning.
4. Click **Create full snapshot** and wait; large databases can take a long time (timeouts are extended for this call).

Snapshots are stored in **PBM’s remote storage**, not as a file download in the browser. The Portal records metadata so you can **restore** from a named snapshot when needed.

---

## Optional: manual `mongodump` from the shell

The Portal button above runs the same idea as:

```bash
mongodump --uri="$MONGO_URI" --gzip --archive=/path/to/expo.archive.gz
```

You can still run commands yourself for automation; practice **`mongorestore`** on a test instance before relying on any backup.

---

## Useful environment variables (API)

| Variable | Purpose |
|----------|---------|
| `PBM_MONGODB_URI` | **Required** for Portal/API backups and restores. |
| `PBM_BACKUP_WAIT_TIME` | How long `pbm backup --wait` may wait (default `4h`). |
| `PBM_CLI_PATH` | Path to `pbm` binary if not on `PATH`. |
| `PBM_SKIP_READINESS_CHECK` | Set to `true` only in emergencies; skips `pbm status` before ops. |
| `PBM_MIN_FREE_DISK_MB` | Minimum free space for local PBM marker files (default `50`). |
| `PBM_DESCRIBE_WAIT_MS` | Max wait for `describe-backup` after backup (default `120000`). |
| `ENABLE_LOCAL_MONGODUMP` | `true` / `false` — USB-style local exports (default on in dev, off in prod unless `true`). |
| `MONGODUMP_PATH` | Optional full path to `mongodump` if not on `PATH`. |
| `LOCAL_MONGODUMP_TIMEOUT_MS` | Max runtime for one export (default 2h, max 4h). |
| `DEFAULT_SUPERADMIN_PASSWORD` | Optional; used for `superadmin@expo.com` when `ENFORCE_DEFAULT_ACCOUNTS` re-hashes. |
| `ENFORCE_DEFAULT_ACCOUNTS` | `false` to keep Portal-changed passwords across restarts. |

See `server/.env.example` and `.env.docker.example`.

---

## Quick verification (operator)

From the **same environment** as the API (host or `app` container):

```bash
PBM_MONGODB_URI='mongodb://...your uri...' pbm status
```

If this fails, fix connectivity, user, or replica set **before** relying on the Portal for backups.

---

## Summary

| Symptom | Most likely cause |
|---------|-------------------|
| Alert: `PBM_MONGODB_URI must be set` | Variable not set for the API process, or server not restarted after setting it. |
| PBM errors after URI is set | MongoDB not a replica set, agents not running, or remote storage not configured in PBM. |
| Need a file copy today | Use **Create local full backup (USB)** in the Portal, or run `mongodump` manually; test restore separately. |

Your data is safest when **PBM is fully configured**, **`PBM_MONGODB_URI` is set on the API**, and you **regularly verify** backups (and restore drills) outside production.
