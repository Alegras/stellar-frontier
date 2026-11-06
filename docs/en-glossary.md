# EN Glossary — «Stellar Frontier» (content localization)

> Единый источник терминологии для EN-контента. Приоритет: `content-en.overrides.json` → `content-en.auto.json` (машинный перевод) → RU-строка. UI-словари `l10n/en.json` ведутся отдельно (ключи интерфейса, не контентные строки).
> Проверка: `tools/translate-content.mjs` собирает все RU-контентные строки в карту RU→EN; покрытие контролируется независимой проверкой «нет ни одного RU-контентного поля без EN».

> **Языковая политика проекта:** русский — основной и обязательный язык игры (все контентные и интерфейсные строки должны быть на русском); **EN — опциональный переключатель**, производный слой (`content-en.overrides.json` → `content-en.auto.json` → runtime `applyContentLocale`). Любая правка смысла/текста делается сначала в RU-источнике, затем обновляется EN-слой.> Обновлено: 2026-11-04 (data-systems + data-campaign).

## 1. Правила стиля и терминологии

| # | Правило | Пример |
|---|---|---|
| 1 | Имена собственные (корабли, станции, империи, древа, узлы, названия технологий) — Title Case, кавычки-ёлочки «» | Hull «Swift», «Veil Dominion» |
| 2 | Описания, брифинги, лор — sentence case, сдержанная НФ: факт + следствие | «The door answers the request. It is not an invitation.» |
| 3 | Термины вселенной: **Builders**, **the Rift**, **the Spindle**, **the Silent Star**, **the Roads**, **the Silent** | Строители → Builders, Разлом → the Rift |
| 4 | Должности и профессии — нарицательно: Governor, Technician, Researcher | Наместник → Governor |
| 5 | Единицы и сокращения не переводятся: FP, FSD, HP, E, A, Cr; поколения — Mk1/Mk2 (не MK1) | «+90 shield», «25 A» |
| 6 | Числа: пробел как разделитель тысяч (1 200), десятичная точка (0.25), проценты без пробела (12%) | — |
| 7 | Тире в тексте — длинное (—); дефис только внутри слов | — |
| 8 | Никаких чужих IP: названия и термины Stellaris / Elite Dangerous / Star Citizen не используются | проверяется ревью |
| 9 | Одна RU-строка → один EN-вариант (иначе коллизия в overrides) | «Синтезатор пищи» → Food Synthesizer |
| 10 | Артикль «the» у уникальных объектов вселенной — только в прозе, не в названиях карточек | «the Rift is waiting» / карточка «Rift» |

### Транслитерация для новых имён

| RU | EN | RU | EN | RU | EN |
|---|---|---|---|---|---|
| А | A | Р | R | Ш | Sh |
| Б | B | С | S | Щ | Shch |
| В | V | Т | T | Ъ | — |
| Г | G | У | U | Ы | Y |
| Д | D | Ф | F | Ь | — |
| Е/Ё | E / Yo | Х | Kh | Э | E |
| Ж | Zh | Ц | Ts | Ю | Yu |
| З | Z | Ч | Ch | Я | Ya |
| И | I | Й | Y | Ю | Yu |
| К | K | Л | L | М | M |
| Н | N | О | O | П | P |

Смысловые имена (корабли, станции, древа) переводятся по смыслу: Стриж → Swift, а не Strizh. Транслитерация — только для систем, секторов и кодов.

---

## 2. Ресурсы, потоки, страты

### Ресурсы (8)

| ID | RU | EN |
|---|---|---|
| energy | Энергия | Energy |
| minerals | Минералы | Minerals |
| food | Пища | Food |
| alloys | Сплавы | Alloys |
| goods | Товары потребления | Consumer Goods |
| unity | Единство | Unity |
| influence | Влияние | Influence |
| credits | Кредиты | Credits |

### Школы науки и страты

| ID | RU | EN |
|---|---|---|
| physics | Физика | Physics |
| society | Общество | Society |
| engineering | Инженерия | Engineering |
| worker | Рабочие | Workers |
| specialist | Специалисты | Specialists |
| ruler | Правители | Rulers |

## 3. Экономика планеты: профессии, районы, здания

### Профессии (20)

| ID | RU | EN |
|---|---|---|
| technician | Техник | Technician |
| miner | Шахтёр | Miner |
| farmer | Фермер | Farmer |
| metallurgist | Металлург | Metallurgist |
| artisan | Ремесленник | Artisan |
| researcher | Исследователь | Researcher |
| administrator | Администратор единства | Unity Administrator |
| governor | Наместник | Governor |
| soldier | Солдат | Soldier |
| trader | Торговец | Trader |
| priest | Священник | Priest |
| engineer | Инженер-ремонтник | Repair Engineer |
| robot_worker | Робот-рабочий | Robot Worker |
| xenologist | Учёный-ксенолог | Xenologist |
| mercenary | Наёмник | Mercenary |
| ace_pilot | Пилот-ас | Ace Pilot |
| hydro_tech | Гидротехник | Hydroponics Technician |
| food_synthesist | Синтезатор пищи | Food Synthesist |
| recycler | Переработчик | Recycler |
| logistician | Грузчик-логист | Logistics Handler |

### Районы (7)

| ID | RU | EN |
|---|---|---|
| residential | Жилой район | Residential District |
| energy_district | Энергорайон | Energy District |
| mining_district | Горный район | Mining District |
| agriculture_district | Агрорайон | Agriculture District |
| industrial_district | Промышленный район | Industrial District |
| academic_district | Академический район | Academic District |
| commercial_district | Торговый район | Commercial District |

### Здания (27)

| ID | RU | EN |
|---|---|---|
| capital | Дворец (столица) | Capital Palace |
| laboratory | Лаборатория | Laboratory |
| goods_factory | Фабрика ТП | Consumer Goods Factory |
| unity_center | Центр единства | Unity Center |
| barracks | Казарма | Barracks |
| hospital | Госпиталь | Hospital |
| police_station | Полицейский участок | Police Station |
| temple | Голографический театр | Holo-Theater |
| academy | Академия | Academy |
| sensor | Сенсорная станция | Sensor Station |
| warehouse | Складской комплекс | Warehouse Complex |
| market | Биржа | Exchange |
| trade_hub | Торговый терминал | Trade Terminal |
| customs | Таможня | Customs House |
| bank | Банк | Bank |
| embassy | Посольство | Embassy |
| hydroponics | Гидропонный комплекс | Hydroponics Complex |
| foundry | Литейный комплекс | Foundry Complex |
| recycling_complex | Комплекс переработки | Recycling Complex |
| armory | Оружейный цех | Ordnance Workshop |
| fuel_synth | Топливный синтезатор | Fuel Synthesizer |
| shipyard | Верфь | Shipyard |
| large_shipyard | Большая верфь | Grand Shipyard |
| robot_plant | Синтетический центр | Synthetic Center |
| food_synthesizer | Синтезатор пищи | Food Synthesizer |
| hq | Штаб флота | Fleet HQ |
| shield_gen | Планетарный щит | Planetary Shield |

## 4. Флот: корпуса, проекты, оружие, модули

### Корпуса (16)

