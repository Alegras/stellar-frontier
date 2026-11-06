# M11 · Мультиплеер: протокол и сервер

> Реализация: apps/api (Fastify + @fastify/websocket), packages/protocol (zod-контракт), apps/web/src/net (NetClient + LobbyScreen).
> Тест: tools/mp-test.mjs (2 WS-клиента), apps/web/e2e/mp.spec.ts (2 браузера).
> Запуск сервера: `node <runtime>/pnpm.mjs exec tsx apps/api/src/server.ts` (PORT=8787 по умолчанию).

## 1. Топология

| Слой | Технология | Назначение |
|---|---|---|
| HTTP | Fastify 5 | лобби: POST /rooms, POST /rooms/:code/join, GET /rooms/:code, GET /modes, GET /health; CORS для dev |
| WSS | @fastify/websocket (ws) | hello/welcome, лобби-события, команды, снапшоты, чат, пауза, тактический лок, реконнект |
| Симуляция | @sf/sim | **сервер-авторитет**: `createWorld`, `tick`, `applyCommand`; клиент только командует |
| Протокол | @sf/protocol | zod-схемы ClientMessage/ServerMessage, константы лимитов, PROTOCOL_VERSION=1 |

Один процесс = менеджер комнат в памяти. Комната: код A-Z0-9 (5 символов), режим, seed, места, состояние lobby/active/finished.

## 2. Режимы (M11)

| Режим | Мест | Тик | Снапшоты | Пауза | Тактический лок |
|---|---|---|---|---|---|
| coop | 2–4 | 1000 мс (конфиг) | 1000 мс | голосование (≥50%, мин 2, кулдаун 5 с, ≤3/час) | 90 с (120 с PvP) |
| mmo | 30–100 (клэмп спеки; данные MODES дают 300 — конфликт, см. §7) | 900 000 мс | 5000 мс | нет | 90 с |

MODES читаются из @sf/data; если данных нет — встроенные лимиты (BUILTIN_MODES). Значения `playersMax` жёстко клэмпятся к спецификации M11: coop 2–4, mmo 30–100.

## 3. Поток

1. `POST /rooms {modeId, nick, seed?}` → `{code, seat, token, wsUrl, room}`.
2. WS `hello {protocol, roomCode, token}` → `welcome {seat, room, resumed}`; если партия идёт — `full_state` (сериализованный мир sim).
3. `ready` у всех → хост `start` → `started` + `full_state` всем.
4. Сервер тикает `sim.tick(world)` по расписанию режима; каждые `snapshotMs` — компактный `snapshot` (игроки/ресурсы/доход, флоты, владельцы систем, события, пауза, лок).
5. Команда клиента `cmd {seq, cmd}` → валидация zod → проверка принадлежности (флот/колония/верфь) → token bucket (5/с, burst 10) → `sim.applyCommand` → `cmd_ack {ok, tick, reason?}`.
6. Реконнект: `/ws?code=..&token=..` или `hello` с токеном в течение 30 с; ответ `welcome resumed=true` + `full_state`. После grace место освобождается, хост передаётся.
7. Heartbeat: ws ping каждые 5 с; клиент без сообщений/понгов 15 с отключается. Чат: ≤1/с, ≤256 символов. Комнаты без игроков удаляются; завершённые — через TTL (10 мин).

## 4. Авторитет и античит (срез)

| Проверка | Реализация |
|---|---|
| Валидация схем | zod в packages/protocol; мусор → `error/bad_message`, счётчик не ведётся (TODO) |
| Владение | fleetId/colonyId/build_ship/trade/diplomacy проверяются до `applyCommand` |
| Запрет клиентских правил | `set_speed` и `apply_battle` запрещены (сервер-авторитет); остальные команды — валидирует sim |
| Rate limit | token bucket 5 команд/с, burst 10; чат 1/с |
| Пауза | голосование, кулдаун, лимит 3/час; во время тактического лока пауза запрещена |
| Реконнект | токен места, grace 30 с, замена старого сокета |
| Протокол | версия проверяется в hello (ломающие изменения — увеличить PROTOCOL_VERSION) |

## 5. Клиент (apps/web/src/net)

