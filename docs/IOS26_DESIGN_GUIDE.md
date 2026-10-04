# Дизайн в стиле актуальной iOS (Liquid Glass) — инструкция для AI-агента

> **Кому:** AI-агенту, который проектирует или пишет интерфейс мобильного
> приложения. **Задача агента:** каждый экран, элемент, переход и
> всплывающее окно должны выглядеть и вести себя как в актуальной iOS.
> Все факты ниже сверены с первоисточниками Apple (HIG, документация API,
> сессии WWDC25, Newsroom) 2026-10-04. Где Apple числа не даёт — это
> сказано прямо; такие места не выдавать за правило Apple.

## 0. Главное правило

**Если у iOS есть родной компонент — бери его, а не рисуй свой.** Системные
панель вкладок, навигационная панель, тулбары, шторки, меню, поиск, кнопки
получают Liquid Glass, его анимации, доступность и поведение при настройках
пользователя **автоматически** — при сборке с актуальным SDK (Xcode 26+).
Своя копия всегда хуже: без преломления, без адаптации к фону, без реакции на
«Уменьшение прозрачности».

Порядок решения для любого элемента:
1. Есть системный компонент? → использовать его, **не перекрашивать фон и не
   менять материал** (кастомный `UIBarAppearance`/фон ломает стекло).
2. Нет — собрать из системных строительных блоков (`glassEffect`,
   `UIGlassEffect`, системные кнопки-стили).
3. Только если платформа не даёт нативного пути (веб, гибрид) — приближение
   по правилам раздела 9.

## 1. Какая это версия

- **Liquid Glass** — дизайн-язык Apple, анонсирован на WWDC25 (09.06.2025),
  вышел 15.09.2025 в **iOS 26**, iPadOS 26, macOS Tahoe 26, watchOS 26,
  tvOS 26. [Newsroom](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)
