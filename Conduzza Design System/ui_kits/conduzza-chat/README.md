# UI kit — Conduzza Chat

A high-fidelity, click-through recreation of the Conduzza Chat product: the WhatsApp-native
service desk for medical clinics. Open `index.html` and navigate with the left rail.

## Files

| File | What's in it |
|---|---|
| `index.html` | Shell. Loads `styles.css`, the compiled `_ds_bundle.js`, then the screen files in order. |
| `data.jsx` | All mock data (fictional patients, leads, appointments, campaigns) published on `window`. |
| `app.jsx` | `App` — sidebar + top bar chrome, page routing, the notification toast. |
| `screens-operacao.jsx` | `ScreenInicio`, `ScreenAtendimento`, `ScreenLeads` |
| `screens-agenda.jsx` | `ScreenAgenda`, `ScreenPacientes`, `ScreenConfirmacoes`, `ScreenEspera` |
| `screens-inteligencia.jsx` | `ScreenResultados`, `ScreenIA`, `ScreenAutomacoes` |
| `screens-admin.jsx` | `ScreenCadastro`, `ScreenConfig` |

## The twelve pages

1. **Início** — the day in one screen: KPI tiles, conversations waiting on a human, the day's agenda, the lead funnel, an AI summary card.
2. **Atendimento** — three columns: inbox list (336px) · thread · patient context panel (320px). Inbound white, outbound lime, AI ink, internal notes amber.
3. **Leads** — Kanban across five stages with a list view behind the segmented control.
4. **Agenda** — hour grid, one column per professional, five booking states.
5. **Pacientes** — record table with reactivation KPIs.
6. **Confirmações** — the day's confirmation run: counts, second-reminder banner, filterable table.
7. **Lista de espera** — waiting patients by priority plus the open slots that can absorb them.
8. **Resultados** — the full dashboard: marketing, commercial funnel, confirmation, AI, Meta Ads table.
9. **Agente de IA** — identity, tone, instructions, capability switches, live preview, 30-day performance.
10. **Automações** — the four pre-defined flows (confirmação, pós-falta, follow-up, lista de espera) with the message editor.
11. **Cadastro** — professionals, procedures, health plans, opening hours, units.
12. **Configurações** — users, permissions matrix, WhatsApp connections, journey stages, etiquetas, Meta Ads.

## Rules this kit follows

- Every primitive comes from `window.ConduzzaDesignSystem_cea3ac` — nothing is re-implemented locally.
- One lime `primary` button per screen.
- Every figure, phone number, date and time uses `.cz-num` (mono + tabular).
- Portuguese (pt-BR) throughout, sentence case, 24h clock, `dd/mm/aaaa`, `R$ 1.234,56`.
- All names, numbers and clinics are fictional.
