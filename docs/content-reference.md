# Справочник контента «Stellar Frontier»

> Источник истины по числам — JSON в `packages/data/src/`. Этот документ — читаемая выжимка для геймдизайна, QA и UI; при расхождении прав JSON и `pnpm data:validate`.
> Поколение данных: вертикальный срез M0–M5, ruleset 1.0.0, режим campaign. Обновлено: 2026-11-04 (итерация content-designer 2).

## 0. Что где лежит

| Файл | Содержимое | Кол-во |
|---|---|---|
| `resources.json` | 8 стратегических ресурсов, цены опт/розница, цвета | 8 |
| `jobs.json` | профессии: страта, слот, выход/потребление | 20 |
| `districts.json` | районы планеты: стоимость, апкип, жильё, места | 7 |
| `buildings.json` | здания: стоимость, апкип, места, эффекты, requiredTech | 27 |
| `techs.json` | технологии: 3 школы × T0–T5, стоимость, unlocks, веса | 62 |
| `hulls.json` | корпуса: 8 боевых + 8 гражданских | 16 |
| `weapons.json` | оружие: урон/ROF/точность/дальность/тепло/мощность | 15 |
| `modules.json` | щиты, броня, тепло, ПВО, сенсоры, груз, реакторы, двигатели, FSD | 27 |
| `designs.json` | готовые проекты кораблей, FP, цена верфи | 18 |
| `missions.json` | контракты станций 6 типов | 16 |
| `names.json` | банки имён | 80 слогов/корней |
| `balance.json` | стартовые значения, апкип, лимиты, рынок | 19 полей |
| `mode.json` | конфиг режима «Кампания» | — |
| `l10n/ru.json`, `l10n/en.json` | локализация | 800 ключей × 2 |

---

## 1. Ресурсы и цены (канон §10, 03b §16.7)

| ID | RU | EN | Опт, Cr | Розница, Cr | Склад | Цвет |
|---|---|---|---|---|---|---|
| `energy` | Энергия | Energy | 1 | 100 | да | `#F5C542` |
| `minerals` | Минералы | Minerals | 1.4 | 140 | да | `#8C99A8` |
| `food` | Пища | Food | 0.9 | 90 | да | `#6BE675` |
| `alloys` | Сплавы | Alloys | 4 | 400 | да | `#4FC3F7` |
| `goods` | Товары потребления | Consumer Goods | 1.8 | 180 | да | `#B8862A` |
| `unity` | Единство | Unity | 2.2 | 220 | да | `#B78CE8` |
| `influence` | Влияние | Influence | 5 | 500 | да | `#F08A24` |
| `credits` | Кредиты | Credits | 1 | 1 | да | `#F5C542` |

Розница = 100 × опт (κ = 100). Спред 4%, комиссия 2% (`marketSpreadPct`, `marketCommissionPct`). Единство и влияние — неторгуемые запасы (shadow-цены 6 и 24 ЭЭ); розничные 220/500 Cr оставлены как UI-ориентир. Кредиты — валюта пилота, империя оперирует потоками энергии/минералов/сплавов.

## 2. Профессии (GDD §6.2 + 03b §3.2)

| ID | Профессия | Страта | Слот | Выход/такт | Вход/такт |
|---|---|---|---|---|---|
| `technician` | Техник | worker | `energy_district` | +5 E | — |
| `miner` | Шахтёр | worker | `mining_district` | +5.5 M | — |
| `farmer` | Фермер | worker | `agriculture_district` | +6 F | — |
| `metallurgist` | Металлург | specialist | `industrial_district` | +3 A | −3 M |
| `artisan` | Ремесленник | specialist | `industrial_district` | +5 ТП | −2 M |
| `researcher` | Исследователь | specialist | `laboratory` | — | −1 ТП |
| `administrator` | Администратор единства | ruler | `capital` | +3 U | −0.5 ТП |
| `governor` | Наместник | ruler | `capital` | +1 Inf | −0.6 ТП |
| `soldier` | Солдат | specialist | `barracks` | — | −0.5 ТП |
| `trader` | Торговец | specialist | `market` | +4 Cr | −0.4 ТП |
| `priest` | Священник | specialist | `temple` | +2 U | −1 ТП |
| `engineer` | Инженер-ремонтник | specialist | `shipyard` | +1 A | −0.4 ТП |
| `robot_worker` | Робот-рабочий | worker | `robot_plant` | +6 M | −2 E |
| `xenologist` | Учёный-ксенолог | specialist | `academy` | — | −1 ТП |
| `mercenary` | Наёмник | specialist | `barracks` | — | −1 ТП |
| `ace_pilot` | Пилот-ас | specialist | `academy` | — | −1 ТП |
| `hydro_tech` | Гидротехник | worker | `hydroponics` | +4.5 F | −1.2 E |
| `food_synthesist` | Синтезатор пищи | specialist | `food_synthesizer` | +6 F | −2 M, −1 E |
| `recycler` | Переработчик | worker | `recycling_complex` | +3 M | −1 A |
| `logistician` | Грузчик-логист | worker | `trade_hub` | +2 Cr | −0.4 ТП |

Ключевое решение: шахтёр = **5.5** минерала (03b §3.2) — только так сходится канон §19.1 «+12 минералов»: 4×5.5 − 2 металлурга×3 − 2 ремесленника×2 = 12. Остальные профессии — точно GDD §6.2. Наука исследователя считается симуляцией через `sciencePerResearcher`, поэтому в `output` её нет.

## 3. Районы планеты (03b §3.6)

| ID | Район | Стоимость | Тактов | Апкип E | Жильё | Рабочие места |
|---|---|---|---|---|---|---|
| `residential` | Жилой район | 60 M | 5 | 0.5 | 5 | — |
| `energy_district` | Энергорайон | 60 M | 6 | 0.25 | 2 | technician, technician |
| `mining_district` | Горный район | 60 M | 6 | 0.25 | 2 | miner, miner |
| `agriculture_district` | Агрорайон | 60 M | 6 | 0.25 | 2 | farmer, farmer |
| `industrial_district` | Промышленный район | 90 M + 10 A | 8 | 0.25 | 2 | metallurgist, artisan |
| `academic_district` | Академический район | 100 M + 20 ТП | 10 | 0.5 | 2 | researcher, researcher |
| `commercial_district` | Торговый район | 100 M | 8 | 0.4 | 2 | trader, trader |

