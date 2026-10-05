#!/usr/bin/env node
/**
 * play-publish — выложить Quran Ing в Google Play одной правкой (edit).
 *
 *   . secrets/play.env
 *   node scripts/play/play-publish.mjs --aab путь/app-release.aab [--track production]
 *   node scripts/play/play-publish.mjs --listing-only
 *
 * Что делает, по порядку, внутри ОДНОЙ правки (либо применяется всё, либо
 * ничего):
 *   1) контакты (почта, сайт) — play-store/listing-ru.json;
 *   2) тексты страницы ru-RU — оттуда же;
 *   3) значок 512, баннер 1024×500, скриншоты телефона — play-store/;
 *   4) загрузка AAB (если передан --aab);
 *   5) выпуск в треке (по умолчанию production) с versionCode этой сборки.
 *
 * Пока приложение ни разу не опубликовано, Google принимает только выпуски
 * со статусом `draft`: на проверку их отправляет владелец в консоли, когда
 * заполнены анкеты «Содержание приложения» (у них нет API). После первой
 * публикации — `--status completed` выкатывает сразу.
 *
 * Права на запись — только у сервисного аккаунта Quran Ing (play-client.mjs).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { play, upload, openEdit, commitEdit, deleteEdit } from './play-client.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = name => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const aabPath = arg('--aab');
const track = arg('--track') ?? 'production';
const status = arg('--status') ?? 'draft';
const listingOnly = process.argv.includes('--listing-only');
if (!aabPath && !listingOnly) {
  console.error('Нужен --aab путь/к/app-release.aab или --listing-only');
  process.exit(2);
}

const L = JSON.parse(readFileSync(resolve(ROOT, 'play-store/listing-ru.json'), 'utf8'));
const lang = L.language;

const edit = await openEdit();
console.log(`правка ${edit}`);
let committed = false;
try {
  // 1) Контакты.
  await play('PATCH', `/edits/${edit}/details`, {
    defaultLanguage: lang,
    contactEmail: L.contactEmail,
    contactWebsite: L.contactWebsite,
  });
  console.log('✓ контакты');

  // 2) Тексты страницы.
  await play('PUT', `/edits/${edit}/listings/${lang}`, {
    language: lang,
    title: L.title,
    shortDescription: L.shortDescription,
    fullDescription: L.fullDescription,
  });
  console.log('✓ тексты страницы');

  // 3) Картинки: прежние того же типа убираем, иначе скриншоты копились бы.
  const images = [
    ['icon', [resolve(ROOT, 'play-store/icon-512.png')], 'image/png'],
    ['featureGraphic', [resolve(ROOT, 'play-store/feature-graphic-1024x500.png')], 'image/png'],
    ['phoneScreenshots', readdirSync(resolve(ROOT, 'play-store/screenshots/phone'))
      .filter(f => f.endsWith('.jpg')).sort()
      .map(f => resolve(ROOT, 'play-store/screenshots/phone', f)), 'image/jpeg'],
  ];
  for (const [type, files, mime] of images) {
    await play('DELETE', `/edits/${edit}/listings/${lang}/${type}`);
    for (const f of files) await upload(`/edits/${edit}/listings/${lang}/${type}`, readFileSync(f), mime);
    console.log(`✓ ${type}: ${files.length}`);
  }

  // 4–5) Сборка и выпуск.
  if (aabPath) {
    console.log('загрузка AAB…');
    const bundle = await upload(`/edits/${edit}/bundles`, readFileSync(aabPath), 'application/octet-stream');
    console.log(`✓ AAB загружен: versionCode ${bundle.versionCode}, sha256 ${bundle.sha256?.slice(0, 12)}…`);
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    await play('PUT', `/edits/${edit}/tracks/${track}`, {
      track,
      releases: [{
        name: `${pkg.version.replace(/\.0$/, '')} (${bundle.versionCode})`,
        versionCodes: [String(bundle.versionCode)],
        status,
        releaseNotes: [{ language: lang, text: L.releaseNotes }],
      }],
    });
    console.log(`✓ выпуск в «${track}», статус ${status}`);
  }

  await commitEdit(edit);
  committed = true;
  console.log('✓ правка применена');
} finally {
  if (!committed) await deleteEdit(edit);
}
