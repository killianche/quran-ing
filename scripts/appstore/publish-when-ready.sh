#!/usr/bin/env bash
# Доводит выпуск до конца без участия человека:
#   1) ждёт, пока сборка обработается, и кладёт её в TestFlight;
#   2) ждёт, пока освободится очередь ревью, и отправляет версию в магазин.
#
# Два шага НАМЕРЕННО независимы. TestFlight не должен ждать очереди магазина:
# внутренним тестировщикам сборка доступна сразу после обработки, и владелец
# может смотреть правки, пока предыдущая версия ещё на проверке.
set -u
cd "$(dirname "$0")/../.."
# 🔴 Идентификаторы Apple НЕ в коде.
#
# 07.09.2026 репозиторий стал публичным ради снятия лимита минут Actions. До
# этого issuer id и key id лежали прямо здесь. Сами по себе они не пускают
# никуда — без приватного ключа .p8 подписать запрос нечем, а он в git не
# попадал ни разу, — но публиковать их незачем.
#
# Доступы теперь в secrets/asc.env: каталог целиком в .gitignore, там же лежит
# сам ключ. Образец — в secrets/README.md.
if [ -f secrets/asc.env ]; then
  # shellcheck disable=SC1091
  . secrets/asc.env
fi
: "${ASC_ISSUER_ID:?нет доступа к App Store Connect — создайте secrets/asc.env, образец в secrets/README.md}"
: "${ASC_KEY_ID:?нет ASC_KEY_ID — см. secrets/README.md}"
: "${ASC_KEY_PATH:?нет ASC_KEY_PATH — см. secrets/README.md}"
: "${ASC_APP_ID:?нет ASC_APP_ID — Apple ID приложения Quran Ing, см. secrets/README.md}"
[ "$ASC_APP_ID" != 6802455200 ] || { echo 'ASC_APP_ID указывает на an-Nur — нужен id Quran Ing' >&2; exit 1; }

# 🔴 Имена переменных здесь только латиницей.
#
# 06.09.2026 строка `нужная="$1"` дала «command not found», а `${нужная}` внутри
# node-скрипта — «bad substitution»: bash допускает в именах переменных только
# [A-Za-z_][A-Za-z0-9_]*. Номер сборки до attach-скрипта не доехал, тот взял
# «самую свежую обработанную» и положил в TestFlight сборку 15 вместо 16.
# Ошибка тихая: заголовки шагов печатались, выпуск завершился успешно.
# Имена функций кириллицей bash принимает — их не трогаем.
build="${1:?укажите номер сборки}"

обработана() {
  node --input-type=module -e "
import { credentialsFromEnv, appIdFromEnv, ascGet } from './scripts/appstore/asc-client.mjs';
const c = credentialsFromEnv();
// Точный фильтр по номеру: список без сортировки идёт в произвольном
// порядке, и с 32-й сборки нужная переставала попадать в первые двадцать.
const b = await ascGet('/v1/builds', c, { 'filter[app]': appIdFromEnv(), 'filter[version]': '${build}', limit: 5 });
const x = b.data.find(v => v.attributes.version === '${build}');
console.log(x ? x.attributes.processingState : 'нет');
" 2>/dev/null
}

for i in $(seq 1 30); do
  s="$(обработана)"
  echo "$(date +%H:%M:%S)  сборка ${build}: $s"
  [ "$s" = "VALID" ] && break
  sleep 60
done

node scripts/appstore/attach-testflight.mjs "$build" || echo "не удалось положить в TestFlight"

состояние() {
  node --input-type=module -e "
import { credentialsFromEnv, appIdFromEnv, ascGet } from './scripts/appstore/asc-client.mjs';
const c = credentialsFromEnv();
const vs = await ascGet('/v1/apps/' + appIdFromEnv() + '/appStoreVersions', c, { limit: 1 });
console.log(vs.data[0].attributes.versionString + ' ' + vs.data[0].attributes.appStoreState);
" 2>/dev/null
}

for i in $(seq 1 60); do
  s="$(состояние)"
  echo "$(date +%H:%M:%S)  верхняя версия: $s"
  case "$s" in
    *WAITING_FOR_REVIEW|*IN_REVIEW|*PENDING_DEVELOPER_RELEASE) sleep 300 ;;
    *) echo "очередь свободна — отправляю"; npm run asc:submit -- --submit 2>&1 | tail -8; exit 0 ;;
  esac
done
echo "очередь так и не освободилась — TestFlight обновлён, магазин отправлю следующим заходом"
