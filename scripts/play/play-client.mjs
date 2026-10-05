/**
 * Клиент Google Play Developer API (androidpublisher v3) — без зависимостей.
 *
 * ── Что этим можно и чего нельзя ──────────────────────────────────────────
 *
 * МОЖНО: загружать AAB, раскладывать сборки по трекам (internal, alpha,
 * beta, production), править страницу магазина (тексты, значок, баннер,
 * скриншоты), контакты.
 *
 * НЕЛЬЗЯ: создать приложение в Play Console (только руками на сайте) и
 * заполнить анкеты раздела «Содержание приложения» — возрастной рейтинг,
 * целевую аудиторию, рекламу. Это делает владелец, ответы — PLAY_STORE.md.
 *
 * Пока приложение ни разу не опубликовано («черновик»), Google принимает
 * выпуски только со статусом `draft`: отправку на проверку владелец
 * нажимает в консоли, когда анкеты заполнены.
 *
 * ── Аутентификация ────────────────────────────────────────────────────────
 *
 * Сервисный аккаунт `quran-ing-publisher@xtrud-play.iam.gserviceaccount.com`
 * (проект Google Cloud владельца, решение 2026-10-05), доступ в Play Console
 * выдан ТОЛЬКО к Quran Ing. Ключ JSON — в `secrets/` (вне git), путь — в
 * PLAY_KEY_PATH (secrets/play.env). Отзывается в Google Cloud → IAM →
 * Service accounts → Keys.
 *
 * Токен OAuth выпускается по JWT (RS256), живёт час; здесь — один на запуск.
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const PACKAGE = 'ing.quran.app';
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;

const b64url = buf => Buffer.from(buf).toString('base64url');

let tokenCache = null;

/** OAuth-токен сервисного аккаунта со scope androidpublisher. */
export async function accessToken() {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const path = process.env.PLAY_KEY_PATH;
  if (!path) throw new Error('PLAY_KEY_PATH не задан — source secrets/play.env');
  const key = JSON.parse(readFileSync(path, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.private_key_id }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${b64url(signer.sign(key.private_key))}`;
  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`токен: ${res.status} ${JSON.stringify(body)}`);
  tokenCache = { token: body.access_token, exp: Date.now() + body.expires_in * 1000 };
  return tokenCache.token;
}

/** JSON-запрос к API. `path` — от `/applications/{package}`. */
export async function play(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`${method} ${path}: ${res.status} ${data.error?.message ?? text}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Загрузка файла. Большие (AAB ~170 МБ) — возобновляемой загрузкой: простая
 * одним запросом на таком размере обрывается чаще, чем хотелось бы.
 */
export async function upload(path, data, contentType) {
  const token = await accessToken();
  if (data.length < 8 * 1024 * 1024) {
    const res = await fetch(`${UPLOAD}${path}?uploadType=media`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      body: data,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`загрузка ${path}: ${res.status} ${body.error?.message ?? JSON.stringify(body)}`);
    return body;
  }
  const start = await fetch(`${UPLOAD}${path}?uploadType=resumable`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-upload-content-type': contentType,
      'x-upload-content-length': String(data.length),
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (!start.ok) throw new Error(`загрузка ${path}: начало ${start.status} ${await start.text()}`);
  const session = start.headers.get('location');
  const res = await fetch(session, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'content-length': String(data.length) },
    body: data,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`загрузка ${path}: ${res.status} ${body.error?.message ?? JSON.stringify(body)}`);
  return body;
}

/** Открыть правку (edit) — все изменения в Play идут внутри неё. */
export async function openEdit() {
  return (await play('POST', '/edits', {})).id;
}

/** Применить правку. `changesNotSentForReview` — не отправлять на проверку. */
export async function commitEdit(id, { sendForReview = true } = {}) {
  const q = sendForReview ? '' : '?changesNotSentForReview=true';
  return play('POST', `/edits/${id}:commit${q}`);
}

export async function deleteEdit(id) {
  try { await play('DELETE', `/edits/${id}`); } catch { /* правка могла истечь */ }
}
