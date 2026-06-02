export function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || 'tinytiny';
}

export function isAdminRequest(req) {
  const expected = getAdminPassword();
  const fromHeader = req.headers['x-admin-password'];
  const fromBody = req.body?.adminPassword;
  return fromHeader === expected || fromBody === expected;
}

export function requireAdmin(req, res) {
  if (isAdminRequest(req)) return true;
  res.status(403).json({ error: 'Нужен пароль редактирования' });
  return false;
}