Лимит районов: `district_cap = размер планеты + 4` (GDD §5.4). Жилой район — основной источник жилья (+5).

## 4. Здания (03b §3.7, GDD §5.4)

| ID | Здание | Стоимость | Тактов | Апкип E | Места | Эффекты | requiredTech |
|---|---|---|---|---|---|---|---|
| `capital` | Дворец (столица) | — | 0 | 1.5 | 2 (governor, administrator) | стаб +5; наука physics 1/society 1/engineering 1; capital 1 | — |
| `laboratory` | Лаборатория | 90 M | 10 | 1 | 2 (researcher, researcher) | наука physics 0.5; science 0.05 | — |
| `goods_factory` | Фабрика ТП | 100 M | 10 | 1.2 | 2 (artisan, artisan) | — | — |
| `unity_center` | Центр единства | 80 M | 8 | 0.8 | 1 (administrator) | tradition_cost -0.05 | `soc_administration_1` |
| `barracks` | Казарма | 70 M | 6 | 0.5 | 3 (soldier, soldier, mercenary) | fleet_cap 4, crime -0.1 | — |
| `hospital` | Госпиталь | 80 M | 8 | 0.8 | — | стаб +3; pop_growth 0.15, famine_loss -0.1 | `soc_biology_1` |
| `police_station` | Полицейский участок | 70 M | 6 | 0.6 | — | стаб +2; crime -0.25 | `soc_governance_1` |
| `temple` | Голографический театр | 120 M | 8 | 1.2 | 1 (priest) | стаб +2; happiness 10 | — |
| `academy` | Академия | 140 M | 10 | 1.4 | 3 (researcher, xenologist, ace_pilot) | наука physics 1/society 1; science 0.1 | `soc_education_1` |
| `sensor` | Сенсорная станция | 90 M | 5 | 2 | — | sensor_range 1 | `phys_scanners_1` |
| `warehouse` | Складской комплекс | 90 M | 6 | 0.4 | — | storage 0.25 | `eng_tools_1` |
| `market` | Биржа | 180 M | 10 | 1.6 | 1 (trader) | trade 0.15, credits_prod 1 | `soc_commerce_1` |
| `trade_hub` | Торговый терминал | 160 M | 8 | 1.8 | 2 (logistician, trader) | route_capacity 40, trade_routes 1 | `soc_commerce_1` |
| `customs` | Таможня | 150 M | 8 | 1 | — | tariff 0.03, smuggling -0.2 | `soc_governance_1` |
| `bank` | Банк | 200 M | 10 | 1.5 | — | credits_prod 2, loan_rate -0.03 | `soc_commerce_2` |
| `embassy` | Посольство | 120 M + 40 ТП | 8 | 1 | — | diplomacy 0.1, influence_prod 0.5 | `soc_xenology_1` |
| `hydroponics` | Гидропонный комплекс | 110 M | 8 | 1.4 | 2 (hydro_tech, hydro_tech) | — | `soc_biology_1` |
| `foundry` | Литейный комплекс | 160 M + 20 A | 9 | 1.2 | 2 (metallurgist, metallurgist) | alloys_prod 0.1 | `eng_metallurgy_1` |
| `recycling_complex` | Комплекс переработки | 140 M | 8 | 1.2 | 2 (recycler, recycler) | minerals_prod 0.015 | `eng_metallurgy_2` |
| `armory` | Оружейный цех | 130 M + 40 A | 10 | 1.8 | — | ordnance_prod 4 | `eng_metallurgy_2` |
| `fuel_synth` | Топливный синтезатор | 120 M + 20 A | 8 | 1.6 | — | fuel_prod 4 | `eng_logistics_1` |
| `shipyard` | Верфь | 150 M + 40 A | 10 | 2 | 1 (engineer) | shipyard_small 1, repair -0.1 | — |
| `large_shipyard` | Большая верфь | 400 M + 200 A | 16 | 6 | 2 (engineer, engineer) | shipyard_large 1, repair -0.2, build_queues 1 | `eng_shipyard_1` |
| `robot_plant` | Синтетический центр | 240 M + 80 ТП | 16 | 3 | 3 (robot_worker, robot_worker, robot_worker) | robot_jobs 3 | `phys_robotics_1` |
| `food_synthesizer` | Синтезатор пищи | 300 M + 100 ТП | 16 | 4 | 3 (food_synthesist, food_synthesist, food_synthesist) | — | `soc_synthetic_food_1` |
| `hq` | Штаб флота | 180 M + 40 A | 12 | 4 | — | fleet_cap 5 | `eng_logistics_1` |
| `shield_gen` | Планетарный щит | 200 M + 50 A | 14 | 2 | — | planet_defense 120, bombardment_resist 0.5 | `phys_shields_3` |

Слоты зданий: `8 + floor(pops/20)`, максимум 20. Апкип тир-0: столица 1.5 + лаборатория 1.0 + фабрика ТП 1.2 + центр единства 0.8 + казарма 0.5 = **5.0 E** (03b §12.2).

## 5. Технологии (GDD §8.2, 03b §2.5)

Стоимость: база по тирам `60 / 126 / 265 / 556 / 1167 / 2451` (таблица GDD §8.2) × мод школы (физика 1.10, общество 0.95, инженерия 1.00) × мод альтернативы (1.0 / 1.15 / 1.35). Итог: T1 = 120–139 очков (канон «≈120»), T5 = 2330–3310. Каждая школа покрывает T0–T5; вес в пуле `weight` = 12–100.

### Физика (18)

