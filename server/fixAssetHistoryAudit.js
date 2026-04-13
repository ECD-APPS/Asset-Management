const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const Asset = require('./models/Asset');

dotenv.config({ path: path.join(__dirname, '.env') });
if (!process.env.MONGO_URI) {
  dotenv.config({ path: path.join(__dirname, '../.env') });
}

const shouldApply = process.argv.includes('--apply');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 0;
const mongoUriArg = process.argv.find((arg) => arg.startsWith('--mongo-uri='));
const mongoUriFromArg = mongoUriArg ? String(mongoUriArg.split('=').slice(1).join('=') || '').trim() : '';

const normalize = (value) => String(value || '').trim();

function buildFixedHistory(asset) {
  const source = Array.isArray(asset.history) ? asset.history : [];
  return source.map((event, index) => {
    const current = event && typeof event.toObject === 'function' ? event.toObject() : { ...(event || {}) };
    const prev = index > 0
      ? (source[index - 1] && typeof source[index - 1].toObject === 'function'
        ? source[index - 1].toObject()
        : source[index - 1])
      : null;

    const derivedPreviousStatus = normalize(prev?.status || (index === 0 ? asset.previous_status : ''));
    const derivedPreviousCondition = normalize(prev?.condition || '');

    return {
      ...current,
      previous_status: derivedPreviousStatus,
      previous_condition: derivedPreviousCondition
    };
  });
}

function countHistoryDiff(before = [], after = []) {
  let diffs = 0;
  for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
    const b = before[i] || {};
    const a = after[i] || {};
    if (normalize(b.previous_status) !== normalize(a.previous_status)) diffs += 1;
    if (normalize(b.previous_condition) !== normalize(a.previous_condition)) diffs += 1;
  }
  return diffs;
}

async function run() {
  const mongoUri = mongoUriFromArg || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing. Set env or pass --mongo-uri=...');
  }

  await mongoose.connect(mongoUri);
  console.log(`MongoDB connected. Mode: ${shouldApply ? 'APPLY' : 'DRY-RUN'}`);

  const query = { 'history.0': { $exists: true } };
  const cursor = Asset.find(query)
    .select('_id serial_number previous_status history')
    .cursor();

  let scanned = 0;
  let affectedAssets = 0;
  let affectedEvents = 0;

  for await (const asset of cursor) {
    scanned += 1;
    if (limit > 0 && scanned > limit) break;

    const before = Array.isArray(asset.history) ? asset.history.map((h) => (h.toObject ? h.toObject() : h)) : [];
    const after = buildFixedHistory(asset);
    const diffCount = countHistoryDiff(before, after);
    if (diffCount === 0) continue;

    affectedAssets += 1;
    affectedEvents += diffCount;

    if (shouldApply) {
      asset.history = after;
      await asset.save();
    }
  }

  console.log(`Scanned assets: ${scanned}`);
  console.log(`Assets needing fixes: ${affectedAssets}`);
  console.log(`History field corrections: ${affectedEvents}`);
  console.log(shouldApply ? 'Backfill completed.' : 'Dry-run completed. Re-run with --apply to persist changes.');
}

run()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Backfill failed:', error.message);
    try {
      await mongoose.disconnect();
    } catch {
      /* ignore disconnect errors after failure */
    }
    process.exit(1);
  });
