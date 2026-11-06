# QA-план: баги диалогов и арт (task-40, prep)

Дата: 2026-11-06. Статус: мерж task-36/37/38/39 в процессе (sim dlc.ts, UI DialogueOverlay/fullgame-panels, data dialogues/quests только что обновлены; typecheck временно красный — ожидаемо). QA подготовил репро-инструмент, e2e-регрессии и план.

## 1. Артефакты QA
| Артефакт | Назначение |
|---|---|
| `tools/dialogue-bugs.mjs` | headless-репро: повтор сцены после завершения/поверх активной, endDlcDialogue, выборы (флаги/реп/Q2/Q5/Q6), кампанийные диалоги, арт 4×6 |
| `apps/web/e2e/dlc-dialogues-bugs.spec.ts` | UI-регрессии: X не оставляет active; повтор после завершения; модалка события не поверх диалога и не копится; new game сбрасывает dismissed/seen; выборы Q1; save/load mid-dialogue |
| `tools/dlc-validate.mjs` | + арт 4×6 эмоций (24 PNG) — обновить после task-39 |
| `docs/acceptance.md §24` | приёмка багфикса диалогов/арта с доказательствами |
| gift + `tools/verify-portable.mjs` | пересборка после мержа, file:// проверка |

## 2. Подтверждённые баги на текущем HEAD (до мержа)
**B1. Повтор dlg_q1_briefing после завершения** — `dlc_dialogue_start` проходит после completed Q1 (`{ok:true}`), сцена открывается заново. Ожидание: отказ («диалог уже завершён»), no replay one-shot.
**B2. Повторный старт поверх активного диалога** — `dlc_dialogue_start` перезапускает сцену (node сбрасывается, `dialogue_interrupted+1`). Ожидание: отказ, активный диалог не перезаписывается.
**B3. Закрытие X не завершает диалог в sim** — UI close: `setHidden(true); dismissedScenes.add(scene)`, `endDlcDialogue` не вызывается → `fg.dlc.dialogue.active===true` остаётся (e2e падает). Ожидание: X → endDlcDialogue, active=false, игра продолжается.
**B4. Модалка события поверх диалога** — `FullGameOverlays` рендерит `narrative-event` независимо от активного диалога; `setNarrativeModalOpen(!!event)` ставит паузу. Ожидание: приоритет диалога; событие ждёт, после закрытия появляется ровно один раз (без накопления).
**B5. new game не сбрасывает dismissed/seen** — `dismissedScenes` — module-level Set; повторная новая игра в той же странице не открывает story-сцену. Ожидание: новый мир/seed сбрасывает dismissed/seen/auto-open маркеры.
**B6. Кампанийные диалоги отсутствуют** — 0 mission/branch ссылок на диалоги; 3 DLC-сцены (briefing/station/svet) не меняют campaign flags/branch/ending. Ожидание: 2–3 сюжетных диалога, влияющих на ветку/флаги/концовку.
**B7. Выборы Q1 → Q5/Q6/награды** — Q2 открывается во всех ветках (PASS), флаги/репутация различаются; Q5 гейт `requiresQuest q_pro_04`, Q6 `signal` — от выборов не зависят; награды Q2 статичны. Ожидание: выборы Q1 меняют Q5/Q6 доступность/цену и награды (по 14e §5).
**B8. Арт** — 2 персонажа ×6 = 12 PNG; нужно 4×6=24 (task-39).
**B9. typecheck красный во время мержа** — `DlcDialogueState.context` отсутствовал в `startDlcDialogue` (sim-engineer пишет); проверить после мержа.

## 3. Матрица task-40 → проверки
| Требование | Проверка |
|---|---|
| повтор dlg_q1_briefing после завершения не запускается | dialogue-bugs (B1), e2e test 2 |
| закрытие X не оставляет active | e2e test 1 (active=false), dialogue-bugs endDlcDialogue |
| narrative-event/модалки не поверх диалога и не копятся | e2e test 3 (инъекция pending, 1 событие, dismiss) |
| выборы Q1 видны и меняют Q2/Q5/Q6/награды/репутацию | dialogue-bugs сценарии 3 веток; e2e test 5; после мержа — проверка Q5/Q6 |
| 2–3 сюжетных диалога кампании меняют flags/ветку/концовку | dialogue-bugs (campaign refs), e2e после появления сцен |
| new game сбрасывает dismissed/seen | e2e test 4 |
| save/load mid-dialogue | dialogue-bugs + e2e test 6 + dlc-test |
| арт 4×6 эмоций | dlc-validate (24 PNG, размеры, бюджет) + скриншоты |
| полный e2e | 37+ тестов solo, workers=1 |

## 4. E2E-инъекция события (для B4)
```js
const fg = g.world.fg;
fg.narrative.pending.push({ id: "qa_event", titleRu: "QA", textRu: "…", chainId: "qa", step: 1, expiresTick: 999999, choices: [] });
g.refresh?.({});
```
Ожидание: пока dialogue-overlay видим → narrative-event отсутствует; после dialogue-close → ровно 1 narrative-event; btn-later-event → 0.

## 5. Координация
- sim-engineer: B1/B2 (one-shot guard, busy guard), B3 (экспорт/использование endDlcDialogue), B7 (Q5/Q6 гейты от флагов Q1), pause-модель диалога.
- ui-engineer: B3 (X → endDlcDialogue + сброс hidden), B4 (приоритет модалок), B5 (сброс dismissed/seen при newGame).
- content-designer: B6 (2–3 campaign dialogues, эффекты flags/branch/ending), B7 (Q2/Q5/Q6 rewards/flags).
- flight-engineer: B8 (4 персонажа ×6 эмоций, 24 PNG, UI-фит).
- После мержа: typecheck/test/build → dialogue-bugs → e2e dlc-dialogues-bugs → полный suite → acceptance §24 → gift + portable.

## 6. Команды
```bash
node <runtime>/pnpm.mjs exec tsx tools/dialogue-bugs.mjs
SF_BASE_URL=http://127.0.0.1:5175 node <runtime>/pnpm.mjs exec playwright test -c apps/web/playwright.config.ts e2e/dlc-dialogues-bugs.spec.ts --workers=1
```
