/**
 * CosmicLayer — фон темы «Аврора».
 *
 * Один слой: <Aurora> в режиме рамки — слабое живое свечение по краям
 * экрана и чистый центр. Рамка медленно дышит, одна рассеянная волна
 * обходит периметр. При reduced-motion/Save Data сцена статична.
 *
 * Звёздное поле (<CosmicWarp>, 3D-пролёт на canvas) было убрано:
 * в кадре постоянно шло движение, а тут подолгу читают длинные
 * тексты, и мельтешение на периферии зрения мешает.  Заодно ушёл
 * canvas с rAF-циклом — минус постоянная нагрузка на слабых
 * телефонах и минус расход батареи при чтении.
 *
 * `isolation: isolate` + `contain: paint` держат дерево композитинга
 * внутри этого слоя — без них iOS Safari перекомпоновывает страницу на
 * каждом тике скролла и текст выше начинает дёргаться.
 *
 * У первой «Авроры» прозрачный световой слой лежит поверх интерфейса:
 * так кромка остаётся видна и на карточках, и на панелях. Сам слой
 * полностью пропускает касания. «Аврора 2» остаётся обычным фоном.
 *
 * Рендерится только когда активна тема «Аврора» — гейт стоит выше, в
 * App.tsx (`themeMode(theme) === 'cosmic'`).  На светлой и тёмной
 * компонент просто не монтируется: ни fade, ни затрат на DOM.
 *
 * Отличие от прежнего QuranIng: там сцена собиралась из восьми localStorage-
 * префов (режим звёзд, скорость, плотность, палитра, направление,
 * яркость…).  Здесь не настраивается ничего: константы приезжают
 * из AURORA_SCENE.
 */

import { useEffect, useState } from 'react';
import { Aurora } from './Aurora';
import { CosmicWarp } from './CosmicWarp';
import {
  auroraPaletteById, onAuroraPaletteChange, readAuroraPalette,
  AURORA_SCENE, AURORA2_SCENE, COSMOS_SCENE,
} from '../lib/cosmic';

export function CosmicLayer({ variant = 'aurora' }:
  { variant?: 'aurora' | 'aurora2' | 'cosmos' }) {
  // 🔴 «Космос» — это звёзды, а не свет.
  //
  // Две «Авроры» отличаются только палитрой и направлением сияния, поэтому
  // делят один слой. У «Космоса» другая природа сцены: чёрное небо и летящие
  // звёзды на canvas, без градиентов. Поэтому он выходит здесь, до всей
  // палитровой машинерии, — иначе пришлось бы протаскивать через неё вариант,
  // которому она не нужна.
  //
  // Возвращён 07.09.2026 по просьбе владельца: тема была и её убрали
  // 09.08.2026 вместе с `CosmicWarp.tsx`. Сам компонент восстановлен из
  // истории без правок — он уже умеет и `prefers-reduced-motion` (статичное
  // поле без цикла кадров), и паузу в скрытой вкладке.
  if (variant === 'cosmos') {
    return (
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          // Под содержимым, как у «Авроры 2»: звёзды — фон, а не плёнка
          // поверх интерфейса.
          zIndex: 0,
          pointerEvents: 'none',
          isolation: 'isolate',
          contain: 'paint',
          transform: 'translateZ(0)',
          willChange: 'transform',
          background: '#000',
        }}
      >
        <CosmicWarp speed={COSMOS_SCENE.starsSpeed} />
      </div>
    );
  }

  // Какая из двух космических тем сейчас: ледяная рамка по краям или
  // зелёное пятно из центра.  Всё различие сводится к палитре и сцене —
  // сам слой один и тот же.
  const second = variant === 'aurora2';
  // Цвет сияния теперь выбирает человек; тема задаёт только направление
  // (рамка против лучей) и яркость, см. AURORA_SCENE.
  const [paletteId, setPaletteId] = useState(() => readAuroraPalette(variant));
  useEffect(() => setPaletteId(readAuroraPalette(variant)), [variant]);
  useEffect(() => onAuroraPaletteChange(() => setPaletteId(readAuroraPalette(variant))), [variant]);

  const palette = auroraPaletteById(paletteId);
  const scene = second ? AURORA2_SCENE : AURORA_SCENE;

  // Проецируем палитру сияния на CSS-переменную караоке-подсветки,
  // чтобы активное слово загоралось тем же цветом, что и небо.
  // Правило в index.css падает на нейтральное свечение, когда
  // переменной нет (светлая и тёмная темы), так что «расстилизация»
  // происходит сама собой при размонтировании слоя.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--ayah-word-shadow',
      palette.wordShadow,
    );
    return () => {
      document.documentElement.style.removeProperty('--ayah-word-shadow');
    };
  }, [palette]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        // Первая Аврора — именно свет на стекле поверх интерфейса.
        // Вторая остаётся под контентом и не меняет прежний характер.
        zIndex: second ? 0 : 900,
        pointerEvents: 'none',
        isolation: 'isolate',
        contain: 'paint',
        transform: 'translateZ(0)',
        willChange: 'transform',
        // Нельзя поднимать непрозрачную чёрную канву вместе со светом:
        // она закрыла бы интерфейс. Чёрный фон первой темы уже задаёт
        // --canvas, здесь поверх остаются только прозрачные градиенты.
        background: second ? '#000' : 'transparent',
      }}
    >
      <Aurora
        brightness={scene.auroraBrightness}
        direction={scene.auroraDirection}
        palette={palette}
      />
    </div>
  );
}