| Тир | ID | Название | Очки | Вес | Открывает / эффект |
|---|---|---|---|---|---|
| T0 | `phys_lasers_1` | Лазеры I | 66 | 100 | +weapon:laser_s_mk1; +weapon:laser_m_mk1 |
| T0 | `phys_shields_1` | Щиты I | 66 | 100 | +module:shield_gen_mk1; +module:shield_bank_mk1 |
| T0 | `phys_scanners_1` | Сканеры I | 66 | 100 | +module:sensor_mk1; +building:sensor; sensor_range +1 |
| T1 | `phys_lasers_2` | Лазеры II | 139 | 85 | energy_dmg +0.1 |
| T1 | `phys_reactor_1` | Реакторы I | 139 | 80 | power +0.15; energy_prod +0.05; +module:reactor_mk2 |
| T1 | `phys_pd_1` | Точечная оборона I | 139 | 80 | +weapon:pd_turret_s_mk1; +module:pd_turret_mk1 |
| T2 | `phys_shields_2` | Щиты II | 292 | 70 | shield_max +0.2; +module:shield_gen_mk2; +module:shield_bank_mk2 |
| T2 | `phys_ion_1` | Ионное оружие | 292 | 70 | +weapon:ion_m_mk1 |
| T2 | `phys_lasers_3` | Лазеры III | 292 | 65 | +weapon:laser_l_mk1 |
| T2 | `phys_robotics_1` | Робототехника | 292 | 60 | +building:robot_plant; minerals_prod +0.1 |
| T2 | `phys_sensors_2` | Сенсоры II | 292 | 65 | +module:sensor_mk2; sensor_range +1 |
| T3 | `phys_shields_3` | Щиты III | 612 | 55 | +building:shield_gen; shield_regen +0.1 |
| T3 | `phys_reactor_2` | Реакторы II | 612 | 55 | power +0.15; energy_prod +0.1; +module:reactor_mk3 |
| T3 | `phys_plasma_1` | Плазма I | 612 | 55 | +weapon:plasma_m_mk1 |
| T4 | `phys_shields_4` | Щиты IV | 1476 | 40 | shield_max +0.3; +module:shield_gen_mk3 |
| T4 | `phys_lasers_4` | Лазеры IV | 1476 | 40 | energy_dmg +0.2; +weapon:laser_s_mk2 |
| T4 | `phys_plasma_2` | Плазма II | 1476 | 38 | +weapon:thermal_l_mk1 |
| T5 | `phys_singularity_1` | Сингулярный реактор | 3640 | 18 | power +0.3; +module:reactor_mk4; флаг singular_reactor |

### Общество (17)

| Тир | ID | Название | Очки | Вес | Открывает / эффект |
|---|---|---|---|---|---|
| T0 | `soc_biology_1` | Биология | 57 | 100 | +building:hydroponics; +building:hospital |
| T0 | `soc_politics_1` | Политика | 57 | 100 | unity_prod +0.1 |
| T0 | `soc_administration_1` | Администрация | 57 | 100 | +building:unity_center; tradition_cost -0.05 |
| T1 | `soc_education_1` | Образование | 120 | 90 | +building:academy |
| T1 | `soc_commerce_1` | Коммерция | 120 | 90 | +building:market; +building:trade_hub; credits_prod +0.1 |
| T1 | `soc_expansion_1` | Экспансия | 120 | 85 | outpost_cost -0.2; colony_cost -0.1 |
| T1 | `soc_colonization_1` | Колонизация | 120 | 85 | colony_cost -0.25; флаг colonization_efficiency |
| T2 | `soc_genetics_1` | Генетика | 252 | 70 | pop_growth +0.15 |
| T2 | `soc_xenology_1` | Ксенология | 252 | 65 | +building:embassy; diplomacy +0.1 |
| T2 | `soc_commerce_2` | Коммерция II | 252 | 65 | +building:bank; credits_prod +0.15 |
| T2 | `soc_education_2` | Образование II | 252 | 70 | physics_prod +0.1; society_prod +0.1; engineering_prod +0.1 |
| T3 | `soc_traditions_1` | Традиции | 528 | 50 | unity_prod +0.2 |
| T3 | `soc_governance_1` | Управление | 528 | 50 | +building:customs; +building:police_station; stability +5 |
| T4 | `soc_psionics_1` | Псионика | 1275 | 35 | unity_prod +0.25; флаг psionics |
| T4 | `soc_synthetic_food_1` | Синтетическая пища | 1275 | 35 | +building:food_synthesizer; food_prod +0.1 |
| T5 | `soc_ascension_1` | Вознесение | 3143 | 15 | energy_prod +0.1; minerals_prod +0.1; food_prod +0.1; alloys_prod +0.1; goods_prod +0.1; unity_prod +0.1; influence_prod +0.1; credits_prod +0.1; флаг ascension |
| T5 | `soc_council_1` | Галактический совет | 3143 | 15 | influence_prod +0.5; флаг galactic_council |

### Инженерия (27)

