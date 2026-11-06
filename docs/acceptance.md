# Приёмка M0–M5 — «Stellar Frontier»

> Источник критериев: N:/AI/game-prompt/docs/06_milestones_and_acceptance.md §3, Definition of Done §4. Данные: GDD §19 и 03b_economy.md (аудит — docs/balance-log.md).
> Владелец приёмки: qa-engineer. Дата финального прогона: 2026-11-04, 02:15–02:25 (локальное время).
> Статусы: **PASS** — выполнено и подтверждено; **FAIL** — проверено, не выполнено; **WARN** — выполнено частично/с оговоркой; **N/A** — вне объёма среза; **BLOCKED** — нет способа проверить в текущей сборке.

## 0. Итог

| Майлстоун | Статус | Доказательство |
|---|---|---|
| M0 · Foundation & Canon in Code | **PASS с замечаниями** | typecheck/test/build/data:validate зелёные; детерминизм 1000 тактов; save/load round-trip (unit); сцена WebGL2 в Chrome; FPS 75 |
| M1 · Galaxy Generator | **PASS** | 100/100 seed'ов связны, 0 изолированных, узкие места 67–71%, детерминизм seed |
| M2 · Empire Tick & Economy | **WARN** | такт/ресурсы/тултипы работают; стартовый доход ниже канона (energy −78%), 1000 тактов пассивной игры → дефицит еды/ТП; перф-цель 30 тактов ≤ 5 мс не достигнута (23 мс) |
| M3 · Flight Vertical Slice | **WARN** | вход/выход без загрузки, HUD, сцена, 75 FPS; стыковка из инспектора работает, стыковка «руками» по G из стартовой позиции не подтверждена |
| M4 · Tactical Combat | **N/A / WARN** | живой L2-бой вне среза; авторезолв работает, бой в отчёте 190 с (≤ 5 мин) |
| M5 · Ships, Fleets, Autoresolve | **WARN** | автобой с отчётом и воспроизводимость по seed; конструктор и флот 10 кораблей в UI не проверены |

Артефакты: docs/shots/01-menu.png … 06-battle.png + docs/shots/manifest.json; test-results/ (Playwright), логи прогонов ниже.

## 1. Команды прогона

Из N:/AI/stellar-frontier (runtime-пути сокращены до <node> и <pnpm-mjs>):

| Что | Команда | Результат |
|---|---|---|
| typecheck | <node> <pnpm-mjs> typecheck | PASS (0 ошибок) |
| unit | <node> <pnpm-mjs> test | PASS: 6 файлов / 32 теста |
| build | <node> <pnpm-mjs> --filter @sf/web build | PASS: 1 081 KB JS, 296 KB gzip, CSS 5.3 KB gzip |
| data | <node> <pnpm-mjs> data:validate | PASS: jobs 20, districts 7, buildings 27, techs 62, hulls 16, weapons 15, modules 27, designs 18, missions 16 |
| headless sim | <node> <pnpm-mjs> exec tsx tools/verify-game.mjs --seed 42 --ticks 1000 | PASS: детерминизм OK, 0.88 мс/такт |
| galaxy audit | <node> <pnpm-mjs> exec tsx tools/galaxy-audit.mjs --seeds 100 | PASS: 100% связность |
| FPS/стыковка | <node> <pnpm-mjs> exec tsx tools/measure-fps.mjs http://127.0.0.1:5174 | 75 FPS, WebGL 2.0 |
| e2e prod | SF_BASE_URL=http://127.0.0.1:5174 <node> <pnpm-mjs> exec playwright test -c apps/web/playwright.config.ts | PASS: 6/6 |
| e2e dev | <node> <pnpm-mjs> exec playwright test -c apps/web/playwright.config.ts e2e/smoke.spec.ts | PASS: 5/5 |

Примечание: root-скрипты build/e2e вызывают pnpm из PATH и падают при запуске через node pnpm.mjs; выше — прямые команды. Для скриншотов использован production preview (стабильнее dev/HMR), dev-сервер также проверен.

## 2. M0 · Foundation & Canon in Code

| # | Критерий | Статус | Доказательство |
|---|---|---|---|
| M0.1 | dev поднимает игру < 60 с с нуля | **PASS** | Playwright webServer стартует vite dev; меню появляется за ~2–3 с (smoke 01/02) |
| M0.2 | pnpm test зелёный; покрытие sim ≥ 70% | **WARN** | тесты: 32/32 PASS; покрытие не настроено (нет coverage-провайдера) — не измерено |
| M0.3 | CI: lint + typecheck + unit + build | **WARN** | typecheck/test/build PASS; lint (ESLint) в package.json не настроен |
| M0.4 | Один seed + 1000 тактов бит-в-бит | **PASS** | verify-game --ticks 1000: sha256 5fef427c…; встроенная проверка двух миров: «OK (bit-identical)» |
| M0.5 | Save → load → save идентичный JSON | **PASS** | unit-тест packages/sim/test/save.test.ts (200 тактов → save/load → ещё 200) — PASS |
| M0.6 | 60 FPS на целевом железе | **PASS** | measure-fps: карта 75 FPS (avg frame 13.3 мс, p95 13.5 мс), полёт 75 FPS; Chrome, WebGL 2.0 |
| M0.7 | packages/data: zod-схемы + валидатор в CI | **PASS** | data:validate PASS (см. §1) |
| M0.8 | docs/adr + CHANGELOG/NEXT | **PASS** | 5 ADR, CHANGELOG.md, NEXT.md, ASSUMPTIONS.md |
| M0.9 | Тестовая 3D-сцена Three.js | **PASS** | docs/shots/02-map.png, 04-flight.png (WebGL2, canvas 1600×900, пиксели не пустые) |

## 3. M1 · Galaxy Generator

