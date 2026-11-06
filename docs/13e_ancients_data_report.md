# Часть XIII · Данные Древних и Реликтового Предела — карта и решения

> Отчёт content-designer по task-26. Источник истины по нумерации миссий — **13b** (зафиксировано Lead); ветвь 13c привязана к миссиям 13b. Все JSON — в `packages/data/src/ancients/`, схема `schema.ts`, экспорт `index.ts`.

## 1. Карта данных

| Файл | Кол-во | Ключи/диапазон |
|---|---|---|
| races.json | 20 (8 playable + 12 NPC) | race_velan, race_keransari, race_siltar, race_drakar, race_thalassi, race_freeborn, race_ultar, race_lithan; race_npc_* (компас/стая/кальд/пламень/клинки/архив/скользящие/клеймо/стражи/уцелевшие/устье/молчащие) |
| traits.json | 44 (35 «+» / 9 «−») | eco_*/mil_*/sci_*/dip_*/env_*/rel_*, cul_liturgy; бюджет рас ровно +3.0 |
| techs.json | 30 A0–A5 (3/6/7/8/4/2) | a0_relic_reading … a5_ansari_ascension; gateMission A0=1, A1=2, A2=4, A3=6 (a3_warp_drive=7), A4=8, A5=12 |
| quests.json | 12 | anc_m01_beacon … anc_m12_legacy; objectives visit/scan/relics/cores/tech/warp_jump/sector_scan/kill_fp/flag/relation |
| codex.json | 44 | cx_ansari_name … cx_end_give; категории: раса/история/технология/место/фракция/правда/предмет/механика/событие/финал |
| factions.json | 4 | ansari_remnants, choir, fallen, wardens |
| pois.json | 44 | poi_anc_01…poi_anc_44; 15 видов POI, привязаны к 5 регионам пулом poiKinds |
| regions.json | 5 | ruins 12, quiet_wastes 11, choir_rift 9, ansari_gardens 8, gates 5 = 45 |
| hazards.json | 9 | haz_choir_wave, haz_call, haz_anomaly, haz_warden, haz_sensor_degradation, haz_radiation, haz_fallen_raid, haz_poi_trap, haz_blackhole_masslock |
| endings.json | 3 | ending_seal / ending_use / ending_give (choice seal/use/give; campaignEnding: ending_seal / ending_control / ending_release) |
| names.json | prefixes 16 / roots 24 / suffixes 12 | банк имён сектора «Ир-Лад» |

## 2. Проверки

| Команда | Результат |
|---|---|
| `node tools/validate-full-data.mjs` | ✅ exit 0, «full data validation passed» (секция ancients: количества, id, ссылки, бюджет трейтов, эффекты, тиры, unlock-токены, кодекс-условия, 45 систем, финалы, банк имён) |
| `pnpm data:validate` | ✅ exit 0 (срез и ancients не ломают схему) |
| `pnpm typecheck` | ⚠ ошибки только в чужих WIP-файлах: `packages/sim/src/ancients.ts` (sim-engineer: string→number в PRNG/сигнатурах, EventKind «ancients»), `apps/web/src/render/system/SystemView.ts`, `SceneHost/scene.ts` (flight-engineer: warp-хуки). В `packages/data` ошибок нет |

## 3. Решения и отклонения

| # | Решение | Причина |
|---|---|---|
| 1 | Нумерация миссий — 13b (12 миссий); gateMission A0=1, A1=2, A2=4, A3=6, A4=8, A5=12; a3_warp_drive gate=7 | 13c §2.6 использует другую нумерацию миссий; Lead зафиксировал 13b как истину. Варп-двигатель требует миссию 7 (Карта Предела), первый прыжок — миссия 9 |
| 2 | Стартовые бонусы рас, невыразимые в RaceStartBonusDef, аппроксимированы: Дракары/Ул-Тар «+2 корвета» → alloys 50; Таласси «святыня +50 единства» → credits 25 000; Лит'Ан «модуль +50 единства» → alloys 25 | В схеме нет единства/кораблей в start; иначе данные не пройдут валидацию |
| 3 | endings ids — контракт sim (`ending_seal/ending_use/ending_give`), а не anc_end_* из 13b | `ancientsFinalChoice` в sim выставляет именно эти id |
| 4 | POI: rewardRelics/rewardCores содержат только реликвии/ядра; сплавы, наука, ТМ, чертежи, корабли — в descRu | В SectorPoiDef нет полей под другие награды; расширение схемы — к Lead |
| 5 | Связь POI↔регион — через `region.poiKinds` (в POI нет region-поля) | Схема; валидатор требует, чтобы каждый kind POI был привязан к региону, а каждый kind региона имел POI |
| 6 | Эффекты трейтов/технологий — существующие ключи modifiers.ts + новый список (relic_yield, warp_*, core_*, habitability_*, gate_pairs, structure_limit, choir_attention и др.); sim-engineer подтвердил: базовые ключи штатно, новые — в EmpireModifiers.special, часть применяется механикой | Требование задачи «ключи, которые понимает modifiers.ts»; согласовано с sim-engineer |
| 7 | Брифинги миссий и кодекс — сжаты до 1–2 предложений (в 13b норматив 60–180 слов для кодекса) | Объём; при необходимости расширю тексты в JSON без смены структуры |
| 8 | У рас одно `greetingRu` (в 13a — по 3 реплики) | В RaceDef поле типа string |
| 9 | Мегаструктуры/6 архео-цепочек/6 испытаний/3 корабля/20 событий сектора не заведены отдельными JSON | В schema.ts нет соответствующих интерфейсов; они частично покрыты POI/poidesc; если sim/UI нужны — расширение схемы |

