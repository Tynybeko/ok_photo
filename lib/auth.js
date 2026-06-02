import { getCurrentPasswords, validatePassword } from './passwords.js';

export function getAdminPassword() {
  return getCurrentPasswords().admin;
}

export function getViewPassword() {
  return getCurrentPasswords().view;
}

export function isAdminRequest(req) {
  const fromHeader = req.headers['x-admin-password'];
  const fromBody = req.body?.adminPassword;
  const got = fromHeader || fromBody;
  if (!got) return false;
  return validatePassword(got, 'admin') === true || got === getAdminPassword();
}

export function requireAdmin(req, res) {
  if (isAdminRequest(req)) return true;
  res.status(403).json({ error: 'Нужен пароль редактирования' });
  return false;
}
