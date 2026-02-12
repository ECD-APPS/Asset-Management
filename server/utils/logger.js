const fs = require('fs');
const path = require('path');
const { createLogger, format, transports } = require('winston');

const logPath = process.env.AUDIT_LOG_PATH || path.join(__dirname, '..', 'logs', 'app-audit.log');
const logDir = path.dirname(logPath);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.File({ filename: logPath })
  ]
});

module.exports = logger;