| ID | RU | EN |
|---|---|---|
| hull_corvette | Корпус «Стриж» | Hull «Swift» |
| hull_frigate | Корпус «Клинок» | Hull «Blade» |
| hull_destroyer | Корпус «Молот» | Hull «Hammer» |
| hull_cruiser | Корпус «Копьё» | Hull «Spear» |
| hull_battleship | Корпус «Бастион» | Hull «Bastion» |
| hull_titan | Корпус «Левиафан» | Hull «Leviathan» |
| hull_colossus | Корпус «Молчание» | Hull «Silence» |
| hull_carrier | Корпус «Улей» | Hull «Hive» |
| hull_shuttle | Шаттл «Пыль» | Shuttle «Dust» |
| hull_science | Исследователь «Око» | Science Vessel «Eye» |
| hull_trader | Торговец «Вьюк» | Trader «Pack» |
| hull_trader_large | Торговец «Караван» | Trader «Caravan» |
| hull_miner | Шахтёр «Кирка» | Miner «Pickaxe» |
| hull_colonizer | Колонизатор «Ковчег» | Colonizer «Ark» |
| hull_troopship | Десантный «Клин» | Troopship «Wedge» |
| hull_tanker | Топливовоз «Цистерна» | Tanker «Cistern» |

### Классы кораблей (16)

| classId | RU | EN |
|---|---|---|
| corvette | корвет | Corvette |
| frigate | фрегат | Frigate |
| destroyer | эсминец | Destroyer |
| cruiser | крейсер | Cruiser |
| battleship | линкор | Battleship |
| titan | титан | Titan |
| colossus | колосс | Colossus |
| carrier | носитель | Carrier |
| shuttle | шаттл | Shuttle |
| science | исследователь | Science Vessel |
| trader | торговец | Trader |
| miner | шахтёр | Miner |
| colonizer | колонизатор | Colonizer |
| troopship | десантный | Troopship |
| tanker | топливовоз | Tanker |
| flagship | флагман | Flagship |

### Готовые проекты (18)

| ID | RU | EN |
|---|---|---|
| player_flagship | Флагман «Заря» | Flagship «Dawn» |
| corvette_scout | Корвет «Стриж» | Corvette «Swift» |
| corvette_strike | Корвет «Оса» | Corvette «Wasp» |
| frigate_escort | Фрегат «Щит» | Frigate «Shield» |
| destroyer_gunner | Эсминец «Молот» | Destroyer «Hammer» |
| cruiser_hammer | Крейсер «Копьё» | Cruiser «Spear» |
| battleship_bastion | Линкор «Бастион» | Battleship «Bastion» |
| titan_leviathan | Титан «Левиафан» | Titan «Leviathan» |
| carrier_swarm | Носитель «Улей» | Carrier «Hive» |
| colossus_worldburner | Колосс «Молчание» | Colossus «Silence» |
| science_vessel | Исследователь «Око» | Science Vessel «Eye» |
| trader_hauler | Торговец «Вьюк» | Trader «Pack» |
| trader_hauler_large | Торговец «Караван» | Trader «Caravan» |
| miner_prospector | Шахтёр «Кирка» | Miner «Pickaxe» |
| colonizer_ark | Колонизатор «Ковчег» | Colonizer «Ark» |
| troopship_legion | Десант «Легион» | Troopship «Legion» |
| tanker_fueler | Топливовоз «Цистерна» | Tanker «Cistern» |
| shuttle_courier | Шаттл «Курьер» | Shuttle «Courier» |

### Оружие (15)

| ID | RU | EN |
|---|---|---|
| kinetic_s_mk1 | Кинетика S | Kinetic S |
| kinetic_m_mk1 | Кинетика M | Kinetic M |
| kinetic_l_mk1 | Кинетика L | Kinetic L |
| kinetic_s_mk2 | Кинетика S MK2 | Kinetic S Mk2 |
| laser_s_mk1 | Лазер S | Laser S |
| laser_s_mk2 | Лазер S MK2 | Laser S Mk2 |
| laser_m_mk1 | Лазер M | Laser M |
| laser_l_mk1 | Лазер L | Laser L |
| railgun_l_mk1 | Рельсотрон L | Railgun L |
| missile_m_mk1 | Ракета M | Missile M |
| torpedo_l_mk1 | Торпеда L | Torpedo L |
| plasma_m_mk1 | Плазма M | Plasma M |
| thermal_l_mk1 | Термо-луч L | Thermal Lance L |
| ion_m_mk1 | Ион-пушка M | Ion Cannon M |
| pd_turret_s_mk1 | ПВО-турель S | Point-Defense Turret S |

### Модули (27)

| ID | RU | EN |
|---|---|---|
| shield_gen_mk1 | Генератор щита MK1 | Shield Generator Mk1 |
| shield_gen_mk2 | Генератор щита MK2 | Shield Generator Mk2 |
| shield_gen_mk3 | Генератор щита MK3 | Shield Generator Mk3 |
| armor_plating_mk1 | Броневые плиты MK1 | Armor Plating Mk1 |
| armor_plating_mk2 | Броневые плиты MK2 | Armor Plating Mk2 |
| armor_plating_mk3 | Броневые плиты MK3 | Armor Plating Mk3 |
| heat_sink_mk1 | Сброс тепла MK1 | Heat Sink Mk1 |
| heat_sink_mk2 | Сброс тепла MK2 | Heat Sink Mk2 |
| pd_turret_mk1 | ПВО-турель | Point-Defense Turret |
| shield_bank_mk1 | Щит-банк MK1 (SCB) | Shield Bank Mk1 (SCB) |
| shield_bank_mk2 | Щит-банк MK2 (SCB) | Shield Bank Mk2 (SCB) |
| sensor_mk1 | Сенсорный модуль MK1 | Sensor Module Mk1 |
| sensor_mk2 | Сенсорный модуль MK2 | Sensor Module Mk2 |
| fuel_tank_mk1 | Топливный бак MK1 | Fuel Tank Mk1 |
| fuel_tank_mk2 | Топливный бак MK2 | Fuel Tank Mk2 |
| cargo_pod_mk1 | Грузовой отсек MK1 | Cargo Pod Mk1 |
| cargo_pod_mk2 | Грузовой отсек MK2 | Cargo Pod Mk2 |
| reactor_mk1 | Реактор MK1 | Reactor Mk1 |
| reactor_mk2 | Реактор MK2 | Reactor Mk2 |
| reactor_mk3 | Реактор MK3 | Reactor Mk3 |
| reactor_mk4 | Реактор MK4 | Reactor Mk4 |
| thruster_mk1 | Двигатели MK1 | Thrusters Mk1 |
| thruster_mk2 | Двигатели MK2 | Thrusters Mk2 |
| thruster_mk3 | Двигатели MK3 | Thrusters Mk3 |
| fsd_mk1 | FSD MK1 | FSD Mk1 |
| fsd_mk2 | FSD MK2 | FSD Mk2 |
| fsd_mk3 | FSD MK3 | FSD Mk3 |

## 5. Технологии (62 базовых + 42 дополнительных)

### Базовые технологии (62)

