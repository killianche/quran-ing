#!/usr/bin/env bash
# publish-site — выкладывает юридические страницы Quran Ing на GitHub Pages.
#
# Зачем отдельный публичный репозиторий: основной `killianche/quran-ing`
# приватный (в нём данные с неподтверждёнными лицензиями — тафсир Quran
# Foundation, ингушский перевод), а App Store требует публичные ссылки на
# политику конфиденциальности и поддержку. Бесплатный GitHub Pages работает
# только у публичных репозиториев, поэтому сайт живёт в `quran-ing-site`, и в
# нём нет ничего, кроме этих страниц.
#
# Источник истины — public/{privacy,support,terms}.html основного репозитория
# (те же страницы лежат в самом приложении). Сайт — их копия плюс
# scripts/site/index.html. Ссылки между страницами относительные, поэтому
# работают и в подпапке Pages, и в приложении.
#
# Адреса: https://killianche.github.io/quran-ing-site/{privacy,support,terms}.html
#
# Запуск:  bash scripts/site/publish-site.sh
# 🔴 Имена переменных только латиницей (CLAUDE.md, грабли № 15).

set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
site_repo="git@github.com:killianche/quran-ing-site.git"
work="$root/.site-publish"

if [ ! -d "$work/.git" ]; then
  git clone --quiet "$site_repo" "$work"
fi
git -C "$work" fetch --quiet origin
if git -C "$work" rev-parse --verify --quiet origin/main >/dev/null; then
  git -C "$work" checkout --quiet -B main origin/main
else
  git -C "$work" checkout --quiet -B main
fi

for page in privacy support terms; do
  cp "$root/public/$page.html" "$work/$page.html"
done
cp "$root/scripts/site/index.html" "$work/index.html"
# Без Jekyll: страницы отдаются как есть.
touch "$work/.nojekyll"

git -C "$work" add -A
if git -C "$work" diff --cached --quiet; then
  echo "Сайт уже актуален."
  exit 0
fi
source_rev="$(git -C "$root" rev-parse --short HEAD)"
git -C "$work" -c user.name="$(git -C "$root" log -1 --format=%an)" \
  -c user.email="$(git -C "$root" log -1 --format=%ae)" \
  commit --quiet -m "Обновить страницы из quran-ing@$source_rev"
git -C "$work" push --quiet origin main
echo "Выложено: https://killianche.github.io/quran-ing-site/"