- `NetClient`: HTTP create/join, WS hello, состояние `MpState` (phase/room/players/tick/paused/chat/lock), backoff-реконнект 1/2/4 с (3 попытки), `sendCommand` (в coop/mmo команды не исполняются локально).
- `LobbyScreen`: data-testid `lobby, lobby-nick, lobby-mode, lobby-create, lobby-code, lobby-join, lobby-room-code, lobby-players, lobby-ready, lobby-start, lobby-pause, lobby-tactical, lobby-leave, lobby-close, lobby-status, lobby-chat, lobby-chat-input, lobby-chat-send`.
- `Game`: `setNet`, `applyRemoteWorld(json)`, `applyRemoteSnapshot(snap)`; `sendCommand` в активной сетевой сессии уходит на сервер; `newGame` в сети заблокирован.
- `App`: кнопка `btn-open-lobby` (фиксированная, справа снизу) + авто-открытие при `?lobby=1&mpApi=<url>`.

## 6. Упрощения среза (осознанно, вне M11-MVP)

1. Снапшоты — JSON (не бинарные Colyseus-схемы); interest management/туман войны не реализованы (в снапшоте владельцы всех систем и все флоты). Трафик на 100 игроков не оптимизирован.
2. Клиентское предсказание/интерполяция тактики L2 не реализованы (живой бой вне среза).
3. Валидация команд выполняется `sim.applyCommand` с временной подменой `world.playerEmpireId` на империю места. **Нужна правка общего файла**: экспортировать `applyCommandAs` из `packages/sim/src/index.ts` (уже существует в commands.ts) — тогда подмена не нужна.
4. Серверная персистентность (PostgreSQL/Redis) отсутствует — комнаты в памяти; saves "server" из MODES пока не реализованы.
5. `@sf/data MODES` задаёт MMO playersMax=300, спека 09 — 30–100; сервер клэмпит к 100. Нужно решение Lead (данные vs канон).
6. **Кооп = shared empire (M11-lite)**: все места в комнате управляют ОДНОЙ империей (`world.playerEmpireId`), поэтому victory-логика sim (по `playerEmpireId`) корректна без правок `victory.ts`. В MMO у каждого места своя империя (`isPlayer=true, ai=null`); сезонная победа/рейтинг серверные и в sim не реализованы (ограничение среза).

## 7. Тесты

| Тест | Что покрывает | Команда |
|---|---|---|
| tools/mp-test.mjs | 24 проверки: HTTP лобби, hello/welcome, start+full_state, команды (своя/чужая/whitelist), rate limit, снапшоты и синхронность, пауза (голоса/заморозка тика), тактический лок (90 с, блокирует паузу, unlock), чат, реконнект по токену, отказ токена, 404 | `node <runtime>/pnpm.mjs exec tsx tools/mp-test.mjs` |
| apps/web/e2e/mp.spec.ts | 2 браузера: лобби → create/join → ready/start → full_state у обоих → одинаковый тик | Playwright (+ API in-process) |

## 8. Финальный статус M11 (2026-11-04)

- **Integration:** App монтирует LobbyScreen (кнопка btn-open-lobby, ?lobby=1&mpApi=...), CoopPanel (src/ui) получает CoopCallbacks/CoopLobbyState из NetClient, MPStatusHud показывается в игре, GameState.mp обновляется (setMpState).
- **Кооп = shared empire** (A23): оба места управляют одной империей; MMO — отдельные империи на место.
- **Клэмп мест:** coop 2–4, mmo 30–100 (MODES исправлены Lead).
- **Тесты:** tools/mp-test.mjs — **27/27 PASS** (включая coop shared empire, MMO separate empires, MMO pause reject); apps/web/e2e/mp.spec.ts — 2 браузера PASS (лобби→start→одинаковый тик), скриншот docs/shots/07-mp-coop.png.
- **Скриншот кооп-лобби из PanelHost:** docs/shots/16-coop-lobby.png.
- **Ограничения:** JSON-снапшоты без interest management; комнаты в памяти (нет PG/Redis); серверные сейвы/сезонный сброс не реализованы; heartbeat/rate limit не под нагрузочным тестом (k6 — вне среза).

## 9. Паритет и нагрузка (финальные гейты M11/M12)

