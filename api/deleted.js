import { addDeleted, addDeletedMany, getDeleted } from '../lib/blob-store.js';
import { requireAdmin } from '../lib/auth.js';
import { readJsonBody } from '../lib/read-body.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    try {
      return res.status(200).json([...(await getDeleted())].sort());
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    try {
      const body = await readJsonBody(req);
      const names = Array.isArray(body?.names)
        ? body.names.filter((n) => typeof n === 'string' && n)
        : body?.name
          ? [body.name]
          : [];
      if (!names.length) {
        return res.status(400).json({ error: 'name or names required' });
      }
      const deleted = names.length === 1 ? await addDeleted(names[0]) : await addDeletedMany(names);
      return res.status(200).json({ ok: true, deleted: [...deleted].sort(), count: names.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
