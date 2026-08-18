import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { playerId } from '../aiTown/ids';

export const buildingKind = v.union(
  v.literal('home'),
  v.literal('farm'),
  v.literal('workshop'),
  v.literal('market'),
  v.literal('warehouse'),
  v.literal('constructionSite'),
);

export const buildingStatus = v.union(
  v.literal('planned'),
  v.literal('constructing'),
  v.literal('active'),
  v.literal('damaged'),
);

export const affordance = v.union(
  v.literal('sleep'),
  v.literal('rest'),
  v.literal('socialize'),
  v.literal('work'),
  v.literal('harvest'),
  v.literal('craft'),
  v.literal('buy'),
  v.literal('sell'),
  v.literal('store'),
  v.literal('build'),
);

export const worldTables = {
  buildings: defineTable({
    worldId: v.id('worlds'),

    kind: buildingKind,

    name: v.string(),

    position: v.object({
      x: v.number(),
      y: v.number(),
    }),

    status: buildingStatus,

    capacity: v.number(),

    ownerId: v.optional(playerId),

    residents: v.array(playerId),

    workers: v.array(playerId),

    affordances: v.array(affordance),

    construction: v.optional(
      v.object({
        progress: v.number(),

        requiredWood: v.number(),
        requiredStone: v.number(),

        deliveredWood: v.number(),
        deliveredStone: v.number(),

        startedAt: v.optional(v.number()),
        completedAt: v.optional(v.number()),
      }),
    ),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('worldId', ['worldId'])
    .index('world_kind', ['worldId', 'kind'])
    .index('world_status', ['worldId', 'status']),

  npcNeeds: defineTable({
    worldId: v.id('worlds'),

    playerId,

    hunger: v.number(),
    energy: v.number(),
    social: v.number(),
    safety: v.number(),

    updatedAt: v.number(),
  })
    .index('world_player', ['worldId', 'playerId'])
    .index('worldId', ['worldId']),

  npcInventories: defineTable({
    worldId: v.id('worlds'),

    playerId,

    food: v.number(),
    wood: v.number(),
    stone: v.number(),
    goods: v.number(),
    money: v.number(),

    updatedAt: v.number(),
  })
    .index('world_player', ['worldId', 'playerId'])
    .index('worldId', ['worldId']),

  buildingInventories: defineTable({
    worldId: v.id('worlds'),

    buildingId: v.id('buildings'),

    food: v.number(),
    wood: v.number(),
    stone: v.number(),
    goods: v.number(),
    money: v.number(),

    updatedAt: v.number(),
  })
    .index('buildingId', ['buildingId'])
    .index('worldId', ['worldId']),
};