### 9.1. SP vs dedicated (tools/parity-test.mjs)

- Два мира с seed 42; 500 тактов; 60 команд (move_fleet, scan_system, research, build_district, repair_fleet), предварительно отобранных как валидные по эталонному прогону.
- Мир A — SP-путь (`applyCommand`), мир B — dedicated (`applyCommandAs от империи`).
- Итог: **serializeWorld идентичен**, sha-hash **ffd059d5**, 0 mismatches, 0 отклонённых команд.
- Команда: `node <runtime>/pnpm.mjs exec tsx tools/parity-test.mjs --ticks 500`.

### 9.2. Нагрузка MMO (tools/load-mmo.mjs)

- 100 WS-клиентов в одной MMO-комнате (сервер в процессе теста), снапшоты 1/5 с (канон режима).
- Результаты: join 1.4 с, started+full_state 0.7 с; full_state **1.68 МБ raw JSON** на клиента; steady-трафик **25.53 МБ/ч/игрок** (бюджет 40); **0 ошибок/дисконнектов**; RSS процесса теста +147 МБ (сервер + 100 клиентов в одном процессе — для серверной оценки нужен вынос клиентов).
- Команда: `node <runtime>/pnpm.mjs exec tsx tools/load-mmo.mjs --clients 100 --observe 16`.

## 10. Персистентность (M11/M12)

