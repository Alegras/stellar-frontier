# Справочник контента полной игры (M6–M12)

> Дополнение к `docs/content-reference.md` (срез M0–M5). Источник истины по числам — JSON в `packages/data/src/full/` и `packages/data/src/campaign/`.
> Обновлено: 2026-11-04 (data-systems + data-campaign). Проверка: `node tools/validate-full-data.mjs` — id, ссылки, количества, миссии по актам, артефакты, паритет ru↔en.

## 0. Состав пакетов

| Пакет | Файл | Экспорт @sf/data | Кол-во |
|---|---|---|---|
| Systems | full/traditions.json | TRADITION_TREES | 7 древ / 35 узлов + 7 финишеров |
| Systems | full/perks.json | PERKS | 12 |
| Systems | full/techs-extra.json | TECHS_EXTRA | 42 |
| Systems | full/megastructures.json | MEGASTRUCTURES | 7 |
| Systems | full/crises.json | CRISES | 5 |
| Systems | full/resolutions.json | COUNCIL_RESOLUTIONS | 8 |
| Systems | full/espionage.json | ESPIONAGE_OPS | 6 |
| Systems | full/modes.json | MODES | 5 |
| Systems | full/ethics.json | ETHICS | 8 |
| Systems | full/governments.json | GOVERNMENTS | 5 |
| Systems | full/civics.json | CIVICS | 12 |
| Systems | full/focus-goals.json | FOCUS_GOALS | 10 |
| Campaign | campaign/acts.json | CAMPAIGN_ACTS | 6 |
| Campaign | campaign/missions.json | CAMPAIGN_MISSIONS | 60 |
| Campaign | campaign/events.json | NARRATIVE_EVENTS | 120 в 40 цепочках |
| Campaign | campaign/anomalies.json | ANOMALIES | 60 |
| Campaign | campaign/archaeology.json | ARCHAEOLOGY | 6 |
| Campaign | campaign/lore.json | LORE | 150 |
| Campaign | campaign/endings.json | ENDINGS | 8 |
| Campaign | campaign/branches.json | BRANCHES | 3 |
| UI | l10n/ru.json + en.json | L10N_RU / L10N_EN | 1094 ключей × 2 (1:1) |

---

## 1. Традиции и перки (GDD §8.5–8.6)

Стоимость узла `cost = 400 × 1.5^index` = 400/600/900/1350/2025; узлы связаны цепочкой `requires`. Значения — доли (+0.1 = +10%) либо плоские числа.

### Открытие — `discovery` (#4FC3F7)

| # | Узел | Очки | Эффекты |
|---|---|---|---|
| 1 | Любознательность (`dis_1`) | 400 | `science_prod` 0.1 |
| 2 | Научная экспедиция (`dis_2`) | 600 | `science_flat_per_school` 1 |
| 3 | Дальние сенсоры (`dis_3`) | 900 | `sensor_range` 1 |
| 4 | Полевые лаборатории (`dis_4`) | 1350 | `anomaly_speed` 0.25 |
| 5 | Три гипотезы (`dis_5`) | 2025 | `extra_tech_choice` 1 |
| ★ | Финишер: Первопроходец | — | `science_burst` 0.2, `science_burst_ticks` 20 |

### Экспансия — `expansion` (#6BE675)

| # | Узел | Очки | Эффекты |
|---|---|---|---|
| 1 | Колониальный устав (`exp_1`) | 400 | `colony_cost` -0.15 |
| 2 | Типовое жильё (`exp_2`) | 600 | `housing` 1 |
| 3 | Волны переселения (`exp_3`) | 900 | `pop_growth` 0.1 |
| 4 | Форпосты фронтира (`exp_4`) | 1350 | `outpost_cost` -0.2 |
| 5 | Голос границы (`exp_5`) | 2025 | `influence_flat` 2 |
| ★ | Финишер: Фронтир | — | `new_colony_pops` 5 |

### Доминирование — `domination` (#FF5A5A)

| # | Узел | Очки | Эффекты |
|---|---|---|---|
| 1 | Военный призыв (`dom_1`) | 400 | `fleet_cap_pct` 0.05 |
| 2 | Наступательная школа (`dom_2`) | 600 | `weapon_damage` 0.1 |
| 3 | Академия адмиралов (`dom_3`) | 900 | `admiral_exp` 0.1 |
| 4 | Тыл и снабжение (`dom_4`) | 1350 | `fleet_upkeep_pct` -0.15 |
| 5 | Уставные доктрины (`dom_5`) | 2025 | `doctrine_slots` 1 |
| ★ | Финишер: Тотальная война | — | `war_score` 0.25 |

### Процветание — `prosperity` (#F5C542)

