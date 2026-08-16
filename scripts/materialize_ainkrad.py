from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f'Cannot patch {label}: anchor not found')
    return text.replace(old, new, 1)


def patch_schema() -> None:
    path = 'convex/schema.ts'
    text = read(path)
    text = replace_once(
        text,
        "import { engineTables } from './engine/schema';\n",
        "import { engineTables } from './engine/schema';\nimport { cardinalTables } from './cardinal/schema';\n",
        path,
    )
    text = replace_once(
        text,
        "  ...agentTables,\n",
        "  ...cardinalTables,\n  ...agentTables,\n",
        path,
    )
    write(path, text)


def patch_conversation() -> None:
    path = 'convex/agent/conversation.ts'
    text = read(path)
    helper = """
async function cardinalConversationPrompt(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
): Promise<string[]> {
  try {
    return await ctx.runQuery((internal as any).cardinal.context.getConversationContext, {
      worldId,
      playerId,
      otherPlayerId,
    });
  } catch (error) {
    console.warn('Cardinal context unavailable; continuing with normal AI Town prompt.', error);
    return [];
  }
}
"""
    if 'async function cardinalConversationPrompt(' not in text:
        text = replace_once(text, 'const selfInternal = internal.agent.conversation;\n', 'const selfInternal = internal.agent.conversation;\n' + helper, path)
    anchor = '  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));\n'
    addition = anchor + '  prompt.push(...(await cardinalConversationPrompt(ctx, worldId, playerId, otherPlayerId)));\n'
    current = text.count('cardinalConversationPrompt(ctx, worldId, playerId, otherPlayerId)')
    needed = 3 - current
    while needed > 0:
        pos = text.find(anchor)
        # Skip anchors already followed by the Cardinal line.
        while pos != -1:
            end = pos + len(anchor)
            if not text.startswith('  prompt.push(...(await cardinalConversationPrompt', end):
                text = text[:pos] + addition + text[end:]
                needed -= 1
                break
            pos = text.find(anchor, end)
        else:
            raise RuntimeError(f'Cannot patch {path}: not enough prompt anchors')
    write(path, text)


def patch_agent_operations() -> None:
    path = 'convex/aiTown/agentOperations.ts'
    text = read(path)
    old = """        // TODO: have LLM choose the activity & emoji
        const activity = ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)];
"""
    new = """        // Cardinal may suggest an activity grounded in profession, habits, and current town pressure.
        // If the overlay is unavailable, retain upstream AI Town behavior.
        let cardinalActivity = null;
        try {
          cardinalActivity = await ctx.runQuery((internal as any).cardinal.context.getActivityHint, {
            worldId: args.worldId,
            playerId: player.id,
          });
        } catch (error) {
          console.warn('Cardinal activity hint unavailable; using default activity.', error);
        }
        const activity = cardinalActivity ?? ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)];
"""
    if 'Cardinal may suggest an activity grounded in profession' not in text:
        text = replace_once(text, old, new, path)

    remember_anchor = """    await rememberConversation(
      ctx,
      args.worldId,
      args.agentId as GameId<'agents'>,
      args.playerId as GameId<'players'>,
      args.conversationId as GameId<'conversations'>,
    );
"""
    remember_new = remember_anchor + """    try {
      const world = await ctx.runQuery((internal as any).cardinal.context.getConversationContext, {
        worldId: args.worldId,
        playerId: args.playerId,
        otherPlayerId: args.playerId,
      });
      void world;
    } catch (_) {
      // Context is optional here; relationship recording below is the important side effect.
    }
"""
    # We record the relationship after loading the other participant from the archived conversation.
    # Use a tiny internal query defined below by the materializer patch.
    if 'cardinal.social.recordConversation' not in text:
        text = replace_once(text, remember_anchor, remember_anchor + """    try {
      const participants = await ctx.runQuery((internal as any).cardinal.runtime.getConversationParticipants, {
        worldId: args.worldId,
        conversationId: args.conversationId,
        playerId: args.playerId,
      });
      if (participants?.otherPlayerId) {
        await ctx.runMutation((internal as any).cardinal.social.recordConversation, {
          worldId: args.worldId,
          conversationId: args.conversationId,
          playerId: args.playerId,
          otherPlayerId: participants.otherPlayerId,
        });
      }
    } catch (error) {
      console.warn('Cardinal social bridge unavailable; memory was still saved.', error);
    }
""", path)
    write(path, text)


