/**
 * Подготовка версии в App Store Connect и отправка её на проверку.
 *
 * Делает то, что иначе делается руками в веб-интерфейсе: создаёт версию,
 * подставляет «Что нового», привязывает обработанную сборку и отправляет
 * заявку на ревью.
 *
 * ── Два режима, и это важно ───────────────────────────────────────────────
 *
 *   node scripts/appstore/asc-submit.mjs             — только подготовка
 *   node scripts/appstore/asc-submit.mjs --submit    — подготовка + отправка
 *
 * Без флага скрипт доводит версию до состояния «готова к отправке» и
 * останавливается, напечатав, что именно уйдёт. Всё, что он делает в этом
 * режиме, обратимо: версию можно удалить, текст переписать, сборку отвязать.
 *
 * Флаг `--submit` выполняет шаг, который обратим уже не полностью: заявка
 * уходит к проверяющему Apple, а после одобрения обновление приходит всем
 * пользователям автоматически (releaseType наследуется от прошлой версии —
 * AFTER_APPROVAL). Отзыв возможен, но он виден снаружи и сбрасывает позицию
 * в очереди проверки. Поэтому отправка отделена флагом, а не спрятана в
 * общий «сделай всё».
 *
 * ── Откуда берётся текст «Что нового» ─────────────────────────────────────
 *
 * Из APP_STORE.md, раздел «What's New — <версия>». Не из аргумента командной
 * строки и не из константы в коде: текст карточки — часть документации
 * релиза, он проходит вычитку там же, где остальное описание, и не должен
 * существовать в двух местах, которые разъезжаются.
 *
 * ── Порядок отправки ──────────────────────────────────────────────────────
 *
 * Apple убрала старый appStoreVersionSubmissions. Действующий порядок из трёх
 * шагов: создать reviewSubmission → добавить в неё reviewSubmissionItem с
 * версией → PATCH с `submitted: true`. Третий шаг не проходит без второго.
 */
import { readFileSync } from 'node:fs';
import { credentialsFromEnv, appIdFromEnv, ascGet, ascSend } from './asc-client.mjs';

const APP_ID = appIdFromEnv();
const PLATFORM = 'IOS';
const LOCALE = 'ru';

const doSubmit = process.argv.includes('--submit');

/** Версия продукта из package.json: 1.2.0 → 1.2, как её видит App Store. */
function versionString() {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  return { version: pkg.version.replace(/\.0$/, ''), build: String(pkg.iosBuild) };
}

