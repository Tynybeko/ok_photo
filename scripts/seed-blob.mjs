#!/usr/bin/env node
/**
 * Однократная загрузка data/images → Vercel Blob.
 * Запуск вручную: SEED_BLOB=1 npm run seed
 * НЕ запускается при деплое — иначе затирает актуальные данные в Blob.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { head, put } from '@vercel/blob';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imagesDir = join(root, 'data', 'images');
const manifestPath = join(root, 'data', 'manifest.json');

const envLocal = join(root, '.env.local');
if (existsSync(envLocal)) {
  for (const line of readFileSync(envLocal, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

async function blobHasManifest() {
  try {
    const meta = await head('gallery/manifest.json');
    const res = await fetch(`${meta.url.split('?')[0]}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

async function blobHasDeleted() {
  try {
    await head('gallery/deleted.json');
    return true;
  } catch {
    return false;
  }
}

if (!process.env.SEED_BLOB) {
  console.log('[seed] Пропуск (нет SEED_BLOB=1). Деплой не трогает Blob.');
  process.exit(0);
}

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.log('[seed] Пропуск: нет BLOB_READ_WRITE_TOKEN');
  process.exit(0);
}

if (!existsSync(manifestPath)) {
  console.log('[seed] Пропуск: нет data/manifest.json');
  process.exit(0);
}

if (await blobHasManifest()) {
  console.log('[seed] В Blob уже есть manifest — пропуск (не перезаписываем)');
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const updated = [];
let ok = 0;

console.log(`[seed] Загрузка ${manifest.length} фото в Blob…`);

for (const entry of manifest) {
  const filePath = join(imagesDir, entry.id);
  if (!existsSync(filePath)) {
    console.warn('[seed] skip', entry.id);
    continue;
  }
  const data = readFileSync(filePath);
  const blob = await put(`gallery/images/${entry.id}`, data, {
    access: 'public',
    contentType: entry.mime || 'image/webp',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  updated.push({ ...entry, blobUrl: blob.url });
  ok++;
  if (ok % 20 === 0) console.log(`[seed] ${ok}/${manifest.length}`);
}

await put('gallery/manifest.json', JSON.stringify(updated), {
  access: 'public',
  contentType: 'application/json',
  addRandomSuffix: false,
  allowOverwrite: true,
  cacheControlMaxAge: 0,
});

// Не затираем удаления в Blob устаревшим deleted.json из git
const deletedPath = join(root, 'deleted.json');
if (existsSync(deletedPath) && !(await blobHasDeleted())) {
  await put('gallery/deleted.json', readFileSync(deletedPath, 'utf-8'), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  console.log('[seed] deleted.json загружен (в Blob его ещё не было)');
} else if (await blobHasDeleted()) {
  console.log('[seed] deleted.json в Blob не трогаем');
}

console.log(`[seed] Готово: ${updated.length} фото в Blob`);
