#!/usr/bin/env bash
# Ждёт, пока освободится очередь ревью, и отправляет готовую версию сам.
#
# Apple держит на проверке одну версию за раз. Пока предыдущая в очереди,
# следующую нельзя даже создать — поэтому вместо ручного «посмотри и отправь»
# ждём смены состояния и отправляем.
#
# Останавливается сам: и по успеху, и по исчерпании попыток.
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

состояние() {
  node --input-type=module -e "
import { credentialsFromEnv, appIdFromEnv, ascGet } from './scripts/appstore/asc-client.mjs';
const c = credentialsFromEnv();
const vs = await ascGet('/v1/apps/' + appIdFromEnv() + '/appStoreVersions', c, { limit: 1 });
console.log(vs.data[0].attributes.versionString + ' ' + vs.data[0].attributes.appStoreState);
" 2>/dev/null
}

# 🔴 Попыток 300, а не 40, и это не «на всякий случай».
#
# 40 попыток по 5 минут — это 3.3 часа. Хватает, когда предыдущая версия
# вот-вот выйдет, и не хватает, когда Apple держит её сутки. 09.09.2026 так и
# случилось: сборка 30 легла в TestFlight, а версия 2.4 осталась
# неотправленной — 2.3 всё ещё висела в WAITING_FOR_REVIEW, и ожидание
# кончилось раньше очереди. 300 попыток — это сутки с четвертью, то есть
# обычный срок проверки Apple с запасом.
for i in $(seq 1 300); do
  s="$(состояние)"
  echo "$(date +%H:%M:%S)  верхняя версия: $s"
  case "$s" in
    *WAITING_FOR_REVIEW|*IN_REVIEW|*PENDING_DEVELOPER_RELEASE)
      sleep 300 ;;
    *)
      echo "очередь свободна — отправляю"
      npm run asc:submit -- --submit 2>&1 | tail -8
      exit 0 ;;
  esac
done
echo "очередь не освободилась за сутки — отправить вручную: npm run asc:submit -- --submit"