/** Текст «Что нового» из APP_STORE.md для конкретной версии. */
function whatsNewFor(version) {
  const doc = readFileSync(new URL('../../APP_STORE.md', import.meta.url), 'utf8');
  const heading = `### What's New — ${version}`;
  const at = doc.indexOf(heading);
  if (at === -1) {
    throw new Error(`В APP_STORE.md нет раздела «${heading}» — текст для карточки взять неоткуда.`);
  }
  const rest = doc.slice(at + heading.length);
  const end = rest.search(/\n#{2,3} /);
  const text = (end === -1 ? rest : rest.slice(0, end)).trim();
  if (!text) throw new Error(`Раздел «${heading}» пуст.`);
  return text;
}

async function main() {
  const credentials = credentialsFromEnv();
  const { version, build } = versionString();
  const whatsNew = whatsNewFor(version);

  console.log(`Версия ${version}, сборка ${build}\n`);

  // ── Сборка должна быть обработана Apple ────────────────────────────────
  const builds = await ascGet('/v1/builds', credentials, {
    'filter[app]': APP_ID, limit: '20', sort: '-uploadedDate',
  });
  const target = builds.data.find(b => b.attributes?.version === build);
  if (!target) {
    throw new Error(`Сборка ${build} в App Store Connect не найдена — сначала выгрузить её.`);
  }
  if (target.attributes.processingState !== 'VALID') {
    throw new Error(
      `Сборка ${build} в состоянии ${target.attributes.processingState}. `
      + 'Привязать можно только VALID — подождать обработки Apple.',
    );
  }
  console.log(`✓ сборка ${build} обработана (VALID), id=${target.id}`);

  // ── Версия: найти существующую или создать ─────────────────────────────
  const versions = await ascGet(`/v1/apps/${APP_ID}/appStoreVersions`, credentials, { limit: '20' });
  let appVersion = versions.data.find(v => v.attributes?.versionString === version);

  if (appVersion) {
    console.log(`✓ версия ${version} уже заведена, id=${appVersion.id}, `
      + `состояние ${appVersion.attributes.appStoreState}`);
  } else {
    // copyright и releaseType берём у предыдущей версии, чтобы карточка не
    // разъезжалась между выпусками из-за забытого поля.
    const previous = versions.data[0];
    const created = await ascSend('POST', '/v1/appStoreVersions', {
      data: {
        type: 'appStoreVersions',
        attributes: {
          platform: PLATFORM,
          versionString: version,
          releaseType: previous?.attributes?.releaseType ?? 'AFTER_APPROVAL',
          copyright: previous?.attributes?.copyright ?? undefined,
        },
        relationships: { app: { data: { id: APP_ID, type: 'apps' } } },
      },
    }, credentials);
    appVersion = created.data;
    console.log(`✓ версия ${version} создана, id=${appVersion.id}`);
  }

  // ── «Что нового» ───────────────────────────────────────────────────────
  const locs = await ascGet(
    `/v1/appStoreVersions/${appVersion.id}/appStoreVersionLocalizations`,
    credentials, { limit: '20' },
  );
  const loc = locs.data.find(l => l.attributes?.locale === LOCALE);
  if (!loc) {
    throw new Error(`У версии ${version} нет локализации ${LOCALE} — карточка заполняется вручную.`);
  }
  await ascSend('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, {
    data: {
      type: 'appStoreVersionLocalizations',
      id: loc.id,
      attributes: { whatsNew },
    },
  }, credentials);
  console.log(`✓ «Что нового» записано (${whatsNew.length} символов)`);

  // ── Привязка сборки ────────────────────────────────────────────────────
  await ascSend('PATCH', `/v1/appStoreVersions/${appVersion.id}/relationships/build`, {
    data: { type: 'builds', id: target.id },
  }, credentials);
  console.log(`✓ сборка ${build} привязана к версии ${version}`);

  if (!doSubmit) {
    console.log('\n— Готово к отправке. Что уйдёт: —');
    console.log(`  версия ${version}, сборка ${build}`);
    console.log(`  выпуск: ${appVersion.attributes.releaseType}`);
    console.log('  «Что нового»:');
    for (const line of whatsNew.split('\n')) console.log('    ' + line);
    console.log('\nОтправка не выполнена: запустить с флагом --submit.');
    return;
  }

  // ── Отправка на ревью ──────────────────────────────────────────────────
  const submission = await ascSend('POST', '/v1/reviewSubmissions', {
    data: {
      type: 'reviewSubmissions',
      attributes: { platform: PLATFORM },
      relationships: { app: { data: { id: APP_ID, type: 'apps' } } },
    },
  }, credentials);
  const submissionId = submission.data.id;
  console.log(`✓ заявка создана, id=${submissionId}`);

  await ascSend('POST', '/v1/reviewSubmissionItems', {
    data: {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { id: submissionId, type: 'reviewSubmissions' } },
        appStoreVersion: { data: { id: appVersion.id, type: 'appStoreVersions' } },
      },
    },
  }, credentials);
  console.log(`✓ версия ${version} добавлена в заявку`);

  const sent = await ascSend('PATCH', `/v1/reviewSubmissions/${submissionId}`, {
    data: {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { submitted: true },
    },
  }, credentials);
  console.log(`✓ ОТПРАВЛЕНО НА ПРОВЕРКУ`);
  console.log(`  состояние заявки: ${sent?.data?.attributes?.state}`);
  console.log(`  submissionId: ${submissionId}`);
}

main().catch(error => {
  console.error('\n' + error.message);
  process.exitCode = 1;
});
