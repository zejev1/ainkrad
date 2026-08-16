AINKRAD / CARDINAL v0.2 — PHONE DROP-IN
========================================

This ZIP is meant to be imported ON TOP OF the existing zejev1/ainkrad project in Spck.
Do not delete the existing v0.1 files first.

What this package adds:
- Cardinal live conversation context: NPC private pressure, needs, relationships, and active world events influence dialogue.
- Profession/habit-aware autonomous activities instead of only AI Town's three random default activities.
- Real conversations feed back into the Cardinal social graph, increasing familiarity and slowly cooling tension.
- Automatic Cardinal seeding after AI Town initializes its agents.
- A five-minute Cardinal director pulse for running worlds.
- A GitHub Action that pulls the CURRENT a16z-infra/ai-town source, overlays Ainkrad, wires the integration, builds/tests it, and commits the full materialized runtime back to main.

Phone workflow after import:
1. Import this ZIP into the existing Ainkrad project in Spck and allow overwrite for these NEW package files if asked.
2. Commit and Push.
3. GitHub Actions performs the heavy merge/build on GitHub's machines; no PC is needed.
4. Pull main back into Spck after the Action succeeds. The repository will then contain the full AI Town application plus Cardinal v0.2.

The workflow refuses to commit a materialized runtime if npm build or tests fail.
That is intentional: a failed integration stays visible as a failed Action instead of silently replacing your working branch with broken code.

Important scope:
- Exactly 20 authored resident NPC profiles remain the default population.
- Yui remains a companion/observer policy layer in v0.2; she is not yet added as a 21st autonomous avatar.
- v0.2 makes Cardinal influence real NPC conversation and routines, but it still does not arbitrarily teleport characters, rewrite maps, or force outcomes.
