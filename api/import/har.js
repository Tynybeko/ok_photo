import {
  addPhotoEntries,
  existingUrlKeys,
  getManifest,
  uploadImage,
} from '../../lib/blob-store.js';
import { nextImportName, parseHar } from '../../lib/ok-import.js';
import { requireAdmin } from '../../lib/auth.js';

export const config = { maxDuration: 300 };

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
    let skipped = 0;
    let errors = 0;
    const manifest = await getManifest();
    const newEntries = [];

    for (const { url, mime, data } of items) {
      const key = url.split('&')[0];
      if (known.has(key)) {
        skipped++;
        continue;
      }
      try {
        const ext =
          { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[mime] || '.webp';
        const id = nextImportName([...manifest, ...newEntries], ext);
        const blob = await uploadImage(id, Buffer.from(data), mime);
        newEntries.push({
          id,
          name: id,
          mime,
          source: 'har',
          originalUrl: url,
          blobUrl: blob.url,
        });
        known.add(key);
      } catch {
        errors++;
      }
    }

    const added = await addPhotoEntries(newEntries);

    return res.status(200).json({
      ok: true,
      added,
      skipped,
      errors,
      entries: items.length,
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'HAR parse failed' });
  }
}
