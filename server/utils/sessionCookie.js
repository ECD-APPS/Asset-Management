/**
 * Single source of truth for `sid` cookie attributes so set/clear/renew stay aligned.
 * Mismatched clearCookie options often leave stale cookies (wrong user after re-login + refresh).
 */

const cookieSecureMode = String(process.env.COOKIE_SECURE || 'auto').toLowerCase();

const shouldUseSecureCookie = (req) => {
  if (cookieSecureMode === 'true' || cookieSecureMode === '1') return true;
  if (cookieSecureMode === 'false' || cookieSecureMode === '0') return false;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return Boolean(req.secure || forwardedProto === 'https');
};

const resolveSameSite = () => {
  const raw = String(process.env.COOKIE_SAMESITE || 'lax').trim().toLowerCase();
  if (raw === 'none') return 'none';
  if (raw === 'strict') return 'strict';
  return 'lax';
};

/** Options for res.cookie('sid', …) */
const sidSetOptions = (req, maxAgeMs) => {
  const o = {
    httpOnly: true,
    secure: shouldUseSecureCookie(req),
    sameSite: resolveSameSite(),
    path: '/'
  };
  if (maxAgeMs != null && Number.isFinite(maxAgeMs)) o.maxAge = maxAgeMs;
  return o;
};

/** Options for res.clearCookie('sid', …) — must match set attributes */
const sidClearOptions = (req) => ({
  path: '/',
  httpOnly: true,
  secure: shouldUseSecureCookie(req),
  sameSite: resolveSameSite()
});

module.exports = {
  shouldUseSecureCookie,
  resolveSameSite,
  sidSetOptions,
  sidClearOptions
};
