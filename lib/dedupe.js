import crypto from 'crypto';

/** Стабильный ключ URL okcdn (параметр r) */
export function urlDedupeKey(url) {
  if (!url) return '';
  const m = url.match(/[?&]r=([A-Za-z0-9_-]+)/);
  if (m) return `r:${m[1]}`;
  return url.split('&')[0].split('?')[0];
}

export function contentHash(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

export function dedupeStateFromManifest(manifest) {
  const urlKeys = new Set();
  const contentHashes = new Set();
  for (const it of manifest) {
    if (it.contentHash) contentHashes.add(it.contentHash);
    const u = it.originalUrl || it.url;
    if (u) urlKeys.add(urlDedupeKey(u));
  }
  return { urlKeys, contentHashes };
}

export function createBatchDedupe() {
  return { urlKeys: new Set(), contentHashes: new Set() };
}

/** null = не дубликат, иначе 'url' | 'hash' */
export function duplicateReason(state, batch, url, data) {
  const uk = url ? urlDedupeKey(url) : '';
  if (uk && (state.urlKeys.has(uk) || batch.urlKeys.has(uk))) return 'url';
  if (data?.length) {
    const h = contentHash(data);
    if (state.contentHashes.has(h) || batch.contentHashes.has(h)) return 'hash';
  }
  return null;
}

export function registerDedupe(state, batch, url, data) {
  const uk = url ? urlDedupeKey(url) : '';
  if (uk) {
    state.urlKeys.add(uk);
    batch.urlKeys.add(uk);
  }
  if (data?.length) {
    const h = contentHash(data);
    state.contentHashes.add(h);
    batch.contentHashes.add(h);
  }
  return data?.length ? contentHash(data) : undefined;
}
