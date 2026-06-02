import { requireAdmin } from '../lib/auth.js';
import { getNotifyState, saveNotifyState } from '../lib/blob-store.js';
import { sendPasswordNotifications } from '../lib/notify-whatsapp.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAdmin(req, res)) return;

  try {
    const state = await getNotifyState();
    const result = await sendPasswordNotifications({
      force: true,
      lastPeriod: state.lastPeriod ?? -1,
    });
    if (result.ok) {
      await saveNotifyState({ lastPeriod: result.period, sentAt: new Date().toISOString() });
    }
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Notify failed' });
  }
}