| # | Узел | Очки | Эффекты |
|---|---|---|---|
| 1 | Энергетический баланс (`pro_1`) | 400 | `energy_prod` 0.1 |
| 2 | Открытые забои (`pro_2`) | 600 | `minerals_prod` 0.1 |
| 3 | Потребительский стандарт (`pro_3`) | 900 | `goods_prod` 0.1 |
| 4 | Городские кварталы (`pro_4`) | 1350 | `building_slots` 1 |
| 5 | Общественный договор (`pro_5`) | 2025 | `stability_pct` 0.15 |
| ★ | Финишер: Золотой век | — | `all_prod_burst` 0.1, `all_prod_burst_ticks` 100 |

### Гармония — `harmony` (#B78CE8)

| # | Узел | Очки | Эффекты |
|---|---|---|---|
| 1 | Быт и досуг (`har_1`) | 400 | `happiness` 5 |
| 2 | Общественная полиция (`har_2`) | 600 | `crime` -0.1 |
| 3 | Семейные программы (`har_3`) | 900 | `pop_growth` 0.1 |
| 4 | Совет фракций (`har_4`) | 1350 | `faction_slots` 1 |
| 5 | Право на порядок (`har_5`) | 2025 | `stability` 15 |
| ★ | Финишер: Единство | — | `no_revolt_ticks` 200 |

### Превосходство — `supremacy` (#F08A24)

| # | Узел | Очки | Эффекты |
|---|---|---|---|
| 1 | Патрульные соединения (`sup_1`) | 400 | `fleet_cap_per_10_systems` 1 |
| 2 | Щитовые матрицы (`sup_2`) | 600 | `shield_max` 0.1 |
| 3 | Манёвренные доктрины (`sup_3`) | 900 | `fleet_speed_pct` 0.1 |
| 4 | Дополнительные жёсткие точки (`sup_4`) | 1350 | `weapon_slots` 1 |
| 5 | Единый кулак (`sup_5`) | 2025 | `fleet_power_pct` 0.15 |
| ★ | Финишер: Несокрушимость | — | `flagship_autoescape` 1 |

### Просвещение — `enlightenment` (#8FA3BF)

| # | Узел | Очки | Эффекты |
|---|---|---|---|
| 1 | Культурный канон (`enl_1`) | 400 | `unity_prod` 0.1 |
| 2 | Университеты (`enl_2`) | 600 | `science_flat_per_school` 1 |
| 3 | Разумные эдикты (`enl_3`) | 900 | `edict_cost` -0.2 |
| 4 | Свободный разум (`enl_4`) | 1350 | `perk_slots` 1 |
| 5 | Эпоха разума (`enl_5`) | 2025 | `science_prod` 0.15 |
| ★ | Финишер: Вознесение | — | `perk_cost` -0.25 |

### Перки вознесения (12, GDD §8.6)

| ID | Перк | Очки | Требует | Эффекты | Открывает |
|---|---|---|---|---|---|
| `space_engineering` | Космическая инженерия | 2000 | — | `megastructure_unlock` 1 | `megastructure:sentinel_array` |
| `ring_world` | Мир-кольцо | 3000 | `space_engineering` | `ring_world_unlock` 1 | `megastructure:ring_habitat` |
| `genetic_ascension` | Генетическое вознесение | 3500 | — | `trait_slots` 1, `pop_growth` 0.15 | — |
| `synthetic_ascension` | Синтетическое вознесение | 3500 | — | `robot_upkeep_pct` -1, `production_pct` 0.1 | — |
| `psionic_ascension` | Псионическое вознесение | 4000 | — | `unity_prod` 0.2, `psi_unlock` 1 | — |
| `diplomatic_grace` | Галантная дипломатия | 2500 | — | `diplo_opinion` 25, `treaty_cost` -0.25 | — |
| `imperial_army` | Имперская армия | 2500 | — | `army_pct` 0.2, `invasion_pct` -0.15 | — |
| `technocracy` | Технократия | 3000 | — | `extra_tech_choice` 1 | — |
| `divine_mandate` | Божественный мандат | 3000 | — | `legitimacy` 20 | — |
| `trade_empire` | Торговая империя | 3000 | — | `trade_margin` 0.25 | — |
| `master_builder` | Мастер-строитель | 4500 | `space_engineering` | `megastructure_cost` -0.25 | — |
| `ascension` | Вознесение | 8000 | `genetic_ascension`, `synthetic_ascension`, `psionic_ascension` | `ascension_victory` 1 | — |

Слотов перков — 8. Ветка возвышений (genetic/synthetic/psionic) ведёт к перку `ascension` — условию победы «Технологическое вознесение».

## 2. Технологии полной игры (TECHS_EXTRA, 42)

