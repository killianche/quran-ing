/**
 * Проверка и сборка таблиц «страница мусхафа → первый аят».
 *
 * ── Зачем ─────────────────────────────────────────────────────────────
 *
 * `src/lib/mushafPages.ts` держит две таблицы по 604 числа: одну для
 * издания 1441 (QCF V4), другую для «Мадани 1405» (QCF V1). По ним
 * работают переход «открыть аят в мусхафе», автоперелистывание за аудио
 * и «вернуться к ленте».
 *
 * Издания расходятся: у 25 страниц первый аят разный, больше всего в
 * тридцатом джузе. Взять чужую таблицу — значит открыть страницу, на
 * которой искомого аята нет. Ничего не упадёт и не подсветится, поэтому
 * таблицы должны быть выводимы из данных, а не правиться руками.
 *
 * ── Что делает ────────────────────────────────────────────────────────
 *
 * Выводит обе таблицы из `public/qcf{1,4}/pages/*.json` и сверяет с тем,
 * что лежит в `src/lib/mushafPages.ts`. Расхождение — ошибка выхода 1.
 *
 * Сверка таблицы V4 здесь не формальность, а проверка самого способа
 * вывода: таблица V4 сделана раньше и другим путём (из
 * `public/qcf4/verses.json`). Если способ верен, он обязан её
 * воспроизвести — все 604 из 604. Только после этого можно доверять
 * таблице V1, у которой такой независимой сверки нет.
 *
 * ── Запуск ────────────────────────────────────────────────────────────
 *
 *   node --experimental-strip-types --import ./scripts/ts-resolve.mjs \
 *     scripts/gen/build-mushaf-page-index.mjs
 *
 *   ... --print v1     # напечатать таблицу V1 готовым куском кода
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globalAyahNumber } from '../../src/lib/ayahNumbering.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PAGES = 604;

/** Первый аят каждой страницы издания — сквозным номером. */
function deriveTable(dir) {
  const table = [];
  for (let page = 1; page <= PAGES; page++) {
    // Страницы V4 раздаются приложению (public/qcf4/pages); страницы V1 в
    // Quran Ing не раздаются — лежат в data/qcf1-pages только для сверок.
    const base = dir === 'qcf1' ? 'data/qcf1-pages' : `public/${dir}/pages`;
    const file = resolve(ROOT, `${base}/${String(page).padStart(3, '0')}.json`);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    let first = null;
    outer: for (const line of data.lines) {
      for (const word of line.words) {
        if (!word.verse_key) continue;
        const [surah, ayah] = word.verse_key.split(':').map(Number);
        first = globalAyahNumber(surah, ayah);
        break outer;
      }
    }
    if (first == null) throw new Error(`${dir}, страница ${page}: не нашлось ни одного аята`);
    table.push(first);
  }
  return table;
}

/** Таблица, как она сейчас лежит в коде. */
function tableFromSource(name) {
  const src = readFileSync(resolve(ROOT, 'src/lib/mushafPages.ts'), 'utf8');
  const head = `const ${name}: number[] = [`;
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`в mushafPages.ts нет таблицы ${name}`);
  // Отсчёт строго после открывающей скобки: в самом имени таблицы есть
  // цифра (`..._V1`), и она попала бы в результат лишним первым числом,
  // сдвинув всю таблицу на страницу.
  const from = start + head.length;
  const end = src.indexOf('];', from);
  return src.slice(from, end).match(/\d+/g).map(Number);
}

function compare(label, derived, current) {
  const bad = [];
  for (let i = 0; i < PAGES; i++) {
    if (derived[i] !== current[i]) bad.push(`  стр.${i + 1}: в коде ${current[i]}, из данных ${derived[i]}`);
  }
  if (bad.length === 0) {
    console.log(`  ${label}: совпадает, 604 из 604`);
    return true;
  }
  console.error(`  ${label}: расхождений ${bad.length}`);
  for (const line of bad.slice(0, 10)) console.error(line);
  return false;
}

function printable(table) {
  const rows = [];
  for (let i = 0; i < table.length; i += 20) rows.push('  ' + table.slice(i, i + 20).join(', ') + ',');
  return rows.join('\n');
}

const v4 = deriveTable('qcf4');
const v1 = deriveTable('qcf1');

const want = process.argv.indexOf('--print');
if (want > -1) {
  console.log(printable(process.argv[want + 1] === 'v4' ? v4 : v1));
  process.exit(0);
}

console.log('Сверка таблиц «страница → первый аят»:');
const okV4 = compare('издание 1441 (V4)', v4, tableFromSource('FIRST_AYAH_OF_PAGE'));
const okV1 = compare('издание 1405 (V1)', v1, tableFromSource('FIRST_AYAH_OF_PAGE_V1'));

let differ = 0;
for (let i = 0; i < PAGES; i++) if (v1[i] !== v4[i]) differ++;
console.log(`  издания расходятся на ${differ} страницах`);
if (differ === 0) {
  console.error('  ✗ издания обязаны расходиться — похоже, одни данные подменены другими');
}

process.exitCode = okV4 && okV1 && differ > 0 ? 0 : 1;
