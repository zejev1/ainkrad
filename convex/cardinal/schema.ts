import { defineTable } from 'convex/server';
import { v } from 'convex/values';

const zeroToOne = v.number();

export const cardinalTables = {
  cardinalWorldState: defineTable({
    worldId: v.id('worlds'),
    updatedAt: v.number(),
    socialIsolation: zeroToOne,
    unresolvedConflict: zeroToOne,
    resourcePressure: zeroToOne,
    safetyPressure: zeroToOne,
    economicImbalance: zeroToOne,
    routineStagnation: zeroToOne,
    lastInterventionAt: v.optional(v.number()),
    recentInterventionTypes: v.array(v.string()),
  }).index('worldId', ['worldId']),

  cardinalNpcState: defineTable({
    worldId: v.id('worlds'),
    profileKey: v.string(),
    agentId: v.optional(v.string()),
    moodValence: zeroToOne,
    energy: zeroToOne,
    stress: zeroToOne,
    trustInTown: zeroToOne,
    lastMeaningfulEventAt: v.optional(v.number()),
    currentNeed: v.optional(v.string()),
    currentGoal: v.optional(v.string()),
  })
    .index('world_profile', ['worldId', 'profileKey'])
    .index('world_agent', ['worldId', 'agentId']),

  cardinalRelationships: defineTable({
    worldId: v.id('worlds'),
    fromProfileKey: v.string(),
    toProfileKey: v.string(),
    trust: zeroToOne,
    affection: zeroToOne,
    respect: zeroToOne,
    tension: zeroToOne,
    familiarity: zeroToOne,
    updatedAt: v.number(),
    reason: v.optional(v.string()),
  })
    .index('from', ['worldId', 'fromProfileKey'])
    .index('pair', ['worldId', 'fromProfileKey', 'toProfileKey']),

  cardinalEvents: defineTable({
    worldId: v.id('worlds'),
    createdAt: v.number(),
    kind: v.string(),
    source: v.union(v.literal('world'), v.literal('npc'), v.literal('player'), v.literal('cardinal'), v.literal('yui')),
    summary: v.string(),
    importance: zeroToOne,
    participants: v.array(v.string()),
    expiresAt: v.optional(v.number()),
  })
    .index('world_time', ['worldId', 'createdAt'])
    .index('world_kind', ['worldId', 'kind']),

  yuiPlayerState: defineTable({
    worldId: v.id('worlds'),
    playerId: v.string(),
    updatedAt: v.number(),
    relationshipTrust: zeroToOne,
    relationshipFamiliarity: zeroToOne,
    minutesAlone: v.number(),
    recentLosses: v.number(),
    repeatedFailures: v.number(),
    explicitDistress: v.boolean(),
    lastSupportContactAt: v.optional(v.number()),
    lastObservedEvent: v.optional(v.string()),
  }).index('world_player', ['worldId', 'playerId']),
};