Дополнительный пул T2–T5; подключается к общему пулу исследований после `TECHS`, не пересекаясь по id.

### Физика (15)

| Тир | ID | Название | Очки | Вес | Эффекты / открывает |
|---|---|---|---|---|---|
| T2 | `x_phys_gravity_1` | Гравитационная линза | 292 | 55 | sensor_range +1 |
| T3 | `x_phys_graviton_2` | Гравитоника II | 612 | 45 | sensor_range +1; anomaly_speed +0.1 |
| T3 | `x_phys_shield_matrix` | Щитовая матрица | 612 | 45 | shield_max +0.15 |
| T3 | `x_phys_reactor_fusion` | Термоядерный реактор | 612 | 45 | power +0.2 |
| T3 | `x_phys_fsd_1` | FSD IV | 612 | 50 | fsd_range +2 |
| T4 | `x_phys_tachyon` | Тахионный сенсор | 1476 | 30 | sensor_range +2 |
| T4 | `x_phys_shield_phased` | Фазовые щиты | 1476 | 30 | shield_max +0.2; shield_regen +0.2 |
| T4 | `x_phys_reactor_annihilation` | Аннигиляционный реактор | 1476 | 30 | power +0.25; energy_prod +0.05 |
| T4 | `x_phys_lance` | Термическая копьё | 1476 | 30 | energy_dmg +0.2 |
| T4 | `x_phys_fsd_2` | FSD V | 1476 | 30 | fsd_range +2; fsd_charge -0.2 |
| T5 | `x_phys_sensor_array` | Дальняя сенсорная сеть | 3640 | 15 | sensor_range +3; anomaly_speed +0.2; +megastructure:sentinel_array |
| T5 | `x_phys_shield_singular` | Сингулярный барьер | 3640 | 15 | shield_max +0.25; resist_thermal +0.1 |
| T5 | `x_phys_reactor_zero` | Реактор нулевой точки | 3640 | 15 | power +0.3 |
| T5 | `x_phys_disruptor` | Дезинтегратор | 3640 | 15 | energy_dmg +0.25; weapon_damage +0.1 |
| T5 | `x_phys_grav_engine` | Гравитационный двигатель | 3640 | 15 | fleet_speed_pct +0.15; fsd_range +1 |

### Общество (13)

| Тир | ID | Название | Очки | Вес | Эффекты / открывает |
|---|---|---|---|---|---|
| T2 | `x_soc_census` | Галактическая перепись | 252 | 50 | influence_prod +0.1 |
| T2 | `x_soc_colonial_admin` | Колониальная администрация | 252 | 50 | colony_cost -0.15 |
| T3 | `x_soc_colonial_union` | Колониальный союз | 528 | 40 | colony_cost -0.15; stability +3 |
| T3 | `x_soc_galactic_law` | Галактическое право | 528 | 40 | diplo_opinion +10 |
| T3 | `x_soc_xeno_integration` | Ксено-интеграция | 528 | 40 | pop_growth +0.1; stability +2 |
| T3 | `x_soc_education_net` | Образовательная сеть | 528 | 40 | science_prod +0.1 |
| T3 | `x_soc_meritocracy` | Меритократия | 528 | 40 | influence_flat +1 |
| T4 | `x_soc_megacity` | Мегаполисы | 1275 | 28 | housing +2; building_slots +1 |
| T4 | `x_soc_galactic_court` | Галактический суд | 1275 | 28 | diplo_opinion +15; war_score +0.1 |
| T4 | `x_soc_psy_academy` | Пси-академия | 1275 | 28 | unity_prod +0.2 |
| T4 | `x_soc_propaganda` | Государственная пропаганда | 1275 | 28 | unity_prod +0.15; stability +3 |
| T5 | `x_soc_psi_chorus` | Пси-хор | 3143 | 14 | unity_prod +0.25; psi_unlock +1 |
| T5 | `x_soc_ritual_calendar` | Ритуальный календарь | 3143 | 14 | stability +10; unity_prod +0.2 |

### Инженерия (14)