| Тир | ID | Название | Очки | Вес | Открывает / эффект |
|---|---|---|---|---|---|
| T0 | `eng_metallurgy_1` | Металлургия | 60 | 100 | +building:foundry; alloys_prod +0.1 |
| T0 | `eng_hull_1` | Корпуса I | 60 | 100 | +hull:hull_frigate |
| T0 | `eng_kinetics_1` | Кинетика I | 60 | 100 | +weapon:kinetic_s_mk1; +weapon:kinetic_m_mk1 |
| T0 | `eng_tools_1` | Инструменты | 60 | 100 | +building:warehouse; build_speed +0.1; minerals_prod +0.05 |
| T1 | `eng_hull_2` | Корпуса II | 126 | 85 | +hull:hull_destroyer |
| T1 | `eng_kinetics_2` | Кинетика II | 126 | 80 | kinetic_dmg +0.1 |
| T1 | `eng_logistics_1` | Логистика | 126 | 85 | +building:hq; +building:fuel_synth; +hull:hull_troopship; fleet_cap +5 |
| T1 | `eng_armor_1` | Броня I | 126 | 85 | armor_max +0.15; +module:armor_plating_mk1 |
| T1 | `eng_thrusters_1` | Двигатели I | 126 | 85 | +module:thruster_mk2; +module:heat_sink_mk2 |
| T1 | `eng_shipyard_1` | Верфи | 126 | 80 | +building:large_shipyard |
| T2 | `eng_hull_3` | Корпуса III | 265 | 65 | +hull:hull_cruiser |
| T2 | `eng_armor_2` | Броня II | 265 | 60 | armor_max +0.3; +module:armor_plating_mk2 |
| T2 | `eng_missiles_1` | Ракеты | 265 | 65 | +weapon:missile_m_mk1 |
| T2 | `eng_fsd_1` | FSD II | 265 | 70 | fsd_range +2; +module:fsd_mk2 |
| T2 | `eng_kinetics_3` | Кинетика III | 265 | 65 | +weapon:kinetic_l_mk1; +weapon:railgun_l_mk1 |
| T2 | `eng_logistics_2` | Логистика II | 265 | 60 | +module:cargo_pod_mk2; +module:fuel_tank_mk2; trade_routes +1; +hull:hull_trader_large |
| T2 | `eng_metallurgy_2` | Металлургия II | 265 | 65 | +building:armory; +building:recycling_complex; alloys_prod +0.1; goods_prod +0.1 |
| T3 | `eng_armor_3` | Броня III | 556 | 45 | armor_max +0.35; +module:armor_plating_mk3 |
| T3 | `eng_missiles_2` | Торпеды | 556 | 45 | +weapon:torpedo_l_mk1 |
| T3 | `eng_fsd_2` | FSD III | 556 | 45 | fsd_range +2; +module:fsd_mk3 |
| T4 | `eng_hull_4` | Корпуса IV | 1342 | 30 | +hull:hull_battleship |
| T4 | `eng_thrusters_2` | Двигатели II | 1342 | 30 | +module:thruster_mk3 |
| T4 | `eng_kinetics_4` | Кинетика IV | 1342 | 30 | kinetic_dmg +0.2; +weapon:kinetic_s_mk2 |
| T4 | `eng_carrier_1` | Носители | 1342 | 28 | +hull:hull_carrier |
| T5 | `eng_megastructure_1` | Мегаинженерия | 3309 | 15 | флаг megastructures |
| T5 | `eng_hull_5` | Корпуса V | 3309 | 15 | +hull:hull_titan |
| T5 | `eng_colossus_1` | Колоссы | 3309 | 12 | +hull:hull_colossus |

Все `requires` валидны и не выше собственного тира; все технологии достижимы из T0 (проверено обходом графа).

## 6. Корпуса (GDD §9.4, §9.3)

| ID | Корпус | Класс | HP | Броня | Щит | Масса | Слоты S/M/L/U/I | Скорость | Сплавы | Тактов | requiredTech |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `hull_corvette` | Корпус «Стриж» | corvette | 180 | 40 | 90 | 80 | 2/1/0/3/2 | 480/620 | 12 | 3 | — |
| `hull_frigate` | Корпус «Клинок» | frigate | 340 | 90 | 160 | 140 | 3/1/0/4/2 | 420/540 | 25 | 5 | `eng_hull_1` |
| `hull_destroyer` | Корпус «Молот» | destroyer | 620 | 180 | 280 | 260 | 0/2/1/5/3 | 380/470 | 45 | 8 | `eng_hull_2` |
| `hull_cruiser` | Корпус «Копьё» | cruiser | 1250 | 380 | 520 | 480 | 0/2/2/6/4 | 320/400 | 90 | 14 | `eng_hull_3` |
| `hull_battleship` | Корпус «Бастион» | battleship | 2600 | 800 | 1050 | 900 | 0/3/3/8/5 | 260/330 | 180 | 22 | `eng_hull_4` |
| `hull_titan` | Корпус «Левиафан» | titan | 6200 | 1800 | 2400 | 1800 | 0/6/6/10/6 | 200/250 | 420 | 40 | `eng_hull_5` |
| `hull_colossus` | Корпус «Молчание» | colossus | 4000 | 1500 | 1200 | 1600 | 0/0/4/6/6 | 180/220 | 2000 | 60 | `eng_colossus_1` |
| `hull_carrier` | Корпус «Улей» | carrier | 3200 | 900 | 1400 | 1200 | 0/2/2/9/6 | 240/300 | 550 | 28 | `eng_carrier_1` |
| `hull_shuttle` | Шаттл «Пыль» | shuttle | 60 | 5 | 20 | 20 | 0/0/0/1/2 | 380/460 | 6 | 2 | — |
| `hull_science` | Исследователь «Око» | science | 90 | 10 | 40 | 30 | 0/0/0/2/2 | 420/520 | 12 | 4 | — |
| `hull_trader` | Торговец «Вьюк» | trader | 220 | 20 | 60 | 90 | 0/0/0/2/4 | 340/420 | 20 | 5 | — |
| `hull_trader_large` | Торговец «Караван» | trader | 600 | 120 | 200 | 260 | 0/0/0/3/6 | 280/340 | 60 | 10 | `eng_logistics_2` |
| `hull_miner` | Шахтёр «Кирка» | miner | 260 | 60 | 90 | 110 | 0/0/0/2/4 | 300/380 | 22 | 5 | — |
| `hull_colonizer` | Колонизатор «Ковчег» | colonizer | 300 | 30 | 80 | 140 | 0/0/0/2/4 | 260/320 | 30 | 8 | — |
| `hull_troopship` | Десантный «Клин» | troopship | 450 | 120 | 160 | 200 | 0/1/0/3/4 | 300/360 | 55 | 10 | `eng_logistics_1` |
| `hull_tanker` | Топливовоз «Цистерна» | tanker | 400 | 90 | 120 | 180 | 0/0/0/2/5 | 290/350 | 40 | 8 | — |

FP задаётся проектом корабля (раздел 9), а не корпусом — таблица GDD §9.4.

## 7. Оружие (GDD §10.3)

