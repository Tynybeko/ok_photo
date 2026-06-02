import { getCurrentPasswords, getSecret } from '../lib/passwords.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const key = req.query?.key || req.headers['x-password-key'] || '';
  if (!key || key !== getSecret()) {
    return res.status(403).json({
      error: 'Нужен ключ. Откройте /api/passwords?key=ВАШ_PASSWORD_SECRET',
    });
  }

  const { view, admin, validUntil, period, rotationDays } = getCurrentPasswords();
  return res.status(200).json({
    view,
    admin,
    validUntil,
    period,
    rotationDays,
    hint: `Пароли меняются каждые ${rotationDays} дня. Сохраните эту ссылку с ключом.`,
  });
}
