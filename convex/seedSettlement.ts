import { mutation } from './_generated/server';
import { v } from 'convex/values';

const STARTER_BUILDINGS = [
  {
    kind: 'home' as const,
    name: 'Дом 1',
    position: { x: 8, y: 8 },
    capacity: 4,
    affordances: ['sleep', 'rest', 'socialize'] as const,
  },
  {
    kind: 'home' as const,
    name: 'Дом 2',
    position: { x: 13, y: 8 },
    capacity: 4,
    affordances: ['sleep', 'rest', 'socialize'] as const,
  },
  {
    kind: 'home' as const,
    name: 'Дом 3',
    position: { x: 18, y: 8 },
    capacity: 4,
    affordances: ['sleep', 'rest', 'socialize'] as const,
  },
  {
    kind: 'home' as const,
    name: 'Дом 4',
    position: { x: 23, y: 8 },
    capacity: 4,
    affordances: ['sleep', 'rest', 'socialize'] as const,
  },
  {
    kind: 'home' as const,
    name: 'Дом 5',
    position: { x: 28, y: 8 },
    capacity: 4,
    affordances: ['sleep', 'rest', 'socialize'] as const,
  },
  {
    kind: 'farm' as const,
    name: 'Ферма',
    position: { x: 8, y: 18 },
    capacity: 6,
    affordances: ['work', 'harvest'] as const,
  },
  {
    kind: 'workshop' as const,
    name: 'Мастерская',
    position: { x: 16, y: 18 },
    capacity: 5,
    affordances: ['work', 'craft'] as const,
  },
  {
    kind: 'market' as const,
    name: 'Рынок',
    position: { x: 24, y: 18 },
    capacity: 8,
    affordances: ['buy', 'sell', 'socialize'] as const,
  },
  {
    kind: 'warehouse' as const,
    name: 'Склад',
    position: { x: 32, y: 18 },
    capacity: 6,
    affordances: ['store', 'work'] as const,
  },
];

export const seedStarterSettlement = mutation({
  args: {
    worldId: v.id('worlds'),
  },

  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('buildings')
      .withIndex('worldId', (q) =>
        q.eq('worldId', args.worldId),
      )
      .first();

    if (existing) {
      return {
        created: false,
      };
    }

    const now = Date.now();

    for (const building of STARTER_BUILDINGS) {
      const buildingId = await ctx.db.insert(
        'buildings',
        {
          worldId: args.worldId,
          kind: building.kind,
          name: building.name,
          position: building.position,
          status: 'active',
          capacity: building.capacity,
          residents: [],
          workers: [],
          affordances: [
            ...building.affordances,
          ],
          createdAt: now,
          updatedAt: now,
        },
      );

      await ctx.db.insert(
        'buildingInventories',
        {
          worldId: args.worldId,
          buildingId,

          food:
            building.kind === 'farm'
              ? 20
              : 0,

          wood:
            building.kind === 'warehouse'
              ? 20
              : 0,

          stone:
            building.kind === 'warehouse'
              ? 10
              : 0,

          goods:
            building.kind === 'workshop'
              ? 5
              : 0,

          money:
            building.kind === 'market'
              ? 100
              : 0,

          updatedAt: now,
        },
      );
    }

    return {
      created: true,
    };
  },
});