- Текущая система — **iOS 27** (14.09.2026): тот же Liquid Glass, плюс
  ползунок в Настройках «от ultraclear до fully tinted» и более чёткие иконки.
  [Newsroom](https://www.apple.com/newsroom/2026/09/major-updates-for-apples-software-platforms-are-now-available/)
- Поэтому в задачах писать: **«в стиле Liquid Glass, iOS 26+»**.

## 2. Принципы (HIG)

1. **Два слоя.** Внизу — контент (тексты, фото, карточки, списки). Над ним —
   слой навигации и управления (панели, кнопки, шторки).
2. **Стекло — только в слое навигации и управления.** «Don’t use Liquid Glass
   in the content layer» ([HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)).
   Карточки, ячейки, фоны экранов — **без** стекла. Для контента, если нужна
   подложка, — стандартные материалы (ultraThin / thin / regular / thick).
   Исключение: у слайдеров и переключателей стеклянным становится ползунок
   в момент касания.
3. **Не класть стекло на стекло.** Поверх стеклянного элемента — заливки,
   прозрачность, vibrancy, но не второе стекло ([WWDC25 «Meet Liquid Glass»](https://developer.apple.com/videos/play/wwdc2025/219/)).
4. **Варианты стекла:** `regular` — по умолчанию почти везде; `clear` —
   только поверх насыщенного фона (фото, видео), и на светлом фоне под него
   нужен затемняющий слой (~35 %).
5. **Цвет на стекле — скупо.** Тонировать только главное действие или статус;
   красить фон кнопки, а не символ; не тонировать сразу несколько контролов
   ([HIG Color](https://developer.apple.com/design/human-interface-guidelines/color)).
6. **Контент прокручивается ПОД плавающими панелями.** Там, где он уходит под
   панель, система рисует *scroll edge effect* — мягкое растворение/размытие
   (стили `soft` / `hard`), чтобы текст под панелью не мешал читать.
7. **Концентричность.** Скругления вложенных элементов повторяют скругление
   контейнера и углов экрана (`ConcentricRectangle`, `UICornerConfiguration`).
   Базовая форма управляющих элементов — капсула.
8. **Одно главное действие на экран.** Главное — prominent-стиль (заливка
   акцентом), остальное — обычные стеклянные кнопки.

## 3. Компоненты

**Панель вкладок (tab bar)**
- Плавает над контентом внизу на стекле. Иконки — SF Symbols: обычная
  вкладка — контур, выбранная — залитый вариант (`.fill`); подписи короткие.
- Поиск — отдельная вкладка с ролью search, система ставит её в конец
  (справа). (Роль есть с iOS 18.)
- При прокрутке панель может сворачиваться: `tabBarMinimizeBehavior`
  (`.onScrollDown` и т.д.; только iPhone).
- Мини-плеер и подобное — нижний аксессуар над панелью
  (`tabViewBottomAccessory` / `UITabBarController.bottomAccessory`).
- **Отступ панели от краёв экрана Apple числом не задаёт.** Встречающееся
  «21 pt» — замер сторонних авторов, не правило.
- Не задавать панели свой фон — это убивает стекло.

**Навигационная панель и тулбары**
- Панели прозрачные, кнопки — стеклянные круги/капсулы; система сама
  группирует соседние кнопки на общий стеклянный фон (не больше ~3 групп).
- Крупный заголовок (Large Title 34 pt) в начале экрана; при прокрутке он
  уходит, появляется компактный заголовок (`prefersLargeTitles`).
- Главное действие — одна prominent-кнопка справа. «Назад» — шеврон.
- Разделить группы: `ToolbarSpacer` (SwiftUI), `fixedSpace` / `hidesSharedBackground` (UIKit).

**Шторки (sheets)**
- Частичная высота: шторка отступает от краёв экрана и лежит на стекле;
  нижние углы повторяют скругление экрана. На полной высоте фон становится
  непрозрачным и прилегает к краям. Свой `presentationBackground` — убрать.
- Граббер, детенты (`.medium`, `.large`, свои доли), закрытие смахиванием.
- Список действий — action sheet / меню; подтверждение опасного действия —
  alert с destructive-кнопкой.

**Кнопки**
- Тап-таргет **не меньше 44×44 pt** ([HIG Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons));
  абсолютный минимум — 28×28 pt ([HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).
- Стили: `.glass` / `.glassProminent` (SwiftUI), `UIButton.Configuration.glass()`
  / `.prominentGlass()` (UIKit).
- Отклик на нажатие — мгновенный; лёгкий haptic на подтверждение действия.

**Списки и настройки** — inset grouped, как «Настройки» iOS: группы со
скруглением, плитки иконок, шеврон или галочка справа, разделитель начинается
от текста. Карточки списков — без стекла.

**Поиск** — системное поле поиска / вкладка поиска; на iPhone поле обычно
внизу, у панели.

## 4. Типографика

Шрифт системный — **SF Pro** (кириллица и латиница), с **Dynamic Type**:
размеры через text styles, без жёстких px/pt и без ограничения сверху.
Таблица по умолчанию (размер Large, [HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography)):

| Style | Размер, pt | Начертание |
|---|---|---|
| Large Title | 34 | Regular (emphasized — Bold) |
| Title 1 | 28 | Regular |
| Title 2 | 22 | Regular |
| Title 3 | 20 | Regular |
| Headline | 17 | Semibold |
| Body | 17 | Regular |
| Callout | 16 | Regular |
| Subheadline | 15 | Regular |
| Footnote | 13 | Regular |
| Caption 1 | 12 | Regular |
| Caption 2 | 11 | Regular |

Основной текст — 17 pt; минимум в интерфейсе — 11 pt.

## 5. Сетка и отступы

- Apple задаёт **safe areas, layout margins и стандартные отступы** и просит
  их не переопределять. **Сетки «8 pt» в HIG нет** — это индустриальная
  практика; можно использовать для своих отступов, но не ссылаться на неё как
  на правило Apple.
- Контент никогда не залезает под чёлку/Dynamic Island и домашний индикатор
  без нужды; плавающие панели — над контентом, а контент под ними получает
  отступ, чтобы последняя строка не пряталась.

## 6. Цвет и темы

- Системные и семантические цвета (`label`, `secondaryLabel`,
  `systemBackground`, `separator`, `tint`) — они сами меняются в тёмной теме
  и при «Повышенном контрасте». **Палитра системных цветов обновлена
  09.06.2025** (например, blue: светлая rgb(0,136,255), тёмная rgb(0,145,255));
  старые значения вроде `#007AFF` устарели.
- Свой фирменный цвет — один акцент (tint): выбранная вкладка, главные
  кнопки, переключатели. Для него обязательно задать светлый, тёмный вариант
  и вариант повышенного контраста. Контраст текста — не ниже 4.5:1.
- Обе темы проверяются обе — всегда.

## 7. Движение и тактильность

- Пружинные анимации (`.spring`, `.smooth`, `.snappy`, `.bouncy`), а не
  линейные. Стекло «перетекает» между состояниями: `GlassEffectContainer`,
  `glassEffectID(_:in:)`, `glassEffectUnion`. Точных параметров пружин для
  стекла Apple не публикует — брать системные пресеты.
- Haptics: `sensoryFeedback(_:trigger:)` / `UIFeedbackGenerator` — выбор,
  подтверждение, ошибка. Не на прокрутке; haptic никогда не единственный
  сигнал.
- **Reduce Motion** — обязателен: без пружин и масштабирования, короткие
  растворения.

## 8. Доступность — как ведёт себя стекло

- **Уменьшение прозрачности** — стекло становится матовым («frostier»).
- **Повышенный контраст** — элементы почти чёрные/белые с контрастной рамкой.
- **Уменьшение движения** — эффекты ослабевают, упругость выключается.
- У системных компонентов это работает само. У своих — надо повторить.
- Dynamic Type до самых крупных размеров: высоты — `minHeight`, а не `height`.
- Каждый экран определяет состояния: загрузка (скелетон, а не пустота),
  пусто, ошибка («Повторить»), офлайн.

## 9. Реализация по стекам

**SwiftUI (лучший путь — всё получает iOS-вид автоматически):**
`TabView` / `Tab`, `NavigationStack` + `.toolbar`, `.sheet` +
`presentationDetents`, `.buttonStyle(.glass / .glassProminent)`,
`glassEffect(_:in:)`, `Glass` (`.regular` / `.clear` / `.identity`,
`.tint`, `.interactive`), `GlassEffectContainer`, `glassEffectID`,
`scrollEdgeEffectStyle(_:for:)`, `safeAreaBar(...)`,
`backgroundExtensionEffect()`, `tabBarMinimizeBehavior`,
`tabViewBottomAccessory`, `ToolbarSpacer`, `ConcentricRectangle`.

**UIKit:** `UITabBarController` (`tabBarMinimizeBehavior`,
`bottomAccessory`), `UISearchTab`, `UIGlassEffect` в `UIVisualEffectView`,
`UIButton.Configuration.glass()` / `.prominentGlass()`,
`UIScrollView.topEdgeEffect` / `bottomEdgeEffect` (`UIScrollEdgeEffect.Style`:
`.automatic` / `.soft` / `.hard`), `UIScrollEdgeElementContainerInteraction`
(для своих панелей над скроллом), `UICornerConfiguration`,
`UIBarButtonItem.hidesSharedBackground`.

**React Native / Expo:** системные компоненты через нативные обёртки
(например, `NativeTabs` из expo-router — это настоящий `UITabBarController`;
`expo-glass-effect` — `GlassView`). Иконки вкладок — SF Symbols, не
картинки.

**Веб и гибриды (Capacitor, WKWebView, PWA):**
- Настоящее системное стекло рендерят **только нативные компоненты**. Для
  гибрида лучший путь — нативные панель вкладок/шторки поверх веб-вью
  (плагин), а не их CSS-копия.
- CSS-приближение там, где без него никак: `backdrop-filter: blur() saturate()`
  (+ `-webkit-backdrop-filter` для старых iOS) и полупрозрачная заливка;
  преломления, адаптации к фону и «перетекания» не будет.
- `prefers-reduced-transparency` в Safari/WKWebView **не поддерживается** —
  «Уменьшение прозрачности» узнаётся только через нативный мост
  (`UIAccessibility.isReduceTransparencyEnabled`). `prefers-contrast` и
  `prefers-reduced-motion` — поддерживаются, учитывать.
- Шрифт: `-apple-system, BlinkMacSystemFont, …` даёт SF Pro на устройствах
  Apple.

## 10. Иконка приложения

- Делается в **Icon Composer** (входит в Xcode 26+): слои, свет, стекло.
- Варианты: default, dark, clear (light/dark), tinted (light/dark). Макет
  1024×1024 без прозрачности для App Store.
- Иконки интерфейса — **SF Symbols** (на WWDC25 вышла SF Symbols 7; текущая
  загрузка на developer.apple.com/sf-symbols). Не смешивать SF Symbols с
  другим набором иконок в одном ряду.

## 11. Скиллы для Claude Code

- Скилл — это **каталог**: `~/.claude/skills/<имя>/SKILL.md` (личный) или
  `.claude/skills/<имя>/SKILL.md` (в проекте); вспомогательные файлы лежат
  рядом в том же каталоге ([документация](https://code.claude.com/docs/en/skills)).
- Сторонний скилл [apple-hig-designer-skill-2026](https://github.com/tristan-mcinnis/apple-hig-designer-skill-2026)
  (MIT) — **только как черновик**: в его README неверная установка (нужен
  каталог `~/.claude/skills/apple-hig-designer/` с `SKILL.md` и `references/`
  внутри), устаревшие системные цвета (`#007AFF`, ошибочный cyan), стекло на
  карточках (запрещено HIG) и «8 pt grid» как правило Apple. При расхождении
  прав этот документ и HIG.
- Официальный [frontend-design](https://github.com/anthropics/skills) от
  Anthropic тянет к «необычному» дизайну — для нативного вида iOS эталон
  HIG, а не он.

## 12. Чек-лист перед сдачей экрана

| Проверка | Требование |
|---|---|
| Компоненты | системные, где они есть; фон панелей не перекрашен |
| Стекло | только навигация/управление; нет стекла на стекле; нет стекла на карточках |
| Прокрутка | контент уходит под плавающие панели с edge-эффектом; последняя строка не прячется |
| Вкладки | SF Symbols, контур/залитый, короткие подписи, поиск — вкладкой справа |
| Заголовки | Large Title → компактный при прокрутке |
| Шторки | детенты, граббер, отступ от краёв на частичной высоте |
| Шрифт | SF Pro + Dynamic Type, основной текст 17 pt, минимум 11 pt |
| Кнопки | ≥ 44×44 pt, одно главное действие (prominent) |
| Цвет | семантические цвета, обе темы, акцент скупо, контраст ≥ 4.5:1 |
| Движение | пружины; Reduce Motion уважается |
| Доступность | Reduce Transparency, Increase Contrast, VoiceOver-подписи |
| Состояния | загрузка, пусто, ошибка, офлайн |

## 13. Источники

- Apple HIG: [Materials](https://developer.apple.com/design/human-interface-guidelines/materials),
  [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars),
  [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars),
  [Typography](https://developer.apple.com/design/human-interface-guidelines/typography),
  [Color](https://developer.apple.com/design/human-interface-guidelines/color),
  [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons),
  [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility),
  [App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)
- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass),
  [Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)
- WWDC25: [219 Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/),
  284 Build a UIKit app with the new design, 323 Build a SwiftUI app with the
  new design, 356 Get to know the new design system
- [Icon Composer](https://developer.apple.com/icon-composer/), [SF Symbols](https://developer.apple.com/sf-symbols/)
- [MDN backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter)
