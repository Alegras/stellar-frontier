# NEXT — Stellar Frontier 1.0

**Статус:** 1.0 + Часть XIII (M9c) + DLC XIV «Первый Свет» (M9d-0) закрыты (v0.6.0, 2026-11-04/05). Открытых блокеров нет.
**Язык:** русский — основной и обязательный; EN — опциональный переключатель.

## Закрыто в 1.0

- Полный баланс-аудит 1000×7200 (3000 партий): лидер/медиана 1.50–1.62×, войны 7.6–10.0, мегаструктуры 4.71–5.43, поражение 0%.
- MMO-hardening: живые PostgreSQL/Redis (12/12), HMAC-токены (5/5), interest management (full_state 36.6 КБ gzip), 300 CCU 300/300, security 0 vulns, heap-соук PASS.
- Конструктор кораблей (sim+UI+e2e), живой L2-бой e2e, стыковка G из старта, 10×10 авторезольв, торговый e2e M8.
- Качество: ESLint 0 errors, coverage 88.9%, axe 0 violations, GitHub Actions workflow, e2e 29/29.
- Язык: RU 100% контента/интерфейса, EN 1798/1798 опция; аудит RU без англицизмов.

## Эксплуатационные заметки

1. Полный 3-часовой heap-soak идёт фоново; на 0.54 ч heapUsed 46.7–52.4 МБ, экстраполяция 3 ч ≈47.6 МБ (<150) — PASS.
2. Одновременный холодный вход 300 CCU — 50–58 с (CPU permessage-deflate); в реальном MMO входы разнесены, соединения не теряются.
3. CI workflow написан и локально воспроизведён; на GitHub runner не запускался (нет runner в среде).
4. 89 lint warnings (any/unused) при 0 errors — базовая линия стиля.
5. EN-динамические сообщения симуляции остаются RU (EN — опция; RU полностью готов).

## Как проверять

- typecheck; test:coverage; lint; build; e2e; mp-test; store-test; persist-test; token-test; pg-redis-test (docker compose); load-300; balance-sim.
- Доказательства 1.0 — docs/acceptance.md §21; полный аудит — docs/balance-log.md §10; протокол — docs/mp-protocol.md §10–11.

## Часть XIII · M9c (task-30, принято 2026-11-04)

- [x] QA: tools/ancients-verify.mjs (34/34) — гейты линии, конечность реликвий/ядер, варп-параметры (радиус/кулдаун/риск/ёмкость), 45 систем/5 регионов/детерминизм, вход/выход сектора, Хор-волны/вторжение, save/load ancients+сектор, 3 финала, отсутствие 7-го условия победы.
- [x] E2E apps/web/e2e/ancients.spec.ts **3/3**: раса и HUD, гейт II акта + миссии + A0, 45 систем/вход-выход/варп-статус/финал на 1280×720; скриншоты 19–25.
- [x] docs/acceptance §22 (M9c PASS с доказательствами), README/NEXT/CHANGELOG, golden 4ced0b78.
- [x] Портативная сборка StellarFrontier.html + gift zip, проверка file://.
- [x] Варп с карты и из полёта (requestWarp/HUD, раскрутка/кулдаун/риск); e2e warp-sector 3/3.
- [ ] Опционально до 1.1: автосимулятор 8 рас × N сидов на доминирование ≤10% (сейчас баланс проверен юнит-тестами/ancients-verify).

## DLC XIV · M9d-0 «Первый Свет» (task-35, принято 2026-11-04)

- [x] QA: tools/dlc-validate.mjs (29/29) + tools/dlc-test.mjs (24/24): данные/граф дерева/диалог/FSM/checks/награды/каналы/save mid-dialogue/flag off/миграция/детерминизм.
- [x] e2e: dlc-quests.spec 4/4, dlc.spec 2/2, dlc-responsive 1/1 (4 разрешения + zoom, дерево без наложений).
- [x] acceptance §23 M9d-0 (15 критериев), README/NEXT/CHANGELOG, golden **c55c7ffe**.
- [x] gift: StellarFrontier.html + zip пересобраны, verify-portable с DLC-проверками.
- [ ] M9d: остальные 52 квеста/9 каналов/полный каст/120 диалогов/60 карточек.
- [ ] WARN: перф-метрика дерева (≤2 мс/кадр) и открытия диалога (≤50 мс) — отдельный замер.

## DLC XIV · «Первый Свет» (M9d-0, принято 2026-11-05)

