import { head, list, put } from '@vercel/blob';

const MANIFEST_PATH = 'gallery/manifest.json';
const DELETED_PATH = 'gallery/deleted.json';
const IMAGE_PREFIX = 'gallery/images/';

export function imagePath(id) {
  return `${IMAGE_PREFIX}${id}`;
}

async function readJson(path, fallback) {
  try {
    const meta = await head(path);
    const url = meta.url.includes('?') ? meta.url.split('?')[0] : meta.url;
    const res = await fetch(`${url}?v=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

async function writeJson(path, data) {
  await put(path, JSON.stringify(data), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

export async function getManifest() {
  const data = await readJson(MANIFEST_PATH, []);
  return Array.isArray(data) ? data : [];
}

export async function saveManifest(items) {
  await writeJson(MANIFEST_PATH, items);
}

export async function getDeleted() {
  const data = await readJson(DELETED_PATH, []);
  return new Set(Array.isArray(data) ? data : []);
}

export async function saveDeleted(set) {
  await writeJson(DELETED_PATH, [...set].sort());
}

export async function listPhotosForApi() {
  const manifest = await getManifest();
  const deleted = await getDeleted();
  return manifest
    .filter((p) => !deleted.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name || p.id,
      mime: p.mime || 'image/jpeg',
      source: p.source,
      profile: p.profile,
      url: p.blobUrl || null,
    }));
}

export async function addDeleted(id) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const deleted = await getDeleted();
    if (deleted.has(id)) return deleted;
    deleted.add(id);
    await saveDeleted(deleted);
    const check = await getDeleted();
    if (check.has(id)) return check;
  }
  const deleted = await getDeleted();
  deleted.add(id);
  await saveDeleted(deleted);
  return deleted;
}

export async function uploadImage(id, data, mime) {
  const blob = await put(imagePath(id), data, {
    access: 'public',
    contentType: mime,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob;
}

export async function addPhotoEntry(entry) {
  const n = await addPhotoEntries([entry]);
  return n > 0;
}

/** Новые фото — в начало manifest (сверху в галерее) */
export async function addPhotoEntries(entries) {
  if (!entries.length) return 0;
  const manifest = await getManifest();
  const ids = new Set(manifest.map((p) => p.id));
  const toAdd = [];
  for (const entry of entries) {
    if (!entry?.id || ids.has(entry.id)) continue;
    toAdd.push(entry);
    ids.add(entry.id);
  }
  if (!toAdd.length) return 0;
  manifest.unshift(...toAdd);
  await saveManifest(manifest);
  return toAdd.length;
}

export async function getImageBlob(id) {
  return head(imagePath(id));
}

export async function existingUrlKeys() {
  const manifest = await getManifest();
  const keys = new Set();
  for (const it of manifest) {
    if (it.originalUrl) keys.add(it.originalUrl.split('&')[0]);
  }
  return keys;
}
