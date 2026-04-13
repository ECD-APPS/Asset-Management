const client = require('prom-client');

let register;
let httpDuration;
let initialized = false;

const normalizePath = (req) => {
  let p = String(req.originalUrl || req.url || '').split('?')[0];
  p = p.replace(/[a-f0-9]{24}/gi, ':id');
  if (p.length > 120) p = `${p.slice(0, 120)}…`;
  return p || '/';
};

const init = () => {
  if (initialized) return;
  register = new client.Registry();
  client.collectDefaultMetrics({ register });
  httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests handled by this process',
    labelNames: ['method', 'path', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 120]
  });
  register.registerMetric(httpDuration);
  initialized = true;
};

const metricsMiddleware = (req, res, next) => {
  init();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    try {
      const delta = Number(process.hrtime.bigint() - start) / 1e9;
      const pathLabel = normalizePath(req);
      httpDuration.observe(
        { method: req.method, path: pathLabel, status_code: String(res.statusCode) },
        delta
      );
    } catch {
      /* avoid throwing from metrics */
    }
  });
  next();
};

const tokenAuthorized = (req) => {
  const expected = String(process.env.METRICS_SCRAPE_TOKEN || '').trim();
  if (!expected) return true;
  const auth = String(req.get('authorization') || '');
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const header = String(req.get('x-metrics-token') || '').trim();
  const q = String(req.query?.token || '').trim();
  const presented = bearer || header || q;
  return presented === expected;
};

const handleMetrics = async (req, res) => {
  if (!tokenAuthorized(req)) {
    res.status(401).set('WWW-Authenticate', 'Bearer').send('Unauthorized');
    return;
  }
  init();
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (e) {
    res.status(500).send(String(e?.message || 'metrics failed'));
  }
};

module.exports = {
  metricsMiddleware,
  handleMetrics
};