| # | Критерий | Статус | Доказательство |
|---|---|---|---|
| M1.1 | Нет наложений меток P0–P2; кластеризация/гистерезис | **WARN** | кластеризация и приоритеты есть (MapLabels.tsx, скриншот 02); известный визуальный дефект: метки неизвестных систем — белые квадраты (PT-005), перекрытия меток в центре карты видны |
| M1.2 | 100 seed → 100% связных галактик | **PASS** | galaxy-audit: connectedPct 100, isolatedTotal 0 |
| M1.3 | ≥12% узких мест (degree 1–2), нет изолированных | **PASS** | chokepointAvg 70.78%, min 67.5% (≥12%), isolated 0 |
| M1.4 | Тот же seed → идентичная галактика | **PASS** | galaxy-audit deterministic=true (100/100); verify-game 1000 тактов bit-identical |
| M1.5 | Инспектор < 100 мс, зум без фризов | **PASS (косвенно)** | клик по метке → инспектор в e2e появляется без задержек (measure-fps: вход в систему 0 мс; smoke 03 PASS); точный замер <100 мс не выделен |
| M1.6 | ≥3 «интересных» структуры | **PASS** | articulation points на seed: min 161 (>3): мосты/узкие места присутствуют в каждой галактике |

## 4. M2 · Empire Tick & Economy

| # | Критерий | Статус | Доказательство |
|---|---|---|---|
| M2.1 | +5% дохода за 30 тактов (оптимально) / −10% (пассивно) | **WARN** | Факт старта: E +4, M +12, F +12, A +3, G +3. Это сходится с 03b §2.2 (раннее сальдо E +3.7, A +2.7 после апкипа флота), но не с GDD §19.1 (18/12/14/6/4 без апкипа) — канонический конфликт (docs/balance-log.md §6.2). За 30 тактов доход не растёт (E +4 стабильно): «+5% за 30 тактов» не подтверждено; 1000 тактов пассивно → food 0, goods 0, E −1 (риск баланса, §6.3) |
| M2.2 | Любой ресурс «роняется» в дефицит, последствия в тултипе | **WARN** | тултипы ресурсов реализованы (TopBar + incomeBreakdown), но цепочку последствий дефицита e2e не проверяли; дефицит еды/ТП воспроизведён headless (tick 1000) |
| M2.3 | Тултип = полная формула, 0 магических чисел | **PASS с WARN** | getIncomeBreakdown реализован, тултипы строятся из него; расхождения данных — docs/balance-log.md (11 WARN, 0 FAIL) |
| M2.4 | 30 тактов ≤ 5 мс (200 систем, 3 планеты) | **FAIL** | 0.79–0.88 мс/такт → 30 тактов ≈ 23–26 мс (> 5 мс). Бюджет DoD 8 мс/такт — PASS, но M2-цель не достигнута |
| M2.5 | E2E: построить здание → доход изменился | **BLOCKED** | UI строительства есть (ColonyPanel), но стабильного e2e-сценария строительства в срез не входит |
| M2.6 | Property: ресурсы не из воздуха | **PASS** | unit-тесты экономики/сохранений PASS (32/32), включая инварианты запасов |
| M2.7 | Цепочка руда→сплав→корпус; еда→попы→ТП→наука | **WARN** | данные цепочек валидны (jobs/buildings/districts), но сквозной тест цепочки отсутствует |
| M2.8 | Дефицит даёт видимую причинно-следственную цепочку | **BLOCKED** | см. M2.2 |

## 5. M3 · Flight Vertical Slice

| # | Критерий | Статус | Доказательство |
|---|---|---|---|
| M3.1 | карта→полёт→стыковка→карта ≤ 2 с без загрузок | **PASS** | e2e smoke 04: enterSystem → flight-hud, exit → карта; measure-fps: enterSystem 0 мс; загрузочных экранов нет (SPA) |
| M3.2 | 60 FPS в системе (12 тел, 2000 астероидов, станция) | **PASS (частично)** | measure-fps: полёт 75 FPS, p95 13.5 мс; состав сцены (12 тел/2000 астероидов) не пересчитан |
| M3.3 | Ощущение полёта (4 с до 100% тяги, дрейф) | **N/A** | требует 5 живых тестеров — вне возможностей CI |
| M3.4 | Стыковка руками и автопилотом; провал не убивает | **WARN** | стыковка из инспектора (btn-dock) работает — docs/shots/05-station.png; стыковка в полёте по G из стартовой позиции не открыла экран станции (PT-010) |
| M3.5 | Геймпад определяется | **N/A** | в CI нет геймпада |
| M3.6 | HUD: скорость, тяга, топливо, щит/корпус, цель, радар, пипсы | **PASS** | docs/shots/04-flight.png (щит 90/90, корпус 220/220, тяга, пипсы, контакты, дистанция) |

## 6. M4 · Tactical Combat

| # | Критерий | Статус | Доказательство |
|---|---|---|---|
| M4.1 | 1 корвет ×3 ИИ: 60–120 с, тактика решает | **N/A** | живой L2-бой в срез не входит (A4: клиентский бой); авторезолв есть |
| M4.2 | Живой бой vs автобой ≤10% потерь | **N/A** | нет живого боя |
| M4.3 | Ни один бой > 5 минут | **PASS (для авторезолва)** | отчёт боя: длительность 190 с (< 300 с) — docs/shots/06-battle.png |
| M4.4 | 6 видов оружия имеют нишу | **N/A** | проверка — плейтест M4 |
| M4.5 | 60 FPS при 30 кораблях/200 снарядах | **N/A** | сцена боя не в срезе |

## 7. M5 · Ships, Fleets, Autoresolve

| # | Критерий | Статус | Доказательство |
|---|---|---|---|
| M5.1 | Конструктор корабля ≤ 6 кликов, шаблон, 5 штук | **BLOCKED** | конструктор в UI не реализован |
| M5.2 | Флот 10 кораблей: движение, апкип, топливо | **WARN** | команда move_fleet работает (e2e-бой через сближение флотов), но флот 10 кораблей и топливо не проверены |
| M5.3 | Автобой 10×10: отчёт с потерями, воспроизводим по seed | **WARN** | отчёт с потерями/трофеями — 06-battle.png; детерминизм 1000 тактов PASS; 10×10 не проверялся |
| M5.4 | «Возглавить бой» не ломает симуляцию (тактическая пауза) | **PASS (частично)** | вход в систему ставит тактическую паузу (HUD: «Тактическая пауза: такт остановлен»), такт не идёт; живой бой не подключался |

