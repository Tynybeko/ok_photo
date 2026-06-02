import { addPhotoEntries, getDedupeState, getManifest, uploadImage } from '../lib/blob-store.js';
import { nextImportName } from '../lib/ok-import.js';
import { createBatchDedupe, duplicateReason, registerDedupe } from '../lib/dedupe.js';
import { requireAdmin } from '../lib/auth.js';

export const config = { maxDuration: 60 };

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function sniffMime(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  return null;
}

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
  if (!buf.length) return res.status(400).json({ error: 'Файл не передан' });
  if (buf.length < 100) return res.status(400).json({ error: 'Файл слишком маленький' });

  let mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED.has(mime)) mime = sniffMime(buf);
  if (!mime || !ALLOWED.has(mime)) {
    return res.status(400).json({ error: 'Нужен JPG, PNG, WebP или GIF' });
  }

  try {
    const dedupe = await getDedupeState();
    const batch = createBatchDedupe();
    if (duplicateReason(dedupe, batch, null, buf)) {
      return res.status(200).json({ ok: true, added: 0, duplicate: true });
    }

    const ext =
      { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[
        mime
      ] || '.bin';
    const manifest = await getManifest();
    const id = nextImportName(manifest, ext);
    const blob = await uploadImage(id, buf, mime);
    const contentHash = registerDedupe(dedupe, batch, null, buf);
    const added = await addPhotoEntries([
      {
        id,
        name: id,
        mime,
        source: 'upload',
        contentHash,
        blobUrl: blob.url,
      },
    ]);

    return res.status(200).json({ ok: true, added, id });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Upload failed' });
  }
}