| ID | Оружие | Слот | Урон | ROF | DPS | Точность | Дальность, м | Тепло | Мощность | БК | Тип | Сплавы | tech |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `kinetic_s_mk1` | Кинетика S | small | 12 | 1.6 | 19.2 | 0.85 | 1800 | 3 | 3 | — | kinetic | 2 | `eng_kinetics_1` |
| `kinetic_m_mk1` | Кинетика M | medium | 28 | 1.2 | 33.6 | 0.82 | 2200 | 6 | 6 | — | kinetic | 5 | `eng_kinetics_1` |
| `kinetic_l_mk1` | Кинетика L | large | 90 | 0.7 | 63.0 | 0.78 | 2600 | 14 | 14 | — | kinetic | 12 | `eng_kinetics_3` |
| `kinetic_s_mk2` | Кинетика S MK2 | small | 16 | 1.7 | 27.2 | 0.86 | 1900 | 4 | 4 | — | kinetic | 3 | `eng_kinetics_4` |
| `laser_s_mk1` | Лазер S | small | 10 | 2 | 20.0 | 0.9 | 1500 | 8 | 8 | — | energy | 3 | `phys_lasers_1` |
| `laser_s_mk2` | Лазер S MK2 | small | 14 | 2 | 28.0 | 0.91 | 1600 | 10 | 10 | — | energy | 4 | `phys_lasers_4` |
| `laser_m_mk1` | Лазер M | medium | 24 | 1.6 | 38.4 | 0.88 | 1800 | 18 | 16 | — | energy | 6 | `phys_lasers_1` |
| `laser_l_mk1` | Лазер L | large | 75 | 0.9 | 67.5 | 0.85 | 2100 | 40 | 32 | — | energy | 14 | `phys_lasers_3` |
| `railgun_l_mk1` | Рельсотрон L | large | 260 | 0.18 | 46.8 | 0.7 | 4000 | 55 | 40 | — | kinetic | 22 | `eng_kinetics_3` |
| `missile_m_mk1` | Ракета M | medium | 120 | 0.5 | 60.0 | 0.95 | 3500 | 10 | 8 | 30 | explosive | 8 | `eng_missiles_1` |
| `torpedo_l_mk1` | Торпеда L | large | 400 | 0.2 | 80.0 | 0.95 | 4000 | 20 | 12 | 12 | explosive | 18 | `eng_missiles_2` |
| `plasma_m_mk1` | Плазма M | medium | 60 | 0.9 | 54.0 | 0.8 | 2000 | 25 | 24 | — | thermal | 11 | `phys_plasma_1` |
| `thermal_l_mk1` | Термо-луч L | large | 90 | 0.8 | 72.0 | 0.9 | 2400 | 30 | 30 | — | thermal | 16 | `phys_plasma_2` |
| `ion_m_mk1` | Ион-пушка M | medium | 40 | 0.6 | 24.0 | 0.85 | 2000 | 12 | 20 | — | energy | 9 | `phys_ion_1` |
| `pd_turret_s_mk1` | ПВО-турель S | small | 6 | 4 | 24.0 | 0.9 | 1200 | 2 | 3 | — | kinetic | 4 | `phys_pd_1` |

Резисты (GDD §10.4): кинетика +25% щит / −15% броня; энергия −20% / +25%; взрыв +10% / +10%; термо +5% / +5%. Порядок: щит → броня → корпус.

## 8. Модули (GDD §9.6, 03b §11.3)

| ID | Модуль | Слот | Масса | Мощность | Сплавы | Эффект | tech |
|---|---|---|---|---|---|---|---|
| `shield_gen_mk1` | Генератор щита MK1 | utility | 6 | 8 | 4 | +90 щит, реген 2/с | `phys_shields_1` |
| `shield_gen_mk2` | Генератор щита MK2 | utility | 7 | 9 | 5 | +180 щит, реген 4.5/с | `phys_shields_2` |
| `shield_gen_mk3` | Генератор щита MK3 | utility | 9 | 12 | 8 | +300 щит, реген 7/с, resist_energy 0.15 | `phys_shields_4` |
| `armor_plating_mk1` | Броневые плиты MK1 | utility | 10 | 0 | 3 | +80 броня | `eng_armor_1` |
| `armor_plating_mk2` | Броневые плиты MK2 | utility | 12 | 0 | 5 | +180 броня | `eng_armor_2` |
| `armor_plating_mk3` | Броневые плиты MK3 | utility | 15 | 0 | 9 | +300 броня | `eng_armor_3` |
| `heat_sink_mk1` | Сброс тепла MK1 | utility | 2 | 0 | 2 | теплоотвод 10 | — |
| `heat_sink_mk2` | Сброс тепла MK2 | utility | 3 | 0 | 4 | теплоотвод 18 | `eng_thrusters_1` |
| `pd_turret_mk1` | ПВО-турель | utility | 4 | 3 | 4 | point_defense 1 | `phys_pd_1` |
| `shield_bank_mk1` | Щит-банк MK1 (SCB) | utility | 3 | 4 | 4 | shield_bank 250 | `phys_shields_1` |
| `shield_bank_mk2` | Щит-банк MK2 (SCB) | utility | 4 | 6 | 7 | shield_bank 500 | `phys_shields_2` |
| `sensor_mk1` | Сенсорный модуль MK1 | utility | 2 | 2 | 3 | сенсор 1 | `phys_scanners_1` |
| `sensor_mk2` | Сенсорный модуль MK2 | utility | 3 | 3 | 6 | сенсор 2 | `phys_sensors_2` |
| `fuel_tank_mk1` | Топливный бак MK1 | internal | 4 | 0 | 2 | fuel 40 | — |
| `fuel_tank_mk2` | Топливный бак MK2 | internal | 6 | 0 | 4 | fuel 80 | `eng_logistics_2` |
| `cargo_pod_mk1` | Грузовой отсек MK1 | internal | 5 | 0 | 2 | груз 50 т | — |
| `cargo_pod_mk2` | Грузовой отсек MK2 | internal | 7 | 0 | 4 | груз 120 т | `eng_logistics_2` |
| `reactor_mk1` | Реактор MK1 | internal | 6 | 32 | 3 | — | — |
| `reactor_mk2` | Реактор MK2 | internal | 8 | 64 | 6 | — | `phys_reactor_1` |
| `reactor_mk3` | Реактор MK3 | internal | 10 | 120 | 10 | — | `phys_reactor_2` |
| `reactor_mk4` | Реактор MK4 | internal | 12 | 220 | 18 | — | `phys_singularity_1` |
| `thruster_mk1` | Двигатели MK1 | internal | 5 | 0 | 2 | thrust 1 | — |
| `thruster_mk2` | Двигатели MK2 | internal | 6 | 0 | 3 | thrust 1.3 | `eng_thrusters_1` |
| `thruster_mk3` | Двигатели MK3 | internal | 7 | 0 | 5 | thrust 1.6 | `eng_thrusters_2` |
| `fsd_mk1` | FSD MK1 | internal | 5 | 0 | 3 | fsd_range 10 | — |
| `fsd_mk2` | FSD MK2 | internal | 6 | 0 | 5 | fsd_range 12 | `eng_fsd_1` |
| `fsd_mk3` | FSD MK3 | internal | 7 | 0 | 8 | fsd_range 15 | `eng_fsd_2` |