| ID | RU | EN |
|---|---|---|
| phys_lasers_1 | Лазеры I | Lasers I |
| phys_shields_1 | Щиты I | Shields I |
| phys_scanners_1 | Сканеры I | Scanners I |
| phys_lasers_2 | Лазеры II | Lasers II |
| phys_reactor_1 | Реакторы I | Reactors I |
| phys_pd_1 | Точечная оборона I | Point Defense I |
| phys_shields_2 | Щиты II | Shields II |
| phys_ion_1 | Ионное оружие | Ion Weapons |
| phys_lasers_3 | Лазеры III | Lasers III |
| phys_robotics_1 | Робототехника | Robotics |
| phys_sensors_2 | Сенсоры II | Sensors II |
| phys_shields_3 | Щиты III | Shields III |
| phys_reactor_2 | Реакторы II | Reactors II |
| phys_plasma_1 | Плазма I | Plasma I |
| phys_shields_4 | Щиты IV | Shields IV |
| phys_lasers_4 | Лазеры IV | Lasers IV |
| phys_plasma_2 | Плазма II | Plasma II |
| phys_singularity_1 | Сингулярный реактор | Singularity Reactor |
| soc_biology_1 | Биология | Biology |
| soc_politics_1 | Политика | Politics |
| soc_administration_1 | Администрация | Administration |
| soc_education_1 | Образование | Education |
| soc_commerce_1 | Коммерция | Commerce |
| soc_expansion_1 | Экспансия | Expansion |
| soc_colonization_1 | Колонизация | Colonization |
| soc_genetics_1 | Генетика | Genetics |
| soc_xenology_1 | Ксенология | Xenology |
| soc_commerce_2 | Коммерция II | Commerce II |
| soc_education_2 | Образование II | Education II |
| soc_traditions_1 | Традиции | Traditions |
| soc_governance_1 | Управление | Governance |
| soc_psionics_1 | Псионика | Psionics |
| soc_synthetic_food_1 | Синтетическая пища | Synthetic Food |
| soc_ascension_1 | Вознесение | Ascension |
| soc_council_1 | Галактический совет | Galactic Council |
| eng_metallurgy_1 | Металлургия | Metallurgy |
| eng_hull_1 | Корпуса I | Hulls I |
| eng_kinetics_1 | Кинетика I | Kinetics I |
| eng_tools_1 | Инструменты | Tools |
| eng_hull_2 | Корпуса II | Hulls II |
| eng_kinetics_2 | Кинетика II | Kinetics II |
| eng_logistics_1 | Логистика | Logistics |
| eng_armor_1 | Броня I | Armor I |
| eng_thrusters_1 | Двигатели I | Thrusters I |
| eng_shipyard_1 | Верфи | Shipyards |
| eng_hull_3 | Корпуса III | Hulls III |
| eng_armor_2 | Броня II | Armor II |
| eng_missiles_1 | Ракеты | Missiles |
| eng_fsd_1 | FSD II | FSD II |
| eng_kinetics_3 | Кинетика III | Kinetics III |
| eng_logistics_2 | Логистика II | Logistics II |
| eng_metallurgy_2 | Металлургия II | Metallurgy II |
| eng_armor_3 | Броня III | Armor III |
| eng_missiles_2 | Торпеды | Torpedoes |
| eng_fsd_2 | FSD III | FSD III |
| eng_hull_4 | Корпуса IV | Hulls IV |
| eng_thrusters_2 | Двигатели II | Thrusters II |
| eng_kinetics_4 | Кинетика IV | Kinetics IV |
| eng_carrier_1 | Носители | Carriers |
| eng_megastructure_1 | Мегаинженерия | Megastructure Engineering |
| eng_hull_5 | Корпуса V | Hulls V |
| eng_colossus_1 | Колоссы | Colossi |

### TECHS_EXTRA (42)

| ID | RU | EN |
|---|---|---|
| x_phys_gravity_1 | Гравитационная линза | Gravitational Lens |
| x_phys_graviton_2 | Гравитоника II | Gravitonics II |
| x_phys_tachyon | Тахионный сенсор | Tachyon Sensor |
| x_phys_sensor_array | Дальняя сенсорная сеть | Deep Sensor Network |
| x_phys_shield_matrix | Щитовая матрица | Shield Matrix |
| x_phys_shield_phased | Фазовые щиты | Phased Shields |
| x_phys_shield_singular | Сингулярный барьер | Singularity Barrier |
| x_phys_reactor_fusion | Термоядерный реактор | Fusion Reactor |
| x_phys_reactor_annihilation | Аннигиляционный реактор | Annihilation Reactor |
| x_phys_reactor_zero | Реактор нулевой точки | Zero-Point Reactor |
| x_phys_lance | Термическая копьё | Thermal Lance |
| x_phys_disruptor | Дезинтегратор | Disruptor |
| x_phys_fsd_1 | FSD IV | FSD IV |
| x_phys_fsd_2 | FSD V | FSD V |
| x_phys_grav_engine | Гравитационный двигатель | Gravity Drive |
| x_soc_census | Галактическая перепись | Galactic Census |
| x_soc_colonial_admin | Колониальная администрация | Colonial Administration |
| x_soc_colonial_union | Колониальный союз | Colonial Union |
| x_soc_megacity | Мегаполисы | Megacities |
| x_soc_galactic_law | Галактическое право | Galactic Law |
| x_soc_galactic_court | Галактический суд | Galactic Court |
| x_soc_psy_academy | Пси-академия | Psi Academy |
| x_soc_psi_chorus | Пси-хор | Psi Chorus |
| x_soc_xeno_integration | Ксено-интеграция | Xeno Integration |
| x_soc_education_net | Образовательная сеть | Education Network |
| x_soc_propaganda | Государственная пропаганда | State Propaganda |
| x_soc_meritocracy | Меритократия | Meritocracy |
| x_soc_ritual_calendar | Ритуальный календарь | Ritual Calendar |
| x_eng_sentinel_array | Сеть Сентри | Sentinel Array |
| x_eng_gate | Технология Врат | Gate Technology |
| x_eng_star_forge | Звёздная кузня | Star Forge |
| x_eng_ring_habitat | Кольцевые миры | Ring Worlds |
| x_eng_dyson | Сфера Дайсона | Dyson Sphere |
| x_eng_nexus | Научный Нексус | Science Nexus |
| x_eng_beacon | Маяк флота | Fleet Beacon |
| x_eng_titan_forge | Титановая верфь | Titan Shipyard |
| x_eng_armor_crystal | Кристаллическая броня | Crystal Armor |
| x_eng_armor_adaptive | Адаптивная броня | Adaptive Armor |
| x_eng_drive_warp | Варп-двигатели | Warp Drives |
| x_eng_drive_inertial | Инерционные компенсаторы | Inertial Compensators |
| x_eng_mega_2 | Инженерия мегаструктур II | Megastructure Engineering II |
| x_eng_fleet_doctrine | Флотские доктрины | Fleet Doctrines |

## 6. Традиции и перки

### Древа традиций (7)

| ID | RU | EN |
|---|---|---|
| discovery | Открытие | Discovery |
| expansion | Экспансия | Expansion |
| domination | Доминирование | Domination |
| prosperity | Процветание | Prosperity |
| harmony | Гармония | Harmony |
| supremacy | Превосходство | Supremacy |
| enlightenment | Просвещение | Enlightenment |

### Узлы традиций (35)

| ID | RU | EN |
|---|---|---|
| dis_1 | Любознательность | Curiosity |
| dis_2 | Научная экспедиция | Research Expedition |
| dis_3 | Дальние сенсоры | Long-Range Sensors |
| dis_4 | Полевые лаборатории | Field Laboratories |
| dis_5 | Три гипотезы | Three Hypotheses |
| exp_1 | Колониальный устав | Colonial Charter |
| exp_2 | Типовое жильё | Standard Housing |
| exp_3 | Волны переселения | Migration Waves |
| exp_4 | Форпосты фронтира | Frontier Outposts |
| exp_5 | Голос границы | Frontier Voice |
| dom_1 | Военный призыв | War Levy |
| dom_2 | Наступательная школа | Offensive School |
| dom_3 | Академия адмиралов | Admirals' Academy |
| dom_4 | Тыл и снабжение | Logistics Corps |
| dom_5 | Уставные доктрины | Field Doctrines |
| pro_1 | Энергетический баланс | Energy Balance |
| pro_2 | Открытые забои | Open-Pit Mines |
| pro_3 | Потребительский стандарт | Consumer Standard |
| pro_4 | Городские кварталы | Urban Districts |
| pro_5 | Общественный договор | Social Contract |
| har_1 | Быт и досуг | Comfort and Leisure |
| har_2 | Общественная полиция | Community Police |
| har_3 | Семейные программы | Family Programs |
| har_4 | Совет фракций | Faction Council |
| har_5 | Право на порядок | Right to Order |
| sup_1 | Патрульные соединения | Patrol Squadrons |
| sup_2 | Щитовые матрицы | Shield Matrices |
| sup_3 | Манёвренные доктрины | Maneuver Doctrines |
| sup_4 | Дополнительные жёсткие точки | Extra Hardpoints |
| sup_5 | Единый кулак | Single Fist |
| enl_1 | Культурный канон | Cultural Canon |
| enl_2 | Университеты | Universities |
| enl_3 | Разумные эдикты | Reasonable Edicts |
| enl_4 | Свободный разум | Free Mind |
| enl_5 | Эпоха разума | Age of Reason |

