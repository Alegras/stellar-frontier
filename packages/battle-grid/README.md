# @sf/battle-grid (M5b)

Детерминированный движок пошаговой битвы 15×11 (odd-r, pointy-top), hook L0, feature flag \`grid_battle\`.

## Данные
Контент: \`packages/data/src/battles\` (task-64): \`BATTLE_CLASSES\` (8), \`BATTLE_ABILITIES\` (16), \`BATTLE_TERRAIN\` (6), \`BATTLE_AI_PROFILES\` (3), \`BATTLE_SCENARIOS\` (3). Движок подхватывает их через \`catalog.ts\`.

## Публичный API (\`src/index.ts\`)
- \`createBattle({seed,battleId?,attacker,defender,field?,terrainProfile?,roundCap?})\`
- \`autoDeploy(state, side, preset?)\`, \`deployStack(state,side,stackId,hex,facing?)\`, \`moveToReserve\`, \`startBattle\`
- \`applyCommand(state, cmd, options?)\` → \`{state,events,ok,reason}\`; команды: move/attack/ranged/wait/defend/ability/reserve/endTurn/retreat/place/auto
- \`aiDeploy\`, \`aiTakeTurn\`, \`runAiBattle\` (easy/normal/hard, профили aggressor/kiter/defender)
- \`getBattleView\`, \`legalMoves\`, \`previewAttack\`, \`previewAbility\`
- \`battleResult\` → losses/spoils/xp/warScore/mvp/replayHash/log; \`autoResolveReference\`, \`parityCheck\`
- \`serializeBattle\`/\`deserializeBattle\`, \`battleStateHash\` (replay/save)
- L0: \`isGridBattleEnabled\`, \`battleEligibility\`, \`createBattleFromWorld\`, \`createBattleTriggered\`; \`toBattleRecord\`, \`applyBattleResultToWorld\`

## Тесты
\`pnpm exec vitest run packages/battle-grid/test/battle.test.ts\` — 14 тестов: hex/LOS/симметрия поля, deployment 7+3, инициатива, melee/retaliation once, defense, wait, abilities/data, AI 3 сложности + детерминизм, save/replay, conversion, parity harness 200.

## Parity status
200 AI-vs-AI калибровочных прогонов (крупные составы, ratio 1.30–1.40): mean |Δloss| ≈ 0.046, within ±0.10 ≈ 85.5%, outcome 100%. Малые sample-сценарии на LOS-нейтральном профиле: deltas 0.02/0.08, 0.02/0.01, 0.01/0.06 — ±10% PASS. Для сценария с астероидным LOS-профилем остаётся отдельный выброс (нужен балансный проход); флаг `grid_battle` по умолчанию ON для новых партий, `world.flags.grid_battle=0` — legacy OFF.
