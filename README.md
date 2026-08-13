# Cardinal Prototype 0.1 — AI Town overlay

Goal: turn AI Town into a small persistent social simulation with **20 deliberately authored NPCs**, a conservative world director (Cardinal), and a player-focused companion observer (Yui).

## What is implemented in this milestone

- Exactly 20 NPC profiles with profession, public face, private need, values, fears, strengths, flaws, habits, secrets, current pressure, long-term goal, speech style, social style, and seeded relationships.
- A drop-in `data/characters.ts` that makes AI Town create those 20 agents by default. AI Town's current `init.ts` already defaults to `Descriptions.length`, so no init rewrite is required.
- Pure deterministic Cardinal decision logic with cooldowns and a deliberate `quiet_period` outcome. The director is allowed to choose **at most one** intervention per evaluation.
- Yui intervention policy that is intentionally non-clinical: observe, check in, offer company, suggest a break, or interrupt immediate in-world danger.
- Convex table definitions for persistent world metrics, per-NPC state, directed relationships, world events, and Yui/player state.
- Convex query/mutation skeleton for feeding world metrics into Cardinal and player signals into Yui.

## Integration into upstream AI Town

1. Copy `data/cardinalNpcProfiles.ts` into AI Town `data/`.
2. Replace upstream `data/characters.ts` with this package's `data/characters.ts`.
3. Copy `convex/cardinal/` into upstream `convex/cardinal/`.
4. In upstream `convex/schema.ts`, add:

```ts
import { cardinalTables } from './cardinal/schema';
```

and inside `defineSchema({ ... })` add:

```ts
  ...cardinalTables,
```

5. Run AI Town normally. Because upstream `convex/init.ts` uses `Descriptions.length` when `numAgents` is omitted, the default new world will create all 20 profiles.

## Important: what 0.1 deliberately does NOT do yet

Cardinal currently **decides and records** interventions; it does not yet mutate the game map, economy, spawn tables, or NPC schedules. That is intentional. The next milestone should introduce an explicit capability layer so Cardinal cannot arbitrarily rewrite engine state.

Yui currently decides whether to act; the next milestone should give her an in-world agent body and a memory pipeline linked to AI Town's existing vector memory system.

## Safety / design rule

Cardinal is a director, not a puppeteer. It should create pressures and opportunities, then let NPC agents react. Yui is a companion, not a therapist: it can notice game-context signals but must not diagnose mental health from telemetry.


## Smoke simulation

The repository overlay includes `scripts/smokeSimulation.ts`.

The current seed creates:

- 20 residents
- 40 directed relationship edges
- moderate initial shortages / theft / health / infrastructure pressures

Expected behavior verified on 2026-08-14:

- Initial safety pressure: ~0.55 -> Cardinal deliberately takes no action.
- After an escalated warehouse attack: safety pressure ~0.82 -> Cardinal selects `watch_patrol` for 120 minutes.

This is intentional: the director must tolerate ordinary imperfect life and intervene only when a threshold is crossed.

## GitHub state

The upstream repository is `a16z-infra/ai-town`. The connected GitHub account can read it but does not have push permission to upstream. The prototype is therefore packaged as an overlay/patch until a user-owned fork or repository is available.
