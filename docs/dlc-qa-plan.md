# DLC XIV · QA-план M9d-0 (task-35, prep)

Дата: 2026-11-04. Автор: qa-engineer. Статус: data/sim/UI в работе (task-31/32/33), QA готовит план и валидатор до мержа.

## 1. Объём M9d-0 (14e_dlc_vertical_slice.md §7)
8 узлов дерева / 10 рёбер, 1 диалог (14 узлов, 3 значимых выбора), журнал 4 вкладки, 4 канала выдачи (story/board/rumor/signal), 2 портрета ×6 эмоций, 2 карточки, 1 фон, 1 комикс, feature-flag `dlc_quests` (новая игра вкл, старый сейв — выкл/миграция v3→v3.1), сейв посреди диалога/квеста, ru/en, идемпотентные награды.

## 2. Артефакты QA (планируемые)
| Артефакт | Назначение |
|---|---|
| `tools/dlc-validate.mjs` | валидатор данных DLC: 8 квестов/7 шагов, диалог 14 узлов/3 выбора/достижимость/0 тупиков, дерево 8/10/0 наложений, персонажи/карточки/арт, l10n ru/en, геометрия |
| `tools/dlc-test.mjs` (после sim) | headless-тесты FSM/диалога/каналов/save/flag off/миграции |
| `apps/web/e2e/dlc-quests.spec.ts` | e2e: первый диалог→3 выбора→Q1/Q2, журнал 4 вкладки, дерево 8/10, доска/слух/сигнал, flag off, save mid-dialogue |
| `docs/acceptance.md §23` | M9d-0 PASS с доказательствами |
| gift + `tools/verify-portable.mjs` | пересборка и проверка file:// |

## 3. Матрица приёмки M9d-0 → проверки
| # | Критерий | QA-проверка |
|---|---|---|
| 1 | Первый квест на такте 0, обоснован | dlc-validate (источник story_message/autoStartTick=0, первый квест=q_pro_01_first_light, 7 шагов); e2e: диалог открывается на старте |
| 2 | 7 шагов работают | dlc-test (FSM: dialogue→reach→kill→choice→dock→report→turn_in); e2e первый квест до награды |
| 3 | Диалог 14 узлов/3 выбора; каждый меняет флаг/репутацию; ≥1 открывает квест | dlc-validate (14/3, все next/onSuccess/onFail разрешаются, все узлы достижимы, 0 тупиков), dlc-test (эффекты, openQuest), e2e 3 выбора |
| 4 | Check DC + seeded roll, исход виден, повтор не меняет | dlc-test: одинаковый seed/tick → тот же исход; checkResults фиксируется; e2e: исход показан |
| 5 | Журнал 4 вкладки, активный квест, шаги, награда, что дальше | e2e: journal tabs active/done/chronicle/tree, quest.step, reward, nextHint |
| 6 | Дерево 8/10, ветвление, туман, фильтр, 0 наложений | dlc-validate геометрия; e2e node/edge counts, fog/filter, клик→карточка, 1280×720/axe |
| 7 | 4 канала (story/board/rumor/signal) | dlc-test (board refresh 10, rumor 500 кр./ложь, signal reveal), e2e доска/слух/сигнал |
| 8 | Save/load mid-quest/dialogue; награды один раз | dlc-test: сериализация посреди диалога, восстановление nodeId/history/choices; повтор turn_in не дублирует |
| 9 | Без `dlc_quests` прежнее поведение; сейв в обоих режимах | dlc-test: enabled=false → dlcPhase no-op, старые механики живы; миграция v3→v3.1 |
| 10 | ru/en: 0 строк вне словарей | dlc-validate: все textKey в l10n/ru.json+en.json; e2e locale RU/EN |
| 11 | Арт: 2×6, 2 карточки, фон, комикс ≤2 МБ | dlc-validate: файлы, размеры PNG; e2e скриншоты |
| 12 | 60 FPS/диалог ≤50 мс/дерево ≤2 мс/кадр | e2e метрики (PerformanceObserver/measure), отчёт WARN при недостижении |
| 13 | 8 unit/6 e2e/4 валидатора | этот набор (dlc-test + dlc-validate + spec) |
| 14 | Демо 10–15 мин без блокеров | e2e сценарий демо |
| 15 | Отчёт «готово к M9d» | acceptance §23 + итог Lead |

