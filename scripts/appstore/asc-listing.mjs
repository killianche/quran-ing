#!/usr/bin/env node
/**
 * asc-listing — заполнить карточку Quran Ing в App Store Connect по
 * APP_STORE.md: всё, что Apple принимает через API.
 *
 * ── Что ставит ────────────────────────────────────────────────────────────
 *
 *   • категории (Books + Reference), название, подзаголовок, Privacy URL;
 *   • Content Rights — приложение показывает сторонний контент;
 *   • возрастной рейтинг — во всех пунктах «нет» (ожидаемо 4+);
 *   • copyright версии, описание, ключевые слова, промо-текст, Support URL;
 *   • контакт для App Review (тот же, что у бета-проверки TestFlight) и
 *     заметки для ревьюера;
 *   • цена «бесплатно» и доступность во всех странах;
 *   • скриншоты iPhone 6.9″ и iPad 13″ из app-store/screenshots/.
 *
 * ── Чего НЕ ставит ────────────────────────────────────────────────────────
 *
 * App Privacy («No, we do not collect data») — у Apple нет API для этой
 * анкеты; её публикует владелец в веб-интерфейсе (APP_STORE.md → Privacy).
 *
 * Повторный запуск безопасен: значения перезаписываются, скриншоты в наборах
 * заменяются целиком. Ничего не отправляет на проверку — это asc-submit.
 *
 * Запуск: . secrets/asc.env && node scripts/appstore/asc-listing.mjs
 */

import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ascGet, ascSend, credentialsFromEnv, appIdFromEnv } from './asc-client.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const APP = appIdFromEnv();
const C = credentialsFromEnv();
const LOCALE = 'ru';
const VERSION = '1.0';

const LISTING = {
  name: 'Quran Ing',
  subtitle: 'Коран с ингушским переводом',
  privacyPolicyUrl: 'https://killianche.github.io/quran-ing-site/privacy.html',
  supportUrl: 'https://killianche.github.io/quran-ing-site/support.html',
  copyright: '2026 Victoria Hester',
  primaryCategory: 'BOOKS',
  secondaryCategory: 'REFERENCE',
};

const SCREEN_SETS = [
  { folder: 'iphone-6.9', displayType: 'APP_IPHONE_67' },
  { folder: 'ipad-13', displayType: 'APP_IPAD_PRO_3GEN_129' },
];
const SHOTS = ['01-quran', '02-surah', '03-tafsir', '04-azkar', '05-prayer'];

