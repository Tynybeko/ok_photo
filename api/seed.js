import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { requireAdmin } from '../lib/auth.js';
import { getManifest, saveManifest, uploadImage, saveDeleted } from '../lib/blob-store.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAdmin(req, res)) return;

  const root = process.cwd();
  const manifestPath = join(root, 'data', 'manifest.json');
  const imagesDir = join(root, 'data', 'images');

  if (!existsSync(manifestPath)) {
    return res.status(400).json({ error: 'Нет data/manifest.json в проекте' });
  }

  try {
    const existing = await getManifest();
    if (existing.length > 0) {
      return res.status(200).json({
        ok: true,
        message: 'В Blob уже есть фото',
        count: existing.length,
      });
    }

    const local = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const updated = [];

    for (const entry of local) {
      const fp = join(imagesDir, entry.id);
      if (!existsSync(fp)) continue;
      const data = readFileSync(fp);
      const blob = await uploadImage(entry.id, data, entry.mime || 'image/webp');
      updated.push({ ...entry, blobUrl: blob.url });
    }

    await saveManifest(updated);

    const deletedPath = join(root, 'deleted.json');
    if (existsSync(deletedPath)) {
      const list = JSON.parse(readFileSync(deletedPath, 'utf-8'));
      await saveDeleted(new Set(list));
    }

    return res.status(200).json({ ok: true, uploaded: updated.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