### Финишеры древ (7)

| ID | RU | EN |
|---|---|---|
| dis_finisher | Первопроходец | Pathfinder |
| exp_finisher | Фронтир | Frontier |
| dom_finisher | Тотальная война | Total War |
| pro_finisher | Золотой век | Golden Age |
| har_finisher | Единство | Unity |
| sup_finisher | Несокрушимость | Indomitability |
| enl_finisher | Вознесение | Ascension |

### Перки вознесения (12)

| ID | RU | EN |
|---|---|---|
| space_engineering | Космическая инженерия | Space Engineering |
| ring_world | Мир-кольцо | Ring World |
| genetic_ascension | Генетическое вознесение | Genetic Ascension |
| synthetic_ascension | Синтетическое вознесение | Synthetic Ascension |
| psionic_ascension | Псионическое вознесение | Psionic Ascension |
| diplomatic_grace | Галантная дипломатия | Diplomatic Grace |
| imperial_army | Имперская армия | Imperial Army |
| technocracy | Технократия | Technocracy |
| divine_mandate | Божественный мандат | Divine Mandate |
| trade_empire | Торговая империя | Trade Empire |
| master_builder | Мастер-строитель | Master Builder |
| ascension | Вознесение | Ascension |

## 7. Поздняя игра: мегаструктуры, кризисы, совет, шпионаж, режимы

### Мегаструктуры (7)

| ID | RU | EN |
|---|---|---|
| sentinel_array | Сеть Сентри | Sentinel Array |
| gate | Врата | Gate |
| star_forge | Звёздная кузня | Star Forge |
| ring_habitat | Мир-кольцо | Ring Habitat |
| dyson_sphere | Сфера Дайсона | Dyson Sphere |
| science_nexus | Научный Нексус | Science Nexus |
| beacon | Маяк | Beacon |

### Кризисы (5)

| ID | RU | EN |
|---|---|---|
| void_reavers | Мародёры Пустоты | Void Reavers |
| synthetic_revolt | Пробуждение Соборов | Awakening of the Cathedrals |
| grey_tide | Серый Прилив | Grey Tide |
| devourers | Пожиратели Пустоты | Devourers |
| ancient_awakening | Пробуждение Древних | Awakening of the Ancients |

### Резолюции совета (8)

| ID | RU | EN |
|---|---|---|
| res_aggression_ban | Запрет агрессии | Aggression Ban |
| res_free_trade | Свободная торговля | Free Trade |
| res_common_market | Общий рынок | Common Market |
| res_sanctions | Санкции против империи | Sanctions |
| res_fleet_limit | Ограничение флота | Fleet Limitation |
| res_science_exchange | Научный обмен | Science Exchange |
| res_forced_peace | Принудительный мир | Forced Peace |
| res_crisis_declaration | Объявление кризиса | Crisis Declaration |

### Операции шпионажа (6)

| ID | RU | EN |
|---|---|---|
| fleet_recon | Разведка флота | Fleet Reconnaissance |
| steal_tech | Кража технологии | Technology Theft |
| sabotage | Диверсия | Sabotage |
| incite | Подстрекательство | Incitement |
| steal_map | Кража карты | Map Theft |
| assassinate | Убийство адмирала | Admiral Assassination |

### Режимы игры (5)

| modeId | RU | EN |
|---|---|---|
| campaign | Кампания | Campaign |
| coop | Кооператив 2–4 | Co-op 2–4 |
| mmo | Персистентный мир | Persistent World |
| sandbox | Песочница | Sandbox |
| trial | Испытание | Trial |

## 8. Империя: этика, правление, цивики, цели

### Этика (8)

| ID | RU | EN |
|---|---|---|
| materialist | Материализм | Materialist |
| spiritualist | Спиритуализм | Spiritualist |
| individualist | Индивидуализм | Individualist |
| collectivist | Коллективизм | Collectivist |
| expansionist | Экспансионизм | Expansionist |
| isolationist | Изоляционизм | Isolationist |
| militarist | Милитаризм | Militarist |
| pacifist | Пацифизм | Pacifist |

### Формы правления (5)

| ID | RU | EN |
|---|---|---|
| directorate | Директория | Directorate |
| clan_council | Совет Кланов | Clan Council |
| technocracy | Технократия | Technocracy |
| theocracy | Теократия | Theocracy |
| corporation | Корпорация | Corporation |

### Цивики (12)

| ID | RU | EN |
|---|---|---|
| engineering_corps | Инженерный корпус | Engineering Corps |
| trade_chamber | Торговая палата | Trade Chamber |
| war_academy | Военная академия | War Academy |
| frontier_colonists | Фронтир-колонисты | Frontier Colonists |
| order_bureau | Бюро порядка | Order Bureau |
| open_science | Открытая наука | Open Science |
| palace_intrigue | Дворцовые интриги | Palace Intrigue |
| pilot_cult | Культ пилота | Pilot Cult |
| industrial_syndicate | Промышленный синдикат | Industrial Syndicate |
| psionic_archive | Псайонический архив | Psionic Archive |
| mercenary_fleet | Наёмный флот | Mercenary Fleet |
| xeno_diplomacy | Ксено-дипломатия | Xeno-Diplomacy |

### Цели-крючки (10)

| ID | RU | EN |
|---|---|---|
| fg_contract_near | Контракт рядом | Contract Nearby |
| fg_scan_signal | Странный сигнал | Strange Signal |
| fg_first_colony | Второе имя на карте | A Second Name on the Map |
| fg_build_route | Дорога прибыли | Road of Profit |
| fg_tech_choice | Третья гипотеза | A Third Hypothesis |
| fg_defend_border | Граница под ударом | Border Under Threat |
| fg_war_goal | Ограниченная цель | Limited Objective |
| fg_federation_offer | Союз или самостоятельность | Union or Independence |
| fg_megastructure_start | Веха инженерии | Engineering Milestone |
| fg_victory_push | Горизонт победы | Horizon of Victory |

## 9. Кампания: акты, ветки, концовки, контракты

### Акты (6)

| ID | RU | EN |
|---|---|---|
| 0 | Пролог «Пробуждение» | Prologue «Awakening» |
| 1 | Акт I «Фронтир» | Act I «Frontier» |
| 2 | Акт II «Хрупкий мир» | Act II «Fragile Peace» |
| 3 | Акт III «Разлом» | Act III «The Rift» |
| 4 | Акт IV «Цена силы» | Act IV «The Price of Power» |
| 5 | Акт V «Финал» | Act V «Finale» |

### Ветки (3)

| ID | RU | EN |
|---|---|---|
| federation | Федерация | Federation |
| sovereignty | Суверенитет | Sovereignty |
| syndicate | Синдикат | Syndicate |

### Концовки (8)