/** Раздел APP_STORE.md по заголовку `### …` — текст без обёрток. */
function section(heading) {
  const doc = readFileSync(resolve(ROOT, 'APP_STORE.md'), 'utf8');
  const at = doc.indexOf(`### ${heading}`);
  if (at === -1) throw new Error(`В APP_STORE.md нет раздела «${heading}»`);
  const rest = doc.slice(at + heading.length + 4);
  const end = rest.search(/\n#{2,3} /);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}
/** Абзацы, переносы внутри абзаца — пробелом (переносы ради ширины файла). */
function prose(text) {
  return text.split(/\n{2,}/).map(block => (
    block.split('\n').map(line => line.trim()).join('\n')
      .replace(/\n(?!- )/g, ' ')
  )).join('\n\n');
}

const description = prose(section('Description'));
const promotionalText = prose(section('Promotional Text'));
const keywords = section('Keywords').replace(/`/g, '').trim();
const reviewNotes = prose(section('App Review Notes'));

if (description.length > 4000) throw new Error('Описание длиннее 4000');
if (promotionalText.length > 170) throw new Error('Промо-текст длиннее 170');
if (keywords.length > 100) throw new Error('Ключевые слова длиннее 100');
if (LISTING.subtitle.length > 30) throw new Error('Подзаголовок длиннее 30');

const patch = (type, id, attributes, relationships) => ascSend('PATCH', `/v1/${type}/${id}`, {
  data: { type, id, ...(attributes ? { attributes } : {}), ...(relationships ? { relationships } : {}) },
}, C);

// ── Информация о приложении ──────────────────────────────────────────────
const infos = await ascGet(`/v1/apps/${APP}/appInfos`, C);
const info = infos.data.find(i => ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED']
  .includes(i.attributes.appStoreState ?? i.attributes.state)) ?? infos.data[0];
await patch('appInfos', info.id, undefined, {
  primaryCategory: { data: { type: 'appCategories', id: LISTING.primaryCategory } },
  secondaryCategory: { data: { type: 'appCategories', id: LISTING.secondaryCategory } },
});
console.log('✓ категории: Books + Reference');

const infoLocs = await ascGet(`/v1/appInfos/${info.id}/appInfoLocalizations`, C);
const infoLoc = infoLocs.data.find(l => l.attributes.locale === LOCALE);
if (!infoLoc) throw new Error('Нет локализации ru у appInfo');
await patch('appInfoLocalizations', infoLoc.id, {
  name: LISTING.name, subtitle: LISTING.subtitle, privacyPolicyUrl: LISTING.privacyPolicyUrl,
});
console.log('✓ название, подзаголовок, Privacy Policy URL');

await patch('apps', APP, { contentRightsDeclaration: 'USES_THIRD_PARTY_CONTENT' });
console.log('✓ Content Rights: сторонний контент, права подтверждены владельцем');

// ── Возрастной рейтинг: всё «нет» ────────────────────────────────────────
const rating = await ascGet(`/v1/appInfos/${info.id}/ageRatingDeclaration`, C);
// Анкета 2025 года: дескрипторы содержания — NONE/INFREQUENT…, флаги —
// да/нет. Служебные поля (override, Корея, kidsAgeBand) не трогаем.
const STRING_RATINGS = [
  'alcoholTobaccoOrDrugUseOrReferences', 'contests', 'gamblingSimulated', 'gunsOrOtherWeapons',
  'medicalOrTreatmentInformation', 'profanityOrCrudeHumor', 'sexualContentGraphicAndNudity',
  'sexualContentOrNudity', 'horrorOrFearThemes', 'matureOrSuggestiveThemes',
  'violenceCartoonOrFantasy', 'violenceRealisticProlongedGraphicOrSadistic', 'violenceRealistic',
];
const BOOL_RATINGS = [
  'advertising', 'gambling', 'healthOrWellnessTopics', 'lootBox', 'messagingAndChat',
  'parentalControls', 'ageAssurance', 'socialMedia', 'unrestrictedWebAccess', 'userGeneratedContent',
];
const ratingAttrs = {};
for (const key of STRING_RATINGS) if (key in rating.data.attributes) ratingAttrs[key] = 'NONE';
for (const key of BOOL_RATINGS) if (key in rating.data.attributes) ratingAttrs[key] = false;
await patch('ageRatingDeclarations', rating.data.id, ratingAttrs).catch(async error => {
  console.error('Рейтинг: Apple отклонила набор полей, поля анкеты:', Object.keys(rating.data.attributes));
  throw error;
});
console.log(`✓ возрастной рейтинг: ${Object.keys(ratingAttrs).length} пунктов — «нет»`);

// ── Версия 1.0 ───────────────────────────────────────────────────────────
const versions = await ascGet(`/v1/apps/${APP}/appStoreVersions`, C);
const version = versions.data.find(v => v.attributes.versionString === VERSION);
if (!version) throw new Error(`Версии ${VERSION} нет`);
await patch('appStoreVersions', version.id, { copyright: LISTING.copyright });
console.log(`✓ copyright: ${LISTING.copyright}`);

const verLocs = await ascGet(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`, C);
const verLoc = verLocs.data.find(l => l.attributes.locale === LOCALE);
if (!verLoc) throw new Error('Нет локализации ru у версии');
await patch('appStoreVersionLocalizations', verLoc.id, {
  description, keywords, promotionalText, supportUrl: LISTING.supportUrl,
});
console.log(`✓ описание (${description.length}), ключевые слова (${keywords.length}), промо (${promotionalText.length}), Support URL`);

// ── Контакт для App Review ───────────────────────────────────────────────
const beta = await ascGet(`/v1/apps/${APP}/betaAppReviewDetail`, C);
const b = beta.data.attributes;
const contact = {
  contactFirstName: b.contactFirstName, contactLastName: b.contactLastName,
  contactPhone: b.contactPhone, contactEmail: b.contactEmail,
  demoAccountRequired: false, notes: reviewNotes,
};
let review = null;
try {
  review = await ascGet(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`, C);
} catch { /* ещё не заведён */ }
if (review?.data) {
  await patch('appStoreReviewDetails', review.data.id, contact);
} else {
  await ascSend('POST', '/v1/appStoreReviewDetails', {
    data: {
      type: 'appStoreReviewDetails', attributes: contact,
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } },
    },
  }, C);
}
console.log(`✓ контакт ревью: ${b.contactFirstName} ${b.contactLastName}, заметки (${reviewNotes.length})`);

// ── Цена: бесплатно ──────────────────────────────────────────────────────
// Пустое расписание у новой записи есть всегда — смотреть надо, есть ли в
// нём цены (первый прогон 2026-10-04 принял пустое за заданное, и Apple
// отказала в отправке: APP_PRICING_REQUIRED).
let hasSchedule = false;
try {
  const prices = await ascGet(`/v1/appPriceSchedules/${APP}/manualPrices`, C, { limit: '1' });
  hasSchedule = prices.data.length > 0;
} catch { /* расписания нет */ }
if (!hasSchedule) {
  const points = await ascGet(`/v1/apps/${APP}/appPricePoints`, C, { 'filter[territory]': 'USA', limit: '200' });
  const free = points.data.find(p => Number(p.attributes.customerPrice) === 0);
  if (!free) throw new Error('Не найдена бесплатная ценовая точка');
  await ascSend('POST', '/v1/appPriceSchedules', {
    data: {
      type: 'appPriceSchedules',
      relationships: {
        app: { data: { type: 'apps', id: APP } },
        baseTerritory: { data: { type: 'territories', id: 'USA' } },
        manualPrices: { data: [{ type: 'appPrices', id: '${price}' }] },
      },
    },
    included: [{
      type: 'appPrices', id: '${price}',
      attributes: { startDate: null },
      relationships: { appPricePoint: { data: { type: 'appPricePoints', id: free.id } } },
    }],
  }, C);
}
console.log('✓ цена: бесплатно');

// ── Доступность: все страны ──────────────────────────────────────────────
let hasAvailability = false;
try {
  const av = await ascGet(`/v1/apps/${APP}/appAvailabilityV2`, C);
  hasAvailability = Boolean(av.data);
} catch { /* не задана */ }
if (!hasAvailability) {
  const territories = [];
  let next = '/v1/territories?limit=200';
  while (next) {
    const page = await ascGet(next, C);
    territories.push(...page.data.map(t => t.id));
    next = page.links?.next ?? null;
  }
  await ascSend('POST', '/v2/appAvailabilities', {
    data: {
      type: 'appAvailabilities',
      attributes: { availableInNewTerritories: true },
      relationships: {
        app: { data: { type: 'apps', id: APP } },
        territoryAvailabilities: {
          data: territories.map(t => ({ type: 'territoryAvailabilities', id: `\${${t}}` })),
        },
      },
    },
    included: territories.map(t => ({
      type: 'territoryAvailabilities', id: `\${${t}}`,
      attributes: { available: true },
      relationships: { territory: { data: { type: 'territories', id: t } } },
    })),
  }, C);
  console.log(`✓ доступность: ${territories.length} стран, новые — автоматически`);
} else {
  console.log('✓ доступность уже задана');
}

// ── Скриншоты ────────────────────────────────────────────────────────────
const sets = await ascGet(`/v1/appStoreVersionLocalizations/${verLoc.id}/appScreenshotSets`, C, { limit: '50' });
for (const { folder, displayType } of SCREEN_SETS) {
  let set = sets.data.find(s => s.attributes.screenshotDisplayType === displayType);
  if (!set) {
    set = (await ascSend('POST', '/v1/appScreenshotSets', {
      data: {
        type: 'appScreenshotSets', attributes: { screenshotDisplayType: displayType },
        relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: verLoc.id } } },
      },
    }, C)).data;
  }
  const existing = await ascGet(`/v1/appScreenshotSets/${set.id}/appScreenshots`, C, { limit: '20' });
  for (const old of existing.data) await ascSend('DELETE', `/v1/appScreenshots/${old.id}`, undefined, C);

  for (const name of SHOTS) {
    const file = resolve(ROOT, 'app-store/screenshots', folder, `${name}.jpg`);
    const bytes = readFileSync(file);
    const created = (await ascSend('POST', '/v1/appScreenshots', {
      data: {
        type: 'appScreenshots',
        attributes: { fileName: basename(file), fileSize: statSync(file).size },
        relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } },
      },
    }, C)).data;
    for (const op of created.attributes.uploadOperations) {
      const headers = Object.fromEntries((op.requestHeaders ?? []).map(h => [h.name, h.value]));
      const res = await fetch(op.url, {
        method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length),
      });
      if (!res.ok) throw new Error(`Загрузка ${name}: ${res.status} ${await res.text()}`);
    }
    await patch('appScreenshots', created.id, {
      uploaded: true, sourceFileChecksum: createHash('md5').update(bytes).digest('hex'),
    });
    console.log(`✓ скриншот ${folder}/${name}`);
  }
}

console.log('\nКарточка заполнена. Осталось: App Privacy (веб-интерфейс), затем asc-submit.');