## 9. Проекты кораблей (GDD §9.4, 03b §10.3)

| ID | Проект | Класс | Корпус | FP | Цена верфи, Cr | Сплавы | Тактов | requiredTech | Стартовый |
|---|---|---|---|---|---|---|---|---|---|
| `player_flagship` | Флагман «Заря» | corvette | `hull_corvette` | 12 | 240000 | 25 | 3 | — | ★ |
| `corvette_scout` | Корвет «Стриж» | corvette | `hull_corvette` | 6 | 210000 | 25 | 3 | — | ★ |
| `corvette_strike` | Корвет «Оса» | corvette | `hull_corvette` | 6 | 230000 | 25 | 3 | — | ★ |
| `frigate_escort` | Фрегат «Щит» | frigate | `hull_frigate` | 13 | 900000 | 45 | 5 | `eng_hull_1` | — |
| `destroyer_gunner` | Эсминец «Молот» | destroyer | `hull_destroyer` | 24 | 2600000 | 80 | 8 | `eng_hull_2` | — |
| `cruiser_hammer` | Крейсер «Копьё» | cruiser | `hull_cruiser` | 55 | 7000000 | 180 | 14 | `eng_hull_3` | — |
| `battleship_bastion` | Линкор «Бастион» | battleship | `hull_battleship` | 130 | 18000000 | 400 | 22 | `eng_hull_4` | — |
| `titan_leviathan` | Титан «Левиафан» | titan | `hull_titan` | 300 | 45000000 | 900 | 40 | `eng_hull_5` | — |
| `carrier_swarm` | Носитель «Улей» | carrier | `hull_carrier` | 160 | 52000000 | 550 | 28 | `eng_carrier_1` | — |
| `colossus_worldburner` | Колосс «Молчание» | colossus | `hull_colossus` | 60 | 30000000 | 2000 | 60 | `eng_colossus_1` | — |
| `science_vessel` | Исследователь «Око» | science | `hull_science` | 2 | 90000 | 12 | 4 | — | ★ |
| `trader_hauler` | Торговец «Вьюк» | trader | `hull_trader` | 2 | 120000 | 20 | 5 | — | ★ |
| `trader_hauler_large` | Торговец «Караван» | trader | `hull_trader_large` | 5 | 380000 | 60 | 10 | `eng_logistics_2` | — |
| `miner_prospector` | Шахтёр «Кирка» | miner | `hull_miner` | 2 | 140000 | 22 | 5 | — | — |
| `colonizer_ark` | Колонизатор «Ковчег» | colonizer | `hull_colonizer` | 2 | 210000 | 30 | 8 | — | ★ |
| `troopship_legion` | Десант «Легион» | troopship | `hull_troopship` | 8 | 260000 | 55 | 10 | `eng_logistics_1` | — |
| `tanker_fueler` | Топливовоз «Цистерна» | tanker | `hull_tanker` | 3 | 180000 | 40 | 8 | — | — |
| `shuttle_courier` | Шаттл «Курьер» | shuttle | `hull_shuttle` | 1 | 40000 | 6 | 2 | — | — |

Стартовые: `player_flagship` (12 FP), `corvette_scout` (6 FP), `corvette_strike` (6 FP), `science_vessel` (2 FP), `trader_hauler` (2 FP), `colonizer_ark` (2 FP). Канонный стартовый флот = player_flagship (12) + 2×corvette (6+6) + science_vessel (2) + trader_hauler (2) = **28 FP** (§3.6). Цены сплавов приведены к таблице классов GDD §19.3.

## 10. Контракты станций (03b §11.1–11.2, §11.6)

| ID | Тип | Название | Такты | Награда, Cr | За прыжок | Реп. | Риск | EV/час* |
|---|---|---|---|---|---|---|---|---|
| `delivery` | delivery | Доставка груза | 4–10 | 18000 | 3500 | 2 | 0.15 | 97423 |
| `bounty` | bounty | Охота за головами | 5–12 | 32000 | 4200 | 4 | 0.35 | 63996 |
| `scan` | scan | Разведка | 3–8 | 12000 | 2800 | 2 | 0.1 | 75430 |
| `passenger` | passenger | Пассажиры | 4–9 | 22000 | 3000 | 3 | 0.2 | 97368 |
| `smuggle` | smuggle | Контрабанда | 4–10 | 45000 | 6000 | -1 | 0.5 | 29691 |
| `rescue` | rescue | Спасение | 3–8 | 26000 | 3200 | 5 | 0.25 | 102063 |
| `delivery_bulk` | delivery | Оптовая поставка | 6–14 | 29000 | 2500 | 3 | 0.2 | 119880 |
| `delivery_express` | delivery | Срочная доставка | 2–5 | 22000 | 4500 | 2 | 0.18 | 120821 |
| `bounty_capital` | bounty | Ликвидация капитана | 8–16 | 80000 | 5000 | 7 | 0.55 | 47206 |
| `bounty_fleet` | bounty | Зачистка сектора | 10–20 | 120000 | 5500 | 9 | 0.65 | 50743 |
| `scan_anomaly` | scan | Аномалия | 4–10 | 28000 | 4500 | 4 | 0.3 | 68289 |
| `scan_derelict` | scan | Обломки корабля | 3–9 | 21000 | 3600 | 3 | 0.22 | 92790 |
| `passenger_vip` | passenger | VIP-персона | 5–12 | 55000 | 5200 | 5 | 0.4 | 106867 |
| `smuggle_arms` | smuggle | Оружие в обход | 5–12 | 70000 | 7000 | -2 | 0.65 | 24030 |
| `rescue_distress` | rescue | Сигнал бедствия | 2–6 | 16000 | 2600 | 3 | 0.2 | 68706 |
| `rescue_blockade` | rescue | Прорыв блокады | 6–14 | 64000 | 6800 | 6 | 0.6 | 28872 |

