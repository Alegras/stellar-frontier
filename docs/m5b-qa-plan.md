# QA-план M5b «Сетка командования» (grid battle)

Статус: UI task-62 и sim task-61 в работе, арт task-63 в работе. QA подготовил headless-верификатор; финальная приёмка — после арт-стрипов и подменю способностей/hover-урона.

## Объём
1. **Фича-флаг OFF по умолчанию**: localStorage `sf.gridBattle` не задан → нет кнопки/оверлея; `sf.gridBattle=1` → кнопка `btn-grid-battle` в SystemInspector при своих+враждебных флотах; sim `world.flags.grid_battle` OFF по умолчанию.
2. **Реальный адаптер** @sf/battle-grid (не мок; мок — только fallback): `apps/web/src/ui/grid-battle/adapter.ts`, host в FullGameOverlays с паузой.
3. **S30 расстановка**: 7+3 (фронт/резерв), формации, авто/сброс/в бой, coop 90с, список стеков, 1280×720.
4. **S31 бой**: инициатива/раунды/MP/действия/лог; пауза мира; reduced-motion.
5. **S32 итог**: потери/трофеи/XP/parity с авторезолвом; возврат на карту.
6. **Детерминизм/replay/save**: одинаковый seed → replayHash/battleStateHash; serialize/deserialize.
7. **Вход с L0**: own+hostile флоты в системе; eligibility guard (FP/стеки/система).
8. **Арт task-63**: гексы/юниты/эффекты, способности/hover-урон; проверить отсутствие 404 и читаемость на 1280.
9. **Гейты**: typecheck 0, unit (battle-grid 14 + all), e2e grid-battle 3/3, полный e2e, acceptance §32, gift/site.

## Артефакты QA
- `tools/grid-battle-verify.mjs` — headless: данные 8/16/6/3, S30 deploy, S31→S32, детерминизм/replay/save, feature flag OFF/ON, eligibility guard.
- `apps/web/e2e/grid-battle.spec.ts` (UI) — S30→S31→S32, вход с L0, reduced-motion+flag off.
- Скриншоты: grid-entry/deploy/battle/result-1280.png.

## Текущий baseline (до финальной приёмки)
- typecheck 0; unit **360/360** (35 файлов); headless grid-verify **7/7**; UI grid-battle spec заявлен 3/3; полный e2e ожидается ~72 (69+3).

## Риски/акценты
- Флаг строго OFF по умолчанию; включение только через localStorage, не через sim.
- Реальный адаптер: проверить, что при наличии пакета используется @sf/battle-grid, мок только fallback.
- Паритет с авторезолвом: parity criteria (mean |Δloss| ≤0.10, within ±0.10 ≥0.80, outcome 100%) — на малых сценариях возможны выбросы, зафиксировать.
- Кооп 90с — таймер/лок; проверить отсутствие утечек/пауз.
- Арт: 404/пустые гексы на 1280, reduced-motion не ломает рендер.
- Gift: battle-grid встроить в portable (data URI/ассеты), verify 10/10.
