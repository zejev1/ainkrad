import { mutation, query } from '../_generated/server';
import { v } from 'convex/values';
import { chooseCardinalInterventions, chooseYuiAction, WorldMetrics } from './core';
import { deriveWorldMetrics } from './metrics';

export const getWorldState = query({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, { worldId }) =>
    ctx.db.query('cardinalWorldState').withIndex('worldId', (q) => q.eq('worldId', worldId)).unique(),
});

async function persistDirectorEvaluation(ctx: any, worldId: any, metrics: WorldMetrics, now: number) {
  const existing = await ctx.db
    .query('cardinalWorldState')
    .withIndex('worldId', (q: any) => q.eq('worldId', worldId))
    .unique();
  const recentTypes = existing?.recentInterventionTypes ?? [];
  const interventions = chooseCardinalInterventions(
    metrics,
    { lastInterventionAt: existing?.lastInterventionAt ?? null, recentTypes },
    now,
  );
  const patch = {
    ...metrics,
    updatedAt: now,
    recentInterventionTypes: interventions.length
      ? [...recentTypes, interventions[0].type].slice(-6)
      : recentTypes,
    ...(interventions.length ? { lastInterventionAt: now } : {}),
  };
  if (existing) await ctx.db.patch(existing._id, patch);
  else await ctx.db.insert('cardinalWorldState', { worldId, ...patch });

  for (const intervention of interventions) {
    await ctx.db.insert('cardinalEvents', {
      worldId,
      createdAt: now,
      kind: `intervention:${intervention.type}`,
      source: 'cardinal',
      summary: intervention.reason,
      importance: Math.max(0, Math.min(1, intervention.intensity)),
      participants: [],
      expiresAt: now + intervention.ttlMinutes * 60_000,
    });
  }
  return interventions;
}

// Useful while wiring sensors: feed metrics directly and inspect Cardinal's decision.
export const upsertWorldMetrics = mutation({
  args: {
    worldId: v.id('worlds'),
    socialIsolation: v.number(),
    unresolvedConflict: v.number(),
    resourcePressure: v.number(),
    safetyPressure: v.number(),
    economicImbalance: v.number(),
    routineStagnation: v.number(),
  },
  handler: async (ctx, args) => {
    const metrics: WorldMetrics = {
      socialIsolation: args.socialIsolation,
      unresolvedConflict: args.unresolvedConflict,
      resourcePressure: args.resourcePressure,
      safetyPressure: args.safetyPressure,
      economicImbalance: args.economicImbalance,
      routineStagnation: args.routineStagnation,
    };
    return persistDirectorEvaluation(ctx, args.worldId, metrics, Date.now());
  },
});

// Autonomous prototype path: derive metrics from Cardinal's persistent social/event tables.
export const evaluateCardinalWorld = mutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, { worldId }) => {
    const now = Date.now();
    const npcs = await ctx.db
      .query('cardinalNpcState')
      .withIndex('world_profile', (q) => q.eq('worldId', worldId))
      .collect();
    const relationships = await ctx.db
      .query('cardinalRelationships')
      .withIndex('from', (q) => q.eq('worldId', worldId))
      .collect();
    const events = await ctx.db
      .query('cardinalEvents')
      .withIndex('world_time', (q) => q.eq('worldId', worldId))
      .collect();

    const metrics = deriveWorldMetrics(npcs, relationships, events, now);
    const interventions = await persistDirectorEvaluation(ctx, worldId, metrics, now);
    return { metrics, interventions };
  },
});

export const logWorldEvent = mutation({
  args: {
    worldId: v.id('worlds'),
    kind: v.string(),
    source: v.union(v.literal('world'), v.literal('npc'), v.literal('player'), v.literal('cardinal'), v.literal('yui')),
    summary: v.string(),
    importance: v.number(),
    participants: v.array(v.string()),
    ttlMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert('cardinalEvents', {
      worldId: args.worldId,
      createdAt: now,
      kind: args.kind,
      source: args.source,
      summary: args.summary,
      importance: Math.max(0, Math.min(1, args.importance)),
      participants: args.participants,
      ...(args.ttlMinutes !== undefined ? { expiresAt: now + args.ttlMinutes * 60_000 } : {}),
    });
  },
});

export const evaluateYui = mutation({
  args: {
    worldId: v.id('worlds'), playerId: v.string(), minutesAlone: v.number(), recentLosses: v.number(),
    repeatedFailures: v.number(), explicitDistress: v.boolean(), currentlyInDanger: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('yuiPlayerState')
      .withIndex('world_player', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .unique();
    const now = Date.now();
    const action = chooseYuiAction({
      minutesAlone: args.minutesAlone,
      recentLosses: args.recentLosses,
      repeatedFailures: args.repeatedFailures,
      explicitDistress: args.explicitDistress,
      currentlyInDanger: args.currentlyInDanger,
      lastSupportContactMinutes: existing?.lastSupportContactAt
        ? (now - existing.lastSupportContactAt) / 60_000
        : null,
    });
    const state = {
      worldId: args.worldId,
      playerId: args.playerId,
      updatedAt: now,
      relationshipTrust: existing?.relationshipTrust ?? 0.25,
      relationshipFamiliarity: Math.min(1, (existing?.relationshipFamiliarity ?? 0.05) + 0.002),
      minutesAlone: args.minutesAlone,
      recentLosses: args.recentLosses,
      repeatedFailures: args.repeatedFailures,
      explicitDistress: args.explicitDistress,
      lastObservedEvent: action.reason,
      ...(action.type !== 'observe'
        ? { lastSupportContactAt: now }
        : existing?.lastSupportContactAt
          ? { lastSupportContactAt: existing.lastSupportContactAt }
          : {}),
    };
    if (existing) await ctx.db.patch(existing._id, state);
    else await ctx.db.insert('yuiPlayerState', state);

    if (action.type !== 'observe') {
      await ctx.db.insert('cardinalEvents', {
        worldId: args.worldId,
        createdAt: now,
        kind: `yui:${action.type}`,
        source: 'yui',
        summary: action.reason,
        importance: action.type === 'safety_interrupt' ? 1 : .45,
        participants: [args.playerId],
        expiresAt: now + 60 * 60_000,
      });
    }
    return action;
  },
});