def patch_init() -> None:
    path = 'convex/init.ts'
    text = read(path)
    text = replace_once(text, "import { internal } from './_generated/api';\n", "import { api, internal } from './_generated/api';\n", path)
    anchor = """    if (shouldCreate) {
      const toCreate = args.numAgents !== undefined ? args.numAgents : Descriptions.length;
      for (let i = 0; i < toCreate; i++) {
        await insertInput(ctx, worldStatus.worldId, 'createAgent', {
          descriptionIndex: i % Descriptions.length,
        });
      }
    }
"""
    new = anchor + """    // Seed is idempotent. Delay it slightly so newly queued agents have time to materialize.
    await ctx.scheduler.runAfter(5000, (api as any).cardinal.seed.seedCardinalState, {
      worldId: worldStatus.worldId,
    });
"""
    if 'cardinal.seed.seedCardinalState' not in text:
        text = replace_once(text, anchor, new, path)
    write(path, text)


def patch_crons() -> None:
    path = 'convex/crons.ts'
    text = read(path)
    anchor = "crons.daily('vacuum old entries', { hourUTC: 4, minuteUTC: 20 }, internal.crons.vacuumOldEntries);\n"
    new = anchor + "\ncrons.interval(\n  'cardinal director pulse',\n  { minutes: 5 },\n  (internal as any).cardinal.runtime.evaluateRunningWorlds,\n);\n"
    if 'cardinal director pulse' not in text:
        text = replace_once(text, anchor, new, path)
    write(path, text)


def patch_runtime() -> None:
    path = 'convex/cardinal/runtime.ts'
    text = read(path)
    text = replace_once(
        text,
        "import { mutation, query } from '../_generated/server';\n",
        "import { internalMutation, internalQuery, mutation, query } from '../_generated/server';\n",
        path,
    )

    participants = """
export const getConversationParticipants = internalQuery({
  args: {
    worldId: v.id('worlds'),
    conversationId: v.string(),
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    const archived = await ctx.db
      .query('archivedConversations')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('id', args.conversationId as any))
      .first();
    if (!archived) return null;
    const otherPlayerId = archived.participants.find((id: any) => id !== args.playerId);
    return otherPlayerId ? { otherPlayerId } : null;
  },
});
"""
    if 'export const getConversationParticipants = internalQuery' not in text:
        text += participants

    runner = """
export const evaluateRunningWorlds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const statuses = await ctx.db.query('worldStatus').collect();
    const results: Array<{ worldId: string; interventions: number }> = [];
    for (const status of statuses) {
      if (status.status !== 'running') continue;
      const worldId = status.worldId;
      const npcs = await ctx.db
        .query('cardinalNpcState')
        .withIndex('world_profile', (q) => q.eq('worldId', worldId))
        .collect();
      if (!npcs.length) continue;
      const relationships = await ctx.db
        .query('cardinalRelationships')
        .withIndex('from', (q) => q.eq('worldId', worldId))
        .collect();
      const events = await ctx.db
        .query('cardinalEvents')
        .withIndex('world_time', (q) => q.eq('worldId', worldId))
        .collect();
      const now = Date.now();
      const metrics = deriveWorldMetrics(npcs, relationships, events, now);
      const interventions = await persistDirectorEvaluation(ctx, worldId, metrics, now);
      results.push({ worldId: String(worldId), interventions: interventions.length });
    }
    return results;
  },
});
"""
    if 'export const evaluateRunningWorlds = internalMutation' not in text:
        text += runner
    write(path, text)


def main() -> None:
    patch_schema()
    patch_conversation()
    patch_agent_operations()
    patch_init()
    patch_crons()
    patch_runtime()
    print('Ainkrad v0.2 integration patches applied successfully.')


if __name__ == '__main__':
    main()