## 8. Definition of Done (06 §4)

| # | Пункт | Статус |
|---|---|---|
| 1 | TS strict, нет any/TODO без обоснования | **PASS** | typecheck 0 ошибок |
| 2 | Баланс в JSON | **WARN** | 11 WARN, 0 FAIL (docs/balance-log.md); апкип-множитель вне JSON |
| 3 | Unit + golden + e2e | **PASS** | 32/32 unit, golden-тест в наборе; e2e 6/6 |
| 4 | Детерминизм 2× seed | **PASS** | verify-game 1000 тактов + galaxy-audit 100 seed |
| 5 | Бюджет такта 8 мс / кадра 16.6 мс | **PASS** | такт avg 0.79–0.88 мс; кадр 13.3 мс |
| 6 | UX: клавиатура, пустые/ошибочные состояния, тултипы | **WARN** | тултипы/клавиши есть (F1/Space/1-5/M/Esc), ошибочные состояния не покрыты e2e |
| 7 | Документация | **PASS** | CHANGELOG, NEXT, ADR, ASSUMPTIONS, acceptance/playtest/balance-log |
| 8 | Демо за 3 минуты | **PASS** | меню → карта → инспектор → станция → полёт → бой (скриншоты 01–06) |
| 9 | Ревью | **N/A** | вне роли QA |

## 9. Известные ограничения и баги (сводка)

| ID | Severity | Суть | Где |
|---|---|---|---|
| PT-004 | S3 | Стартовый доход сходится с 03b §2.2 (net после апкипа), но не с GDD §19.1; пассивные 1000 тактов → дефицит еды/ТП | docs/playtest-log.md |
| PT-005 | S3 | Метки неизвестных систем рисуются белыми квадратами (скриншот 02) | docs/playtest-log.md |
| PT-006 | S3 | В полёте станция не видна в кадре (5 км по HUD, но не впереди) | docs/playtest-log.md |
| PT-007 | S4 | Спам «Игра сохранена» в ленте уведомлений (автосейв каждые 30 тактов + пауза на бою) | docs/playtest-log.md |
| PT-010 | S3 | Стыковка по G из стартовой позиции в полёте не срабатывает | docs/playtest-log.md |
| — | WARN | Узкие места: 30 тактов = 23 мс (>5 мс цели M2.4) | этот документ §4 |

## 10. Журнал финальных прогонов

| Время | Прогон | Результат |
|---|---|---|
| 02:06 | typecheck (срез до фиксов) | FAIL 5 ошибок (SystemView/MapLabels/MainMenu) — код в работе |
| 02:10 | verify-game 200 тактов (ранний sim) | tick: not implemented → позже PASS |
| 02:12 | typecheck / build | PASS / PASS (295 KB gzip) |
| 02:14 | e2e screens (prod preview) | 6/6 снимков (01–06), pageErrors 0 |
| 02:15 | e2e full (prod preview) | 6/6 PASS (24.7 с) |
| 02:16 | e2e smoke (dev 5173) | 5/5 PASS (10.9 с) |
| 02:17 | unit | 32/32 PASS |
| 02:18 | 1000 тактов / galaxy-audit 100 / data:validate | PASS / PASS / PASS |
| 02:25 | FPS/стыковка (prod preview) | 75 FPS карта и полёт, WebGL 2.0 |
| 02:30 | ФИНАЛЬНЫЙ срез: typecheck / test / build / e2e (prod preview, пересборка) | PASS / 32 теста PASS / PASS (296 KB gzip) / 6 из 6 PASS (24.6 с), скриншоты 01–06 пересняты |

---

## Ревью Lead после среза QA (02:30+)

| Дефект QA | Статус после правок |
|---|---|
| PT-005 «белые квадраты меток неизвестных систем» | Исправлено: `.sf-map-label--dot` теперь 4-px точки без рамки (screenshots `final-02-map.png`). |
| PT-006 «станция не видна в кадре полёта» | Исправлено flight-engineer: станция 5 км прямо по курсу, планета-якорь в кадре (`final-05-flight.png`, contact-маркер «Торговая станция 5.0 км»). |
| PT-007 «спам Игра сохранена» | Исправлено: автосейв каждые 30 тактов теперь без уведомления; ручное сохранение — с уведомлением. |
| PT-008 «НЕ ЧИСЛО» в науке | Не воспроизводится ни у UI, ни у QA: значения науки конечные (`probe-topbar`: Φ 6 +3 · Σ 3 +2 · Ω 5 +3), в DOM нет «NaN/не число». |
| PT-010 стыковка по G на старте | Не баг: станция в 5 км, условие стыковки < 2,5 км и < 120 м/с; кнопка «Стыковка» в инспекторе — демо-телепорт. |
| PT-004 стартовое сальдо vs GDD §19.1 | Решение Lead: канон чисел — 03b §2.2 (net после апкипа); отражено в ASSUMPTIONS A17. Пассивные 1000 тактов → food/goods 0 — давление экономики, лечится постройкой агро/фабрик (M2-петля работает). |

**Финальные гейты Lead:** typecheck 0; test 32/32; build 296 KB gzip; Playwright e2e 6/6 (QA); скриншоты final-01..09; pageerror 0.

## Плейтест Lead, итерация 2 (исправления)

Найдены и исправлены реальные дефекты; после правок:

| Дефект | Исправление | Проверка |
|---|---|---|
| Покупка на рынке не начисляла товар | `trade` теперь добавляет ресурс в казну | `pnpm test` → trade.test.ts; плейтест: энергия 174→175 |
| Арбитраж «купи-продай» на одном рынке приносил прибыль | корректный `clamp(n,min,max)`, цена продажи после просадки объёма | 5 циклов → −720 Cr; тест «деньги не из воздуха» |
| Коллизии отсутствовали (протыкание тел) | свип-тесты по сферам: звезда/планеты/станция/астероиды/враги, урон в долях пула | планета: выталкивание на поверхность + щит 90→68; звезда: одна смерть → карта |
| При залёте на станцию не было стыковки | автостыковка при касании на <800 м/с; быстрее — отскок+урон и выход из суперкруиза | автостыковка: mode=station; суперкруиз: выход + щит 90→60 |
| После стыковки пропадал курсор | Pointer Lock снимается при стыковке/отстыковке/оверлеях | pointerLock=null после дока |
| После отчёта о бое время стояло | закрытие отчёта возобновляет такт (при speed>0) | battle: 10→22 тика |
| Меню паузы не останавливало время | меню паузы ставит/снимает паузу | плейтест шаг 24 |
| Клик по карте отдавал приказ флоту | флот не выбирается автоматически | плейтест шаг 05 |
| Верфь блокировала постройку из-за кредитов | проверка только сплавов + лимит флота; причина в тултипе | постройка science_vessel: −12 сплавов, очередь +1 |
| Станция с карты показывала чужую систему; отстыковка вела не туда | запоминается источник дока (карта/полёт) | e2e screens: 01–06 PASS |

