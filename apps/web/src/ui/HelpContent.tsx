import { Key } from "./controls";
import { L } from "./fg";
import { useLocale } from "./fg";

function groups(): { title: string; rows: [string, string][] }[] {
  return [
  {
    title: L("Время и карта", "Time and map"),
    rows: [
      ["Space", L("пауза / продолжить", "pause / resume")],
      ["1 / 2 / 3 / 5", L("скорость времени (0 — пауза)", "time speed (0 — pause)")],
      ["M", L("галактическая карта", "galactic map")],
      ["Tab", L("следующая система", "next system")],
      ["Esc", L("закрыть оверлей · выйти на уровень выше", "close overlay · go one level up")],
      ["F1", L("эта справка", "this help")],
      ["F5 / F9", L("быстрое сохранение / загрузка", "quick save / load")],
    ],
  },
  {
    title: L("Карта (L0)", "Map (L0)"),
    rows: [
      [" " + L("Клик по метке", "Click a label"), L("выбрать систему (панель слева)", "select a system (panel on the left)")],
      [" " + L("Двойной клик", "Double click"), L("войти в систему", "enter the system")],
      [" " + L("Клик с выбранным флотом", "Click with a fleet selected"), L("приказ move_fleet в эту систему", "move_fleet order to this system")],
      [" " + L("Колесо мыши", "Mouse wheel"), L("зум карты (гистерезис 8%)", "map zoom (8% hysteresis)")],
    ],
  },
  {
    title: L("Полёт (L1)", "Flight (L1)"),
    rows: [
      ["W / S", L("тяга +/−", "throttle +/−")],
      ["A / D", L("рыскание", "yaw")],
      ["F", L("скан системы: панель покажет планеты, POI, награды и прогресс миссий", "scan system: panel shows planets, POIs, rewards and mission progress")],
      ["C", L("суперкруиз", "supercruise")],
      ["J", L("прыжок FSD", "FSD jump")],
      ["G", L("стыковка у станции", "dock at station")],
      ["Esc / " + L("кнопка «На карту»", "To map button"), L("вернуться на карту", "return to the map")],
      [" " + L("Подлёт к планете", "Fly to a planet"), L("появляется панель «Планета» и кнопка «Высадить колонистов» (нужен колонизатор, пригодность ≥ 40% и дистанция до поверхности ≤ 500 км)", "the Planet panel appears with a Deploy colonists button (colonizer + habitability ≥ 40%)")],
      [" " + L("Луны", "Moons"), L("колонизируются после колонии на родительской планете; у них свои города/станции", "colonize after the parent planet has a colony; moons have their own cities/stations")],
    ],
  },
  {
    title: L("Бой: L0, авторезолв и сетка", "Combat: L0, auto-resolve and grid"),
    rows: [
      [" " + L("Свои + вражеские флоты в системе", "Own + hostile fleets in system"), L("появляется окно «Перед боем»: авторезолв, сетка или 6DOF; режим по умолчанию — Настройки → «Бои на карте»", "a Before battle window appears: auto-resolve, grid or 6DOF; default is Settings → Map battles")],
      [" " + L("Авторезолв", "Auto-resolve"), L("мгновенный результат по формуле флота, без ручного боя", "instant result using fleet power, no manual fight")],
      [" " + L("Сетка командования", "Grid Command"), L("пошаговая битва на гексах: расстановка 7+3, инициатива, способности, S32-итог", "turn-based hex battle: 7+3 deployment, initiative, abilities, S32 result")],
      [" " + L("6DOF", "6DOF"), L("личный полёт в системе остаётся real-time; сетка и 6DOF не смешиваются", "in-system flight stays real-time; grid and 6DOF never mix")],
    ],
  },
  {
    title: L("Империя", "Empire"),
    rows: [
      [" " + L("Кнопки «Колонии», «Наука», «Флот»", "Colonies / Research / Fleet buttons"), L("панели управления империей", "empire management panels")],
      [" " + L("Эта панель", "This panel"), L("тултипы формул у каждого ресурса", "formula tooltips on every resource")],
    ],
  },
];
}

