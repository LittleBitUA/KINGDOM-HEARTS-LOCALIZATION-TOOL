# UI Redesign Spec — KH-style

Plan для повного візуального редизайну в стилі офіційного KH HD-лаунчера. Виконується **окремою задачею у власному branch**, поетапно з review після кожного stage.

## 🎨 Design language

Дві паралельні палітри (за функцією компонента):

### Gold/Black — для menu/launcher панелей
Використовується: header, toolbar, sidebar, file picker, primary buttons.

```
--kh-bg-deep:       #050505   (глибокий чорний фон)
--kh-bg-panel:      #0a0a0a   (панелі)
--kh-bg-elev:       #141414   (підняті елементи)
--kh-gold-primary:  #FFB300   (основний золотий)
--kh-gold-light:    #FFD75A   (світлий акцент / glow)
--kh-gold-dark:     #8C5A00   (темний gradient stop)
--kh-gold-border:   rgba(255, 179, 0, 0.55)
--kh-text-primary:  #fffaf0   (читабельний на темному)
--kh-text-muted:    #8a7a55   (приглушений)
--kh-glow-amber:    rgba(255, 215, 90, 0.5)
```

Reference: KH HD launcher screen, Game Settings menu.

### Red gradient — для модалів/тостів/повідомлень
Використовується: confirm dialogs, toasts, info popups, error banners.

```
--kh-red-top:    #8B1010   (top gradient)
--kh-red-bot:    #4A0808   (bottom gradient)
--kh-red-glow:   rgba(255, 80, 80, 0.4)
```

Reference: «Play KINGDOM HEARTS FINAL MIX?» QUESTION-popup screenshot.

---

## 📐 Stages (priority order)

### Stage 1 — Foundation
- [ ] Custom title bar (`frame: false` + кастомні мін/макс/закрити кнопки)
- [ ] Crown/heart pattern background SVG (faded watermark)
- [ ] CSS-токени для обох палітр
- [ ] KH-heart icon як logo (із [renderer/assets/kh-heart.png](renderer/assets/kh-heart.png))
- [ ] Drag-region на title bar
- [ ] Window state listener (для max/restore icon swap)

**Dependencies:** користувач має зберегти `kh-heart.png` (КH-heart іконка) у assets теці.

### Stage 2 — KH-style modals & toasts
- [ ] Replace `window.confirm()` на власний modal (червоний градієнт, pill buttons, glow indicator на selected)
- [ ] Toast component redesign — pill-shape, colored by type (info/success/warn/error), faded heart watermark в куті
- [ ] About dialog — як QUESTION-popup стиль
- [ ] Replace overlay (settings, replace, import) — gold-bordered cards з gold underline header

### Stage 3 — Glow buttons & inputs
- [ ] Primary buttons: rounded pill, gold-border default, full-gold-fill on hover/active, white text
- [ ] Secondary buttons: black background, gold border, hover = subtle gold glow
- [ ] Mode tabs (Editor/Translate/Kerning): pill з амбер glow-dot на active
- [ ] Inputs: dark з rounded gold border, focus = gold glow
- [ ] Animated progress bar: energy stripe gradient + subtle pulse

### Stage 4 — Glass panels & cards
- [ ] Toolbar: glass-effect (backdrop-filter: blur) + gold underline border
- [ ] Glossary cards: dark з subtle gold border + scale on hover
- [ ] Dashboard: revamped зі стилем Game Settings screen
- [ ] Footer / status bar: thin gold-bordered strip

### Stage 4.5 — Icon set + fonts (KH-style)

**Asset sources:**
1. https://www.kingdomhearts.com — офіційна навігація з білими line-art іконками
   (Crown, Heart-with-Key, Heart-outline, Heart-with-arrow, Mickey-head)
2. https://github.com/Televo/kingdom-hearts-recollection — fan-зроблений
   архів KH assets (no formal license, "credit appreciated"):
   - `Minimal/Config/` — корисні UI: Searching, Map, Emblem
   - `Fonts/` — оригінальні KH шрифти (для headers, button labels)
   - `Detailed/` — яскравіші art assets (декорація, не UI)
3. https://televo.github.io/kingdom-hearts-recollection/ — live preview сайт
   Televo: показує як assets виглядають у дії, темна тема, KH-typeface,
   приклади hover-ефектів та layout patterns.

**Стратегія:**
- **Шрифти** — взяти з Televo архіву (з кредитом). Підключити через `@font-face`
  для headers і кнопок. Залишити system font для body-text (читабельність).
- **Іконки** — recreate як inline SVG у line-art стилі kingdomhearts.com.
  Не bundling'ємо PNG-сетки (зайва вага), а малюємо SVG власноруч.
  Через `currentColor` + `fill: none` легко кастомізувати під будь-яку тему.