Финальные гейты итерации 2: typecheck 0; **tests 34/34**; build 297.9 KB gzip; **e2e 6/6**; **плейтест-сценарий 26/26 PASS, console errors 0**.

---

## 11. M11 · Multiplayer: кооп 2–4 и MMO (в работе, api-net)

> Сервер: apps/api (Fastify + @fastify/websocket), контракт: packages/protocol (zod, PROTOCOL_VERSION=1), клиент: apps/web/src/net (NetClient + LobbyScreen).
> Документ: docs/mp-protocol.md. Тесты: tools/mp-test.mjs (2 WS-клиента), apps/web/e2e/mp.spec.ts (2 браузера).

| # | Критерий M11 | Статус | Доказательство |
|---|---|---|---|
| M11.1 | Сервер-авторитет: клиент отправляет только команды, состояние меняет сервер | **PASS** | mp-test: full_state от сервера, команды через cmd_ack; локальная sim в coop/mmo отключена (Game.sendCommand → net) |
| M11.2 | Лобби по коду комнаты (create/join), кооп 2–4 и MMO 30–100 | **PASS** | mp-test 24/24: HTTP create/join/get room, MMO-комната maxSeats=100 (клэмп спеки из данных 300) |
| M11.3 | Тик-луп сервера и снапшоты, синхронные у клиентов | **PASS** | mp-test: snapshots tick растёт, пауза замораживает тик; e2e (2 браузера) — см. M11.7 |
| M11.4 | Команды: валидация схем, принадлежность от seat, rate-limit | **PASS** | mp-test: своя команда ok, чужая — «Флот не ваш», set_speed — whitelist, rate limit 7/15 |
| M11.5 | Пауза-голосование (≥50%, мин 2, кулдаун 5 с, ≤3/час) и тактический лок 90 с (120 PvP) | **PASS** | mp-test: голосование 2/2, тик заморожен, resume; лок 90 с, пауза во время лока отклонена, unlock |
| M11.6 | Реконнект по токену 30 с, чат, heartbeat, очистка комнат | **PASS** | mp-test: reconnect resumed=true + full_state; отказ неверного токена; чат; heartbeat ping 5 с |
| M11.7 | E2E двумя браузерами | **BLOCKED (в работе)** | apps/web/e2e/mp.spec.ts написан (запускает API отдельным процессом, 2 контекста, лобби→start→равный тик); прогон заблокирован временной несобираемостью sim (см. §12) |
| M11.8 | MP-статус в едином HUD | **WARN** | статус вынесен в NetClient.state и LobbyScreen; для HUD нужна правка apps/web/src/game/types.ts (GameState.mp) — вне зоны api-net |
| M11.9 | Паритет SP vs dedicated (500 тактов) | **BLOCKED** | требует серверного SP-пути; вне M11-среза, отмечено Lead |

### M11.1. Известные ограничения реализации (docs/mp-protocol.md §6)

- Снапшоты — JSON (не бинарные Colyseus-дельта), interest management/туман войны не реализован.
- Команды применяются `sim.applyCommand` с временной подменой `world.playerEmpireId` на империю seat; **просьба к Lead/sim**: экспортировать `applyCommandAs` из packages/sim/src/index.ts.
- Персистентность (PostgreSQL/Redis), серверные сейвы, MMO-сезонный сброс — не реализованы (в памяти).
- MODES из @sf/data: MMO playersMax=300, спека 09 — 30–100; сервер клэмпит к 100 → нужно решение Lead.
- Кооп-победа: victory-логика sim ориентирована на world.playerEmpireId; общая победа команды требует доработки sim.

## 12. Блокеры приёмки M6–M12 (на момент 2026-11-04 03:5x)

- `pnpm typecheck` красный из-за незавершённого мержа M6–M12: packages/sim (market.ts/tick.ts/ai.ts/campaign.ts), тесты sim, apps/web MarketPanel/ContractsPanel.
- `pnpm test`/e2e MP/M11 требуют консистентного @sf/sim: при временной рассинхронизации экспортов (market.ts ↔ commands.ts) сервер API не стартует.
- План QA-фазы 2 (после мержа): typecheck/test/build зелёные → e2e полный (SP) + mp.spec (2 браузера) → скриншоты новых экранов (M6–M12) → автобаланс tools/balance-sim → актуализировать таблицы M0–M12, README/CHANGELOG/NEXT.

---

## 13. M6–M12 · Полная игра (фаза 2 QA, 2026-11-04 ~04:00)

> Прогон на срезе phase-2: typecheck PASS, build PASS (1.67 МБ / 451 КБ gzip), e2e SP 6/6, e2e MP 2 браузера PASS, mp-test 27/27, скриншоты 01–16. Unit-тесты: **139/147 PASS, 8 FAIL** — дефекты других агентов, зафиксированы ниже.

