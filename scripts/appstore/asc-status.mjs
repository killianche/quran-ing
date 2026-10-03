/**
 * Состояние приложения в App Store Connect — только чтение.
 *
 * Первая команда, которую стоит запустить, когда появится ключ API: она ничего
 * не меняет и доказывает, что доступ настроен и права выданы верно. Если она
 * отработала — можно двигаться к правке карточки и отправке на ревью.
 *
 *   ASC_ISSUER_ID=... ASC_KEY_ID=... ASC_KEY_PATH=secrets/AuthKey_XXXX.p8 \
 *     npm run asc:status
 *
 * Печатаем атрибуты объектов КАК ЕСТЬ, без выборки известных полей. Причина:
 * состав атрибутов у версий и сборок Apple меняла не раз (часть полей помечена
 * deprecated), и код, ожидающий конкретное имя, тихо покажет «undefined» вместо
 * реального состояния. Сырой вывод честнее: видно ровно то, что отдал Apple.
 * Когда доступ будет настроен и станет видно фактические имена полей, поверх
 * этого можно писать команды правки метаданных.
 */
import { credentialsFromEnv, ascGet } from './asc-client.mjs';

const BUNDLE_ID = 'ing.quran.app';

function printAttributes(prefix, attributes) {
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value === null || value === undefined) continue;
    const shown = typeof value === 'object' ? JSON.stringify(value) : String(value);
    console.log(`${prefix}${key}: ${shown}`);
  }
}

async function main() {
  const credentials = credentialsFromEnv();

  console.log('— Приложения команды —');
  const apps = await ascGet('/v1/apps', credentials, { limit: '50' });
  for (const app of apps.data) {
    const mark = app.attributes?.bundleId === BUNDLE_ID ? ' ←  наше' : '';
    console.log(`  ${app.attributes?.bundleId ?? '?'}  id=${app.id}${mark}`);
    console.log(`    ${app.attributes?.name ?? ''}`);
  }

  const app = apps.data.find(a => a.attributes?.bundleId === BUNDLE_ID);
  if (!app) {
    console.log(`\nПриложение ${BUNDLE_ID} этому ключу не видно.`);
    console.log('Проверить: тот ли Issuer ID и хватает ли ключу прав (нужна роль App Manager).');
    process.exitCode = 1;
    return;
  }

  console.log(`\n— Версии ${BUNDLE_ID} —`);
  const versions = await ascGet(`/v1/apps/${app.id}/appStoreVersions`, credentials, { limit: '10' });
  if (!versions.data.length) console.log('  (пусто)');
  for (const version of versions.data) {
    console.log(`  версия id=${version.id}`);
    printAttributes('    ', version.attributes);
  }

  console.log(`\n— Сборки —`);
  const builds = await ascGet('/v1/builds', credentials, {
    'filter[app]': app.id,
    limit: '10',
    sort: '-uploadedDate',
  });
  if (!builds.data.length) {
    console.log('  (пусто) — значит, ни один архив ещё не загружен с Mac');
  }
  for (const build of builds.data) {
    console.log(`  сборка id=${build.id}`);
    printAttributes('    ', build.attributes);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
