# CHANGELOG

## [0.7.2] — 2026-11-08 · Полная история 0–V (task-51/52/54/55)

- Story: 12 кампанийных сцен (11 mission + epilogue): act0_relic, teira_arc, act1_hegemon, kira_arc, act2_council, act3_truth, act4_legacy, act4_betrayal, final_door, epilogue; + Древние 13b: ancient_archive/ancient_contact (requiresAncients); 103 outcome-узла; 5 мостиков (0→I…IV→V) в журнале; story-script v2 — 6 актов/18 сцен/16 развилок/40 вариантов/4 директивы/8 эпилогов.
- Флаги/отношения: camp_relic_*, camp_voice_*, camp_hegemon_vassal/rejected, camp_teira_arc_*, camp_kira_arc_*, camp_ancient_* (17), kira_debt; отношения teira_os/kain/kira7/selen; unlock main_01_rift_rumor/main_03_truth/main_03_megastructure.
- l10n ru/en 1584↔1584; legacy-сцены/фразы удалены (legacy-check 0), docs/legacy-removed-keys.md, docs/story-script.md.
- QA: story-verify 17/17 (12 сцен/103 outcome/13b gating), story-full 4/4, unit 340/340, golden 8f52b0a6, полный e2e 65/65, acceptance §27/§28/§29; gift 2.99 МБ/zip 1.04 МБ/verify 10/10; site синхронизирован.
## [0.7.1] — 2026-11-07 · Финальная история/карта/арт v0.7 (task-46/47/48)

- Story: 6 Gemini-сцен (акты II–V: 5 mission-сцен + эпилог); legacy-сцены/триггеры и 239 l10n-ключей удалены; endingHint/unlockMission (20/13); 20 payoff-флагов (requiresFlag) в поздних сценах; l10n ru/en 1407↔1407.
- Legacy: tools/legacy-check.mjs (0 legacy-маркеров в source/dist/gift/site), docs/legacy-removed-keys.md.
- Карта: политический слой AI-ИИ линий/столиц/статусов/фильтров (getPoliticalMap, map-pol-*), клик→панель; сектор Предела скрыт до revealSector, после — слой и туман; map-layer-sector.
- Комикс: DOM-пузыри поверх Qwen-арта (позиции/адаптив 1280–2560), портрет не вылезает из grid, история ниже футера; dlc-comic.spec.
- Арт: Qwen 4×6 портретов (24), фон/карточки/комикс, manifest 31 ассет.
- UI: уведомления скрываются при активном диалоге (:has), исправления раскладки.
- QA: story-verify 10/10, world-map/politics/dlc-comic/dialogue-fixes зелёные, unit 335/335, golden **8f52b0a6**, полный e2e **61/61**, acceptance §26, gift пересобран (2.89 МБ, verify 10/10).
## [0.7.0] — 2026-11-07 · Мировая политика и динамика ИИ (task-42/43/44)

- AI-AI слой: договоры/войны/федерации/дань/вассалитет; fg.aiWorld (news cap 50, events, blocs, statuses, stats), aiWorldPhase каждые 10 тактов, getAiNews/getAiRelations/getAiWorldState/getAiWorldEvents/getAiWorldHud.
- Динамика: collapse (системы соседям, dead), absorb/merge (перенос систем/колоний/флотов/казны/техов, dead), вассал→интеграция, федерация→содружество→централизация в единую империю.
- Игрок: события call-to-arms/trade_bloc/refugees/vassalization_demand/accession_offer/centralization_vote с выборами и эффектами; игрок никогда не удаляется молча; захват всех систем/forceAbsorb защищены.
- UI: панель «Мировая политика» (обзор/матрица/лента/события/фильтры), HUD ai-world-hud/world-war-hud/world-bloc-hud, модалка ai-world-event с приоритетом к диалогу, статусы фракций, журнал; исправлен краш effectsRu string|string[].
- Кампания: flags ai_war/ai_federation/ai_trade_bloc/ai_call_to_arms/ai_accession/ai_commonwealth; журнал politics.
- QA: politics-verify 20/0/1, world-politics e2e 5/5, unit 335/335, golden **8f52b0a6**, полный e2e **61/61**, acceptance §25; gift пересобран.
## [0.6.1] — 2026-11-06 · Диалоги и арт: багфикс DLC XIV (task-40)

- Диалоги: one-shot сцен (dlg_q1_briefing не запускается после завершения), закрытие X завершает сцену (нет active/зависшей паузы), приоритет модалок (narrative-event не поверх диалога, без накопления), сброс dismissed/seen при новой игре, save/load mid-dialogue.
- Кампания: 3 сюжетных диалога (act2/branch/finale) с campaignFlag/relation/branch/ending; consequences/getDlcConsequences; ветка/концовка видны в e2e.
- B7: Q1-выборы читаются в modifiers Q2/Q5/Q6 (8 флагов), цепочка Q1→Q2→Q3→Q4→Q5→Q7 и Q6→Q7, Q5 достижима после Q4.
- Арт: 24 портрета (4 персонажа × 6 эмоций) 128×128 сгенерированы локальной **Qwen-Image 2.1** через ComfyUI (RTX 4070 Ti), 32 цвета/PNG-8; manifest 31 ассет/177 КБ; процедурный генератор оставлен историческим.
- QA: dialogue-bugs 14/14, dlc-validate 32/32, dlc-test 24/24, e2e **53/53**, unit 321/321, golden **1bfd9c71**; acceptance §24.
- Gift пересобран после Qwen-арта: StellarFrontier.html 2.57 МБ, zip 830 КБ; verify-portable 10/10.
## [0.6.0] — 2026-11-04 · DLC XIV «Первый Свет» (M9d-0)