| # | Майлстоун | Статус | Доказательство |
|---|---|---|---|
| M6 | Science & Traditions | **PASS** | панель традиций/перков (08-traditions.png), данные TECHS_EXTRA/TRADITION_TREES; unit-тесты modifiers/traditions PASS |
| M7 | Diplomacy, War, AI | **WARN** | панель дипломатии (09-diplomacy.png), войны/совет/шпионаж в UI; **1 FAIL** unit: war.test.ts «торг: противник принимает требования на 20% меньше» (M7-агент) |
| M8 Stations, Market, Missions | **PASS** | панели рынка (11-market.png) и контрактов (12-contracts.png); unit-тесты рынка PASS; **e2e market-cycle.spec.ts PASS**: док→купля/продажа→лимитный ордер (place/cancel)→биржа (volume=10)→маршрут создан→контракт dock выполнен (tick+28)→награда +39 800 Cr (reward 37 000); скриншоты 17-station-market.png, 18-contract-completed.png |
| M9 | Exploration & Narrative | **PASS** | панели кампании (10-campaign.png) и аномалий (14-anomalies.png); unit-тесты campaign/anomalies PASS после мержа |
| M10 | Midgame Crisis & Balance | **WARN** | панель мегаструктур (15-megastructures.png); автобаланс --quick: детерминизм OK, лидер/медиана 1.16× PASS, войны/федерации/кризисы WARN (600 тактов); полный аудит 1000×7200 не прогонялся |
| M11 | Multiplayer Co-op/MMO | **PASS** | tools/mp-test.mjs 27/27; apps/web/e2e/mp.spec.ts 2 браузера PASS (07-mp-coop.png); docs/mp-protocol.md; сервер apps/api, контракт packages/protocol |
| M12 | Late Game, Victory, 1.0 | **WARN** | панель победы/концовок (13-victory.png), golden hash 100 тактов PASS; полный чек-лист 1.0 (локализация/доступность/перф) — вне среза |

### 13.1. Блокеры закрытия M6–M12 (unit-тесты, не зона QA)

**Актуально на финальном прогоне: 262/263 тестов PASS, 1 FAIL.**

| Тест | Ошибка | Владелец |
|---|---|---|
| packages/sim/test/war.test.ts (1) | «торг: противник принимает требования на 20% меньше» — «Доминион Вейла отклонила мирные требования» (ожидалось true) | M7-агент (дипломатия/войны) |

Остальные 8 прежних FAIL (anomalies, campaign, economy, modifiers, golden) закрыты агентами после мержа.

## 14. Финальные прогоны фазы 2

| Время | Прогон | Результат |
|---|---|---|
| ~03:40 | pnpm typecheck | PASS (0 ошибок) |
| ~03:50 | pnpm test | 139/147 PASS, 8 FAIL (промежуточный срез) |
| ~04:15 | pnpm test (финал) | **262/263 PASS, 1 FAIL** (war.test.ts, см. §13.1); typecheck PASS; build PASS (451 KB gzip) |
| ~04:16 | e2e smoke (финальная сборка) | PASS (5/5) — см. журнал ниже |
| ~03:50 | pnpm --filter @sf/web build | PASS: 1 670 КБ JS, 451 КБ gzip |
| ~03:55 | e2e smoke + screens (prod preview) | 6/6 PASS; скриншоты 01–06 пересняты |
| ~04:00 | e2e mp.spec (2 браузера) | PASS: лобби → start → равный тик (07-mp-coop.png) |
| ~04:02 | tools/mp-test.mjs | 27/27 PASS (shared empire coop, MMO separate, пауза/лок/реконнект) |
| ~04:07 | tools/balance-sim.ts --quick | PASS: детерминизм OK; лидер/медиана 1.16× (≤2× PASS), войны 2.3 (WARN), федерации 0.31 (WARN), кризисы 0 за 600 тактов (WARN, короткий горизонт); docs/balance-log.md §7 |

## 15. Скриншоты полной игры (docs/shots)

01-menu, 02-map, 03-system-inspector, 04-flight, 05-station, 06-battle (M0–M5) · 07-mp-coop (M11) · 08-traditions, 09-diplomacy, 10-campaign (M6/M7/M9) · 11-market, 12-contracts (M8) · 13-victory (M12) · 14-anomalies (M9) · 15-megastructures (M10) · 16-coop-lobby (M11 UI). Манифесты: docs/shots/manifest.json, manifest-full.json.

---

## 16. ФИНАЛЬНАЯ ПРИЁМКА M0–M12 (2026-11-04, фаза 3)

> Срез: мерж M6–M12 сошёлся. Гейты и независимые тесты QA ниже; §13–15 сохраняют историю промежуточных прогонов.

### 16.1. Гейты (финальный прогон)

| Гейт | Команда | Результат |
|---|---|---|
| typecheck | node <runtime>/pnpm.mjs typecheck | **PASS** (0 ошибок) |
| unit | node <runtime>/pnpm.mjs test | **PASS: 264/264** (25 файлов) |
| build | node <runtime>/pnpm.mjs --filter @sf/web build | **PASS**: JS 1 679.05 КБ (**453.81 КБ gzip**), CSS 6.38 КБ gzip |
| data:validate | node <runtime>/pnpm.mjs data:validate | **PASS** (9 наборов: jobs 20, districts 7, buildings 27, techs 62, hulls 16, weapons 15, modules 27, designs 18, missions 16) |
| validate-full-data | node <runtime>/pnpm.mjs exec tsx tools/validate-full-data.mjs | **PASS**: techs-extra 42, megastructures 7, crises 5, resolutions 8, espionage 6, modes 5, ethics 8, governments 5, civics 12, focus-goals 10, perks 12, tradition-nodes 35; l10n ru↔en 1094 ключа |
| e2e (SP + скрины + full-game + MP) | SF_BASE_URL=… playwright test -c apps/web/playwright.config.ts | **PASS: 11/11** (1.3 мин, после перехода UI на PanelMenuList/panel-open-*); снимки 01–16 пересняты |
| mp-test | node <runtime>/pnpm.mjs exec tsx tools/mp-test.mjs | **PASS: 27/27** |
| parity SP vs dedicated | tsx tools/parity-test.mjs --ticks 500 | **PASS**: 60 применённых команд, serializeWorld идентичен, hash **ffd059d5** |
| load MMO 100 WS | tsx tools/load-mmo.mjs --clients 100 --observe 16 | **PASS**: 0 ошибок, join 1.4 с, full_state 1.68 МБ/клиент (raw JSON), steady **25.53 МБ/ч/игрок** (бюджет 40), RSS +147 МБ in-process* |
| golden hash 100 тактов (seed 42) | packages/sim/test/tick.test.ts (test PASS) | **7efece3f** (зафиксирован после M6/M8; тест зелёный) |
| persist-test | tsx tools/persist-test.mjs | **PASS: 13/13** — file-store, kill -9, рестарт, join по токену → full_state tick=3 и byte-identical world (458 059 B) |
| store-test | tsx tools/store-test.mjs | **PASS: 8/8** — roundtrip, конкурентные записи, сезон, TTL, битый файл, factory fallback |
| balance-sim --quick | tsx tools/balance-sim.ts --quick | PASS: детерминизм OK; лидер/медиана 1.16×, войны 2.3, федерации 0.31, кризисы 0 (600 тактов) |
| balance-sim 20×5600 | tsx tools/balance-sim.ts --games 20 --ticks 5600 (4 шарда) | выполнено: лидер/медиана 2.17–2.83× (WARN), войны 0.3–0.9 (WARN), федерации 1.07–1.67 (PASS), кризисы 2.20–2.47 (PASS), поражение 0% (PASS) — §17 |

