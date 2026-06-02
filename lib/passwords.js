import crypto from 'crypto';

export const ROTATION_DAYS = 2;
const PERIOD_MS = ROTATION_DAYS * 24 * 60 * 60 * 1000;

export function getSecret() {
  return process.env.PASSWORD_SECRET || 'ok-gallery-default-secret';
}

export function getPasswordPeriod(now = Date.now()) {
  return Math.floor(now / PERIOD_MS);
}

export function getPeriodEndMs(period) {
  return (period + 1) * PERIOD_MS;
}

function derive(role, period, secret = getSecret()) {
  const raw = crypto
    .createHash('sha256')
    .update(`${secret}|p${period}|${role}`)
    .digest('base64url')
    .replace(/[^a-zA-Z0-9]/g, '');
  const prefix = role === 'view' ? 'v' : 'e';
  return prefix + raw.slice(0, 11);
}

export function getCurrentPasswords(now = Date.now()) {
  const period = getPasswordPeriod(now);
  const secret = getSecret();
  return {
    view: derive('view', period, secret),
    admin: derive('admin', period, secret),
    period,
    validUntil: new Date(getPeriodEndMs(period)).toISOString(),
    rotationDays: ROTATION_DAYS,
  };
}

export function validatePassword(password, role, now = Date.now()) {
  const { view, admin } = getCurrentPasswords(now);
  if (role === 'view') return password === view;
  if (role === 'admin') return password === admin;
  if (password === admin) return 'admin';
  if (password === view) return 'view';
  return null;
}