- Первый квест на такте 0: story-диалог 14 узлов/3 выбора, 7 шагов Q1, награда один раз; Q2-крючок.
- Журнал S16 (4 вкладки), дерево 8 узлов/10 рёбер (туман/фильтры/зум/миникарта/a11y-список), адаптив 1280–2560 + zoom 80–150%.
- 4 канала: story, доска, слухи (500 кр., ложь/опровержение), сигналы; маркеры карты/HUD.
- Арт: 2 портрета ×6 эмоций, карточки, фон, комикс (19 PNG, 43 КБ).
- Feature-flag dlc_quests, миграция старых сейвов, save/load mid-dialogue, seeded checks без сейв-скама.
- QA: dlc-validate 29/29, dlc-test 24/24, e2e DLC 8/8 (+perf), меню-рас 4/4, acceptance §23; golden c55c7ffe; unit 312/312; полный e2e 41/41.
- Gift пересобран c Qwen-артом (StellarFrontier.html 2.57 МБ, zip 830 КБ), verify-portable 10/10 через file://.
- **Автомасштабирование:** меню рас без фиксированной max-height — тайлы саморасширяются, текст не выходит за карточки; дерево fit-to-content; e2e `menu-autoscale` 4/4 на 1280×720…2560×1440, полный e2e 41/41.

## [0.5.0] — 2026-11-04 · Часть XIII: Древние, расы и Реликтовый Предел (M9c)

### Добавлено
- **Расы:** 20 рас (8 играбельных + 12 NPC), 44 трейта, стартовые бонусы, уникальные здания/модули/корабли, выбор расы в меню и влияние на sim.
- **Линия «Наследие Ансаров»:** 12 миссий, побочный старт во II акте (такт 1200+), гейты A0–A5/варп/сектор, 3 финала (Запечатать/Использовать/Отдать); не 7-е условие победы.
- **Ветвь A0–A5:** 30 технологий отдельно от трёх школ; конечные реликвии (≤60) и ядра (≤20), гейты миссиями, эффекты в модификаторах.
- **Варп «Наследие»:** радиус 60 св. лет, 1 ядро = 10 зарядов, раскрутка 60 с, кулдаун 5 тактов, риск Хора 15%, прыжок вне гиперлиний; полётный HUD, выбор цели, эффекты; варп с карты.
- **Сектор «Реликтовый Предел»:** 45 систем/5 подрегионов без гиперлиний; Ансары-остатки, Хор, Отступники, Стражи; 44 POI, hazardous-системы, Хор-волны/вторжение, стабильность, scan/claim, вход/выход, слой карты.
- **Кодекс:** 44 записи; панель «Древние» (Линия/Наследие/Кодекс/Предел/Финал), HUD реликвий/ядер/зарядов/кулдауна.
- Дополнительные данные: 3 мегаструктуры Предела, 6 архео-цепочек, 6 испытаний Стражей, 3 реликтовых корабля, 20 событий сектора.

### Исправлено
- Случайные события: время стоит до выбора; «Отложить» убирает событие из очереди без накопления.
- Меню выбора расы: кнопка «Новая кампания» всегда видима на 1280×720/1600×900.
- Варп с карты: `selectWarpTarget`/`requestWarp` работают без полётного вида; исправлен вход в сектор (`sector.active/visited`).

### Гейты
- typecheck 0; unit **299/299**; golden hash **4ced0b78**; build ~560 КБ gzip; e2e **29/29**; ancients-verify **34/34**; data:validate + validate-full-data PASS; axe 0 violations.
- Портативная сборка: StellarFrontier.html ~2.10 МБ, gift zip ~618 КБ, verify-portable 8/8 через file://.

## [0.4.1] — 2026-11-04 · Политическая карта и события
- Политическая карта рядом с миникартой; события ставят время на паузу, «Отложить» не копит очередь.

## [0.4.0] — 2026-11-04 · Stellar Frontier 1.0
- Полный аудит 1000×7200 (3000 партий); анти-снежок/войны/мегаструктуры ИИ; MMO PostgreSQL/Redis, HMAC, interest management, 300 CCU; конструктор кораблей, живой L2-бой, торговый e2e; ESLint/coverage/axe/CI; RU-primary + EN-опция.

## [0.3.0] — 2026-11-04 · Снятие ограничений
- Баланс/персистентность/языковой слой; store-test 8/8, persist-test 13/13.

## [0.2.1] — 2026-11-04 · Исправления после плейтеста
- Победа «Продолжить», формы ордера/маршрута, коллизии/автостыковка/курсор, меню паузы, станция с карты.

## [0.1.0] — 2026-11-04 · Вертикальный срез M0–M5
- Карта, полёт, бой, экономика, станция, сохранения, пиксельный рендер.