| Тир | ID | Название | Очки | Вес | Эффекты / открывает |
|---|---|---|---|---|---|
| T3 | `x_eng_sentinel_array` | Сеть Сентри | 556 | 45 | sensor_range +1; +megastructure:sentinel_array |
| T3 | `x_eng_gate` | Технология Врат | 556 | 45 | +megastructure:gate |
| T4 | `x_eng_star_forge` | Звёздная кузня | 1342 | 30 | alloys_prod +0.15; +megastructure:star_forge |
| T4 | `x_eng_ring_habitat` | Кольцевые миры | 1342 | 30 | housing +2; +megastructure:ring_habitat |
| T4 | `x_eng_beacon` | Маяк флота | 1342 | 30 | fleet_cap_pct +0.1; +megastructure:beacon |
| T4 | `x_eng_armor_crystal` | Кристаллическая броня | 1342 | 30 | armor_max +0.25 |
| T4 | `x_eng_drive_warp` | Варп-двигатели | 1342 | 30 | fleet_speed_pct +0.15 |
| T4 | `x_eng_fleet_doctrine` | Флотские доктрины | 1342 | 30 | doctrine_slots +1; fleet_upkeep_pct -0.1 |
| T5 | `x_eng_dyson` | Сфера Дайсона | 3309 | 15 | energy_prod +0.2; +megastructure:dyson_sphere |
| T5 | `x_eng_nexus` | Научный Нексус | 3309 | 15 | science_prod +0.15; +megastructure:science_nexus |
| T5 | `x_eng_titan_forge` | Титановая верфь | 3309 | 15 | ship_cost_pct -0.1; +hull:hull_titan |
| T5 | `x_eng_armor_adaptive` | Адаптивная броня | 3309 | 15 | armor_max +0.25; repair_cost -0.2 |
| T5 | `x_eng_drive_inertial` | Инерционные компенсаторы | 3309 | 15 | fleet_speed_pct +0.2; weapon_damage +0.05 |
| T5 | `x_eng_mega_2` | Инженерия мегаструктур II | 3309 | 15 | megastructure_cost -0.15 |

## 3. Мегаструктуры (GDD §8.7)

| ID | Мегаструктура | Сплавы | Тактов | requiredTech | requiredPerk | Эффекты | Макс. |
|---|---|---|---|---|---|---|---|
| `sentinel_array` | Сеть Сентри | 1500 | 60 | `x_eng_sentinel_array` | `space_engineering` | `sensor_range` 2, `science_prod` 0.1 | 1 |
| `gate` | Врата | 1200 | 40 | `x_eng_gate` | `space_engineering` | `gate_network` 1 | 2 |
| `star_forge` | Звёздная кузня | 4000 | 120 | `x_eng_star_forge` | `master_builder` | `alloys_prod` 0.25 | 1 |
| `ring_habitat` | Мир-кольцо | 2500 + 500 M | 90 | `x_eng_ring_habitat` | `ring_world` | `housing` 50, `jobs` 10, `pop_cap` 60 | 1 |
| `dyson_sphere` | Сфера Дайсона | 8000 | 200 | `x_eng_dyson` | `space_engineering` | `energy_flat` 300 | 1 |
| `science_nexus` | Научный Нексус | 3000 | 100 | `x_eng_nexus` | `technocracy` | `science_prod` 0.15, `extra_tech_choice` 1 | 1 |
| `beacon` | Маяк | 2000 | 80 | `x_eng_beacon` | `space_engineering` | `fleet_cap_pct` 0.2, `doctrine_slots` 1 | 1 |

## 4. Кризисы (GDD §14)

| ID | Кризис | Старт, такт | Флотов | FP флота | Узлов | Длительность | Награда |
|---|---|---|---|---|---|---|---|
| `void_reavers` | Мародёры Пустоты | 2200 | 14 | 100 | 3 | 300 | 500 A, 120000 Cr, 400 науки, `module:pd_turret_mk1` |
| `synthetic_revolt` | Пробуждение Соборов | 2600 | 8 | 60 | 3 | 400 | 300 A, 80000 Cr, 600 науки, `module:shield_gen_mk2` |
| `grey_tide` | Серый Прилив | 4600 | 15 | 400 | 5 | 800 | 1500 A, 250000 Cr, 1200 науки, `module:reactor_mk4` |
| `devourers` | Пожиратели Пустоты | 5200 | 12 | 4000 | 3 | 900 | 2500 A, 400000 Cr, 2000 науки, `hull:hull_colossus` |
| `ancient_awakening` | Пробуждение Древних | 3600 | 1 | 1200 | 1 | 120 | 800 A, 150000 Cr, 900 науки, `module:reactor_mk4` |

## 5. Галактический совет (GDD §12.4)

| ID | Резолюция | Влияние | Вето | Эффекты | Тактов |
|---|---|---|---|---|---|
| `res_aggression_ban` | Запрет агрессии | 20 | да | aggressor_war_score -0.5 | 300 |
| `res_free_trade` | Свободная торговля | 15 | нет | trade_margin 0.1, tariff -0.2 | 400 |
| `res_common_market` | Общий рынок | 30 | да | market_price_unify 1 | 400 |
| `res_sanctions` | Санкции против империи | 40 | да | target_income_mult 0.8, target_science_mult 0.9 | 300 |
| `res_fleet_limit` | Ограничение флота | 50 | да | fleet_cap_pct -0.4 | 200 |
| `res_science_exchange` | Научный обмен | 25 | нет | science_prod 0.1, tech_cost_low_tier -0.1 | 400 |
| `res_forced_peace` | Принудительный мир | 60 | да | forced_peace_ticks 50 | 50 |
| `res_crisis_declaration` | Объявление кризиса | 40 | нет | crisis_coalition 1, fp_vs_crisis 0.2 | 400 |

