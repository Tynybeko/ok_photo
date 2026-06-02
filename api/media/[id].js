import { getImageBlob } from '../../lib/blob-store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const id = req.query?.id;
  if (!id || String(id).includes('..')) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const blob = await getImageBlob(id);
    const upstream = await fetch(blob.url);
    if (!upstream.ok) return res.status(404).json({ error: 'Not found' });
    const data = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', blob.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(data);
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
}