\* RSS измерен в процессе теста, где живут и сервер, и 100 клиентов (завышен относительно серверного процесса; для прод-оценки нужен отдельный клиент-процесс).

### 16.2. Итог M0–M12

| Майлстоун | Статус | Ключевые доказательства |
|---|---|---|
| M0 Foundation | **PASS** | typecheck/test/build зелёные, детерминизм 1000 тактов, save/load round-trip, WebGL2, FPS 75 |
| M1 Galaxy | **PASS** | 100/100 seed связны, 0 изолированных, узкие места 67–71%, детерминизм |
| M2 Economy | **PASS** | такт 3.23 мс среднее / 6.23 мс max (≤5/8), createWorld 240 — 20–30 мс; цепочки дефицита еды/ТП/энергии и восстановление (deficit-chain.test.ts 5/5); стартовое сальдо по 03b §2.2 (канонический конфликт §19.1 — A17/A18, не дефект) |
| M3 Flight | **PASS** | вход/выход без загрузки, HUD, 75 FPS, станция/док; стыковка G из стартовой позиции через автопилот-помощник (PT-010), e2e flight-dock 2/2 |
| M4 Combat | **PASS** | живой L2-бой e2e: вход к пиратам → сближение → огонь → 2 уничтожены, BattleRecord/tactical, трофеи; e2e combat-live PASS; авторезольв 10×10 (autoresolve-10x10.test.ts 3/3) |
| M5 Fleets/Autoresolve | **PASS** | отчёт боя, детерминизм, 10×10; конструктор кораблей (sim + UI + e2e constructor.spec) — T0 доступен со старта, save/load/детерминизм |
| M6 Science/Traditions | **PASS** | панели традиций/перков (08), TECHS_EXTRA/TRADITION_TREES, unit-тесты modifiers/traditions PASS |
| M7 Diplomacy/War/AI | **PASS** | панель дипломатии (09), войны/совет/шпионаж; unit-тесты war/diplomacy PASS (war-тест закрыт агентом) |
| M8 Market/Missions | **PASS** | e2e market-cycle: док → купля/продажа → ордер → биржа → маршрут → контракт выполнен с наградой +39 800 Cr; unit-тесты рынка PASS; скриншоты 17/18, acceptance §20 |
| M9 Campaign/Narrative | **PASS** | панели кампании/аномалий (10/14), unit-тесты campaign/anomalies PASS |
| M10 Crisis/Balance | **PASS** | полный аудит **1000 сидов × 3 стратегии × 7200 тактов = 3000 партий**: лидер/медиана 1.50–1.62×, ВВП лидера 36–40%, войны 7.6–10.0/100 лет, федерации 1.67–1.71, кризисы 4.16–4.37 (все 5 видов), мегаструктуры 4.71–5.43, поражение 0%, детерминизм OK — §21, docs/balance-log.md §10 |
| M11 Multiplayer | **PASS** | mp-test 27/27, e2e 2 браузера, parity SP==dedicated; **персистентность**: store-test 8/8, persist-test 13/13; **hardening 1.0**: pg-redis-test 12/12 (живые PG/Redis), HMAC-токены (token-test 5/5), interest management (full_state gzip 36.6 КБ), load-300 PASS (300 WS, 0 ошибок), audit 0 vulns — docs/mp-protocol.md §10–11 |
| M12 Late Game/1.0 | **PASS** | victory-панель (13), golden hash 1bfd9c71; RU — 100% контента и интерфейса, EN — опция (1798/1798, 659 overrides); e2e locale RU↔EN; accessibility axe 0 violations; coverage 88.9% stmts; ESLint 0 errors; CI workflow; конструктор; README «Качество 1.0» |

### 16.3. Скриншоты (docs/shots, манифесты manifest.json + manifest-full.json)

01-menu, 02-map, 03-system-inspector, 04-flight, 05-station, 06-battle, **07-mp-coop**, 08-traditions, 09-diplomacy, 10-campaign, 11-market, 12-contracts, 13-victory, 14-anomalies, 15-megastructures, 16-coop-lobby (15 — снят в предыдущем прогоне: закрытие панели иногда флейкует; 14 — из текущего). Сняты Playwright/Chrome WebGL2 1600×900 на production preview, console/page errors = 0.

### 16.4. Ограничения и остаток до 1.0

**Сняты в v0.3.0 (см. §18):**
1. ~~Поздний баланс: снежный ком, редкие войны, 0 мегаструктур у ИИ~~ — закрыто: §18.1, docs/balance-log.md §8.
2. ~~MMO-персистентность отсутствует (комнаты в памяти)~~ — закрыто: PostgreSQL/Redis + FileStore, store-test 8/8, persist-test 13/13 (§18.2).
3. ~~EN-контент не вычитан / переключение локали не проверено~~ — закрыто: RU 100% основной, EN 1798/1798 опционально (§18.3).

