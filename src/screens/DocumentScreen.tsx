/**
 * DocumentScreen — юридический документ внутри приложения.
 *
 * ── Почему iframe, а не ссылка в браузер ──────────────────────────────
 *
 * Документы лежат в пакете (`public/privacy.html`, `public/terms.html`),
 * поэтому открываются офлайн — в самолёте и в горах, как и всё
 * остальное.  Ссылка наружу требовала бы интернета и публичного адреса,
 * которого у проекта пока нет.
 *
 * iframe, а не вставка разметки в наш DOM: у документов своя типографика
 * и свои стили, и они должны остаться такими, какие есть.  Юридический
 * текст — не место для наших тем: он выглядит документом, и это
 * правильно.
 *
 * ── Зачем это Apple ───────────────────────────────────────────────────
 *
 * App Review требует, чтобы политика конфиденциальности была доступна.
 * Публичный URL для App Store Connect всё равно понадобится отдельно, но
 * доступность из самого приложения — то, что проверяют глазами.
 *
 * ── Типографика ───────────────────────────────────────────────────────
 *
 * Заголовок набран той же формой, что «Коран» и «Аккаунт»:
 * clamp(30px, 8vw, 40px) по серифу.  Раньше здесь стояла своя,
 * третья по счёту форма — clamp(22px, 6vw, 28px), — и переход из
 * «Аккаунта» в документ выглядел как переход в другое приложение.
 * Строка одна, с многоточием: «Политика конфиденциальности» в шапку не
 * влезает ни при каком кегле, поэтому в DOCS лежат короткие имена.
 */

import { ScreenHeader, screenHeaderOffset } from '../components/ScreenHeader';

export type DocumentId = 'privacy' | 'terms';

const DOCS: Record<DocumentId, { title: string; src: string }> = {
  privacy: { title: 'Конфиденциальность', src: '/privacy.html' },
  terms:   { title: 'Условия',            src: '/terms.html' },
};

export function DocumentScreen({ doc, onBack }: {
  doc: DocumentId;
  onBack: () => void;
}) {
  const meta = DOCS[doc];

  return (
    <div style={{
      height: '100dvh',
      display: 'flex', flexDirection: 'column',
      background: 'transparent',
    }}>
      {/* Документ — подробный экран: компактная шапка, как у вложенных
          экранов iOS, а не крупный заголовок над страницей документа. */}
      <ScreenHeader title={meta.title} onBack={onBack} />
      <div aria-hidden style={{ height: screenHeaderOffset(), flexShrink: 0 }} />

      <iframe
        src={meta.src}
        title={meta.title}
        style={{
          flex: 1, minHeight: 0, width: '100%',
          border: 'none',
          borderTop: '1px solid var(--hairline)',
          background: '#fafafa',
        }}
      />
    </div>
  );
}
