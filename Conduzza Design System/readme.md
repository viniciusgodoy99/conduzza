# Conduzza Design System

The design system for **Conduzza Chat** — a WhatsApp-native service desk for medical clinics in Brazil.
One team, one inbox: leads arrive from Meta Ads and WhatsApp, an AI agent answers first, the human team
takes over when it matters, and every appointment gets confirmed, rescheduled or back-filled automatically.

Everything in this repository is derived from material the client supplied. Nothing about the brand was invented.

---

## Sources

| Source | What it gave us |
|---|---|
| `uploads/LOGO-BG-VERDE.png`, `LOGO-BG-ESCURO.png`, `LOGO-BG-BRANCO.png`, `SIMBOLO-ESCURO.png`, `ASSET CONDUZZA.png` | The symbol in four grounds. Brand lime `#b2e54f`, brand ink `#051813` and brand cream `#fbfce8` were **sampled pixel-exact** from these files. |
| `uploads/LOGOMARCA CONDUZZA.png`, `LOGO-SEM-FUNDO-V3.png` | The horizontal lock-up. The wordmark exists **only in cream** — there is no dark-ink wordmark file. |
| `uploads/Behance_3_Projetos_Imagens/` (3 reference projects: *Veri Health App*, *Eduzy EdTech*, *AI Finance Management / Fynix*, all credited to RondesignLab) | Stylistic reference chosen by the client: warm-grey canvases with white cards, 16px squircles, low soft shadows, lime-on-ink accents, dense data tables, mono numerals, and the "one saturated colour, everything else quiet" discipline. **These are mood reference, not Conduzza product screens.** |
| Product brief (chat) | The twelve pages of the product: Início, Atendimento, Leads, Agenda, Paciente, Confirmações, Lista de espera, Resultados, Agente de IA, Automações, Cadastro, Configurações. |

**No codebase, Figma file or existing product screenshots were provided.** The UI kit is therefore an
original construction from the brief plus the brand assets — not a recreation of a live interface.
If a real Conduzza Chat codebase or Figma file exists, attach it and the kit should be re-derived from it.

---

## Index

```
styles.css              ← the only file consumers link
tokens/                 fonts · colors · typography · spacing · radius · elevation · motion · base
assets/                 the supplied logo files, copied verbatim
guidelines/             foundation specimen cards (Design System tab)
components/             core · forms · navigation · data · feedback · chat · scheduling
ui_kits/conduzza-chat/  the twelve product screens, click-through
thumbnail.html          homepage tile
SKILL.md                Agent Skills entry point
```

### Components

