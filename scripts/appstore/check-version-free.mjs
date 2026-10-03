/**
 * check-version-free — не тратить сборку на закрытый поезд версии.
 *
 * ── Зачем ─────────────────────────────────────────────────────────────
 *
 * 08.09.2026 сборка 25 прошла весь путь — тесты, гард, компиляцию Xcode на
 * облачном раннере — и упала на самой выгрузке ответом Apple:
 *
 *   Invalid Pre-Release Train. The train version '2.1' is closed for new
 *   build submissions.
 *
 * Причина: 2.1 к тому моменту уже вышла в магазин, и новые сборки под этим
 * номером Apple не принимает. Узнать это можно было одним запросом ДО
 * сборки — вместо пяти минут работы раннера и потерянного времени.
 *
 * Скрипт сверяет `version` из package.json с версиями в App Store Connect и
 * падает, если такая уже выпущена. Запускать перед отправкой сборки.
 */

import { readFileSync } from 'node:fs';
import { credentialsFromEnv, appIdFromEnv, ascGet } from './asc-client.mjs';

const APP = appIdFromEnv();

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const наша = pkg.version.replace(/\.0$/, '');

const credentials = credentialsFromEnv();
const ответ = await ascGet(`/v1/apps/${APP}/appStoreVersions`, credentials, { limit: 10 });

const занятые = ответ.data
  .filter(v => ['READY_FOR_SALE', 'PENDING_DEVELOPER_RELEASE', 'REPLACED_WITH_NEW_INFO']
    .includes(v.attributes.appStoreState))
  .map(v => v.attributes.versionString);

if (занятые.includes(наша)) {
  console.error(
    `Версия ${наша} уже выпущена в App Store — поезд закрыт, новую сборку под\n`
    + `этим номером Apple не примет. Поднимите MARKETING_VERSION и version в\n`
    + `package.json, добавьте раздел «What's New» в APP_STORE.md.`,
  );
  process.exit(1);
}

const идёт = ответ.data.find(v => v.attributes.versionString === наша);
console.log(идёт
  ? `Версия ${наша} заведена и находится в состоянии ${идёт.attributes.appStoreState} — можно собирать.`
  : `Версия ${наша} ещё не заведена — будет создана при отправке. Можно собирать.`);