## 6. Шпионаж (GDD §12.5)

| ID | Операция | Влияние | Базовый шанс | Эффекты |
|---|---|---|---|---|
| `fleet_recon` | Разведка флота | 5 | 0.75 | reveal_fleets_ticks 20 |
| `steal_tech` | Кража технологии | 15 | 0.35 | steal_tech_max_tier 3 |
| `sabotage` | Диверсия | 10 | 0.4 | target_prod_penalty -0.2, penalty_ticks 20 |
| `incite` | Подстрекательство | 20 | 0.3 | target_stability -15, target_unrest 10 |
| `steal_map` | Кража карты | 8 | 0.7 | reveal_systems 5 |
| `assassinate` | Убийство адмирала | 25 | 0.2 | kill_admiral 1 |

Формула шанса (sim): `P = clamp(0.05, 0.95, base + 0.1×intel − 0.2×counter_intel)`.

## 7. Режимы игры (GDD §17.2)

| modeId | Режим | Игроков | Тик, с | Пауза | Такт. лок | ИИ | Систем | Победа | Сейвы | Рейтинг |
|---|---|---|---|---|---|---|---|---|---|---|
| `campaign` | Кампания | 1 | 1 | free | 0 | 7 | 240 | domination/federation/ascension/economy/crisis/score | local | нет |
| `coop` | Кооператив 2–4 | 4 | 1 | vote | 90 | 6 | 240 | crisis/shared | server | нет |
| `mmo` | Персистентный мир | 100 | 900 | none | 90 | 12 | 400 | season/council | server | да |
| `sandbox` | Песочница | 1 | 1 | free | 0 | 7 | 300 | none | local | нет |
| `trial` | Испытание | 1 | 1 | none | 0 | 3 | 120 | scenario | server | да |

## 8. Этика, правление, цивики, цели (GDD §3.2–3.4, §15.5)

Порядок массивов = дефолт империи в sim (`ETHICS.slice(0,2)`, `GOVERNMENTS[0]`, `CIVICS.slice(0,2)`). Первыми стоят нейтральные для стартового баланса: materialist + spiritualist, directorate, engineering_corps + trade_chamber.

| Этика | Ось | Эффекты |
|---|---|---|
| Материализм (`materialist`) | mind_faith | `science_prod` 0.1, `robot_cost` -0.1, `shrine_unity` -0.2 |
| Спиритуализм (`spiritualist`) | mind_faith | `unity_prod` 0.15, `stability` 5, `science_prod` -0.1 |
| Индивидуализм (`individualist`) | self_collective | `goods_prod` 0.15, `happiness` 5, `contract_slots` 1, `fleet_cap_pct` -0.1 |
| Коллективизм (`collectivist`) | self_collective | `district_prod` 0.1, `migration_cost` -0.1, `elite_happiness` -10 |
| Экспансионизм (`expansionist`) | expansion_isolation | `outpost_cost` -0.2, `colony_speed` 0.15, `stability` -10 |
| Изоляционизм (`isolationist`) | expansion_isolation | `system_defense` 0.2, `unity_prod` 0.1, `diplo_weight` -0.25 |
| Милитаризм (`militarist`) | war_peace | `weapon_damage` 0.1, `fleet_upkeep_pct` -0.1, `opinion_pacifists` -15 |
| Пацифизм (`pacifist`) | war_peace | `unity_prod` 0.15, `goods_prod` 0.1, `diplo_opinion` 10, `fleet_cap_pct` -0.1 |

| Правление | Эффекты |
|---|---|
| Директория (`directorate`) | `influence_flat` 1, `election_ticks` 900, `legitimacy_base` 60 |
| Совет Кланов (`clan_council`) | `production_pct` 0.1, `fleet_cap_per_10_systems` 1, `election_ticks` 1200 |
| Технократия (`technocracy`) | `science_prod` 0.1, `extra_tech_choice` 1, `election_ticks` 0 |
| Теократия (`theocracy`) | `unity_prod` 0.2, `stability` 2, `election_ticks` 1500 |
| Корпорация (`corporation`) | `credits_prod` 0.15, `treaty_cost` -0.5, `election_ticks` 1000 |

