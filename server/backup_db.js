const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const { isPbmConfigured, runPbmBackup } = require('./utils/pbmClient');

dotenv.config({ path: path.join(__dirname, '.env') });

async function backupDatabase() {
  const mongoUri = String(process.env.MONGO_URI || process.env.LOCAL_FALLBACK_MONGO_URI || 'mongodb://127.0.0.1:27017/expo').trim();

  if (!isPbmConfigured()) {
    throw new Error('PBM_MONGODB_URI is not set; automatic backups require Percona Backup for MongoDB.');
  }

  const shouldConnect = mongoose.connection.readyState !== 1;
  if (shouldConnect) await mongoose.connect(mongoUri);
  try {
    const { name } = await runPbmBackup({ backupType: 'Full' });
    return name;
  } finally {
    if (shouldConnect) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  backupDatabase()
    .then((snapshotName) => {
      console.log(`PBM backup completed. Snapshot: ${snapshotName}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Backup failed:', error);
      process.exit(1);
    });
}

module.exports = { backupDatabase };
