/**
 * create-distribution-signing — подпись для App Store без зарегистрированных
 * устройств: сертификат «Apple Distribution» + профиль IOS_APP_STORE для
 * ing.quran.app, и всё это — в секреты GitHub для сборки в Actions.
 *
 * ── Зачем ─────────────────────────────────────────────────────────────
 *
 * Автоматическая подпись Xcode собирает архив профилем РАЗРАБОТКИ, а его Apple
 * выдаёт только при хотя бы одном зарегистрированном устройстве. В аккаунте
 * Quran Ing устройств нет — первая сборка упала: «Your team has no devices
 * from which to generate a provisioning profile». Профиль App Store устройств
 * не требует, поэтому релиз подписывается вручную им (Release-конфигурация
 * цели App в project.pbxproj, ios/ExportOptions-AppStore.plist).
 *
 * ── Что делает ─────────────────────────────────────────────────────────
 *
 * 1. Закрытый ключ RSA 2048 и CSR — openssl, локально в secrets/dist/.
 * 2. Сертификат DISTRIBUTION через App Store Connect API.
 * 3. .p12 (ключ + сертификат) со случайным паролем — в формате, который
 *    понимает `security import` на macOS (PBE-SHA1-3DES).
 * 4. Профиль IOS_APP_STORE «Quran Ing App Store» для bundle ID ing.quran.app
 *    с этим сертификатом (старый профиль с тем же именем удаляется — он
 *    привязан к прежнему сертификату).
 * 5. Секреты репозитория: DIST_P12_BASE64, DIST_P12_PASSWORD,
 *    APPSTORE_PROFILE_BASE64.
 *
 * 🔴 Чужое не трогается: существующие сертификаты аккаунта (он общий с
 * приложением xtrud) не отзываются и не используются. Сертификат живёт год —
 * через год запустить скрипт заново.
 *
 * Запуск (на сервере, один раз):
 *   . secrets/asc.env && node scripts/appstore/create-distribution-signing.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { credentialsFromEnv, ascGet, ascSend } from './asc-client.mjs';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const DIR = resolve(ROOT, 'secrets/dist');
const BUNDLE = 'ing.quran.app';
const PROFILE_NAME = 'Quran Ing App Store';
const REPO = 'killianche/quran-ing';
const GH = process.env.GH_BIN || '/root/.local/bin/gh';

const run = (cmd, args, input) => execFileSync(cmd, args, { input, encoding: 'utf8' });

mkdirSync(DIR, { recursive: true, mode: 0o700 });
const credentials = credentialsFromEnv();

// 1. Ключ и CSR
const keyPath = resolve(DIR, 'distribution.key');
const csrPath = resolve(DIR, 'distribution.csr');
run('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', keyPath, '-out', csrPath, '-subj', '/CN=Quran Ing Distribution/O=Quran Ing']);
chmodSync(keyPath, 0o600);
const csr = readFileSync(csrPath, 'utf8')
  .replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

// 2. Сертификат
const cert = await ascSend('POST', '/v1/certificates', {
  data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: csr } },
}, credentials);
const certId = cert.data.id;
const certDer = Buffer.from(cert.data.attributes.certificateContent, 'base64');
const certPem = `-----BEGIN CERTIFICATE-----\n${certDer.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
writeFileSync(resolve(DIR, 'distribution.pem'), certPem, { mode: 0o600 });
console.log(`✓ сертификат ${certId}: ${cert.data.attributes.name}, до ${cert.data.attributes.expirationDate}`);

// 3. .p12 — формат, который принимает `security import` на macOS
const password = randomBytes(24).toString('base64url');
const p12Path = resolve(DIR, 'distribution.p12');
run('openssl', ['pkcs12', '-export', '-inkey', keyPath, '-in', resolve(DIR, 'distribution.pem'),
  '-out', p12Path, '-passout', `pass:${password}`, '-name', 'Quran Ing Distribution',
  '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1']);
chmodSync(p12Path, 0o600);

// 4. Профиль App Store
const bundle = await ascGet('/v1/bundleIds', credentials, { 'filter[identifier]': BUNDLE });
const bundleId = bundle.data.find(b => b.attributes.identifier === BUNDLE)?.id;
if (!bundleId) throw new Error(`bundle ID ${BUNDLE} не зарегистрирован`);
const existing = await ascGet('/v1/profiles', credentials, { 'filter[name]': PROFILE_NAME });
for (const old of existing.data) {
  await ascSend('DELETE', `/v1/profiles/${old.id}`, undefined, credentials);
  console.log(`  удалён прежний профиль ${old.id}`);
}
const profile = await ascSend('POST', '/v1/profiles', {
  data: {
    type: 'profiles',
    attributes: { name: PROFILE_NAME, profileType: 'IOS_APP_STORE' },
    relationships: {
      bundleId: { data: { type: 'bundleIds', id: bundleId } },
      certificates: { data: [{ type: 'certificates', id: certId }] },
    },
  },
}, credentials);
const profileContent = profile.data.attributes.profileContent;
writeFileSync(resolve(DIR, 'QuranIng_AppStore.mobileprovision'), Buffer.from(profileContent, 'base64'), { mode: 0o600 });
console.log(`✓ профиль ${profile.data.id} «${PROFILE_NAME}», до ${profile.data.attributes.expirationDate}`);

// 5. Секреты GitHub — значения через stdin, не в аргументах командной строки
const setSecret = (name, value) => run(GH, ['secret', 'set', name, '-R', REPO], value);
setSecret('DIST_P12_BASE64', readFileSync(p12Path).toString('base64'));
setSecret('DIST_P12_PASSWORD', password);
setSecret('APPSTORE_PROFILE_BASE64', profileContent);
writeFileSync(resolve(DIR, 'p12-password.txt'), password + '\n', { mode: 0o600 });
console.log('✓ секреты DIST_P12_BASE64, DIST_P12_PASSWORD, APPSTORE_PROFILE_BASE64');