| ID | RU | EN |
|---|---|---|
| ending_seal | Запечатать Разлом | Seal the Rift |
| ending_control | Контролировать Разлом | Control the Rift |
| ending_release | Освободить Разлом | Release the Rift |
| ending_syndicate | Синдикат | Syndicate |
| ending_ascension | Вознесение | Ascension |
| ending_whisper | Шёпот | Whisper |
| ending_exile | Изгнание | Exile |
| ending_ironman | Ironman: конец линии | Ironman: End of the Line |

### Шаблоны контрактов (16)

| ID | RU | EN |
|---|---|---|
| delivery | Доставка груза | Cargo Delivery |
| bounty | Охота за головами | Bounty Hunt |
| scan | Разведка | Reconnaissance |
| passenger | Пассажиры | Passengers |
| smuggle | Контрабанда | Smuggling |
| rescue | Спасение | Rescue |
| delivery_bulk | Оптовая поставка | Bulk Supply |
| delivery_express | Срочная доставка | Priority Delivery |
| bounty_capital | Ликвидация капитана | Captain Elimination |
| bounty_fleet | Зачистка сектора | Sector Sweep |
| scan_anomaly | Аномалия | Anomaly |
| scan_derelict | Обломки корабля | Derelict Wreck |
| passenger_vip | VIP-персона | VIP Transfer |
| smuggle_arms | Оружие в обход | Arms Running |
| rescue_distress | Сигнал бедствия | Distress Signal |
| rescue_blockade | Прорыв блокады | Blockade Breakthrough |

## 10. Банки имён

### Префиксы систем (20)

| # | RU | EN |
|---|---|---|
|  | Альфа | Alpha |
|  | Бета | Beta |
|  | Гамма | Gamma |
|  | Дельта | Delta |
|  | Эпсилон | Epsilon |
|  | Дзета | Zeta |
|  | Эта | Eta |
|  | Тета | Theta |
|  | Йота | Iota |
|  | Каппа | Kappa |
|  | Лямбда | Lambda |
|  | Сигма | Sigma |
|  | Омега | Omega |
|  | Тау | Tau |
|  | Хи | Chi |
|  | Ро | Rho |
|  | Пи | Pi |
|  | Фи | Phi |
|  | Пси | Psi |
|  | Ню | Nu |

### Корни систем (40)

| # | RU | EN |
|---|---|---|
|  | Вир | Vir |
|  | Тар | Tar |
|  | Кел | Kel |
|  | Нор | Nor |
|  | Зен | Zen |
|  | Лур | Lur |
|  | Ори | Ori |
|  | Касс | Kass |
|  | Вел | Vel |
|  | Драк | Drak |
|  | Мир | Mir |
|  | Сол | Sol |
|  | Тер | Ter |
|  | Фен | Fen |
|  | Цир | Tsir |
|  | Шек | Shek |
|  | Яр | Yar |
|  | Бран | Bran |
|  | Кор | Kor |
|  | Нем | Nem |
|  | Асх | Askh |
|  | Бор | Bor |
|  | Дан | Dan |
|  | Ирр | Irr |
|  | Кхар | Khar |
|  | Лом | Lom |
|  | Мор | Mor |
|  | Нал | Nal |
|  | Рел | Rel |
|  | Тис | Tis |
|  | Ульм | Ulm |
|  | Хан | Khan |
|  | Элл | Ell |
|  | Юр | Yur |
|  | Аст | Ast |
|  | Гвин | Gwin |
|  | Дорн | Dorn |
|  | Зар | Zar |
|  | Игг | Igg |
|  | Крон | Kron |

### Суффиксы систем (20)

| # | RU | EN |
|---|---|---|
|  | I | I |
|  | II | II |
|  | III | III |
|  | IV | IV |
|  | V | V |
|  | VI | VI |
|  | VII | VII |
|  | a | a |
|  | b | b |
|  | c | c |
|  | d | d |
|  | Прайм | Prime |
|  | Секунда | Secunda |
|  | Терция | Tertia |
|  | Нова | Nova |
|  | Минор | Minor |
|  | Мажор | Major |
|  | Ретра | Retra |
|  | Ультима | Ultima |
|  | Бета-клипс | Beta-Clip |

### Империи (16)

| # | RU | EN |
|---|---|---|
|  | Доминион Вейла | Veil Dominion |
|  | Империя Тарн | Tarn Empire |
|  | Синдикат Керн | Kern Syndicate |
|  | Республика Орион | Orion Republic |
|  | Консорциум Нова | Nova Consortium |
|  | Легион Драко | Draco Legion |
|  | Союз Астрея | Astrea Union |
|  | Каганат Хелл | Khell Kaganate |
|  | Ковенант Сириус | Sirius Covenant |
|  | Директорат Ульм | Ulm Directorate |
|  | Содружество Ветров | Windward Commonwealth |
|  | Колония Семи Звёзд | Colony of Seven Stars |
|  | Пакт Тихого Света | Pact of Quiet Light |
|  | Фронтир Кхарна | Kharne Frontier |
|  | Лига Вольных Портов | Free Ports League |
|  | Теократия Немой Звезды | Theocracy of the Silent Star |

### Имена кораблей (30)

| # | RU | EN |
|---|---|---|
|  | Стриж | Swift |
|  | Заря | Dawn |
|  | Клинок | Blade |
|  | Молот | Hammer |
|  | Копьё | Spear |
|  | Бастион | Bastion |
|  | Левиафан | Leviathan |
|  | Око | Eye |
|  | Вьюк | Pack |
|  | Ковчег | Ark |
|  | Оса | Wasp |
|  | Щит | Shield |
|  | Ветер | Wind |
|  | Искра | Spark |
|  | Тень | Shadow |
|  | Клык | Fang |
|  | Пламя | Flame |
|  | Гром | Thunder |
|  | Полынь | Wormwood |
|  | Рубеж | Frontier |
|  | Сполох | Flare |
|  | Туман | Mist |
|  | Уголь | Coal |
|  | Хвоя | Needle |
|  | Циклон | Cyclone |
|  | Штиль | Calm |
|  | Ястреб | Hawk |
|  | Аметист | Amethyst |
|  | Барс | Snow Leopard |
|  | Волна | Wave |

### Станции (12)

| # | RU | EN |
|---|---|---|
|  | Станция «Гамма-7» | Station «Gamma-7» |
|  | Орбитал «Ковчег» | Orbital «Ark» |
|  | Форпост «Рубеж» | Outpost «Frontier» |
|  | Док «Клевер» | Dock «Clover» |
|  | Терминал «Восток» | Terminal «East» |
|  | Хаб «Перекрёсток» | Hub «Crossroads» |
|  | Станция «Немая Гавань» | Station «Silent Harbor» |
|  | Орбитал «Стальной Пояс» | Orbital «Steel Belt» |
|  | Форпост «Дальний» | Outpost «Far» |
|  | Док «Седьмой Узел» | Dock «Seventh Knot» |
|  | Терминал «Соль» | Terminal «Salt» |
|  | Хаб «Меридиан» | Hub «Meridian» |

### Аномалии (12)

| # | RU | EN |
|---|---|---|
|  | Забытый маяк | Forgotten Beacon |
|  | Разлом Эха | Echo Rift |
|  | Сфера Молчания | Sphere of Silence |
|  | Кости Титана | Titan's Bones |
|  | Шёпот Пустоты | Whisper of the Void |
|  | Архив Предтеч | Precursors' Archive |
|  | Кольцо Странника | Wanderer's Ring |
|  | Немая звезда | Silent Star |
|  | Спираль Пепла | Spiral of Ash |
|  | Тень Веретена | Shadow of the Spindle |
|  | Осколок Дня | Splinter of Day |
|  | Песня Глубины | Song of the Deep |

