const PREFIX = 'assign_asset_modal_prefs_v1';

export function buildAssignModalPrefsKey(user) {
  return `${PREFIX}:${String(user?._id || user?.id || user?.email || 'anon')}`;
}

export function readAssignModalPrefsForKey(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

export function persistAssignModalPrefsPatch(key, patch) {
  try {
    const cur = readAssignModalPrefsForKey(key);
    localStorage.setItem(key, JSON.stringify({ ...cur, ...patch }));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Merge saved CC + gate-pass toggles into a fresh assign form base. */
export function mergeAssignModalSavedTogglesWithKey(key, base) {
  const p = readAssignModalPrefsForKey(key);
  const needGp = p.needGatePass === true;
  return {
    ...base,
    notifyManager: p.notifyManager === true,
    notifyViewer: p.notifyViewer === true,
    notifyAdmin: p.notifyAdmin === true,
    needGatePass: needGp,
    sendGatePassEmail: needGp && p.sendGatePassEmail === true
  };
}
