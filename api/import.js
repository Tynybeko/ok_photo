import {
  addPhotoEntries,
  existingUrlKeys,
  getManifest,
  uploadImage,
} from '../lib/blob-store.js';
import { collectProfileUrls, nextImportName } from '../lib/ok-import.js';
import { requireAdmin } from '../lib/auth.js';

export const config = { maxDuration: 300 };

const IMAGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
  Referer: 'https://ok.ru/',
};

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
  const maxPhotos = Math.min(parseInt(process.env.IMPORT_MAX || '50', 10), 100);

  try {
    const urls = await collectProfileUrls(url, cookies);
    const known = await existingUrlKeys();
    let skipped = 0;
    let errors = 0;
    const errorSamples = [];
    const manifest = await getManifest();
    const newEntries = [];

    for (const imageUrl of urls) {
      if (newEntries.length >= maxPhotos) break;

      const key = imageUrl.split('&')[0];
      if (known.has(key)) {
        skipped++;
        continue;
      }

      try {
        const r = await fetch(imageUrl, {
          headers: {
            ...IMAGE_HEADERS,
            ...(cookies ? { Cookie: cookies } : {}),
          },
        });
        if (!r.ok) {
          errors++;
          if (errorSamples.length < 3) errorSamples.push(`HTTP ${r.status}`);
          continue;
        }
        const data = Buffer.from(await r.arrayBuffer());
        if (data.length < 500) {
          errors++;
          continue;
        }
        const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
        const ext =
          { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[mime] || '.webp';
        const id = nextImportName([...manifest, ...newEntries], ext);
        const blob = await uploadImage(id, data, mime);
        newEntries.push({
          id,
          name: id,
          mime,
          source: 'ok',
          profile: url,
          originalUrl: imageUrl,
          blobUrl: blob.url,
        });
        known.add(key);
      } catch (e) {
        errors++;
        if (errorSamples.length < 3) errorSamples.push(e.message || 'fetch error');
      }
    }

    const added = await addPhotoEntries(newEntries);

    return res.status(200).json({
      ok: true,
      found: urls.length,
      added,
      skipped,
      errors,
      has_cookies: Boolean(cookies),
      capped: urls.length > maxPhotos,
      hint:
        added === 0 && urls.length > 0
          ? 'Фото найдены, но не скачались. Добавьте OK_COOKIES в Vercel или используйте HAR.'
          : undefined,
      errorSamples: errorSamples.length ? errorSamples : undefined,
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Import failed' });
  }
}