## 11. Интерфейсные термины, на которые опирается контент

Эти пары берутся из UI-словарей `l10n/ru.json`/`en.json` и обязаны совпадать по смыслу с контентными переводами (иначе игрок увидит два разных названия одного и того же).

### Отношения и договоры

| Ключ | RU | EN |
|---|---|---|
| diplomacy.attitude.ally | Союзник | Ally |
| diplomacy.attitude.friendly | Дружественное | Friendly |
| diplomacy.attitude.neutral | Нейтральное | Neutral |
| diplomacy.attitude.cold | Прохладное | Cold |
| diplomacy.attitude.hostile | Враждебное | Hostile |
| diplomacy.attitude.rival | Соперник | Rival |
| diplomacy.treaty.nap | Пакт о ненападении | Non-aggression pact |
| diplomacy.treaty.trade | Торговый договор | Trade agreement |
| diplomacy.treaty.research | Договор исследований | Research agreement |
| diplomacy.treaty.defensive | Оборонительный союз | Defensive pact |
| diplomacy.treaty.alliance | Союз | Alliance |
| diplomacy.treaty.federation | Федерация | Federation |
| diplomacy.treaty.vassal | Вассалитет | Vassalage |
| diplomacy.treaty.tribute | Дань | Tribute |

### Поводы к войне

| Ключ | RU | EN |
|---|---|---|
| war.cb.conquest | Завоевание | Conquest |
| war.cb.liberation | Освобождение | Liberation |
| war.cb.humiliation | Унижение | Humiliation |
| war.cb.vassalization | Вассализация | Vassalization |
| war.cb.crisis | Кризис | Crisis |
| war.cb.defensive | Оборонительная война | Defensive war |
| war.cb.none | Нет | None |

### Состояния рынка и боя

| Ключ | RU | EN |
|---|---|---|
| market.state.boom | Подъём | Boom |
| market.state.bust | Спад | Bust |
| market.state.famine | Голод | Famine |
| market.state.blockade | Блокада | Blockade |
| market.state.war | Военная экономика | War economy |
| market.state.plague | Эпидемия | Plague |
| fleet.status.idle | Ожидает | Idle |
| fleet.status.moving | В пути | Moving |
| fleet.status.combat | Бой | Combat |
| fleet.status.docked | В доке | Docked |
| fleet.status.retreat | Отступление | Retreat |
| fleet.status.scanning | Сканирует | Scanning |

### Формации флота

| Ключ | RU | EN |
|---|---|---|
| fleet.formation.wedge | Клин | Wedge |
| fleet.formation.wall | Стена | Wall |
| fleet.formation.sphere | Сфера | Sphere |
| fleet.formation.swarm | Рой | Swarm |
| fleet.formation.echelon | Эшелон | Echelon |
| fleet.formation.ambush | Засада | Ambush |
| fleet.formation.caravan | Караван | Caravan |

### Типы контрактов и миссий

| Ключ | RU | EN |
|---|---|---|
| mission.kind.delivery | Доставка | Delivery |
| mission.kind.bounty | Охота за головами | Bounty |
| mission.kind.scan | Разведка | Scan |
| mission.kind.passenger | Пассажиры | Passenger |
| mission.kind.smuggle | Контрабанда | Smuggle |
| mission.kind.rescue | Спасение | Rescue |
| contract.kind.mining | Добыча | Mining |
| contract.kind.tourist | Туризм | Tourism |
| contract.kind.escort | Эскорт | Escort |
| contract.kind.salvage | Спасение груза | Salvage |
| contract.kind.hunt | Охота | Hunt |
| contract.kind.evacuation | Эвакуация | Evacuation |

### Типы звёзд, планет, POI, станций

| Ключ | RU | EN |
|---|---|---|
| star.yellow | Жёлтая звезда | Yellow star |
| star.orange | Оранжевый карлик | Orange dwarf |
| star.red | Красный карлик | Red dwarf |
| star.blue | Голубая звезда | Blue star |
| star.white | Белый карлик | White dwarf |
| star.binary | Двойная звезда | Binary star |
| star.trinary | Тройная звезда | Trinary star |
| star.neutron | Нейтронная звезда | Neutron star |
| star.pulsar | Пульсар | Pulsar |
| star.blackhole | Чёрная дыра | Black hole |
| star.nebula | Туманность | Nebula |
| planet.continental | Континентальная | Continental |
| planet.ocean | Океаническая | Ocean |
| planet.desert | Пустынная | Desert |
| planet.tundra | Тундровая | Tundra |
| planet.arctic | Арктическая | Arctic |
| planet.savanna | Саванна | Savanna |
| planet.tropical | Тропическая | Tropical |
| planet.arid | Аридная | Arid |
| planet.volcanic | Вулканическая | Volcanic |
| planet.gas_giant | Газовый гигант | Gas giant |
| planet.barren | Безжизненная | Barren |
| planet.asteroid_belt | Астероидный пояс | Asteroid belt |
| poi.anomaly | Аномалия | Anomaly |
| poi.derelict | Остов корабля | Derelict |
| poi.pirate_base | Пиратская база | Pirate base |
| poi.mining_platform | Шахтёрская платформа | Mining platform |
| poi.research_station | Исследовательская станция | Research station |
| poi.trade_hub | Торговый узел | Trade hub |
| station.kind.outpost | Аутпост | Outpost |
| station.kind.shipyard | Верфь | Shipyard |
| station.kind.mining | Шахтёрская станция | Mining station |
| station.kind.research | Научная станция | Research station |
| station.kind.pirate | Пиратская станция | Pirate station |
| station.kind.trade | Торговая станция | Trade station |

### Условия победы

| Ключ | RU | EN |
|---|---|---|
| victory.condition.domination | Доминирование: 45% систем | Domination: 45% of systems |
| victory.condition.federation | Федерация: 3+ империи, 60% населения | Federation: 3+ empires, 60% of population |
| victory.condition.ascension | Технологическое вознесение | Technological ascension |
| victory.condition.economy | Экономическая гегемония: 40% ВВП 300 тактов | Economic hegemony: 40% of GDP for 300 ticks |
| victory.condition.crisis | Выживание в кризисе | Crisis survival |
| victory.condition.score | Счёт на такте 7200 | Score at tick 7200 |

## 12. Как устроено покрытие и как проверять

1. `tools/translate-content.mjs` обходит все JSON в `packages/data/src` (кроме `l10n/`), берёт строки с кириллицей, режет многострочные значения по строкам и выполняет `trim()` — ключ карты = такая строка.
2. Для каждого ключа значение выбирается так: `overrides[key] ?? cache[key]` (overrides — этот глоссарий, cache — машинный перевод в `tools/.translate-cache.json`).
3. Результат — `l10n/content-en.auto.json` (карта RU→EN). `l10n/content-en.overrides.json` редактируется вручную (этот глоссарий — его документация) и перекрывает автоперевод.
4. Runtime: `applyContentLocale("en")` в `@sf/data` мутирует загруженный контент под локаль; UI-переключатель вызывает его из `apps/web/src/ui/fg.ts`.

Проверки перед сдачей EN:

```powershell
node tools/translate-content.mjs            # пересобрать auto.json (нужен сетевой перевод новых строк)
node tools/validate-full-data.mjs          # целостность данных не зависит от локали
pnpm data:validate                         # схема/ссылки
```

Инварианты:

- каждая RU-контентная строка имеет EN-значение (overrides или auto) — ноль пропусков;
- в overrides нет ключей, которых нет в данных (иначе мусор);
- нет двух EN-вариантов для одной RU-строки (иначе непредсказуемая локализация);
- EN-строки не содержат кириллицы;
- l10n ru/en остаются 1:1 (это отдельный словарь интерфейса).

