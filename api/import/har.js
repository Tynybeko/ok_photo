import {
  addPhotoEntries,
  getDedupeState,
  getManifest,
  uploadImage,
} from '../../lib/blob-store.js';
import { nextImportName, parseHar } from '../../lib/ok-import.js';
import { createBatchDedupe, duplicateReason, registerDedupe } from '../../lib/dedupe.js';
import { requireAdmin } from '../../lib/auth.js';

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

  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', (c) => chunks.push(c));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const buf = Buffer.concat(chunks);
  if (!buf.length) return res.status(400).json({ error: 'HAR file required' });

  const cookies = process.env.OK_COOKIES || '';

  try {
    const { items, urlsOnly } = parseHar(buf);
    const dedupe = await getDedupeState();
    const batch = createBatchDedupe();
    let skipped = 0;
    let duplicates = 0;
    let errors = 0;
    const manifest = await getManifest();
    const newEntries = [];

    for (const { url, mime, data } of items) {
      const bufData = Buffer.from(data);
      if (duplicateReason(dedupe, batch, url, bufData)) {
        skipped++;
        duplicates++;
        continue;
      }
      try {
        const ext =
          { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[mime] || '.webp';
        const id = nextImportName([...manifest, ...newEntries], ext);
        const blob = await uploadImage(id, bufData, mime);
        const contentHash = registerDedupe(dedupe, batch, url, bufData);
        newEntries.push({
          id,
          name: id,
          mime,
          source: 'har',
          originalUrl: url,
          contentHash,
          blobUrl: blob.url,
        });
      } catch {
        errors++;
      }
    }

    let downloaded = 0;
    for (const url of urlsOnly) {
      if (duplicateReason(dedupe, batch, url, null)) {
        skipped++;
        duplicates++;
        continue;
      }
      try {
        const r = await fetch(url, {
          headers: {
            ...IMAGE_HEADERS,
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
        if (duplicateReason(dedupe, batch, url, data)) {
          skipped++;
          duplicates++;
          continue;
        }
        const mime = (r.headers.get('content-type') || 'image/webp').split(';')[0];
        const ext =
          { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[mime] || '.webp';
        const id = nextImportName([...manifest, ...newEntries], ext);
        const blob = await uploadImage(id, data, mime);
        const contentHash = registerDedupe(dedupe, batch, url, data);
        newEntries.push({
          id,
          name: id,
          mime,
          source: 'har',
          originalUrl: url,
          contentHash,
          blobUrl: blob.url,
        });
        downloaded++;
      } catch {
        errors++;
      }
    }

    const added = await addPhotoEntries(newEntries);

    const hint =
      added === 0 && items.length === 0 && urlsOnly.length === 0
        ? 'В HAR нет фото okcdn.ru. Откройте альбом на ok.ru, прокрутите вниз, сохраните HAR.'
        : added === 0 && items.length === 0 && urlsOnly.length > 0
          ? 'HAR без тел ответов — скачивание по URL не удалось. Экспортируйте HAR с «Save content» или добавьте OK_COOKIES.'
          : added === 0 && duplicates > 0
            ? `Все ${duplicates} фото уже есть в галерее (дубликаты).`
            : undefined;

    return res.status(200).json({
      ok: true,
      added,
      skipped,
      duplicates,
      errors,
      fromBody: items.length,
      downloaded,
      urlsInHar: items.length + urlsOnly.length,
      hint,
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'HAR parse failed' });
  }
}
