import { getNotifyState, saveNotifyState } from '../lib/blob-store.js';
import { sendPasswordNotifications } from '../lib/notify-whatsapp.js';

export const config = { maxDuration: 60 };

function isAuthorized(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized cron' });
  }

  try {
    const state = await getNotifyState();
    const force = req.query?.force === '1';
    const result = await sendPasswordNotifications({
      force,
      lastPeriod: state.lastPeriod ?? -1,
    });

    if (result.ok && !result.skipped) {
      await saveNotifyState({ lastPeriod: result.period, sentAt: new Date().toISOString() });
    }

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Notify failed' });
  }
}