## 13. Карта готовности по категориям

| Категория | Файл | Видимых названий | EN зафиксировано в overrides |
|---|---|---|---|
| Ресурсы | `resources.json` | 8 | 8 |
| Профессии | `jobs.json` | 20 | 20 |
| Районы | `districts.json` | 7 | 7 |
| Здания | `buildings.json` | 27 | 27 |
| Корпуса | `hulls.json` | 16 | 16 |
| Проекты кораблей | `designs.json` | 18 | 18 |
| Оружие | `weapons.json` | 15 | 15 |
| Модули | `modules.json` | 27 | 27 |
| Технологии (база) | `techs.json` | 62 | 62 |
| Технологии (доп.) | `full/techs-extra.json` | 42 | 42 |
| Традиции | `full/traditions.json` | 49 | 49 |
| Перки | `full/perks.json` | 12 | 12 |
| Мегаструктуры | `full/megastructures.json` | 7 | 7 |
| Кризисы | `full/crises.json` | 5 | 5 |
| Резолюции | `full/resolutions.json` | 8 | 8 |
| Шпионаж | `full/espionage.json` | 6 | 6 |
| Режимы | `full/modes.json` | 5 | 5 |
| Этика | `full/ethics.json` | 8 | 8 |
| Правления | `full/governments.json` | 5 | 5 |
| Цивики | `full/civics.json` | 12 | 12 |
| Цели | `full/focus-goals.json` | 10 | 10 |
| Акты | `campaign/acts.json` | 6 | 6 |
| Ветки | `campaign/branches.json` | 3 | 3 |
| Концовки | `campaign/endings.json` | 8 | 8 |
| Контракты | `missions.json` | 16 | 16 |
| Банки имён | `names.json` | 148 | 148 |
| Описания, лор, события, брифинги (проза) | все файлы | ~1 200 строк | машинный перевод + выборочная вычитка |

Итог: все **видимые названия и термины** (≈570 строк) зафиксированы вручную в `content-en.overrides.json`; прозаические описания покрываются автопереводом с приоритетом overrides.

## 14. Выборочная вычитка (22 единицы)

Ниже — единицы, где машинный перевод заменён вручную (тон, связность, термины). Полные пары RU→EN — в `content-en.overrides.json`.

| Тип | ID | Что вычитано |
|---|---|---|
| Миссия | `main_00_awakening` | заголовок + брифинг |
| Миссия | `main_01_colony` | заголовок + брифинг |
| Миссия | `main_02_council` | заголовок + брифинг |
| Миссия | `main_03_truth` | заголовок + брифинг |
| Миссия | `main_04_legacy_use` | заголовок + брифинг |
| Миссия | `main_05_final_choice` | заголовок + брифинг + подписи |
| Миссия | `rift_03_keys` | заголовок + брифинг |
| Миссия | `br_fed_02` | заголовок + брифинг |
| Событие | `ev_silent_star_1` | заголовок + текст + выборы |
| Событие | `ev_silent_star_3` | заголовок + текст + выборы |
| Событие | `ev_derelict_convoy_2` | заголовок + текст + выборы |
| Событие | `ev_devourer_scout_1` | заголовок + текст + выборы |
| Событие | `ev_ghost_fleet_3` | заголовок + текст + выборы |
| Событие | `ev_final_choice_rumor_3` | заголовок + текст + выборы |
| Событие | `ev_rift_whisper_3_2` | заголовок + текст + выборы |
| Лор | `lore_001` | The Builders |
| Лор | `lore_004` | The First Road |
| Лор | `lore_031` | The Rift |
| Лор | `lore_051` | The Road Inward |
| Лор | `lore_071` | The Spindle |
| Аномалия | `an_003` | заголовок + текст |
| Аномалия | `an_039` | заголовок + текст |

## 15. Спорные места и принятые решения

| # | Спорное место | Решение | Почему |
|---|---|---|---|
| 1 | «Синтезатор пищи» встречается как профессия и как здание | **Food Synthesizer** для обоих | Одна RU-строка = один EN-вариант (жёсткое правило карты); «Synthesizer» читается и как человек-оператор, и как установка |
| 2 | «Мир-кольцо» — перк и мегаструктура | **Ring Habitat** для обоих | EN-термин GDD §8.7 для мегаструктуры; перк читается как «позволяет строить Ring Habitat» |
| 3 | «Вознесение» — финишер традиции, перк, концовка и технология | **Ascension** везде | Канон использует один термин; контекст различается категорией |
| 4 | Строители / Предтечи | **Builders** — основной термин; **Precursors** — только в готовых названиях POI/архивов | В лоре это одна цивилизация; два слова создают впечатление двух |
| 5 | «Товары потребления» | **Consumer Goods**; краткая форма в чипах — **Goods** | Совпадает с l10n (`hud.goods`, `resource.goods`) |
| 6 | «Сплавы» / alloys | **Alloys** | Совпадает с l10n и каноном §13 |
| 7 | «Единство» / «Влияние» | **Unity** / **Influence** | Неторгуемые запасы; канон §5 |
| 8 | «Флитпауэр» | **Fleet Power (FP)** | Канон §13: Fleet Power |
| 9 | «Апкип» | **Upkeep** | Канон §13 |
| 10 | «Такт» | **Tick**; «тактическая пауза» — **tactical pause** | Канон §13 |
| 11 | «Попы» | **Pops** (не «population units») | Канон §13 |
| 12 | «Флагман» | **Flagship** | Канон §13 |
| 13 | «Аутпост» | **Outpost** | Канон §13 |
| 14 | «Притязание» / «Военный счёт» / «Истощение» | **Claim** / **War Score** / **War Exhaustion** | Канон §13 |
| 15 | Названия кораблей-имён (Стриж, Клинок…) | по смыслу: Swift, Blade… | Транслитерация даёт нечитаемые «Strizh» |

## 16. Открытые вопросы к Lead

- «Синтезатор пищи» и «Мир-кольцо» — если нужен отдельный EN для профессии/перка, потребуется правка RU-строк в JSON (сейчас коллизия снята единым вариантом).
- Банки слогов систем переведены транслитерацией (20/40/20). Если нужен иной стиль имён (например, латинские корни вместо транслитерации) — это меняет генератор имён, а не только перевод.
- Машинный перевод длинного лора может терять «» и тире; после генерации `auto.json` имеет смысл выборочно проверить ещё 20–30 лор-записей (можно поручить по списку самых длинных строк).
- `l10n/en.json` и контентные overrides живут раздельно: при добавлении новых UI-экранов термины берутся из раздела 11 этого глоссария.

## 17. Пост-обработка машинного перевода (рекомендация Lead) и статус

В текущем `content-en.auto.json` (1798 строк, покрытие 100%) машинный перевод оставляет системные косметические артефакты, которые дешевле нормализовать в `tools/translate-content.mjs`, чем переопределять построчно:

| Артефакт | Пример | Рекомендуемое правило |
|---|---|---|
| Дефис вместо длинного тире (49 вхождений) | «but power - and the price» | `en.replace(/ - /g, " — ")` |
| Типографский апостроф (8 вхождений) | «It’s not here yet» | `en.replace(/’/g, "'")` |
| Лишние пробелы/переносы | — | `en.trim()` уже есть; дополнительно `en.replace(/\s+/g, " ")` для однострочных |
| Кавычки-ёлочки | сохраняются | нормализация не нужна, но проверить парность |

Также вручную зафиксированы 14 прозаических строк с терминологическими ошибками MT (см. журнал ниже); они уже в overrides и применятся при следующей генерации auto.json.

