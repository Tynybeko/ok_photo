import { addDeleted, getDeleted } from '../lib/blob-store.js';
import { requireAdmin } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
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
      const name = req.body?.name;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name required' });
      }
      const deleted = await addDeleted(name);
      return res.status(200).json({ ok: true, deleted: [...deleted].sort() });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
