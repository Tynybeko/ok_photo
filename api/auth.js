import { readJsonBody } from '../lib/read-body.js';
import { getCurrentPasswords, getPasswordPeriod, validatePassword } from '../lib/passwords.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const { period, validUntil, rotationDays } = getCurrentPasswords();
    return res.status(200).json({ period, validUntil, rotationDays });
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const password = String(body?.password || '');
    const role = validatePassword(password, 'any');
    if (!role) return res.status(401).json({ error: 'Неверный пароль' });
    return res.status(200).json({
      ok: true,
      role,
      period: getPasswordPeriod(),
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