**core/** — `Icon`, `Button`, `IconButton`, `Badge`, `Tag`, `Avatar`, `Card`, `StatCard`
**forms/** — `Input`, `Select`, `Textarea`, `Checkbox`, `Switch`, `SearchField`, `SegmentedControl`, `Dropdown`
**navigation/** — `SidebarNav`, `TopBar`, `Tabs`, `PageHeader`
**data/** — `DataTable`, `ProgressBar`, `BarChart`, `DonutChart`, `EmptyState`
**feedback/** — `Modal`, `Banner`, `Toast`, `Tooltip`
**chat/** — `ChatBubble`, `ConversationItem`, `Composer`, `KanbanCard`
**scheduling/** — `AppointmentCard`

Each directory carries a `@dsCard` HTML thumbnail; each component has a `.d.ts` props contract and a
`.prompt.md` with a one-line "what & when" plus a usage example.

### Intentional additions

No source defined a component inventory, so the set above was authored from the product brief.
Three entries go beyond a generic kit and exist because the product cannot be drawn without them:
`ChatBubble`/`ConversationItem`/`Composer` (Atendimento), `KanbanCard` (Leads), `AppointmentCard` (Agenda).
`BarChart` and `DonutChart` are CSS-only stand-ins so Resultados can be mocked without a charting library.

### UI kit

`ui_kits/conduzza-chat/` — see its own `README.md`. Entry point: `index.html`.

---

## CONTENT FUNDAMENTALS

Conduzza Chat is used by clinic receptionists under pressure, between phone calls. Copy is written
for that person: short, in Brazilian Portuguese, and never in the way.

**Language.** Portuguese (pt-BR) everywhere in the product. English appears only in this design system's
documentation. Never mix the two in the interface.

**Person.** The product addresses the operator as **você**, implicitly — usually by dropping the pronoun
entirely. Conduzza never says "eu" or "nós" in the interface; it is a tool, not a personality.
The *agente de IA* is the one exception: inside a conversation it speaks as the clinic, in first person plural
("Atendemos sim!", "Consigo te encaixar na quinta"), because the patient is talking to the clinic, not to software.

**Casing.** Sentence case for everything — titles, buttons, labels, menu items. `Disparar lembretes`,
not `Disparar Lembretes`. ALL CAPS is reserved for the 10px eyebrow (`--text-eyebrow`, `0.14em` tracking):
section context, table column heads, KPI labels. Nothing else is ever uppercase.

**Verbs, not nouns, on buttons.** `Disparar lembretes`, `Oferecer vaga`, `Publicar alterações`,
`Transferir atendimento`. Never `Envio`, `Ação`, `OK`, `Submit`.

**Numbers are facts, so they are quiet and exact.** Always pt-BR format: `1.248`, `87,2%`, `R$ 1.234,56`,
`22/09/2026`, `14:32` (24h, never AM/PM). Always mono + tabular (`.cz-num`). Never round a real figure
to look nicer. Deltas carry a sign and a direction icon: `+12,4% ↗`.

**Tone by situation.**
- *Neutral state* — a plain statement of fact. "19 confirmações ainda sem resposta."
- *Good news* — factual, never celebratory. "Lembretes disparados · 128 pacientes notificados." No confetti, no exclamation marks in system copy.
- *Problem* — say what broke, when, and what to do. "WhatsApp desconectado. Mensagens não estão sendo enviadas desde 09:14." Then a single fix button. Never apologise ("Ops!", "Desculpe"), never blame the user.
- *Empty* — say what would be here and offer the one action that fills it. "Ninguém na lista de espera. Pacientes sem horário adequado aparecem aqui automaticamente."
- *Destructive* — name the consequence in the title. "Cancelar consulta?" / "O paciente recebe um aviso no WhatsApp."

**Hints teach, they don't scold.** `Variáveis disponíveis: {primeiro_nome}, {profissional}, {data}` —
not `Você esqueceu de preencher`.

**Emoji.** Not used in the product chrome — no emoji in labels, buttons, headings, empty states or
system messages. Emoji **are** used inside message content and quick replies, because that is how
Brazilian clinics actually write on WhatsApp: `Bom dia! 👋`, `Obrigada! Até quinta então 😊`.
That is the only place they may appear.

**Vocabulary (fixed — never paraphrase).**
Atendimento · Conversa · Etiqueta · Etapa da jornada · Lead · Paciente · Confirmação · Encaixe ·
Lista de espera · Agente de IA · Automação · Unidade · Profissional · Procedimento · Convênio.
Confirmation statuses are always exactly: **Confirmado · Aguardando · Cancelado · Faltou · Remarcado**.

**Length.** Page descriptions max one sentence (~14 words). Tooltips under five words, no full stop.
Toasts: a four-word title plus one clause.

---

## VISUAL FOUNDATIONS

The whole system is built from one idea already present in the logo: **a soft-cornered square, cut open
so light gets through.** Everything is squircles, hairlines and a single loud colour.

### Colour

Three brand primitives, sampled from the supplied files, never adjusted:
lime `#b2e54f` · ink `#051813` · cream `#fbfce8`.

Around them: a 10-step lime ramp, an 11-step **green-black** ink ramp (never neutral grey — the ink
carries a cool green cast so it sits under the lime instead of fighting it), and four warm paper
neutrals for the canvas.

- **Lime is the only saturated colour on screen.** It marks exactly one thing per view: the committing
  action, the current nav item, the highlighted KPI, the outbound message. If two things are lime, one is wrong.
- **Semantics are deliberately desaturated** (`#2f9e5b`, `#d9962a`, `#d4553d`, `#4785b5`) so status never
  out-shouts the lime.
- **Text on lime is always ink** (8.9:1). **Lime as text on white is always `--cz-lime-700`** (`#5d8515`) —
  the 400 step fails contrast and must never carry type.
- The dark scope is a class, not a media query: `.cz-dark` re-points every semantic alias, so the same
  component renders correctly on the sidebar, in a toast, or inside `<Card tone="inverse">`.

### Type

**Manrope** (400–800) for everything, **JetBrains Mono** (400–600) for every figure.
Manrope is a *substitution* — see the flag below.

Display sizes are tight: `-0.035em` at 72px, `-0.03em` at 48px. Headings step 24 / 19 / 16px only.
Body is 14px; 13px in dense chrome; 12px labels; 11px captions; 10px eyebrow at `0.14em`.
Numerals are always mono and tabular so table columns and stacked KPIs align optically.

### Space and layout

4px base; 8 / 12 / 16 carry the product. Fixed layout constants: sidebar 248px (64px collapsed),
top bar 60px, inbox list 336px, context panel 320px, page gutter 24px, content max 1240px.
Controls are 30 / 36 / 44px tall.

Layout rules: the sidebar and top bar are **always fixed**; only the page body scrolls. Atendimento is
the only three-column screen. Tables scroll inside their card with a sticky header — the page never
scrolls a table header out of view.

### Corners, borders, shadows

Radii are squircle-derived from the mark and generous: 6 / 8 / 10 (controls) / 12 / 16 (**every card**) /
18 (chat bubbles) / 20 / 28 / pill. Nothing is ever square-cornered except the 7px etiqueta chip,
which is deliberately 2px-cornered so it reads as data rather than as a pill.

Borders are hairlines at 8% / 12% / 22% ink — never a solid grey line. **A card gets one border and one
low shadow, never two elevation cues.** Shadows are wide, low-opacity and green-tinted (`rgba(5,24,19,…)`),
never neutral grey and never dark: `xs` for controls, `sm` for resting cards, `md` for hover,
`lg` for modals, `pop` for menus and toasts, `accent` (lime-tinted) only under a lime KPI tile.
There are no inner shadows anywhere; sunken surfaces are expressed with `--surface-sunken`, not with an inset.

### Backgrounds and imagery

No gradients, no textures, no patterns, no hand-drawn illustrations, no stock photography.
The canvas is flat warm paper; cards are flat white; the sidebar is flat ink. Full-bleed colour is
allowed exactly twice: the ink sidebar, and at most **one** lime block per screen.
The brand symbol is the only graphic; it is placed, never redrawn.
(The Behance references use grainy dark renders — that language belongs to their brands, not to Conduzza,
and was deliberately not carried over into a clinical operations tool.)

### Transparency and blur

Used sparingly and only for layering: the modal scrim (`rgba(5,24,19,.42)` + 3px blur) and the alpha
borders/fills inside `.cz-dark`. Never frosted glass on cards, never blurred panels in the product body.

### Motion

Short and confident. 90ms press · 140ms hover and focus · 200ms menus and toggles · 320ms toasts and bars.
Easing is `cubic-bezier(.2,0,0,1)` in, `cubic-bezier(.16,1,.3,1)` out. **Nothing bounces, nothing
overshoots, nothing spins except a loading glyph.** Toasts rise 12px and fade; menus drop 4px and fade;
modals rise 10px with a 0.985 → 1 scale. All of it collapses to 0ms under `prefers-reduced-motion`.

### States

- **Hover** — one step *darker* on filled surfaces (lime-400 → lime-500), a faint ink-050 wash on ghost
  controls, `--shadow-sm` → `--shadow-md` plus a 1px lift on interactive cards. Never an opacity change.
- **Press** — `scale(.975)` on buttons, `scale(.94)` on icon buttons, held at the hover colour. No colour flash.
- **Focus** — `--focus-ring`: a 3px `rgba(178,229,79,.55)` halo, plus a lime border on fields. Keyboard focus
  is always visible; it is never removed.
- **Selected** — lime-050 fill plus a 2px lime left edge (nav, conversation rows, table rows).
- **Disabled** — 45% opacity and `not-allowed`. Never grey out by changing the colour.

### Iconography

See **ICONOGRAPHY** below.

---

## ICONOGRAPHY

**The client supplied no icon set, icon font or SVG sprite** — only logo files. Flagged substitution:
the system uses **Lucide 0.544** from CDN (`unpkg.com/lucide-static@0.544.0/icons/<name>.svg`).
Lucide was chosen because its 2px stroke, 24px box and rounded joins match the geometry of the Conduzza
symbol; a thinner or filled set would read as a different brand.

- **One primitive, always.** `<Icon name="calendar-check" />`. It fetches the Lucide SVG once, caches it,
  and **inlines it as real SVG**, so icons inherit text colour (`stroke="currentColor"`), work unchanged
  inside `.cz-dark`, and survive rasterisation to PNG/PDF. Never `<img>` a Lucide file directly, and never
  paint one as a remote CSS `mask` — both lose colour inheritance or break in export.
- **Sizes:** 11–13px inside badges and chips · 14–15px in dense chrome · 16–18px default · 20px nav · 24px feature.
- **Outline only.** No filled variants, no duotone, no colour-in-icon. Colour comes from the surrounding text token.
- **Never decorative.** Every icon either labels an action (with a `Tooltip` or `aria-label`) or reinforces
  a KPI/status that is also written in words. Icon-only buttons always carry `label`.
- **No emoji as icons. No unicode glyphs as icons.** (Emoji live only in message content — see Content Fundamentals.)
- **Do not hand-draw SVG.** If a needed glyph is missing from Lucide, pick the nearest Lucide name and
  note the compromise rather than inventing a shape.
- **Third-party marks** (WhatsApp, Meta, Instagram) are referenced by their brand colour token
  (`--cz-whatsapp`, `--cz-meta`, `--cz-instagram`) on a neutral glyph — the official logos were not supplied
  and are not reproduced.

---

## FLAGGED SUBSTITUTIONS — please send the real files

1. **Typeface.** The wordmark is a custom rounded-geometric lowercase face with a distinctive cut `zz`.
   No font files were supplied, so the system substitutes **Manrope** (Google Fonts) — the closest available
   match in weight, roundness and geometric proportion. Send the real brand font and
   `tokens/fonts.css` + `tokens/typography.css` are the only files that need to change.
2. **Icons.** Lucide 0.544, as described above.
3. **Light-ground wordmark.** Only cream wordmark artwork exists. On light grounds the system pairs the
   dark symbol with the name set in Manrope 800 at `-0.04em` (see the *Lock-up* card). An official
   ink-coloured wordmark file would replace that construction.
4. **Photography.** None supplied; none used. Avatars fall back to initials on deterministic brand tints.

---

## Using this system

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
<script type="text/babel">
  const { Button, Card, DataTable } = window.ConduzzaDesignSystem_cea3ac;
</script>
```

Style through the CSS custom properties — never hard-code a hex that is not in `tokens/colors.css`.
