# Legacy-маркеры: что удалено при замене кампанийных диалогов (для QA/acceptance §26)

> Причина: 6 старых кампанийных сцен (task-36) и 3 совсем старых (act2/branch/finale) заменены 6 Gemini-сценами (task-49/50).
> Данные чистые: в `dialogues.json` 9 диалогов (3 Q1 + 6 Gemini), дублей id/textKey нет; l10n ru/en — 1407↔1407, паритет.

## 1. Удалённые диалоги (id)
- `dlg_campaign_act2` (10 узлов)
- `dlg_campaign_branch` (9 узлов)
- `dlg_campaign_finale` (11 узлов)

Новые (остаются): `dlg_campaign_act2_council`, `dlg_campaign_act3_truth`, `dlg_campaign_act4_legacy`, `dlg_campaign_act4_betrayal`, `dlg_campaign_final_door`, `dlg_campaign_epilogue`.

## 2. Удалённые l10n-ключи: 239 шт. (168 + 71)
Точный поштучный список до удаления не сохранён (файлы не версионируются), но охват полный; для проверки бандлов используй **неймспейсы** ниже — ни один из них не должен встречаться.

| Группа | Кол-во | Неймспейс (удалён) | Примеры ключей |
|---|---|---|---|
| Старые 6 сцен (task-36) | 168 | `dlg.camp.act2c.*`, `dlg.camp.act3t.*`, `dlg.camp.act4l.*`, `dlg.camp.act4b.*`, `dlg.camp.fin.*` | `dlg.camp.act2c.n01`, `dlg.camp.act3t.c1.a`, `dlg.camp.act4l.fx.use`, `dlg.camp.act4b.fx.forgive`, `dlg.camp.fin.fx.seal` |
| Старые 3 диалога | 71 | `dlg.camp.act2.*`, `dlg.camp.branch.*`, `dlg.camp.finale.*` | `dlg.camp.act2.n01`, `dlg.camp.act2.c1.a`, `dlg.camp.branch.c1.b`, `dlg.camp.finale.c2.a`, `dlg.camp.finale.chronicle` |

Важно: старый эпилог использовал неймспейс `dlg.camp.epi.*`, который **совпадает** с новым Gemini-эпилогом; ключи были перезаписаны новыми текстами, а не удалены. Поэтому проверяй не отсутствие `dlg.camp.epi.`, а **новые** тексты эпилога.

## 3. RU-фразы-маркеры старых версий (проверять в собранных бандлах)
Эти строки не должны встречаться ни в `gift/StellarFrontier.html`, ни в `site/**`, ни в `web/**`, ни в `apps/web/dist`:

- «Кризис прошёл. Теперь надо решить»
- «Архив Строителей расшифрован на 61%»
- «Наследие Строителей на столе»
- «Я нашла подпись. Ваша советница подписывала приказы»
- «Разлом стабилен 97%»
- «Война закончилась. Начинается то, что от неё осталось»
- «Совет на мостике. Кейн смотрит на карту»
- «Три двери. За каждой — свой способ закончить войну»
- «Финал. Кейн стоит у иллюминатора»
- «Я не буду просить прощения до того, как вы спросите, за что» (в старой формулировке)

## 4. Что должно быть вместо них (положительные маркеры)
- Новые сцены актов 0–I: `dlg_campaign_act0_relic`, `dlg_campaign_act1_hegemon` (неймспейсы `dlg.camp.act0_r.*`, `dlg.camp.act1_h.*`).
- Outcome-узлы: `dlg.camp.<scene>.out.<option>` + `outcome: true` на узлах.
- Арки: `dlg_campaign_teira_arc` (dlg.camp.teira_a.*), `dlg_campaign_kira_arc` (dlg.camp.kira_a.*) — новые сцены, не legacy.
- Мостики актов: `campaign/bridges.json` / `CAMPAIGN_BRIDGES` (5 записей 0→I … IV→V).
- Новые диалоги: `dlg_campaign_act2_council`, `act3_truth`, `act4_legacy`, `act4_betrayal`, `final_door`, `epilogue`.
- Новые l10n-неймспейсы: `dlg.camp.act2_c.*`, `dlg.camp.act3_t.*`, `dlg.camp.act4_l.*`, `dlg.camp.act4_b.*`, `dlg.camp.fin_d.*`, `dlg.camp.epi.*` (новые значения).
- Примеры новых фраз: «Сорок два борта потеряно на рубеже…», «Данные с глубин Разлома расшифрованы…», «Флагман вошёл в область абсолютного резонанса…».

## 5. Проверка ключей (быстро)
```
grep -r "dlg.camp.act2c\.\|dlg.camp.act3t\.\|dlg.camp.act4l\.\|dlg.camp.act4b\.\|dlg.camp.fin\." gift site web apps/web/dist
grep -r "dlg.camp.act2\.\|dlg.camp.branch\.\|dlg.camp.finale\." gift site web apps/web/dist
```
Оба грепа должны дать 0 совпадений после пересборки.

## 6. Payoff-слой (после чистки восстановлен)
- 20 campaign-флагов читаются через `requiresFlag` в поздних Gemini-сценах (act3_truth, act4_legacy, act4_betrayal, final_door, epilogue).
- Валидатор `tools/validate-full-data.mjs` падает, если прочитано < 18 campaign-флагов.
- Явные проверки: `camp_believe_selena/teira`, `camp_betrayal_forgiven/executed/exiled`, `camp_final_price_fleet/worlds/knowledge`, `camp_use/seal/trade_engine`, `camp_truth_revealed/used`, `camp_central/delegate_fleet`, `camp_council_now`, `camp_trust_council`, `camp_fleet_truth`, `camp_relic_returned`, `camp_verdict_law`.