| Цивик | Эффекты |
|---|---|
| Инженерный корпус (`engineering_corps`) | `building_upkeep_pct` -0.15, `repair_cost` -0.1 |
| Торговая палата (`trade_chamber`) | `route_slots` 1, `trade_margin` 0.1 |
| Военная академия (`war_academy`) | `admiral_exp` 0.15, `weapon_damage` 0.05 |
| Фронтир-колонисты (`frontier_colonists`) | `colony_cost` -0.25, `housing` 1 |
| Бюро порядка (`order_bureau`) | `crime` -0.2, `stability` 5 |
| Открытая наука (`open_science`) | `science_flat_per_school` 1, `tech_trade_speed` 0.1 |
| Дворцовые интриги (`palace_intrigue`) | `influence_flat` 2, `edict_cost` -0.1 |
| Культ пилота (`pilot_cult`) | `pilot_exp` 0.2, `flagship_modules` 1 |
| Промышленный синдикат (`industrial_syndicate`) | `alloys_prod` 0.1, `goods_prod` -0.05 |
| Псайонический архив (`psionic_archive`) | `unity_prod` 0.15, `rare_flat` 1 |
| Наёмный флот (`mercenary_fleet`) | `fleet_upkeep_pct` -0.2, `hire_cost` 0.1 |
| Ксено-дипломатия (`xeno_diplomacy`) | `diplo_opinion` 25, `treaty_cost` -0.2 |

| Цель-крючок | Условие | Награда |
|---|---|---|
| Контракт рядом (`fg_contract_near`) | `contract_available` | Стандартный контракт станции (15–60 тыс. Cr) |
| Странный сигнал (`fg_scan_signal`) | `anomaly_near` | Данные исследования и возможный артефакт |
| Второе имя на карте (`fg_first_colony`) | `colony_ship_ready` | +8…12 ЭЭ/такт, +1 система |
| Дорога прибыли (`fg_build_route`) | `route_slots_free` | +400 Cr/такт и опыт торговца |
| Третья гипотеза (`fg_tech_choice`) | `tech_offer_ready` | Открытие зданий, кораблей или модулей |
| Граница под ударом (`fg_defend_border`) | `border_threat` | −риск потери системы |
| Ограниченная цель (`fg_war_goal`) | `war_possible` | Военный счёт, притязание, репутация |
| Союз или самостоятельность (`fg_federation_offer`) | `offer_pending` | NAP/торговля/оборонительный союз |
| Веха инженерии (`fg_megastructure_start`) | `megastructure_ready` | Постоянный бонус империи |
| Горизонт победы (`fg_victory_push`) | `victory_progress>=0.8` | Окно победы на такте 7000 |

## 9. Кампания: акты (docs/11 §2)

| Акт | Название | Такты | Суть |
|---|---|---|---|
| 0 | Пролог «Пробуждение» | 0–300 | Первый контакт, наследие Строителей, первые пираты. Игрок учится летать, стыковаться и торговать. |
| 1 | Акт I «Фронтир» | 300–1200 | Колонизация, соперник-гегемон, слухи о Разломе. Войны малого масштаба, зародыш федерации, T1–T2. |
| 2 | Акт II «Хрупкий мир» | 1200–2600 | Дипломатия и выбор «союз или суверенитет»; шпионаж, галактический совет, первый кризис. |
| 3 | Акт III «Разлом» | 2600–4400 | Правда о Строителях, вторжение, раскол галактики; T3–T4, мегаструктуры, доктрины. |
| 4 | Акт IV «Цена силы» | 4400–6200 | Использование наследия, внутренние фракции, предательство; T5, титаны, поздний кризис. |
| 5 | Акт V «Финал» | 6200–7200 | Гонка за победу и финальный выбор: 5 концовок, колосс или вознесение. |

## 10. Миссии: структура и распределение

Состав: **24 главных** («Наследие Строителей») + **12 «Разлом»** + **24 веток** (по 8 на ветку). Требование «≥8 миссий и ≥2 развилки в каждом акте» выполнено.

| Акт | Всего | Главные | Разлом | Ветки | Разных ветвей |
|---|---|---|---|---|---|
| 0 | 8 | 4 | 2 | 2 | 2 |
| 1 | 11 | 4 | 2 | 5 | 3 |
| 2 | 11 | 4 | 2 | 5 | 3 |
| 3 | 11 | 4 | 2 | 5 | 3 |
| 4 | 10 | 4 | 2 | 4 | 3 |
| 5 | 9 | 4 | 2 | 3 | 3 |

Типы целей: `reach_system`, `scan`, `dock`, `talk`, `destroy_fleet`, `collect_artifact`, `construct`, `defend_system`, `survive_ticks`, `seal_rift`, `demonstrate`, `deliver`, `escape`, `profit`. Награды эскалируют по актам (25–40 тыс. Cr в прологе → 550–750 тыс. в финале) и включают сплавы, науку, влияние, репутацию и unlock. Финальные миссии ссылаются на `endings`, ветки — на `branches`, привилегии — на mission id.