* EV/час — риск-взвешенная ожидаемая прибыль по методике `docs/balance-log.md` §5: за цикл (средние тики / 180 + 0.5 ч оверхеда) × предельное число контрактов в час по полосе риска. Потолок канона — 130 000 Cr/час (канон §10, 03b §2.4); максимум в данных — 120821.

## 11. Банки имён (оригинальные, без чужих IP)

- Префиксы систем (20): Альфа, Бета, Гамма, Дельта, Эпсилон, Дзета, Эта, Тета, Йота, Каппа, Лямбда, Сигма, Омега, Тау, Хи, Ро, Пи, Фи, Пси, Ню
- Корни систем (40): Вир, Тар, Кел, Нор, Зен, Лур, Ори, Касс, Вел, Драк, Мир, Сол, Тер, Фен, Цир, Шек, Яр, Бран, Кор, Нем, Асх, Бор, Дан, Ирр, Кхар, Лом, Мор, Нал, Рел, Тис, Ульм, Хан, Элл, Юр, Аст, Гвин, Дорн, Зар, Игг, Крон
- Суффиксы (20): I, II, III, IV, V, VI, VII, a, b, c, d, Прайм, Секунда, Терция, Нова, Минор, Мажор, Ретра, Ультима, Бета-клипс
- Империи (16): Доминион Вейла, Империя Тарн, Синдикат Керн, Республика Орион, Консорциум Нова, Легион Драко, Союз Астрея, Каганат Хелл, Ковенант Сириус, Директорат Ульм, Содружество Ветров, Колония Семи Звёзд, Пакт Тихого Света, Фронтир Кхарна, Лига Вольных Портов, Теократия Немой Звезды
- Корабли (30): Стриж, Заря, Клинок, Молот, Копьё, Бастион, Левиафан, Око, Вьюк, Ковчег, Оса, Щит, Ветер, Искра, Тень, Клык, Пламя, Гром, Полынь, Рубеж, Сполох, Туман, Уголь, Хвоя, Циклон, Штиль, Ястреб, Аметист, Барс, Волна
- Станции (12): Станция «Гамма-7», Орбитал «Ковчег», Форпост «Рубеж», Док «Клевер», Терминал «Восток», Хаб «Перекрёсток», Станция «Немая Гавань», Орбитал «Стальной Пояс», Форпост «Дальний», Док «Седьмой Узел», Терминал «Соль», Хаб «Меридиан»
- Аномалии (12): Забытый маяк, Разлом Эха, Сфера Молчания, Кости Титана, Шёпот Пустоты, Архив Предтеч, Кольцо Странника, Немая звезда, Спираль Пепла, Тень Веретена, Осколок Дня, Песня Глубины

## 12. Стартовые значения и balance.json

| Поле | Значение | Источник / примечание |
|---|---|---|
| `startResources` | E 150, M 120, F 80, A 60, ТП 40, U 0, Inf 30, Cr 120000 | GDD §3.5; кредиты — ТЗ проекта (120 000 Cr); единство 0 — канон «накапливается» |
| `startIncome` | E +18, M +12, F +14, A +6, ТП +4, U +3, Inf +2 | канон §19.1 |
| `colonyCost` | 120 M + 40 ТП + 20 Inf | 03b §12.6 (420 ЭЭ ≈ 120 M + 40 ТП + 20 Inf) |
| `outpostCost` | 60 M + 30 Inf | 03b §2.2 / GDD §5.2 |
| `fleetUpkeepPerFpEnergy` / `fleetUpkeepPerFpAlloys` | 0.25 / 0.1 | 03b §10.2 |
| `baseFleetCap` / `popsFleetCap` / `systemsFleetCap` | 7 + 0.6×попы + 1×системы | GDD §9.5: flat-база 7 → старт 20 попов / 1 система = 20 FP |
| `popFoodUpkeep` | 0.5 | 03b §2.2 |
| `popGoodsUpkeep` | worker 0.2, specialist 0.4, ruler 0.6 | 03b §2.2 |
| `growthBase` | 0.05 | GDD §6.3 |
| `stabilityBase` | 60 | GDD §6.4 |
| `sciencePerResearcher` | 2 | GDD §6.2; +1 в каждую школу от столицы — в `buildings.json` |
| `interestRatePct` | 3.5 | 03b §9.5: %/100 тактов (купон облигаций 3.5%) |
| `marketSpreadPct` / `marketCommissionPct` | 4 / 2 | 03b §7.1 |
| `fleetSpeedTicksPerJump` | 1 | 1 прыжок гиперлинии = 1 такт |
| `maxTicks` | 7200 | канон §4 (7200 тактов ≈ 20 игровых лет) |

## 13. Режим (mode.json)

| Параметр | Значение |
|---|---|
| `modeId` / `rulesetVersion` | campaign / 1.0.0 |
| Название | Кампания |
| Галактика | 240 систем, spiral, 7 ИИ, chokepointBias 0.5 |
| Время | скорости [0, 1, 2, 3, 5], тактическая пауза true, тик 1× = 1 с |
| Победа | domination, federation, ascension, economy, crisis, score (6) |
| Сложность | normal |
| Старт игрока | 3 планеты, 24 попа, 60 сплавов, 120000 кредитов |

240 систем и 24 попа — решения вертикального среза M0–M5 (ТЗ этапа), а не дефолт GDD §4.1; зафиксированы в ASSUMPTIONS A8.

## 14. Локализация: l10n/ru.json и l10n/en.json

Ключей: **800** в каждом словаре (ru и en эквивалентны 1:1, проверяется скриптом). Неймспейсы: app, battle, build, colony, common, empire, fleet, flight, flow, help, hud, map, market, menu, mission, mode, notify, overlay, planet, poi, research, resource, scene, settings, star, station, system, tech, tutorial, unit, victory.

Соглашения: `namespace.section.key`

**Текущее состояние UI.** Компоненты `apps/web/src/ui/**` и `apps/web/src/render/**` пока используют inline-русские строки и локальные RU-карты в `ui/util.ts`; вызовов `t(...)` и `L10N_RU` в коде нет. Ключи добавлены под фактическую лексику интерфейса (панели, кнопки, тултипы, подсказки, статусы, а также перечисления: типы звёзд, планет, POI, станций, формации, статусы флотов). Это задел на миграцию UI на словари.

