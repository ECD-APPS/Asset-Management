const nodemailer = require('nodemailer');
const Store = require('../models/Store');
const EmailLog = require('../models/EmailLog');
const User = require('../models/User');

const resolveStoreId = (storeRef) => {
  if (!storeRef) return null;
  if (typeof storeRef === 'string') return storeRef;
  if (storeRef._id) return String(storeRef._id);
  return String(storeRef);
};

const getStoreEmailConfig = async (storeId) => {
  const id = resolveStoreId(storeId);
  if (!id) return null;
  const store = await Store.findById(id).lean();
  if (!store?.emailConfig?.enabled) return null;
  const cfg = store.emailConfig;
  if (!cfg.smtpHost || !cfg.smtpPort || !cfg.username || !cfg.password) return null;
  return {
    smtpHost: cfg.smtpHost,
    smtpPort: Number(cfg.smtpPort),
    username: cfg.username,
    password: cfg.password,
    encryption: cfg.encryption || 'TLS',
    fromEmail: cfg.fromEmail || cfg.username,
    fromName: cfg.fromName || store.name || 'Expo Asset',
    storeName: store.name || 'Store'
  };
};

const getStoreNotificationRecipients = async (storeId) => {
  const id = resolveStoreId(storeId);
  if (!id) return [];
  const store = await Store.findById(id).select('emailConfig.notificationRecipients emailConfig.lineManagerRecipients').lean();
  const recipients = Array.isArray(store?.emailConfig?.notificationRecipients)
    ? store.emailConfig.notificationRecipients
    : [];
  const lineManagers = Array.isArray(store?.emailConfig?.lineManagerRecipients)
    ? store.emailConfig.lineManagerRecipients
    : [];
  return Array.from(new Set([...recipients, ...lineManagers]
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean)));
};

const getFallbackConfig = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const username = process.env.SMTP_EMAIL;
  const password = process.env.SMTP_PASSWORD;
  if (!host || !username || !password) return null;
  return {
    smtpHost: host,
    smtpPort: port,
    username,
    password,
    encryption: process.env.SMTP_PORT === '465' ? 'SSL' : 'TLS',
    fromEmail: process.env.SMTP_EMAIL,
    fromName: process.env.FROM_NAME || 'Expo Stores',
    storeName: 'Global'
  };
};

const buildTransport = (cfg) => {
  const secure = String(cfg.encryption || '').toUpperCase() === 'SSL' || Number(cfg.smtpPort) === 465;
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: Number(cfg.smtpPort),
    secure,
    auth: {
      user: cfg.username,
      pass: cfg.password
    }
  });
};

const parseRecipients = (to) => Array.from(
  new Set(
    String(to || '')
      .split(',')
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean)
  )
);

const filterRecipientsByNotificationPreference = async (recipients = []) => {
  if (!Array.isArray(recipients) || recipients.length === 0) return [];
  const users = await User.find({ email: { $in: recipients } })
    .select('email notificationPreferences.enabled')
    .lean();
  const byEmail = new Map(users.map((u) => [String(u.email || '').toLowerCase(), u]));
  return recipients.filter((email) => {
    const user = byEmail.get(String(email || '').toLowerCase());
    // If the recipient is not a platform account, keep existing behavior.
    if (!user) return true;
    const enabled = user.notificationPreferences?.enabled;
    return enabled !== false;
  });
};

const sendStoreEmail = async ({ storeId, to, subject, text, html, forceConfig, context = '' }) => {
  const cfg = forceConfig || (await getStoreEmailConfig(storeId)) || getFallbackConfig();
  if (!cfg) {
    await EmailLog.create({
      store: resolveStoreId(storeId),
      to,
      subject,
      status: 'skipped',
      reason: 'SMTP not configured for store or global fallback',
      context
    });
    return { skipped: true, reason: 'SMTP not configured for store or global fallback' };
  }
  const parsedRecipients = parseRecipients(to);
  const filteredRecipients = await filterRecipientsByNotificationPreference(parsedRecipients);
  if (filteredRecipients.length === 0) {
    await EmailLog.create({
      store: resolveStoreId(storeId),
      to,
      subject,
      status: 'skipped',
      reason: 'All recipients have disabled email notifications',
      context
    });
    return { skipped: true, reason: 'All recipients have disabled email notifications' };
  }
  try {
    const transporter = buildTransport(cfg);
    const from = `${cfg.fromName} <${cfg.fromEmail}>`;
    const info = await transporter.sendMail({ from, to: filteredRecipients.join(','), subject, text, html });
    await EmailLog.create({
      store: resolveStoreId(storeId),
      to: filteredRecipients.join(','),
      subject,
      status: 'sent',
      providerMessageId: info.messageId || '',
      context
    });
    return { skipped: false, messageId: info.messageId, storeName: cfg.storeName };
  } catch (error) {
    await EmailLog.create({
      store: resolveStoreId(storeId),
      to,
      subject,
      status: 'failed',
      reason: error.message || 'Email send failed',
      context
    });
    throw error;
  }
};

module.exports = {
  getStoreEmailConfig,
  getStoreNotificationRecipients,
  sendStoreEmail,
  buildTransport
};