Власні inline-SVG в стилі:
- 1.5px stroke, white (`currentColor`), no fill
- 24×24px viewbox, scale ↔ font-size
- Простий геометричний характер (без деталей)

**Кандидати на іконки в нашому додатку:**
- 👑 Crown → Editor mode (king of editing)
- ⌨ Heart-with-key → Translate mode (UK = "key" to localization)
- 📐 Heart-with-compass → Kerning mode (font measuring)
- 🔨 Hammer → Build glossary
- 📥 Down-arrow → Import
- 📤 Up-arrow → Export
- 🔍 Magnifying glass → Search/Validate
- 🧹 Broom → Clean broken
- ⚙ Gear → Settings
- ⚡ Lightning → Compose ALL
- 💾 Disk → Save
- 🛡 Shield → Safe Mode

Замінити emoji на ці SVG (inline у HTML). Зберігається легкість стилізації
через `currentColor` + `fill: none`.

### Stage 5 — Decorative layer (polish)
- [ ] Animated star particles (CSS keyframes) на background
- [ ] Decorative SVG flourishes у кутах (corner ornaments)
- [ ] Faded crown/heart pattern (background-image SVG, 5% opacity)
- [ ] Soft radial gradients для глибини
- [ ] Smooth scroll з custom scrollbar (gold-themed)

### Stage 6 — Responsive
- [ ] Layout adapt для 1280×720 (мін.)
- [ ] 1600×900 (medium)
- [ ] 1920×1080 (large) — більше padding'у
- [ ] Sidebar може колапсуватись < 1100px
- [ ] Toolbar wrap → 3-row на дрібних екранах

### Stage 7 — Event log panel (опційно)
- [ ] Замінити стек тостів на постійну log-панель знизу/збоку
- [ ] Кожне повідомлення з timestamp та підсвічуванням за severity
- [ ] Можливість згорнути/розгорнути

---

## 🛠 Технічна стратегія

### Що НЕ змінюємо
- Всю IPC-логіку (main.js, preload.js, workers/)
- Codec, parsers (shared/, tools/lib/)
- Renderer state management і event handlers (renderer.js)
- ID-нейми DOM-елементів (бо renderer.js покладається на них)

### Що змінюємо
- `index.html` — додаємо нові wrappers, DECORATIVE elements, custom title bar
- `styles.css` — повністю переписуємо з новими токенами і компонентами
- Можливо: розділяємо styles.css на кілька (`tokens.css`, `components/buttons.css`, `components/modals.css` тощо) і імпортуємо з main `styles.css`

### Workflow
1. Створити branch `redesign-kh-style` з main
2. Stage 1 → commit → review → merge / iterate
3. Stage 2 → commit → review → merge / iterate
4. ...
5. Final merge у main + release v3.0.0

---

## 🚧 Risks & mitigation

| Ризик | Mitigation |
|---|---|
| Зламати робочі функції | Не чіпати renderer.js логіку, тільки CSS/HTML wrappers |
| Custom title bar bugs (drag/resize) | Тестувати на Win10/11, fullscreen, multi-monitor |
| Performance просідання від blur/animations | `prefers-reduced-motion` fallback, GPU-accelerated transforms only |
| User has saved settings/data — не зламати | Не торкаємося .json schema, settings, glossary store |

---

## 📦 Coverage estimate

- Stage 1: 4-6 годин
- Stage 2: 6-8 годин (модалі — багато overlay'ів треба замінити)
- Stage 3: 4-6 годин (кнопки/inputs — десятки місць)
- Stage 4: 4-6 годин
- Stage 5: 3-4 години (декор)
- Stage 6: 2-3 години (responsive tweaks)
- Stage 7: 4-6 годин

**Total:** 27-39 годин розробки + iterations.

---

## 🎯 Success criteria

Користувач відкриває програму і отримує відчуття:
- **«О, це справжній KH-tool, не technical hack»** — преміальний gold/black launcher feel
- **«Все там де я очікую»** — не зламано usability існуючих flow'ів
- **«Швидко й плавно»** — анімації не лагають, інтерфейс відчутно реагує
- **«Стильно»** — детальні декоративні елементи (corners, particles, glow) видають увагу до деталей

---

## 🙏 Credits для assets (Stage 4.5)

- **[Televo / kingdom-hearts-recollection](https://github.com/Televo/kingdom-hearts-recollection)** — KH-style fonts і icon inspiration. Fan-зроблений архів, без формальної ліцензії, "credit appreciated".
- **Square Enix / Disney** — original KH design language (наслідуємо стиль через fan-recreated assets, не використовуємо офіційні asset-файли).