## 4. Открытые вопросы к Lead

1. Нужны ли отдельные данные для мегаструктур сектора, архео-цепочек, испытаний Стражей, реликтовых кораблей и 20 событий (сейчас нет в схеме)?
2. Нужны ли EN-поля для ancients (сейчас RU-only, как в задании)?
3. Расширять ли кодекс до 60–180 слов на запись (сейчас краткие)?

## 5. Расширение: объекты и события Реликтового Предела (по запросу Lead)

Схема `packages/data/src/ancients/schema.ts` расширена **опциональными** полями `AncientsBundle` — sim читает по наличию, обратная совместимость сохранена: `sectorMegastructures?`, `archaeologyChains?`, `wardenTrials?`, `relicShips?`, `sectorEvents?`. Новые интерфейсы: `SectorMegastructureDef`, `ArchaeologyChainDef`, `WardenTrialDef`, `RelicShipDef`, `SectorEventChoiceDef`, `SectorEventDef`. Экспорт: `SECTOR_MEGASTRUCTURES`, `ARCHAEOLOGY_CHAINS`, `WARDEN_TRIALS`, `RELIC_SHIPS`, `SECTOR_EVENTS` (+ `*_BY_ID`), все продублированы в `ANCIENTS_BUNDLE`.

| Файл | Кол-во | Содержание |
|---|---|---|
| sector-megastructures.json | 3 | sector_gate_ring (Врата, region gates, миссия 10), sector_star_core (Ядро звезды, gardens, миссия 11), sector_archive (Архив Вечности, ruins, репутация ≥30) |
| archaeology-chains.json | 6 | Корабль Ансаров (5), Город под корой (3), Песнь Дорог (4), Ключ от Врат (3), Могила Адмирала (2), Сад, который помнит (6) — **23 шага**, 8 реликвий + 2 ядра суммарно |
| warden-trials.json | 6 | Молчание, Точность, Скорость, Память, Смирение, Верность (у Верности бой 2 000 FP при жёстком провале) |
| relic-ships.json | 3 | Реликтовый крейсер «Свидетель», Реликтовый линкор «Наследие», Дрон-матка «Хор» (hullId сверяется с классами корпусов, лимит 1) |
| sector-events.json | 20 | 20 событий с 2 выборами и ценой; conditions в triggerRu (flag/region/poi/noise/rep/mission) |

Валидатор дополнен: количества 3/6/6/3/20, уникальность id, region/hullId/classId/requiredTech/requiredChain/rewardTech/rewardCodex-ссылки, сумма шагов ≥23, ≥2 выбора и непустые effects у событий.

## 6. Итоговые проверки (после расширения)

| Команда | Результат |
|---|---|
| `node tools/validate-full-data.mjs` | ✅ exit 0 (ancients + расширение) |
| `pnpm data:validate` | ✅ exit 0 |
| `pnpm typecheck` | ✅ exit 0 |
| `pnpm test` | ⚠ 298/299: единственный провал — golden hash (`tick.test.ts`, sim-константа), ожидается пере-базирование после контент-фриза; ancients-тесты зелёные |

## 7. Дополнительные решения (за 5-й итерацией)

| # | Решение | Причина |
|---|---|---|
| 10 | `race_velan.start.colonizers` убран: бесплатный колонизатор (+2 FP) выводил стартовый флот за лимит и ломал `build_ship`/colonize-тест; вместо корабля — `alloys:30 + goods:20` (игрок строит колонизатор сам) | `applyRaceStartBonuses` добавляет корабль в флагманский флот, FP считается против cap; канонный стартовый флот и так 28 FP |
| 11 | Мегаструктуры/цепочки/испытания/корабли/события сектора вынесены в отдельные опциональные массивы, а не в существующие | Lead: нужны отдельные данные; опциональные поля не ломают sim, который читает bundle |