> Реализация: apps/api/src/store/**. Store выбирается фабрикой createPersistence: PostgreSQL при `DATABASE_URL`, иначе durable JSON-file в `.data/`; Redis подключается дополнительно при `REDIS_URL`.

### 10.1. Слои

| Слой | Файл | Что хранит |
|---|---|---|
| Store (интерфейс) | apps/api/src/store/types.ts | комнаты (seats, state, host, seed, season), снапшоты мира, сезон |
| FileStore | apps/api/src/store/file-store.ts | `.data/rooms/<CODE>.json`, `.data/season.json`, атомарная запись tmp→rename, очередь записей, устойчивость к битым файлам |
| PgStore | apps/api/src/store/pg-store.ts | таблицы `sf_rooms` (JSONB seats + последний world), `sf_snapshots` (история последних 5 на комнату), `sf_season`, `sf_presence` |
| RedisSide | apps/api/src/store/redis-side.ts | presence `sf:presence:<code>` (TTL 60 с), кэш комнаты `sf:room:<code>` (TTL 30 с), сезонный ключ `sf:season`; ошибки Redis не критичны (available=false, no-op) |

При недоступности PostgreSQL createPersistence логирует ошибку и откатывается на FileStore — dev/тесты работают без серверов.

### 10.2. Когда сохраняем

- **Дебаунс** `SF_PERSIST_INTERVAL_MS` (1500 мс): изменения от тика/команды/голосования/тактического лока/attach-detach складываются в одну запись.
- Немедленная запись: создание комнаты, join, старт партии, leave/close сокета.
- **Восстановление при старте**: `listen()` → `store.cleanup(TTL)` → загрузка всех комнат → `Room.fromRecord` (мир через `deserializeWorld`, seats/токены, state, таймеры для active). Восстановленные места «отключены» с расширенным grace `restoreGraceMs` (5 мин), чтобы игрок успел переподключиться.
- **Graceful shutdown**: CLI ловит SIGINT/SIGTERM → `server.close()` → `flushAll()` (принудительная запись всех комнат) → закрытие store/Redis.
- **TTL/очистка**: active/lobby старше `SF_ROOM_MAX_AGE` (24 ч) удаляются; finished — старше 7 дней; пустые комнаты удаляются sweeper’ом и из store (`deleteRoom`).
- **Сезон MMO**: сезон хранится в store/Redis (`seasonId`, `startedAt`, `resetAt`, `seed`). При создании MMO-комнаты сезон создаётся/продлевается автоматически (TTL 30 дней, `SF_SEASON_TTL_MS`); seed сезона одинаков для всех MMO-комнат. `POST /season/reset` (admin) закрывает MMO-комнаты и запускает новый сезон.

### 10.3. Админ-эндпоинты (заголовок `x-admin-token` = `SF_ADMIN_TOKEN`)

| Метод | Путь | Назначение |
|---|---|---|
| GET | /health | в т.ч. `persistence`, `redis`, `season` |
| GET | /season | текущий сезон |
| POST | /season/reset | сезонный сброс MMO (удаляет MMO-комнаты) |
| POST | /admin/flush | принудительный flush всех комнат |
| GET | /admin/stats | store.stats(), число комнат, Redis, сезон |

### 10.4. Окружение и запуск

`.env.example` + `docker-compose.yml` (postgres:17 + redis:7):

```bash
docker compose up -d
SF_PERSISTENCE=auto DATABASE_URL=postgres://sf:sf@127.0.0.1:5432/stellar_frontier \
REDIS_URL=redis://127.0.0.1:6379 node <runtime>/pnpm.mjs api
# без серверов (dev/тесты): SF_PERSISTENCE=file SF_DATA_DIR=.data
```

Переменные: `SF_PERSISTENCE` (auto/file/postgres/none), `SF_DATA_DIR`, `DATABASE_URL`, `REDIS_URL`, `SF_PERSIST_INTERVAL_MS`, `SF_SEASON_TTL_MS`, `SF_ADMIN_TOKEN`, `SF_RECONNECT_GRACE_MS`.

### 10.5. Тесты

| Тест | Что проверяет | Команда |
|---|---|---|
| tools/store-test.mjs | **8/8 PASS**: roundtrip комнаты/мира, 20 конкурентных записей, сезон, битый файл, TTL-очистка, delete/stats, factory fallback, SF_DATA_DIR | `node <runtime>/pnpm.mjs store-test` |
| tools/persist-test.mjs | **13/13 PASS**: API с file-store → создать/стартовать/протиковать (tick=3) → пауза → kill -9 → рестарт → комната восстановлена (active, 2 игрока, tick=3) → join по токену → full_state с **тем же тиком и байт-идентичным миром** (458 059 B); admin stats/flush/guard; season reset | `node <runtime>/pnpm.mjs persist-test` |
| tools/mp-test.mjs | регресс протокола с `persistence:"none"` — 27/27 PASS | `node <runtime>/pnpm.mjs mp-test` |
| apps/web/e2e/mp.spec.ts | 2 браузера, API с `SF_PERSISTENCE=none` — PASS | `playwright test … e2e/mp.spec.ts` |

### 10.6. Ограничения

- Интеграция с реальными PostgreSQL/Redis в CI не прогонялась (docker-compose приложен; FileStore-путь покрыт тестами).
- Токены реконнекта в seats JSON хранятся в открытом виде (для MMO нужен HMAC/хэш + короткий TTL — TODO безопасности).
- Interest management/бинарные снапшоты по-прежнему вне среза: в БД пишется полный serializeWorld (для MMO 400 систем — крупные записи; храним последние 5).
- Redis presence/кэш не используется для matchmaking; это задел под шардирование.

## 11. Hardening M11/1.0 (2026-11-04)

### 11.1. Реальные интеграционные тесты PostgreSQL/Redis

Подняты docker compose (postgres:17-alpine + redis:7-alpine). **tools/pg-redis-test.mjs — 12/12 PASS:**
- PgStore: init схемы, save/load комнаты (seats JSONB), snapshot retention 5, season roundtrip, TTL cleanup, stats;
- RedisSide: presence/cache/season (available=true), dropRoom;
- сервер с `DATABASE_URL`+`REDIS_URL`: комната→старт→пауза→**graceful SIGTERM** → строка комнаты в PostgreSQL сохранена (не удалена при shutdown) → рестарт → восстановление (active, 2 игрока, tick=2) → join по токену → full_state **байт-идентичен** (458 085 B); presence в Redis; /health = postgres+redis.

### 11.2. HMAC-токены реконнекта

- `apps/api/src/auth/token.ts`: HMAC-SHA256(raw, secret), secret из `SF_TOKEN_SECRET` (или стабильный `.data/token-secret`, чтобы реконнект через рестарт file-store работал), TTL `SF_TOKEN_TTL_MS` (24 ч), сравнение `timingSafeEqual`; admin-токен тоже сравнивается constant-time по SHA-256.
- В памяти/на клиенте — сырой токен; **в PostgreSQL/.data пишется только tokenHash+expiresAt**; legacy-снапшоты с raw token мигрируют в хэш при восстановлении.
- `tools/token-test.mjs` — 5/5 PASS (hash/verify, чужой токен/секрет, TTL expired, admin secret, уникальность).
- Регресс: mp-test 27/27, persist-test 13/13 (реконнект после kill -9 через хэш работает).

### 11.3. Interest management и gzip-бюджеты

- Снапшот формируется **на seat**: только видимые системы (`owner/knownBy/visibleTo`), свои и видимые флоты, события своей империи + глобальные; список игроков компактный общий.
- `perMessageDeflate` (level 1, threshold 256); full_state рассылается чанками по 5 через `setImmediate`, чтобы 300 холодных join не блокировали event loop; heartbeat пропускает проверку при дрейфе таймера >3 с (ложные ping-timeout устранены).
- Замеры (240 систем, MMO): full_state gzip **36.6 КБ** (бюджет 1536 КБ), snapshot gzip **1.58 КБ**, видимых систем на старте **4/240**.

### 11.4. Нагрузка 300 CCU (tools/load-300.mjs)

Один сервер-шард, 3 MMO-комнаты ×100 клиентов (Node WS-клиент держит пул `200 соединений на origin, поэтому клиенты разложены по loopback 127.0.0.N — сервер один):

| Метрика | Факт | Вердикт |
|---|---|---|
| WS открыты / hello | 300/300, 0 ошибок | PASS |
| join+hello | `2 с | PASS |
| full_state gzip | 36.6 КБ | PASS (≪1.5 МБ) |
| snapshot gzip | 1.58 КБ | PASS |
| interest management | 4/240 видимых систем | PASS |
| steady-трафик (gzip-оценка) | `5.5 МБ/ч/игрок | PASS (бюджет 40) |
| **одновременный холодный старт 300** | **`50–58 с** до доставки всех full_state | **WARN** (CPU permessage-deflate на 300×1.7 МБ; реальные MMO-входы разнесены; сервер не теряет соединения) |
| RSS процесса теста (сервер+300 клиентов) | +0.7 ГБ | справочно (клиенты в том же процессе) |

### 11.5. Heap-soak

`tools/heap-soak.mjs`: сервер отдельным (?в процессе?) — сервер и клиенты в одном процессе теста, память сервера читается из `/admin/stats` (process.memoryUsage серверного процесса). Пишет `docs/shots/heap-soak.jsonl`, анализ: `--analyze` (линейная регрессия после 2-мин прогрева, экстраполяция на 3 ч, цель <150 МБ).
Прогон 3 ч запущен фоново; результат (полный/частичный + честная пометка) — в `docs/shots/heap-soak-summary.json` и acceptance §18.

### 11.6. Security

- security headers: `x-content-type-options`, `x-frame-options: DENY`, `referrer-policy`, `permissions-policy`, `cross-origin-resource-policy`, `cache-control: no-store`;
- CORS allowlist (`SF_CORS_ORIGINS`; пусто = dev `*`), preflight;
- HTTP rate limit token bucket на IP для мутаций (`SF_HTTP_RATE_PER_MIN`, default 240/мин, burst 2×);
- bodyLimit 256 КБ, `MAX_WS_MESSAGE_BYTES` 64 КБ, лимит WS-соединений (`SF_WS_MAX_CONNECTIONS` 1200), admin-эндпоинты только с constant-time `x-admin-token`;
- **`pnpm audit --prod`: 0 known vulnerabilities** (zod обновлён до ^4.6.6; в packages/data `z.record` с enum-ключом заменён на `z.partialRecord`).

### 11.7. Тесты M11-hardening

| Тест | Результат |
|---|---|
| tools/pg-redis-test.mjs (живые PG/Redis) | **12/12 PASS** |
| tools/token-test.mjs | **5/5 PASS** |
| tools/load-300.mjs | **PASS** (join/errors/gzip/interest), WARN по холодному старту 300 |
| tools/store-test.mjs | 8/8 PASS |
| tools/persist-test.mjs | 13/13 PASS |
| tools/mp-test.mjs | 27/27 PASS |
| e2e mp.spec.ts | PASS |