### Журнал правок overrides (итерация 2)

| RU (фрагмент) | Было в auto | Стало (override) |
|---|---|---|
| Гиперлинии не появились сами… | hyperlines… the builders left them open - … | hyperlanes… The Builders left them open — … |
| Двигатель, использующий саму гиперлинию… | A motor that uses the hyperline… | A drive that uses the hyperlane itself as a rail… |
| Обнаружена гиперлиния… | A hyperline has been detected… | A hyperlane has been found that runs both ways… |
| Орден, который обслуживает гиперлинии… | serves the hyperlines | maintains the hyperlanes |
| Самая старая республика Дорог… | arguing about the right to hyperlinks | rights to the hyperlanes |
| Мегаструктура Строителей… Постройте узел… | Build a knot | Build a node |
| Второй разлом, закрытый сразу… | The second fault | A second Rift, sealed right after it opened |
| Личный корабль Адмирала-Аватара… | memory of the forerunners | a memory of the Builders |
| 5 описаний режимов | «tick on», «pause is prohibited» и т.п. | вычитанный EN (см. overrides) |
| Союзник, которому вы доверяли… | Find it | Find the traitor |

### Статус покрытия (проверено)

- Данных: **1798** уникальных RU-контентных строк; в `auto.json` — 1798 значений: **пропусков 0**, кириллицы в EN — **0**, `EN == RU` — **0**, лишних ключей — **0**.
- Overrides: **584** записи (570 терминов/имён + 14 вычитанных прозаических строк); все 570 терминов применены в текущем auto.json.
- Требует одного перегона `node tools/translate-content.mjs` для применения 14 новых строк (сетевой перевод не нужен — строки берутся из overrides).

## 18. RU-полировка (итерация 3): что поправлено и что осталось

### 18.1. Выполненные правки (76 значений)

| Категория | Правок | Что именно |
|---|---|---|
| Служебные пометки в тексте для игрока | 4 | убраны «(GDD §6.2)», «(03b §3.6/§3.2; … §19.1 …)» из `jobs.descRu`, `districts.descRu` — внутренние ссылки не должны быть видны |
| Поколения техники | 45 | `MK1…MK4` → `Mk1…Mk4` в названиях модулей и описаниях технологий (единый стиль, совпадает с каноном GDD) |
| Десятичная запятая | 22 | `0.5` → `0,5`, `0.25` → `0,25`, `1.5` → `1,5`, `0.2×` → `0,2×` в описаниях зданий/районов/профессий/правлений |
| Тир вместо «T» | 6 | «T1–T2» → «тир 1–2», «T4» → «тир 4», «T4+» → «4-го тира и выше» (акты, археология, перки, лор, профессии) |
| Англицизмы в RU | 2 | «VIP-персона» → «Высокопоставленная особа»; «с CB «унижение»» → «с поводом «унижение»» |
| Имена собственные | 1 | «память о предтечах» → «память о Строителях» (единый термин) |

Файлы: `districts.json`, `jobs.json`, `designs.json`, `missions.json`, `modules.json`, `weapons.json`, `buildings.json`, `techs.json`, `full/focus-goals.json`, `full/perks.json`, `full/governments.json`, `campaign/acts.json`, `campaign/archaeology.json`, `campaign/lore.json`.

### 18.2. Канонические исключения (оставлены осознанно)

- 7 полей состоят только из канонических аббревиатур: `FSD II`, `FSD III`, `FSD IV`, `FSD V`, `FSD Mk1/2/3` — это названия технологий/модулей, а не английские заготовки; допускаются языковой политикой (FP, FSD, Mk, CR, L1/L2).
- Допустимые аббревиатуры в русских текстах: `FP`, `FSD`, `Mk`, `CR/Cr`, `E`, `A`, `M`, `L`, `SCB`, `PvE`, `PvP`, `T0–T5` (тиры в интерфейсе), `L1/L2` (слои), `S/M/L` (слоты оружия).
- Римские числители в названиях (`Акт II`, `Шёпот II`) — норма.

### 18.3. Автопроверки RU (после правок)

| Проверка | Результат |
|---|---|
| Пустые/не русские текстовые поля | 0 (кроме 7 канонических FSD-названий) |
| Смешанные латинские токены в RU-тексте | 1 допустимый (`PvE-галактика`), остальное — разрешённые аббревиатуры |
| Десятичная точка вместо запятой в RU-тексте | 0 |
| Двойные пробелы, пробелы перед пунктуацией | 0 |
| Прямые кавычки в RU-тексте | 0 (используются «») |
| Согласование числительных (такт/такта/тактов, поп/попа/попов и т.п.) | 0 нарушений по эвристике |

### 18.4. Осталось (зона Lead / задача UI)

В `l10n/ru.json` (файл ведёт Lead, не редактировал) остались англицизмы в видимых строках — кандидаты на замену:

| Ключ | Сейчас | Предложение |
|---|---|---|
| `menu.seedLabel` | «Seed галактики (пусто — случайный)» | «Зерно галактики (пусто — случайное)» |
| `menu.seedHint` | «Один и тот же seed даёт идентичную галактику…» | «Одно и то же зерно даёт идентичную галактику…» |
| `menu.seedInvalid` | «Seed должен быть целым…» | «Зерно должно быть целым неотрицательным числом» |
| `help.map.fleetOrder` | «приказ move_fleet в эту систему» | «приказ флоту идти в эту систему» |
| `fleet.clickNote` | «…отдаёт приказ move_fleet» | «…отдаёт приказ движения» |
| `system.orderMove` | «Приказ move_fleet» | «Приказ движения» |
| `fleet.noneHint` | «Постройте корабль на верфи станции (build_ship)» | «Постройте корабль на верфи станции» |
| `overlay.bloom` | «Bloom (свечение)» | «Свечение (Bloom)» |
| `flight.assistOn/Off` | «Assist включён/выключен (6DOF)» | «Ассист включён/выключен (6DOF)» |
| `flight.heatSinkUsed/Vent` | «Heat sink израсходован», «Heat sink: сброс тепла» | «Сброс тепла израсходован», «Сброс тепла: сброс тепла активен» |
| `flight.controlsHint` | «…Z — assist» | «…Z — ассист» |
| `map.clusterNote` | «…(docs/12 §4)» | убрать внутреннюю ссылку |
| `help.fleetCap` | «7 + 0.6×попы + 1×системы» | «7 + 0,6×попы + 1×системы» |
| `research.tierShort` | «T{tier} · {cost} очк.» | «Тир {tier} · {cost} очк.» |

### 18.5. EN-слой после RU-правок: закрыто вручную

75 изменённых RU-строк, которые не успели перевестись из-за rate-limit внешнего переводчика, переведены вручную и добавлены в `content-en.overrides.json` (ключ = точная trimmed RU-строка):

- модули и описания технологий с `Mk` (Shield Generator Mk1…, Thrusters Mk3…), включая фразы «Открывает …»;
- районы и профессии с десятичной запятой (0,25 / 0,5 / 1,2 / 4,5 / 5,5) → EN с точкой;
- здания (посольство, переработка, оружейный цех), правление (директория), концепты «тир N» → «tier N» / «tiers 1–2»;
- акты кампании (тиры, мегаструктуры, титаны), археология («tier-4 module»), лор (tier-4+ empires), концовка Ironman;
- базовый контракт «Высокопоставленная особа» → «Distinguished Passenger».

Итог: offline-сборка карты (overrides ?? cache) даёт **1798/1798** строк — пропусков 0, кириллицы в EN 0, `EN == RU` 0. Пересборка `content-en.auto.json` выполняется Lead'ом; повторный сетевой перевод не нужен.
