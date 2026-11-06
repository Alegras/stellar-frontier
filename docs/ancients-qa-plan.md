# Часть XIII · QA-план M9c (prep, до мержа sim/UI)

Дата: 2026-11-04 `22:30. Автор: qa-engineer (task-30).
Статус: sim-engineer пишет `packages/sim/src/ancients*`; данные `packages/data/src/ancients/*.json` — заглушки (`3 байта`); UI/flight Части XIII ещё нет; задачи task-26 (контент) и task-28 (UI) — без исполнителя. QA готовит независимые проверки, ждёт мержа.

## 1. Что уже готово (QA-инфраструктура)

| Артефакт | Назначение |
|---|---|
| `tools/ancients-verify.mjs` | headless-проверка данных/гейтов/конечности/варпа/сектора/save/детерминизма/7-го условия. Запуск: `node <runtime>/pnpm.mjs exec tsx tools/ancients-verify.mjs` |
| `tools/verify-portable.mjs` | проверка `file://` портативной сборки (меню, WebGL2, старт кампании, canvas, console errors, скриншоты). Сейчас **6/6 PASS** на текущей сборке |
| gift-пайплайн | `pnpm build` → `tsx tools/make-portable.mjs` → `tsx tools/make-gift.mjs` → (zip) → `verify-portable.mjs`; скрипты уже есть |
| `docs/ancients-qa-plan.md` | этот план |

## 2. Базовый прогон `ancients-verify` (до мержа)

```
PASS=9  FAIL=10  SKIP=1
```

Ожидаемые FAIL (зависят от task-26/sim):
- 8 FAIL — данные пусты: расы 0/20 (8 playable), 12 миссий/гейты, ветвь A0–A5, 3 финала, 5 регионов/45 систем, фракции, кодекс 40+, POI 40+.
- 1 FAIL — генерация сектора: `sector.systems=1` (тестовая инъекция), `generated=false`; функции генерации 45 систем пока нет.
- **1 реальный баг sim (уже передан sim-engineer):** `warpJump` не проверяет радиус 60 св. лет — прыжок на любую систему разрешён.

Зелёное уже сейчас: fg.ancients инициализируется, старт линии закрыт (tick 0, tier −1), конечность реликвий/ядер (cap 60/20), варп-заряд/кулдаун 5 тактов, 3 финала применяются, 6 условий победы (7-го нет), save/load ancients-состояния, детерминизм мира seed 42.

## 3. Матрица приёмки M9c → проверки

| # | Критерий M9c | QA-проверка | Статус |
|---|---|---|---|
| 1 | 8 рас играбельны, нет доминирования >10% | данные (8 playable + 12 NPC) + автосимулятор рас (расширение tools/balance-sim) | ожидает task-26 |
| 2 | Линия стартует как побочная во II акте, не блокирует | tool: старт закрыт, доступна после `ANCIENTS_START_TICK=1200`/аномалии; e2e: панель/квест до старта недоступны | частично PASS (старт закрыт) |
| 3 | 12 миссий, каждая открывает свой гейт | tool: quests=12, index 1..12, объединение unlocks ⊇ A0–A5/warp/sector/ending | ожидает данные+line |
| 4 | Варп: радиус 60 св. лет, ядро, 60 с, кулдаун 5, 15% Хор | tool: заряд/кулдаун PASS; **радиус FAIL**; 15% риск — после ancients-warp; UI-кнопка «Почему нельзя прыгнуть» | 1 FAIL |
| 5 | Сектор 45 систем, вход варпом/Вратами, выход не ломает сейв | tool: 45 систем/5 регионов; save/load в секторе; e2e вход/выход, после выхода save→load | ожидает sim |
| 6 | Хор не убивает за 1 такт; вторжение по таймеру | tool/sim-тест: chorusThreat-волны, invasion timer, урон <порога | ожидает sim |
| 7 | Реликвии/ядра конечны; нельзя купить за кредиты | tool: cap 60/20 PASS; статическая проверка — нет `ResourceId` реликвий/ядер, нет рынка для них; property-тест «нельзя превысить лимит» | PASS (cap) |
| 8 | Ветвь отдельно от трёх школ; гейты в UI | e2e: панель «Наследие» отдельная вкладка (A0–A5), гейты-миссии объяснены, счётчики реликвий/ядер | ожидает UI |
| 9 | 3 финала достижимы и влияют на концовки кампании | tool: 3 выбора PASS; e2e: выбор финала, запись в кодексе/концовке; нет 7-го условия победы (PASS) | частично PASS |
| 10 | Метки сектора без наложений, вкладка на 1280×720 | e2e screens/axe: скриншоты 1280×720, labels, keyboard, axe 0 critical | ожидает UI |

## 4. План e2e (`apps/web/e2e/ancients.spec.ts`, после UI)

1. **Раса:** меню → выбор расы (8 карточек) → «Новая кампания» seed 42 → top-bar, раса в состоянии (`game.world.fg.ancients.playerRace`), стартовые бонусы расы.
2. **Панель Древних:** «Ещё…» → пункт «Древние/Наследие» → вкладки: Линия / Технологии / Кодекс / Сектор; до II акта — «Линия спит» (гейт), счётчики 0/60, 0/20.
3. **A0–A5:** через `window.__SF_GAME__` прокрутить линию до миссии 3 (или tick 1200 + отладка), открыть тех A0 (`ancients_tech`), проверить отдельную вкладку, списание реликвий/ядер, лимит.
4. **Варп:** после миссии 9 (или флаг) — кнопка «Варп-прыжок», выбор цели, «Почему нельзя» при отсутствии заряда/кулдауне; прыжок меняет систему флота и cooldown 5.
5. **Сектор:** вход (Врата/варп) → вкладка «Реликтовый Предел»: 45 меток, 5 регионов, «ВНЕ ГИПЕРЛИНИЙ», scan/claim, выход на карту, save→load.
6. **Финал:** 3 кнопки (Запечатать/Использовать/Отдать) → запись концовки; victory conditions остаются 6.
7. **1280×720:** скриншоты сектора/панели; axe WCAG 2.1 A/AA (0 critical).

## 5. Контракт data-testid для UI (предложение, согласовать с ui-engineer)

| Элемент | testid |
|---|---|
| Выбор расы в меню | `select-race`, `race-card-<raceId>`, `race-details` |
| Пункт меню полной игры | `panel-open-ancients` (+ PanelId "ancients") |
| Панель/вкладки | `panel-ancients`, `btn-ancients-tab-line|tech|codex|sector` |
| Линия | `quest-row-<index>`, `btn-quest-accept-<id>`, `quest-gate` |
| Технологии A0–A5 | `ancients-tier-<0..5>`, `btn-ancients-tech-<id>`, `ancients-relics`, `ancients-cores` |
| Кодекс | `codex-entry-<id>` |
| Варп | `btn-warp`, `warp-status`, `warp-target-<systemId>`, `warp-reason` |
| Сектор | `sector-map`, `sector-label-<systemId>`, `sector-region-<id>`, `btn-sector-scan`, `btn-sector-claim`, `btn-sector-exit` |
| Финал | `btn-final-seal|use|give`, `final-choice-status` |
| HUD | `mp-status-hud` (уже есть), `ancients-hud` (реликвии/ядра/варп-кулдаун) |

## 6. Портативная сборка (gift)

После мержа Part XIII:
1. `node <runtime>/pnpm.mjs build` (vite production)
2. `node <runtime>/pnpm.mjs exec tsx tools/make-portable.mjs` → `StellarFrontier.html` (+ вычитка make-gift: обновить текст «что в игре» — добавить Древних/расы/сектор/варп)
3. `node <runtime>/pnpm.mjs exec tsx tools/make-gift.mjs` → gift/StellarFrontier.html, Играть.cmd, ЧИТАЙ-МЕНЯ.txt
4. zip: `Compress-Archive` gift/* → `gift/StellarFrontier-1.0-portable.zip`
5. `node <runtime>/pnpm.mjs exec tsx tools/verify-portable.mjs` → 6+ проверок PASS (file://, WebGL2, старт, canvas, 0 console errors, скриншоты)
6. Проверить, что Part XIII-экраны (раса/панель/сектор) доступны в file:// сборке.

## 7. Блокеры/координация

- **task-26 (контент данные) без исполнителя** — 8 FAIL в ancients-verify; без данных sim/UI не пройдут. Прошу Lead назначить content-designer.
- **task-28 (UI Части XIII) без исполнителя** — e2e/скриншоты/axe заблокированы; нужен ui-engineer (+ testid по §5).
- sim: ancientsPhase — заглушка, нет ancients-warp/sector (кроме части ancients.ts), нет генерации 45 систем, нет проверки радиуса 60 св. лет; ждём sim-engineer + golden hash.
- После мержа: прогнать typecheck/test/build/e2e (весь набор + ancients.spec), обновить docs/acceptance (M9c), NEXT/CHANGELOG/README, пересобрать gift, финальный отчёт Lead.

## 8. Команды QA

```bash
node <runtime>/pnpm.mjs typecheck
node <runtime>/pnpm.mjs test
node <runtime>/pnpm.mjs --filter @sf/web build
node <runtime>/pnpm.mjs exec tsx tools/ancients-verify.mjs       # headless M9c
node <runtime>/pnpm.mjs exec tsx tools/ancient-...               # появится: line/warp/sector
node <runtime>/pnpm.mjs exec tsx tools/verify-portable.mjs       # gift file://
SF_BASE_URL=http://127.0.0.1:5174 node <runtime>/pnpm.mjs exec playwright test -c apps/web/playwright.config.ts e2e/ancients.spec.ts
```

## 9. Итог приёмки (2026-11-04, после мержа)

- tools/ancients-verify.mjs: **34/34 PASS** (гейты 12 миссий, конечность 60/20, варп-радиус/кулдаун/риск 15%, 45 систем/5 регионов/детерминизм, вход/выход, Хор-волны/вторжение, save/load, 3 финала, нет 7-го условия победы).
- apps/web/e2e/ancients.spec.ts: **3/3 PASS** (раса+HUD+1280×720, гейт II акта/миссии/A0, сектор 45/вход-выход/варп с карты/финал); скриншоты 19–25.
- Полный e2e: **29/29 PASS** (`--workers=1 --retries=0`, 3.3 мин), включая axe (5 экранов, 0 violations), ancients-ui/warp-sector от UI/flight.
- Golden hash seed 42 = **4ced0b78**; unit 299/299; typecheck 0; data:validate PASS.
- Gift: StellarFrontier.html 2.19 МБ (+gift/копия), zip ~617 КБ, verify-portable **8/8 PASS** (file://, WebGL2, 8 рас, панель Древних, 0 ошибок консоли).