## 4. План e2e (`apps/web/e2e/dlc-quests.spec.ts`)
1. **Старт:** меню → новая кампания (флаг DLC включён) → **такт 0**: диалог Кира-7/СВЕТ открыт, 14 узлов доступны.
2. **3 выбора:** C1 (идти/диагностика) → C2 (лидер/прикрытие/пугать) → C3 (честно/скрыть/только Тейре); проверяем флаги в состоянии, репутацию, открытый Q2/Q5.
3. **Q1 7 шагов:** диалог→прыжок→бой (2 пирата)→выбор→стыковка→отчёт→награда; награда **один раз** (повтор не дублирует), открыт Q2.
4. **Журнал:** 4 вкладки (active/done/chronicle/tree), карточка Q1, прогресс шагов, награда, nextHint.
5. **Дерево:** 8 узлов/10 рёбер, туман, фильтр «только открытое», клик→карточка, 0 наложений, скриншот 1280×720.
6. **Каналы:** доска (Q2), слух 500 кр. (Q3, шанс лжи), сигнал (Q6) — принятие квеста из каждого.
7. **Flag off:** новая игра с выключенным флагом → нет диалога/журнала DLC, прежнее поведение; старый сейв открывается.
8. **Save mid-dialogue:** открыть диалог → сохранить → reload → продолжить с того же узла, без потерь/дублей.
9. **a11y/1280:** axe 0 critical; клавиатура (выбор стрелками/Enter), alt-список дерева.

## 5. Контракт data-testid (предложение UI)
| Элемент | testid |
|---|---|
| Диалог | `dialogue-overlay`, `dialogue-portrait`, `dialogue-speaker`, `dialogue-text`, `dialogue-choice-<id>`, `dialogue-check-result`, `dialogue-continue`, `dialogue-history` |
| Журнал | `journal-panel`, `btn-journal-tab-active|done|chronicle|tree`, `quest-card-<id>`, `quest-progress`, `quest-reward`, `quest-next-hint` |
| Дерево | `quest-tree`, `tree-node-<id>`, `tree-edge-<from>-<to>`, `tree-filter-open`, `tree-fog`, `tree-list-fallback` |
| Каналы | `channel-story`, `channel-board`, `channel-rumor`, `channel-signal`, `btn-accept-<id>`, `rumor-item-<id>`, `signal-item-<id>` |
| Флаг/настройки | `toggle-dlc-quests`, `dlc-disabled-note` |
| HUD-маркер | `quest-marker-<id>` |

## 6. Координация/вопросы
- sim: точное имя флага (в аддендуме `dlc_quests`, в task-32 `dlc.enabled`), состояние `fg.dlc`, команды (`dlc_accept`, `dlc_dialogue`, `dlc_choose`, `dlc_rumor`…), миграция v3→v3.1, save mid-dialogue, seeded-check API, доступ к доске/слухам/сигналам для тестов, golden hash.
- data: JSON квестов/диалогов/дерева/персонажей/карточек + ключи l10n, пути арта.
- UI: подтвердить testid; как открывается журнал/дерево/диалог; как включается флаг в новой игре.
- art: пути PNG, размеры 128×128 (портреты), 360×200 карточки, 640×360 фон/комикс, бюджет ≤2 МБ.

## 7. Команды
```bash
node <runtime>/pnpm.mjs exec tsx tools/dlc-validate.mjs
node <runtime>/pnpm.mjs exec tsx tools/dlc-test.mjs
node <runtime>/pnpm.mjs exec tsx tools/verify-portable.mjs
SF_BASE_URL=http://127.0.0.1:5174 node <runtime>/pnpm.mjs exec playwright test -c apps/web/playwright.config.ts e2e/dlc-quests.spec.ts
```

## 8. Итог (2026-11-04, после мержа)

- tools/dlc-validate.mjs: **29/29 PASS, 0 SKIP** (квесты/диалог/дерево/персонажи/карточки/арт/l10n/бюджет).
- tools/dlc-test.mjs: **24/24 PASS** (FSM, 3 выбора/флаги/открытие Q2, seeded check + save/load, награда один раз, board/rumor/signal, flag off, миграция, save mid-dialogue, детерминизм, getDlcTree/Journal/SaveMeta).
- e2e: dlc-quests **4/4**, dlc.spec 2/2, dlc-responsive 1/1; полный e2e 41/41 последовательно (+ dlc-perf, menu-autoscale 4/4).
- unit 312/312; typecheck 0; golden **c55c7ffe**; acceptance §23 PASS (WARN: перф-метрики дерева/диалога).
- gift: пересобран, verify-portable с DLC-проверками (диалог на старте, журнал 4 вкладки, 8 рас/13-я часть).