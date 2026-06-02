import {
  addPhotoEntry,
  existingUrlKeys,
  getManifest,
  uploadImage,
} from '../lib/blob-store.js';
import { collectProfileUrls, nextImportName } from '../lib/ok-import.js';
import { requireAdmin } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAdmin(req, res)) return;

  const url = req.body?.url?.trim();
  if (!url) return res.status(400).json({ error: 'url required' });

  const cookies = process.env.OK_COOKIES || '';
  const maxPhotos = Math.min(parseInt(process.env.IMPORT_MAX || '80', 10), 200);

  try {
    const urls = await collectProfileUrls(url, cookies);
    const known = await existingUrlKeys();
    let added = 0;
    let skipped = 0;
    let errors = 0;
    const manifest = await getManifest();

    for (const imageUrl of urls.slice(0, maxPhotos)) {
      const key = imageUrl.split('&')[0];
      if (known.has(key)) {
        skipped++;
        continue;
      }
      try {
        const r = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ok-photo/1.0)',
            ...(cookies ? { Cookie: cookies } : {}),
          },
        });
        if (!r.ok) {
          errors++;
          continue;
        }
        const data = Buffer.from(await r.arrayBuffer());
        if (data.length < 500) {
          errors++;
          continue;
        }
        const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
        const ext =
          { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[mime] || '.bin';
        const id = nextImportName(manifest, ext);
        const blob = await uploadImage(id, data, mime);
        await addPhotoEntry({
          id,
          name: id,
          mime,
          source: 'ok',
          profile: url,
          originalUrl: imageUrl,
          blobUrl: blob.url,
        });
        manifest.push({ id });
        known.add(key);
        added++;
      } catch {
        errors++;
      }
    }

    return res.status(200).json({
      ok: true,
      found: urls.length,
      added,
      skipped,
      errors,
      has_cookies: Boolean(cookies),
      capped: urls.length > maxPhotos,
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Import failed' });
  }
}