export function HelpContent() {
  useLocale();
  return (
    <div className="sf-list">
      <p className="sf-dim">
        {L("STELLAR FRONTIER — браузерная 4X-стратегия × космосимулятор. Такт равен одним игровым суткам; в полёте действует тактическая пауза.", "STELLAR FRONTIER is a browser 4X strategy × space sim. One tick equals one game day; tactical pause applies in flight.")}
      </p>
      <div className="sf-sep" />
      {groups().map((g) => (
        <div key={g.title} style={{ marginBottom: 8 }}>
          <div className="sf-h" style={{ color: "#F5C542", marginBottom: 4 }}>{g.title}</div>
          <table className="sf-table">
            <tbody>
              {g.rows.map(([k, v]) => (
                <tr key={k}>
                  <td style={{ width: 210, whiteSpace: "normal" }}>{k.split(" / ").map((part, i) => (
                    <span key={i}>{i > 0 && " / "}<Key>{part}</Key></span>
                  ))}</td>
                  <td style={{ whiteSpace: "normal" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="sf-sep" />
      <div className="sf-h" style={{ color: "#F5C542" }}>{L("Советы", "Tips")}</div>
      <ul className="sf-steps">
        <li>{L("Доход падает — откройте тултип ресурса: там разложение «источник → вклад → итог» и прогноз.", "Income drops — open the resource tooltip for the source → contribution → total breakdown and forecast.")}</li>
        <li>{L("Постройте районы на колонии: район даёт жильё и рабочие места, здание — эффект и науку.", "Build districts on a colony: districts give housing and jobs, buildings give effects and science.")}</li>
        <li>{L("Наука: у каждой школы три альтернативы — выбор влияет на доступные технологии и корабли.", "Research: each school offers three alternatives — your choice affects available tech and ships.")}</li>
        <li>{L("Флот без приказа простаивает. Выберите флот в панели «Флот» и кликните систему на карте.", "A fleet without orders idles. Select a fleet in the Fleet panel and click a system on the map.")}</li>
        <li>{L("Всё, что нельзя сделать, объясняется тултипом причины (нехватка кредитов, лимит, технология).", "Everything you cannot do explains the reason in a tooltip (credits, cap, technology).")}</li>
        <li>{L("Скан: F в полёте. Если панель пишет «новых объектов нет» — система уже изучена; для квестов смотрите сигнал/миссии.", "Scan: F in flight. If the panel says no new objects, the system is already surveyed; for quests check signals/missions.")}</li>
        <li>{L("Настройки → «Внутреннее разрешение»: 1920×1080 для FHD; кнопка «На весь экран» разворачивает окно.", "Settings → Internal resolution: 1920×1080 for FHD; Fullscreen button expands the window.")}</li>
        <li>{L("Стреляйте по небольшим астероидам: они разрушаются, обломки подбираются автоматически при подлёте.", "Shoot small asteroids: they break, and salvage is collected automatically when you fly close.")}</li>
        <li>{L("Квестовый сигнал в 3D: зелёный ромб на планете/луне/станции; летите к нему — при подлёте квест откроется.", "3D quest signal: a green diamond on a planet/moon/station; fly to it and the quest opens on approach.")}</li>
        <li>{L("Гиперпрокладчик «Путевод»: ветка «Инженерия → FSD/Корпуса» (FSD II). После неё его можно построить; иногда он продаётся на верфи даже без технологии (кнопка «Купить»). Выбери дальнюю систему и нажми «Проложить гиперпуть».", "Pathfinder Putevod: Engineering → Hyperlane I–III. After II it can be built; sometimes sold at a shipyard without the tech. Select a far system and press Plot hyperlane.")}</li>
      </ul>
    </div>
  );
}