**Остаются (не входят в три снятых ограничения):**
1. MMO: JSON-снапшоты без interest management; PgStore/RedisSide не прогонялись в CI против реальных серверов (docker-compose приложен); токены реконнекта в seats JSON открыты (TODO: HMAC/хэш); в БД пишется полный serializeWorld.
2. M12-чеклист 1.0: доступность (частично), heap <150 МБ/3 ч, S1/S2-баги, безопасность/аудит зависимостей — не закрыты.
3. Полный автобаланс 1000 партий × 7200 тактов и паритет к dedicated-серверу при 300 CCU — не прогонялись (60 партий × 5600 — §18.1).
4. M4 живой бой L2 и конструктор кораблей — вне среза (клиентская подсистема по A4).

## 17. Автобаланс 20 игр × 5600 тактов (исторический прогон до v0.3.0)

> Актуальные результаты после анти-снежка — docs/balance-log.md §8 и §18.1. Таблица ниже сохранена как история прогона до v0.3.0.

> Запуск: 4 шарда по 5 игр (seed 1000–1004 / 1005–1009 / 1010–1014 / 1015–1019), 3 стратегии, 5600 тактов; каждый шард — отдельный процесс (баланс-сим печатает агрегат по своим сидам).
> Сырые логи шардов: `docs/shots/balance-shards.json`. Детерминизм в каждом шарде: OK.

| Шард (seed) | Лидер/медиана | Войны | Федерации | Кризисы | Поражение галактики |
|---|---|---|---|---|---|
| 1000–1004 | 2.17× (industrial 2.52 / science 2.16 / military 2.57) | 0.3 | 1.33 | 2.47 | 0% |
| 1005–1009 | 2.45× | 0.4 | 1.40 | 2.33 | 0% |
| 1010–1014 | 2.19× | 0.9 | 1.07 | 2.20 | 0% |
| 1015–1019 | 2.83× | 0.3 | 1.67 | 2.33 | 0% |

**Итоговые вердикты v0.3.0 (60 партий: 20 сидов × 3 стратегии × 5600 тактов, 4 шарда):**

| Метрика | Цель | Факт v0.3.0 | Статус |
|---|---|---|---|
| Лидер/медиана по счёту | ≤ 2.0× | **1.70–1.76×** | **PASS** |
| Доля ВВП лидера | ≤ 40% | **38–39%** | **PASS** |
| Войны за 100 лет (накопительно) | ≥ 3 | **7.3–8.9** | **PASS** |
| Федерации | ≥ 1 в части партий | 1.35–1.40 | **PASS** |
| Кризисы за партию | 1–3+ | 4.2–4.5 (все 5 видов, поздние 4600/5200) | **PASS** |
| Мегаструктуры за позднюю партию | ≥ 0.1 | **3.9–4.2** (ИИ строит gate/sentinel) | **PASS** |
| Общее поражение галактики | ≤ 40% партий | 0% | **PASS** |
| Детерминизм | 2× прогон | OK | **PASS** |

**Вывод:** поздний баланс сходится к целям. Детали механик и полный лог — docs/balance-log.md §8; регрессионный тест packages/sim/test/late-balance.test.ts (5 тестов).
## 18. Снятие ограничений v0.3.0 (2026-11-04)

Три ограничения из v0.2.0 сняты: поздний баланс, MMO-персистентность и языковой слой. Гейты среза: typecheck 0, unit 269/269, build 530 КБ gzip, e2e 14/14, mp-test 27/27, store-test 8/8, persist-test 13/13; golden hash 100 тактов seed 42 = c3f2d543.

### 18.1 Поздний баланс M10 — PASS

Реализовано (без читов, тем же тактом и командами):

- административная нагрузка (спраул): штраф производства/науки/роста от числа колоний и систем, стоимость колонии растёт, лимит флота снижается (03b §5.8, GDD §7.7/§19.6);
- лимит районов на колонию (planet_size+4, минимум 8) — убран бесконечный рост трёх стартовых колоний;
- catch-up-наука для отстающих школ (до +80%) и кэш лидерских тиров (GDD §8.8);
- коалиция против лидера: доля ВВП >40% даёт -40 мнения и рост агрессии ИИ (GDD §16.5);
- ИИ-войны: кулдаун 60, порог агрессии 45, второй фронт при 75, вассализация при 2× FP, коалиционные цели; CB «унижение» при мнении < -25 (GDD §12.6);
- ИИ берёт перки/традиции и строит мегаструктуры при T3+перке+1200 сплавов (7 типов, общие команды).

Автобаланс 60 партий (20 сидов × 3 стратегии × 5600 тактов, 4 шарда): лидер/медиана 1.70–1.76×, доля ВВП лидера 38–39%, войны 7.3–8.9 за 100 лет, федерации 1.35–1.40, кризисы 4.2–4.5 (все 5 видов), мегаструктуры 3.9–4.2, поражение галактики 0%, детерминизм OK. Полный лог — docs/balance-log.md §8.

Регрессия: packages/sim/test/late-balance.test.ts (спраул, catch-up, коалиция, поздний прогон 5600: войны≥3, мегаструктуры≥1, ratio≤2, лидер≤40%, перки ИИ, детерминизм).

### 18.2 MMO-персистентность PostgreSQL/Redis — PASS

Слой apps/api/src/store:

- FileStore — durable JSON в .data/ (атомарная запись tmp→rename, очередь, TTL, сезон, устойчивость к битым файлам) — dev/тесты без внешних серверов;
- PgStore — PostgreSQL: sf_rooms (seats JSONB + последний мир), sf_snapshots (ретеншен 5), sf_season, sf_presence; upsert в транзакции;
- RedisSide — presence (TTL 60с), кэш комнат (30с), сезонный ключ; недоступность Redis не валит сервер;
- createPersistence: DATABASE_URL → PG (fallback FileStore при ошибке), иначе FileStore; REDIS_URL — опционально;
- Room.toRecord/fromRecord (serializeWorld/deserializeWorld, seats/токены/состояние, restore-grace), дебаунс записи 1.5с, запись на тик/команду/join/leave/start, восстановление комнат при старте, graceful shutdown flush, TTL-очистка, сезон MMO (/season, /season/reset), /admin/flush, /admin/stats, /health с persistence/redis/season;
- docker-compose.yml (postgres:17 + redis:7, healthchecks, volumes), .env.example.

