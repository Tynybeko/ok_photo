import {
  addPhotoEntry,
  existingUrlKeys,
  getManifest,
  uploadImage,
} from '../../lib/blob-store.js';
import { nextImportName, parseHar } from '../../lib/ok-import.js';
import { requireAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAdmin(req, res)) return;

  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', (c) => chunks.push(c));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const buf = Buffer.concat(chunks);
  if (!buf.length) return res.status(400).json({ error: 'HAR file required' });

  try {
    const items = parseHar(buf);
    const known = await existingUrlKeys();
    let added = 0;
    let skipped = 0;
    const manifest = await getManifest();

    for (const { url, mime, data } of items) {
      const key = url.split('&')[0];
      if (known.has(key)) {
        skipped++;
        continue;
      }
      const ext =
        { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[mime] || '.webp';
      const id = nextImportName(manifest, ext);
      const blob = await uploadImage(id, Buffer.from(data), mime);
      await addPhotoEntry({
        id,
        name: id,
        mime,
        source: 'har',
        originalUrl: url,
        blobUrl: blob.url,
      });
      manifest.push({ id });
      known.add(key);
      added++;
    }

    return res.status(200).json({ ok: true, added, skipped, entries: items.length });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'HAR parse failed' });
  }
}
