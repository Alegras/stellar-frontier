# QA-план: мировая политика и внутренняя динамика ИИ (task-44)

Дата: 2026-11-06. Статус: sim task-42 и UI task-43 в работе; QA готовит план/верификатор до мержа.

## 1. Объём (task-44 + доп. Lead)
1. **AI-AI**: договоры (trade/research/NAP/defensive/alliance), войны с CB, федерации, дань/вассалитет; opinion/power/personality/truce; без спама.
2. **Collapse/absorb/merge**: слабые ИИ распадаются (системы → соседи/пираты/осколок, империя dead); вассал интегрируется через N тактов; захват всех систем = уничтожение; федерация ≥4/через N тактов → содружество с общей казной/флотом.
3. **Единая империя (доп.)**: добровольное объединение при высоком мнении/этике или после вассалитета; перенос систем/колоний/флотов/казны; поглощённый dead; федерация/содружество централизуется в империю; **игрок не удаляется молча** — событие «вхождение в империю/вассалитет» с выбором (принять/отказаться/война), иначе поражение/вассал.
4. **Новости/UI**: fg.aiNews (tick/kind/titleRu/textRu/a/b/eventId), cap 50, save/load/migration; панель «Мировая политика» (матрица отношений, лента, статусы фракций: активна/ослаблена/распалась/поглощена/в содружестве), HUD-индикатор мировых войн/блоков, event modal call-to-arms/торговый блок, 1280×720, нет перекрытия диалогом.
5. **Влияние на игрока**: call-to-arms (вступить/нейтралитет/санкции), торговый блок (вступить/отказ), беженцы/рынок/приграничье при войне, passive market/opinion.
6. **Кампания**: flags ai_trade_bloc/ai_war/ai_federation, доступность/условия миссий и концовок, журнал/consequences.
7. **Детерминизм/save/load**, unit/e2e, acceptance §25, README/NEXT/CHANGELOG, gift+verify-portable, скриншоты.

## 2. Артефакты QA (планируемые)
| Артефакт | Назначение |
|---|---|
| `tools/politics-verify.mjs` | headless: новости/кап/детерминизм/save/load, AI-AI активность, collapse/absorb/merge/centralize (перенос систем/флотов, dead), вассал→интеграция, федерация→содружество/империя, защита игрока, campaign flags, no-spam |
| `apps/web/e2e/world-politics.spec.ts` | панель/матрица/лента/фильтры/HUD, event modal call-to-arms/блок (эффект), статусы фракций, unification-новости, 1280×720, axe |
| `docs/acceptance.md §25` | приёмка с доказательствами |
| gift + `tools/verify-portable.mjs` | пересборка и file:// проверка |

## 3. Матрица проверок
| # | Проверка | Инструмент |
|---|---|---|
| U1 | AI-AI договоры/войны/федерации/дань/вассалитет появляются за N тактов | politics-verify (counts), e2e лента |
| U2 | Нет спама: новостей на такт ≤ лимита, дубликаты не копятся, cap 50 | politics-verify |
| U3 | Детерминизм: два мира seed → одинаковые aiNews/владения/dead | politics-verify |
| U4 | Collapse: слабая империя → dead, системы перешли (owner/ownerId), новость collapse | politics-verify (+тестовые API форс-условий, если дадут) |
| U5 | Absorb: сильный поглощает слабого → системы/колонии/флоты/казна перенесены, dead, новость absorb/annex | politics-verify |
| U6 | Merge/centralize: федерация ≥4/N → единая империя/содружество, участники dead/вассалы, общая казна/флот | politics-verify |
| U7 | Вассал интегрируется через N тактов (tax/autonomy → integrate), dead/подданный | politics-verify |
| U8 | Захват всех систем = уничтожение империи | politics-verify (kill/owner swap) |
| U9 | Игрок при поглощении: narrative-событие с выбором, нет молчаливого удаления; отказ/война; вассалитет | politics-verify + e2e |
| U10 | Влияние на игрока: call-to-arms/trade bloc/refugees/market события и эффекты | politics-verify + e2e |
| U11 | Кампания: flags/missions/endings зависят от мировых событий | politics-verify + unit sim |
| U12 | Save/load: aiNews/политика/владения/dead/вассалы/федерации сохраняются, повторный load идемпотентен | politics-verify |
| U13 | UI: панель/матрица/фильтры/статусы/HUD/event modal, 1280×720, axe, no dialog overlap | e2e |
| U14 | Полный e2e/typecheck/test/build | гейты |

## 4. Контракт для sim (запросить/подтвердить)
- Состояние: `fg.aiNews` (cap 50), `fg.politics` / поля империй (dead, vassalOf, overlordId, federationId/commonwealth, absorbedBy), `getAiNews()`, `getAiWorldState()`, `getAiRelations()`.
- Функции/фазы: `aiWorldPhase(world)` (каждые `10 тактов), collapse/absorb/merge/centralize (имена+условия), `integrateVassal`, `formCommonwealth`, `centralizeFederation`; тестовые форс-API для QA (forceCollapse/forceAbsorb) или детерминированные сценарии.
- Игрок: событие поглощения/вассалитета (narrative pending, kind/choices), call-to-arms/trade bloc события; эффекты target-строк (opinion:/join_war:/treaty:).
- Кампания: flags ai_trade_bloc/ai_war/ai_federation, условия миссий/концовок; journal.
- Save: schemaVersion/migration, сериализация новых полей.

## 5. Контракт UI (testid, предложение)
`panel-open-politics` (PanelId politics), `politics-panel`, `politics-matrix`, `politics-relations-row-<a>-<b>`, `ai-news-feed`, `ai-news-item-<id>`, фильтры `ai-news-filter-<kind>`, `faction-status-<empireId>`, `world-war-hud`, `world-bloc-hud`, `event-call-to-arms`, `event-choice-<id>`, `event-trade-bloc`, `politics-status-dead|absorbed|vassal|commonwealth|empire`, ссылки `empire-link-<id>`.
Согласовать с UI; также как открывается панель («Ещё…» → «Мировая политика»).

## 6. Риски/акценты
- Детерминизм: aiPhase порядок/PRNG — сравнивать полные снимки.
- No-spam: cap и дедуп; события игрока не чаще X.
- Игрок не удаляется: проверить, что empire.dead не ставится игроку без события; принять/отказаться/война.
- Перенос: системы/колонии/флоты/казна без дублей и без «потерянных» флотов; dead-империя не в советах/федерациях.
- Save/load: миграции; повторный load не удваивает новости.
- UI: не перекрывать активный диалог (getDlcModalState priority), не копить модалки.

## 7. Команды
```bash
node <runtime>/pnpm.mjs exec tsx tools/politics-verify.mjs
SF_BASE_URL=http://127.0.0.1:5175 node <runtime>/pnpm.mjs exec playwright test -c apps/web/playwright.config.ts e2e/world-politics.spec.ts --workers=1
```