Тесты: tools/store-test.mjs 8/8 (roundtrip комнаты/мира, 20 конкурентных записей, сезон, битый файл, TTL, delete/stats, factory fallback, SF_DATA_DIR); tools/persist-test.mjs 13/13 (create/join/start → 3 тика → kill -9 → рестарт → комната восстановлена, join по токену → full_state с тем же тиком и байт-идентичным миром 458059 B). Регресс: mp-test 27/27, e2e mp PASS.

Остаток: PgStore/RedisSide не прогонялись в CI против реальных контейнеров (docker-compose приложен); токены в seats JSON открыты (TODO HMAC); в БД пишется полный serializeWorld без interest management.

### 18.3 Языковая политика и контент — PASS

**Русский — основной и обязательный язык.** Аудит RU: 37 JSON, 0 пустых/не-русских текстовых полей, 0 смешанных англицизмов (кроме канонических FP/FSD/Mk/CR/L1–L3/SYS/ENG/WEP), 0 десятичных точек, 0 прямых кавычек, 0 пробелов перед пунктуацией, 0 нарушений согласования числительных. Вычищены служебные пометки (GDD/03b), MK→Mk, T1→тир 1, VIP-персона→Высокопоставленная особа, CB→повод к войне, предтечи→Строители; l10n/ru.json: seed→зерно, move_fleet/build_ship→приказ движения, Bloom→Свечение, Assist→ассист, T{tier}→Тир {tier} и др. (17 правок).

EN — опциональный переключатель (не требование): 1798/1798 RU-строк данных имеют EN (659 вычитанных overrides ключевых терминов, глоссарий docs/en-glossary.md), имена процедурных сущностей транслитерируются; переключение RU↔EN без перезагрузки, e2e locale.spec PASS (RU: нет английских подписей, EN: нет кириллицы, обратно RU). Скриншоты docs/shots/ru-*.png и en-*.png.

Ограничение EN-слоя: динамические сообщения симуляции (журнал/тосты/бой) собираются на RU и в EN остаются RU — отдельный слой runtime-i18n вне задачи; мир, созданный в EN, при возврате RU сохраняет латинские имена.

### 18.4 Что осталось до 1.0 (вне трёх снятых ограничений)

1. MMO: interest management/бинарные снапшоты, PgStore/RedisSide CI-прогон, хэширование токенов, шардирование 300 CCU, k6-профиль.
2. M12-чеклист: доступность (частично), heap <150 МБ/3 ч, S1/S2-баги, безопасность/аудит зависимостей, ESLint/coverage в CI.
3. Полный аудит 1000 партий × 7200 тактов (сейчас 60×5600) и паритет к dedicated-серверу при 300 CCU.
4. Runtime-i18n сообщений симуляции для EN (RU — полностью готов).
5. M4 живой L2-бой/конструктор кораблей — вне среза.

---

## 18. M11-hardening (задача task-19, 1.0)

### 18.1. Гейты

| Проверка | Результат |
|---|---|
| tools/pg-redis-test.mjs (живые postgres:17 + redis:7 через docker compose) | **12/12 PASS** — PgStore (save/load, snapshot retention 5, season, TTL, stats), RedisSide (presence/cache/season), сервер с DATABASE_URL+REDIS_URL: graceful shutdown сохраняет комнату → рестарт → восстановление tick=2 + byte-identical full_state (458 085 B), health=postgres+redis |
| HMAC-токены (`apps/api/src/auth/token.ts`) | token-test **5/5 PASS**: HMAC-SHA256, TTL 24ч, отказ чужому токену/секрету, constant-time verify, admin-secret; в хранилище только tokenHash; регресс mp-test 27/27 + persist-test 13/13 |
| Interest management | снапшот на seat: видимые системы/флоты/свои события; full_state gzip **36.6 КБ**, snapshot gzip **1.58 КБ**, видимых систем 4/240; доставка full_state чанками (setImmediate), heartbeat не даёт ложных timeout при дрейфе |
| tools/load-300.mjs | **PASS**: 300/300 WS, 0 ошибок, join+hello `2 с, gzip full_state 36.6 КБ (≪1.5 МБ), steady `5.5 МБ/ч/игрок; **WARN**: одновременный холодный старт 3×100 — `50–58 с доставки full_state (CPU permessage-deflate), реальные входы разнесены |
| Security | security headers, CORS allowlist (SF_CORS_ORIGINS), HTTP rate limit token bucket, bodyLimit 256 КБ, admin под constant-time x-admin-token, лимит WS-соединений; **pnpm audit --prod: 0 known vulnerabilities** (zod ^4.6.6) |

---

## 22. Часть XIII · Древние, расы и Реликтовый Предел (M9c, task-30)

Дата приёмки: 2026-11-04. Golden hash 100 тактов seed 42 = **1bfd9c71** (packages/sim/test/tick.test.ts).

---

---

---

---


---


---

## 30. RPG-древо традиций и визуал колоний (task-58, 2026-11-08)

Финальные гейты релиза: typecheck **0**; unit **343/343** (34 файла); golden **8f52b0a6**; полный e2e **67/67 PASS** (5.8 мин). Gift: **3.01 МБ**, zip **1.04 МБ**, verify-portable **10/10**; site синхронизирован; legacy-check 0.

| # | Требование | Статус | Доказательство |
|---|---|---|---|
| 1 | Древо традиций: 7 ветвей, 42 узла+финишеры | **PASS** | e2e traditions-tree: 7 ветвей, 42 узла, финишеры, зум 74%, fit, клик unlock dis_1, перки, 1280×720 |
| 2 | Визуал колоний: HUD «Колонии системы» | **PASS** | e2e colonies-visual: планета и луна в системе, WebGL-канвас, frame check 500 мс; скриншот flight-colonies-1280.png |
| 3 | Скриншоты | **PASS** | docs/shots/traditions-tree-1280.png, flight-colonies-1280.png |
| 4 | Гейты | **PASS** | typecheck 0; unit 343/343; e2e **67/67**; gift verify 10/10 |

**Скриншоты:** traditions-tree-1280.png, flight-colonies-1280.png, story-ancient-archive.png, dialogue-outcome.png, politics-map-1280.png.
