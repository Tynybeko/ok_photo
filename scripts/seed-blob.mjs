#!/usr/bin/env node
/**
 * Загрузка локальных data/images → Vercel Blob.
 * Запускается при деплое (npm run build) или вручную: npm run seed
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { head, put } from '@vercel/blob';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imagesDir = join(root, 'data', 'images');
const manifestPath = join(root, 'data', 'manifest.json');

// .env.local для локального npm run seed
const envLocal = join(root, '.env.local');
if (existsSync(envLocal)) {
  for (const line of readFileSync(envLocal, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

async function blobHasPhotos() {
  try {
    const meta = await head('gallery/manifest.json');
    const res = await fetch(meta.url);
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.log('[seed] Пропуск: нет BLOB_READ_WRITE_TOKEN (подключите Blob на Vercel)');
  process.exit(0);
}

if (!existsSync(manifestPath)) {
  console.log('[seed] Пропуск: нет data/manifest.json');
  process.exit(0);
}

if (await blobHasPhotos()) {
  console.log('[seed] В Blob уже есть фото — пропуск');
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
});

const deletedPath = join(root, 'deleted.json');
if (existsSync(deletedPath)) {
  await put('gallery/deleted.json', readFileSync(deletedPath, 'utf-8'), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

console.log(`[seed] Готово: ${updated.length} фото в Blob`);