- [x] 8 квестов, Q1 из 7 шагов на такте 0; story-диалог 14 узлов/3 выбора; Q2-крючок.
- [x] Журнал S16: 4 вкладки, карточки, прогресс, награды, «что дальше»; дерево 8/10, туман/фильтры/зум/пан/миникарта/a11y.
- [x] 4 канала: story-сообщение, доска станции, слухи 500 кр. (ложь/опровержение), сигналы в полёте.
- [x] Feature-flag dlc_quests: новые игры on, старые сейвы off/миграция; save/load mid-dialogue; награды один раз.
- [x] Арт 19 PNG/43 КБ: 2 портрета ×6 эмоций, карточки, фон, комикс, голос СВЕТ; l10n ru/en 84 ключа.
- [x] Автомасштабирование: 1280×720…2560×1440 + zoom 80–150%; дерево fit-to-content, без наложений/обрезки; perf PASS (диалог 3.0 мс, дерево 0.20 мс).
- [x] Гейты: unit 321/321, golden 1bfd9c71, dialogue-bugs 14/14, dlc-validate 32/32, dlc-test 24/24, полный e2e 53/53, gift 2.57 МБ / verify-portable 10/10.
- [ ] Задел M9d: остальные 52 квеста, 9 каналов, 120 диалогов, арт до 60 карточек (по 14e срез — go/no-go гейт пройден).

## Диалоги/арт: багфикс (task-40, закрыто 2026-11-06)

- [x] one-shot сцен, X→endDlcDialogue, приоритет модалок, сброс dismissed/seen, save/load mid-dialogue — sim+UI.
- [x] 3 кампанийных диалога с flags/branch/ending; Q1→Q2/Q5/Q6 modifiers; цепочка Q1→Q2→Q3→Q4→Q5→Q7.
- [x] Арт 4×6 эмоций (24 PNG, manifest 31 ассет).
- [x] QA: dialogue-bugs 14/14, dlc-validate 32/32, dlc-test 24/24, e2e 53/53, unit 321/321, golden 1bfd9c71, acceptance §24.
- [ ] Перф-метрики диалогов/дерева — dlc-perf PASS (диалог 2.1 мс, дерево 0.10 мс, кадр 15.6 мс).

## Мировая политика/динамика ИИ (task-42/43/44, закрыто 2026-11-07)

- [x] AI-AI договоры/войны/федерации/дань/вассалитет; fg.aiWorld/news/events/blocs/statuses, aiWorldPhase, API + HUD.
- [x] collapse/absorb/merge/centralize: dead, перенос систем/колоний/флотов/казны/техов, вассал-интеграция, содружество→единая империя.
- [x] Игрок: call-to-arms/trade_bloc/refugees/vassalization/accession/centralization — события с выбором; защита от молчаливого удаления.
- [x] UI-панель/матрица/лента/фильтры/HUD/модалка (приоритет к диалогу), журнал; фикс краша effectsRu.
- [x] QA: politics-verify 21/0/1, world-politics 5/5, unit 335/335, golden 8f52b0a6, e2e 61/61, acceptance §25, gift.
- [ ] Естественная генерация call-to-arms в headless — SKIP (нужны war+alliance в конкретном seed); покрыта e2e-событием/командой и unit sim.

## Финальная приёмка v0.7 (task-48, закрыто 2026-11-07)

- [x] Story 6 актовых сцен + эпилог, endingHint/unlockMission, 20 payoff-флагов; story-verify 10/10.
- [x] Карта AI-ИИ линий и сектор Предела (скрыт до revealSector, открывается после) — world-map 1/1, ancients-ui 1/1.
- [x] Комикс с DOM-пузырями 1280–2560 — dlc-comic 1/1; Qwen 4×6 арт/фон/карточки.
- [x] typecheck 0, unit 335/335, golden 8f52b0a6, полный e2e **61/61**, acceptance §26, gift 2.89 МБ/verify 10/10.
- [ ] Флейк долгих live-спеков (warp-sector/combat-live) в полном прогоне — в изоляции зелёные, финальный suite 61/61; при CI желательно retries=1 для двух спеков.

## Полная история 0–V (task-53/54/55, закрыто 2026-11-08)

- [x] 10 кампанийных сцен (9 mission + epilogue), 88 outcome-узлов, 5 мостиков в журнале; story-script v2 (6 актов/18 сцен/16 развилок/40 вариантов).
- [x] Флаги/отношения/unlock актов 0/I + арки Тейры/Киры (camp_teira_arc_*, camp_kira_arc_*, kira_debt); legacy-сцены удалены, legacy-check 0.
- [x] story-verify 16/16, story-full e2e 3/3, unit 338/338, golden 8f52b0a6, полный e2e **64/64**, acceptance §27/§28.
- [x] gift 2.97 МБ/zip 1.04 МБ/verify 10/10, site синхронизирован; скриншоты dialogue-outcome/story-arcs.

## Древние 13b: Архив/Контакт (task-56/57/58, закрыто 2026-11-08)

- [x] dlg_campaign_ancient_archive (main_01_rift_rumor) + dlg_campaign_ancient_contact (main_03_truth), requiresAncients gating; 103 outcome, 15 диалогов, 17 camp_ancient_*.
- [x] story-verify 17/17, story-full 4/4, unit 340/340, golden 8f52b0a6, полный e2e **65/65**, acceptance §29.
- [x] gift 2.99 МБ/zip 1.04 МБ/verify 10/10, site синхронизирован; legacy-check 0.
