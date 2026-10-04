/**
 * Статический preflight App Store-релиза.
 *
 * Не заменяет подпись и проверку App Store Connect: он ловит локальные
 * расхождения, из-за которых архив заведомо нельзя отправлять — неверный
 * Bundle ID, версия, пропущенный privacy manifest, прозрачная иконка,
 * старые ссылки PWA и несинхронная production-сборка.
 *
 * Работает на любой системе, не только на macOS. Раньше звал `plutil` и
 * `sips`, и из-за этого гард запускался ровно в одном месте на свете — на
 * Mac владельца, за минуту до архива. Всё, что он ловит, дешевле поймать
 * заранее: на сервере, в рабочей среде, в CI. Разбор plist и заголовков
 * изображений вынесен в scripts/lib/apple-assets.mjs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { plistValue, imageInfo } from './lib/apple-assets.mjs';

const root = process.cwd();
const checks = [];

function add(name, pass, detail = '') {
  checks.push({ name, pass, detail });
}

function text(path) {
  return readFileSync(join(root, path), 'utf8');
}

function sha(path) {
  return createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
}

function bytes(path) {
  return readFileSync(join(root, path));
}

/** Размеры и альфа изображения. null — файла нет либо формат не распознан. */
function picture(path) {
  if (!existsSync(join(root, path))) return null;
  return imageInfo(bytes(path));
}

const infoPlist = text('ios/App/App/Info.plist');
const info = {
  CFBundleDevelopmentRegion: plistValue(infoPlist, 'CFBundleDevelopmentRegion'),
  NSLocationWhenInUseUsageDescription: plistValue(infoPlist, 'NSLocationWhenInUseUsageDescription'),
  UIBackgroundModes: plistValue(infoPlist, 'UIBackgroundModes'),
  ITSAppUsesNonExemptEncryption: plistValue(infoPlist, 'ITSAppUsesNonExemptEncryption'),
};
const pkg = JSON.parse(text('package.json'));
const project = text('ios/App/App.xcodeproj/project.pbxproj');
const privacy = text('ios/App/App/PrivacyInfo.xcprivacy');
const manifest = JSON.parse(text('public/manifest.webmanifest'));

add('Bundle ID', /PRODUCT_BUNDLE_IDENTIFIER = ing\.quran\.app;/.test(project));
// Quran Ing выпускается в ДРУГОМ аккаунте Apple. SGS6KFDCD4 — команда an-Nur:
// с ней Archive либо падает без профилей для ing.quran.app, либо Xcode
// регистрирует App ID в чужом аккаунте. Пока Team ID нового аккаунта не
// вписан в project.pbxproj, сборку выпускать нельзя.
const teams = [...project.matchAll(/DEVELOPMENT_TEAM = ([A-Z0-9]+);/g)].map(m => m[1]);
add('Team ID нового аккаунта (не an-Nur SGS6KFDCD4)',
  teams.length > 0 && teams.every(team => team !== 'SGS6KFDCD4'));
// Версию и номер сборки держим в package.json — единственном месте, где их
// правят. Раньше ожидаемые числа были зашиты прямо здесь, и подъём версии
// ронял собственный preflight: гард сообщал не «забыли поднять», а «забыли
// поднять В ДВУХ местах».
const expectedVersion = pkg.version.replace(/\.0$/, '');
const expectedBuild = String(pkg.iosBuild);
add(
  `Версия ${expectedVersion}`,
  new RegExp(`MARKETING_VERSION = ${expectedVersion.replace(/\./g, '\\.')};`).test(project),
);
add(
  `Build ${expectedBuild}`,
  new RegExp(`CURRENT_PROJECT_VERSION = ${expectedBuild};`).test(project),
);
add('Русская локализация', info.CFBundleDevelopmentRegion === 'ru');
add('Описание геолокации', typeof info.NSLocationWhenInUseUsageDescription === 'string');
add('Фоновое аудио', info.UIBackgroundModes?.includes('audio') === true);
add('Export compliance', info.ITSAppUsesNonExemptEncryption === false);
add('Privacy manifest', privacy.includes('<key>NSPrivacyTracking</key>'));
add('Privacy manifest без сбора', /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/.test(privacy));
add('App Store export options', existsSync(join(root, 'ios/ExportOptions-AppStore.plist')));

for (const size of [16, 32, 48, 72, 96, 128, 180, 192, 256, 512]) {
  add(`Web icon ${size}`, existsSync(join(root, `public/icons/icon-${size}.png`)));
}
add('PWA name Quran Ing', manifest.name === 'Quran Ing' && manifest.short_name === 'Quran Ing');
add('PWA icon paths', manifest.icons.every(icon => icon.src.endsWith('.png')));

const appIcon = picture('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
add('App Store icon 1024×1024', appIcon?.width === 1024 && appIcon?.height === 1024);
// Прозрачность в иконке App Store — отказ на загрузке, а не на ревью.
add('App Store icon без alpha', appIcon?.hasAlpha === false);

for (const nativeIndex of [
  'ios/App/App/public/index.html',
]) {
  const pass = existsSync(join(root, 'dist/index.html'))
    && existsSync(join(root, nativeIndex))
    && sha('dist/index.html') === sha(nativeIndex);
  add(`Синхронизация ${nativeIndex}`, pass);
}

for (const [folder, width, height] of [
  ['iphone-6.9', 1320, 2868],
  ['ipad-13', 2064, 2752],
]) {
  for (const name of ['01-quran', '02-surah', '03-tafsir', '04-azkar', '05-prayer']) {
    const path = `app-store/screenshots/${folder}/${name}.jpg`;
    const shot = picture(path);
    add(
      `Скриншот ${folder}/${name}`,
      shot?.width === width && shot?.height === height && shot.hasAlpha === false,
    );
  }
}

for (const check of checks) {
  console.log(`${check.pass ? '✓' : '✗'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
}

const failed = checks.filter(check => !check.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
if (failed.length) process.exitCode = 1;