Покрытие фактических строк интерфейса (снимок 2026-11-04): **528 из 528** уникальных строк уже имеют ключ; 0 — задел.

| Файл | Уникальных строк | Покрыто | Задел |
|---|---|---|---|
| `N:/AI/stellar-frontier/apps/web/src/render/system/flight.ts` | 2 | 2 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/render/system/scene.ts` | 2 | 2 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/render/system/SystemView.ts` | 34 | 34 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/ColonyPanel.tsx` | 44 | 44 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/controls.tsx` | 1 | 1 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/EmpireDrawer.tsx` | 5 | 5 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/FleetPanel.tsx` | 23 | 23 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/FlightHUD.tsx` | 37 | 37 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/HelpContent.tsx` | 32 | 32 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/MainMenu.tsx` | 24 | 24 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/MapLabels.tsx` | 23 | 23 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/Notices.tsx` | 2 | 2 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/Overlays.tsx` | 49 | 49 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/ResearchPanel.tsx` | 24 | 24 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/StationScreen.tsx` | 37 | 37 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/SystemInspector.tsx` | 43 | 43 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/TopBar.tsx` | 45 | 45 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/Tutorial.tsx` | 10 | 10 | 0 |
| `N:/AI/stellar-frontier/apps/web/src/ui/util.ts` | 91 | 91 | 0 |

### Пример соответствия «строка UI → ключ»

| Строка UI | Ключ | EN |
|---|---|---|
| Колония | `colony.panelTitle` | Colony |
| Рынок станции | `station.marketTitle` | Station market |
| Дерево технологий | `research.tree` | Technology tree |
| Флитпауэр | `fleet.fleetPowerLabel` | Fleet power |
| ПАУЗА | `hud.pausedBadge` | PAUSED |
| Профицит: +{value} за такт, запас растёт. | `flow.surplus` | Surplus: +{value} per tick, stock grows. |
| Нейтронная звезда | `star.neutron` | Neutron star |
| Мини-карта галактики | `map.minimapAria` | Galaxy minimap |
| Отчёт боя | `hud.battleReportBtn` | Battle report |
| Нет мира. | `colony.noWorld` | No world. |
| Станция недоступна | `station.unavailable` | Station unavailable |

## 15. Решения и допущения

Согласовано с Lead 2026-11-04 (зафиксировано в ASSUMPTIONS.md):

| # | Решение | Причина |
|---|---|---|
| 1 | Шахтёр = **5.5** минерала (не 4.5 из GDD §6.2) | Только так сходится канон §19.1 «+12 минералов»: 4×5.5 − 2×3.0 − 2×2.0 = 12; 03b §3.2 — авторитетная экономика |
| 2 | `baseFleetCap = 7` | Flat-слагаемое формулы GDD §9.5; иначе старт давал бы 33–37 FP вместо канонических 20 |
| 3 | player_flagship — корпус корвета, FP 12 | Канон §3.6 «флагман-корвет»; стартовый флот ровно 28 FP |
| 4 | `capital.science = {physics:1, society:1, engineering:1}` | Канон §3.5 «+1 очко в каждую школу»; данные самодостаточны |
| 5 | `interestRatePct = 3.5` | 03b §9.5: %/100 тактов (купон облигаций империи) |
| 6 | 24 попа на 3 планетах (mode.json) | ASSUMPTIONS A8: допуск ±20% к канону §19.1; стартовая расстановка 4 шахтёра / 4 фермера |

Дополнительно (решения content-designer):

- **Единство на старте = 0** (канон §3.5 «накапливается»); 20 U — артефакт раннего набора, исправлено.
- **Кредиты 120 000 Cr** — требование ТЗ проекта и `mode.json`; канон §3.5 (5 000) и 03b §12.1 (80 000) — исторические оценки; зафиксировано как осознанное изменение.
- **Цены сплавов проектов** — по таблице классов GDD §19.3 (корвет 25, фрегат 45, эсминец 80, крейсер 180, линкор 400, титан 900, носитель 550, колосс 2000); стоимость корпуса в `hulls.json` — отдельная база конструктора.
- **Технологии** следуют таблице GDD §8.2 (126/265/556/1167/2451), как 03b §2.5; формула 120×2.1^(T−1) даёт ту же кривую с коэффициентом 1.05.
- **Наука**: в данных нет science-поля у профессий — симуляция использует `sciencePerResearcher` и `building.science` (столица 1/1/1).
- **Имена** — оригинальные; никаких названий Stellaris/Elite Dangerous.

## 16. Как проверить

```powershell
pnpm data:validate    # zod-схемы, уникальность id, ссылочная целостность tech/hull/module/design
pnpm typecheck       # типы data/sim/web
```

Скрипт-однострочник ссылочной целостности (node, из корня репозитория) обходит: `tech.requires`, все `unlock`-таргеты (`weapon:/module:/hull:/building:`), `requiredTech` зданий/корпусов/проектов, `tech` оружия/модулей, `hullId/weapons/modules` проектов и слоты профессий — ожидается 0 висячих ссылок и 0 недостижимых из T0 технологий.

Баланс контрактов пересчитывается по формуле из `docs/balance-log.md` §5; порог — 130 000 Cr/час.

## 17. Журнал итерации 2 (2026-11-04)

| Что | Изменение |
|---|---|
| `l10n/ru.json`, `l10n/en.json` | 278 → 800 ключей: добавлены ключи под фактическую лексику UI и перечисления (звёзды, планеты, POI, станции, формации, статусы) |
| `missions.json` | delivery_bulk 38 000 → 29 000 Cr; delivery_express 24 000 → 22 000 Cr и perJump 4 800 → 4 500 — уложить EV/час в канон 130 000 |
| `designs.json` | 14 проектов: цены сплавов приведены к GDD §19.3 (эсминец 95 → 80, крейсер 200 → 180, линкор 430 → 400, титан 950 → 900, корветы 28 → 25, фрегат 50 → 45 и др.) |
| `balance.json` | `startResources.unity`: 20 → 0 (канон §3.5) |
| `docs/content-reference.md` | создан (этот файл) |
| `docs/balance-log.md` | добавлен раздел 5: разбор аудита QA и методика проверки контрактов |