### Ветки кампании

| Ветка | Миссий | Концовка | Эффекты |
|---|---|---|---|
| Федерация (`federation`) | 8 | `ending_release` | diplo_opinion 25, science_prod 0.05, fleet_cap_pct -0.05 |
| Суверенитет (`sovereignty`) | 8 | `ending_control` | fleet_cap_pct 0.1, weapon_damage 0.05, diplo_opinion -15 |
| Синдикат (`syndicate`) | 8 | `ending_syndicate` | credits_prod 0.2, trade_margin 0.15, diplo_opinion -10 |

## 11. События и цепочки

**120 событий в 40 цепочках** (по 3 шага), у каждого 2 варианта выбора с ценой; шаг N+1 открывается после выбора в шаге N с кулдауном цепочки. Цепочки: `silent_star`, `derelict_convoy`, `border_incident`, `syndicate_offer`, `precursor_ping`, `refugee_flotilla`, `plague_ship`, `pirate_tribute`, `scientist_defection`, `ancient_beacon`, `federation_petition`, `mutiny`, `lost_colony`, `black_market_relic`, `synthetic_rights`, `trade_boom`, `famine_alert`, `council_intrigue`, `titan_sighting`, `psionic_dream`, `ghost_fleet`, `mining_strike`, `rift_whisper_1`, `rift_whisper_2`, `rift_whisper_3`, `admiral_past`, `captured_spy`, `data_cache`, `terraform_offer`, `mercenary_contract`, `megastructure_anomaly`, `cult_of_void`, `diplomatic_wedding`, `lost_fleet`, `alien_artifact_1`, `alien_artifact_2`, `alien_artifact_3`, `grey_tide_echo`, `devourer_scout`, `final_choice_rumor`.

## 12. Аномалии и археология

Аномалии: **60** — anomaly 26, derelict 12, archaeology 12, silent_star 10; артефактных — **19** (требуется ≥6).

| chainId | Цепочка | Шагов | Награда | Артефакт |
|---|---|---|---|---|
| `arch_builder_ship` | Корабль Строителей | 5 | 180000 Cr, 220 A, 900 науки, `module:shield_gen_mk3` | да |
| `arch_buried_city` | Город под корой | 3 | 120000 Cr, 80 A, 700 науки, `building:unity_center` | нет |
| `arch_road_song` | Песнь Дорог | 4 | 150000 Cr, 120 A, 1000 науки, `module:fsd_mk3` | да |
| `arch_gate_key` | Ключ от Врат | 3 | 200000 Cr, 150 A, 800 науки, `megastructure:gate` | да |
| `arch_admiral_grave` | Могила Адмирала | 2 | 90000 Cr, 60 A, 400 науки | нет |
| `arch_silent_star` | Немая звезда | 4 | 240000 Cr, 180 A, 1200 науки, `module:reactor_mk4` | да |

## 13. Лор (150 записей)

Категории: precursors 30, rift 21, races 19, worlds 25, factions 15, technology 20, history 20. Условия открытия: `start`, `tick>=600`, `tech_tier>=2`, `tech_tier>=4`.

## 14. Концовки (docs/11 §8)

| ID | Концовка | Условие (DSL) | Ветка | Секретная |
|---|---|---|---|---|
| `ending_seal` | Запечатать Разлом | `artifacts>=5, crisis_defeated` | — | нет |
| `ending_control` | Контролировать Разлом | `branch==sovereignty, artifacts>=3` | `sovereignty` | нет |
| `ending_release` | Освободить Разлом | `branch==federation, federation>=1` | `federation` | нет |
| `ending_syndicate` | Синдикат | `branch==syndicate, economy_hegemony` | `syndicate` | нет |
| `ending_ascension` | Вознесение | `perk==ascension, megastructure==science_nexus` | — | нет |
| `ending_whisper` | Шёпот | `artifacts_whisper>=6` | — | да |
| `ending_exile` | Изгнание | `colonies<=0, fleets>=1` | — | нет |
| `ending_ironman` | Ironman: конец линии | `flag:ironman_death` | — | нет |

DSL (sim `endingConditionMet`): сравнения `artifacts>=5`, `credits>=N`; равенства `branch==syndicate`, `perk==ascension`, `megastructure==science_nexus`; флаги `flag:name`; миссии `mission:id`; токены `crisis_defeated`, `federation`, `megastructure`. Несколько условий — через запятую (AND).

## 15. Локализация новых экранов

