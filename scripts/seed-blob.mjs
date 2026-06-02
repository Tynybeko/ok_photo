#!/usr/bin/env node
/**
 * Загрузка локальных data/images в Vercel Blob (один раз после деплоя).
 * Нужен BLOB_READ_WRITE_TOKEN в .env.local — скопируйте из Vercel → Storage → Blob.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { put } from '@vercel/blob';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imagesDir = join(root, 'data', 'images');
const manifestPath = join(root, 'data', 'manifest.json');

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Задайте BLOB_READ_WRITE_TOKEN в .env.local');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const updated = [];

for (const entry of manifest) {
  const filePath = join(imagesDir, entry.id);
  if (!existsSync(filePath)) {
    console.warn('skip', entry.id);
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
  console.log('ok', entry.id);
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

console.log(`Готово: ${updated.length} фото в Blob`);
