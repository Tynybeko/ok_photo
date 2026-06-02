import { listPhotosForApi } from '../lib/blob-store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const photos = await listPhotosForApi();
    return res.status(200).json(photos);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Blob error' });
  }
}