Всего ключей: **1094** в ru и en (паритет 1:1). Неймспейсы: `anomalies.*`, `app.*`, `battle.*`, `build.*`, `campaign.*`, `civics.*`, `colony.*`, `common.*`, `contract.*`, `council.*`, `crisis.*`, `diplomacy.*`, `empire.*`, `endings.*`, `espionage.*`, `ethics.*`, `events.*`, `federation.*`, `fleet.*`, `flight.*`, `flow.*`, `focus.*`, `governments.*`, `help.*`, `hud.*`, `journal.*`, `lore.*`, `map.*`, `market.*`, `megastructure.*`, `menu.*`, `mission.*`, `mode.*`, `modes.*`, `notify.*`, `overlay.*`, `perks.*`, `planet.*`, `poi.*`, `research.*`, `resource.*`, `routes.*`, `scene.*`, `score.*`, `settings.*`, `star.*`, `station.*`, `system.*`, `tech.*`, `traditions.*`, `tutorial.*`, `unit.*`, `victory.*`, `war.*`.

Ключевые для M6–M12: `traditions.*`, `perks.*`, `diplomacy.*`, `war.*`, `federation.*`, `council.*`, `espionage.*`, `megastructure.*`, `crisis.*`, `routes.*`, `campaign.*`, `events.*`, `anomalies.*`, `lore.*`, `endings.*`, `modes.*`, `ethics.*`, `governments.*`, `civics.*`, `focus.*`, `score.*`, `journal.*`, `battle.*`, `tutorial.*`, `overlay.*`, `star.*`, `planet.*`, `poi.*`, `unit.*`, `flow.*`, `empire.*`, `flight.*`, `scene.*`, `common.*`.

Подстановки: `{count}`, `{percent}`, `{ticks}`, `{cost}`, `{name}`, `{value}`, `{credits}`, `{alloys}`, `{energy}`, `{stage}`, `{total}`, `{reason}`, `{tier}`, `{school}`, `{points}`, `{income}`, `{seconds}`. Контентные строки (ru) живут в JSON-полях `*Ru` и не дублируются в l10n, чтобы не разъезжались.

## 16. Решения и допущения (M6–M12)

| # | Решение | Причина |
|---|---|---|
| 1 | 8 концовок: seal / control / release / syndicate / ascension + secret «Шёпот» + провал «Изгнание» + ironman | Нужно 5 + секрет + провал; ascension добавлен как победа через перк/T5-мегаструктуру, ironman — отдельный слот |
| 2 | В прологе 8 миссий, включая 2 веточных превью (federation, sovereignty) | Требование «≥8 миссий и ≥2 развилки в каждом акте»; полные ветки идут с акта I |
| 3 | ID концовок в данных: `ending_seal`, `ending_control`, `ending_release`, `ending_syndicate`, `ending_whisper`; fallback sim — `ending_*_rift` | Данные важнее fallback; тестами проверяются оба набора |
| 4 | Условия концовок — строковый DSL, совместимый с `endingConditionMet` | Единый механизм для данных и тестовых каталогов |
| 5 | Порядок `ETHICS`/`GOVERNMENTS`/`CIVICS` задаёт дефолт империи | Нейтральные materialist+spiritualist / directorate / engineering_corps+trade_chamber не искажают стартовый доход и лимиты |
| 6 | Аномалии связаны с археологией только через `arch_*`; сюжетные цепочки — в events | Однозначная ссылочная целостность |
| 7 | 60 миссий = 24 главные + 12 «Разлом» + 24 ветки | Точно по docs/11 §9 |
| 8 | 120 событий = 40 цепочек × 3 шага | Точно по docs/11 §9; шаги 2–3 требуют выбора в предыдущем |
| 9 | 150 лор-записей в 7 категориях | Требование объёма; открытие привязано к прогрессу |
| 10 | Доп. технологии — отдельный пул TECHS_EXTRA (T2–T5) | Расширение дерева без поломки среза; отсутствие коллизий проверяет валидатор |

## 17. Проверка

```powershell
node tools/validate-full-data.mjs     # id/ссылки/количества/миссии по актам/артефакты/паритет l10n
pnpm data:validate                    # срез M0–M5 (не затронут)
pnpm typecheck                        # типы @sf/data + sim/web
pnpm test                             # тесты sim (campaign/narrative/anomalies/traditions/modifiers)
```

Валидатор считает ошибкой: дубли id, висячие ссылки (perk.requires/unlocks, megastructure.requiredTech/requiredPerk, techs-extra.requires/unlocks, crises.rewards.unlock, espionage.requiresTech, traditions requires/cost, missions branch/branchRequired/ending/prerequisites/rewards.unlock, branch.missions/ending, events choice.missionId, anomalies.chainId, archaeology.reward.unlock, endings.branch), несоответствие количеств, миссии по актам <8, развилок <2, цепочек <40, артефактов <6, нарушение ru↔en.
