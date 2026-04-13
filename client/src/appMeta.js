import packageJson from '../package.json';

/** Client build version — single source of truth: client/package.json */
export const CLIENT_APP_VERSION = packageJson.version || '0.0.0';
