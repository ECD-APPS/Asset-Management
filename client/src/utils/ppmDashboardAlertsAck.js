const READ_FP_KEY = (userId, storeId) => {
  const u = String(userId || 'anon').trim() || 'anon';
  const s = String(storeId != null ? storeId : 'no-store').trim() || 'no-store';
  return `ppm_notif_read_fps_v1_${u}_${s}`;
};

const MAX_STORED_READ_FP = 4000;

function bumpPpmAckListeners() {
  window.dispatchEvent(
    new CustomEvent('ppm-dash-alerts-ack', {
      detail: { userId: '', storeId: '' }
    })
  );
}

/** Stable id for one notification row (task + last update time). */
export function ppmNotificationFingerprint(alert) {
  const id = String(alert?.task_id ?? alert?.taskId ?? '');
  const u = String(alert?.updated_at ?? alert?.updatedAt ?? alert?.created_at ?? alert?.createdAt ?? '');
  return id ? `${id}:${u}` : '';
}

export function getPpmNotificationReadFpSet(userId, storeId) {
  try {
    const raw = localStorage.getItem(READ_FP_KEY(userId, storeId));
    const arr = JSON.parse(raw || '[]');
    return new Set(Array.isArray(arr) ? arr.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function persistReadFpSet(set, userId, storeId) {
  const arr = [...set];
  const trimmed = arr.length > MAX_STORED_READ_FP ? arr.slice(-MAX_STORED_READ_FP) : arr;
  localStorage.setItem(READ_FP_KEY(userId, storeId), JSON.stringify(trimmed));
  bumpPpmAckListeners();
}

export function markPpmNotificationFpRead(fp, userId, storeId) {
  const f = String(fp || '').trim();
  if (!f) return;
  const set = getPpmNotificationReadFpSet(userId, storeId);
  set.add(f);
  persistReadFpSet(set, userId, storeId);
}

export function markPpmNotificationFpsRead(fps, userId, storeId) {
  const list = Array.isArray(fps) ? fps.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (list.length === 0) return;
  const set = getPpmNotificationReadFpSet(userId, storeId);
  list.forEach((fp) => set.add(fp));
  persistReadFpSet(set, userId, storeId);
}

/** Mark every listed alert as read (used by sidebar ack + batch actions). */
export function markAllPpmNotificationsRead(alerts, userId, storeId) {
  const fps = (Array.isArray(alerts) ? alerts : [])
    .map((a) => ppmNotificationFingerprint(a))
    .filter(Boolean);
  markPpmNotificationFpsRead(fps, userId, storeId);
}

export function isPpmNotificationUnread(alert, userId, storeId) {
  const fp = ppmNotificationFingerprint(alert);
  if (!fp) return false;
  return !getPpmNotificationReadFpSet(userId, storeId).has(fp);
}

export function countUnreadPpmAlerts(alerts, userId, storeId) {
  return (Array.isArray(alerts) ? alerts : []).filter((a) => isPpmNotificationUnread(a, userId, storeId)).length;
}

/** Same visibility rules as GET /api/ppm/dashboard-alerts (for badge + row emphasis). */
export function isPpmWorkflowAlertActiveForUser(user, alert) {
  const r = String(user?.role || '');
  const s = String(alert?.status || '');
  const mgrLike = r.toLowerCase().includes('manager');
  if (mgrLike) return s === 'Pending' || s === 'Modified';
  if (r === 'Admin' || r === 'Super Admin') return s === 'Approved' || s === 'Rejected' || s === 'Modified';
  if (r === 'Technician' || r === 'Viewer') return s === 'Approved';
  return false;
}

/**
 * @param {number} [ackRevision] — Bump when client acks (e.g. localStorage) so callers can
 *   re-run the memo without the alerts array reference changing; not read for logic.
 */
export function countUnreadActivePpmAlerts(alerts, user, userId, storeId, ackRevision = 0) {
  void ackRevision;
  return (Array.isArray(alerts) ? alerts : []).filter(
    (a) => isPpmWorkflowAlertActiveForUser(user, a) && isPpmNotificationUnread(a, userId, storeId)
  ).length;
}

/**
 * @deprecated Use markAllPpmNotificationsRead — kept for call-site compatibility.
 */
export function acknowledgePpmDashboardAlerts(alerts, userId, storeId) {
  markAllPpmNotificationsRead(alerts, userId, storeId);
}

/** @deprecated Prefer countUnreadPpmAlerts / countUnreadActivePpmAlerts */
export function isPpmDashboardAlertsAckCurrent(alerts, userId, storeId) {
  if (!Array.isArray(alerts) || alerts.length === 0) return true;
  return countUnreadPpmAlerts(alerts, userId, storeId) === 0;
}
