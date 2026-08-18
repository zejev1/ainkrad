import {
  mutation,
  MutationCtx,
} from './_generated/server';
import { v } from 'convex/values';
import { Id } from './_generated/dataModel';

const STARTER_BUILDINGS = [
  {
    kind: 'home' as const,
    name: 'Дом 1',
    position: { x: 6, y: 6 },
    capacity: 4,
    affordances: ['sleep', 'rest', 'socialize'],
  },
  {
    kind: 'home' as const,
    name: 'Дом 2',
    position: { x: 10, y: 6 },
    capacity: 4,
    affordances: ['sleep', 'rest', 'socialize'],
  },
  {
    kind: 'home' as const,
    name: 'Дом 3',
    position: { x: 14, y: 6 },
    capacity: 4,
    affordances: ['sleep', 'rest', 'socialize'],
  },
  {
    kind: 'home' as const,
    name: 'Дом 4',
    position: { x: 6, y: 10 },
    capacity: 4,
    affordances: ['sleep', 'rest', 'socialize'],
  },
  {
    kind: 'home' as const,
    name: 'Дом 5',
    position: { x: 10, y: 10 },
    capacity: 4,
    affordances: ['sleep', 'rest', 'socialize'],
  },
  {
    kind: 'farm' as const,
    name: 'Ферма',
    position: { x: 14, y: 10 },
    capacity: 6,
    affordances: ['work', 'harvest'],
  },
  {
    kind: 'workshop' as const,
    name: 'Мастерская',
    position: { x: 6, y: 14 },
    capacity: 5,
    affordances: ['work', 'craft'],
  },
  {
    kind: 'market' as const,
    name: 'Рынок',
    position: { x: 10, y: 14 },
    capacity: 8,
    affordances: ['buy', 'sell', 'socialize'],
  },
  {
    kind: 'warehouse' as const,
    name: 'Склад',
    position: { x: 14, y: 14 },
    capacity: 6,
    affordances: ['store', 'work'],
  },
];

async function ensureSettlement(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
) {
  const now = Date.now();

  const existingBuildings =
    await ctx.db
      .query('buildings')
      .withIndex('worldId', (q) =>
        q.eq('worldId', worldId),
      )
      .collect();

  const buildings = [];

  // =====================================================
  // CREATE OR REPAIR BUILDINGS
  // =====================================================

  for (const definition of STARTER_BUILDINGS) {
    const existing =
      existingBuildings.find(
        (building) =>
          building.name === definition.name,
      );

    if (existing) {
      // Переносим старые технические маркеры
      // в новую компактную зону.
      await ctx.db.patch(
        existing._id,
        {
          position: definition.position,
          capacity: definition.capacity,
          affordances: [
            ...definition.affordances,
          ],
          status: 'active',
          updatedAt: now,
        },
      );

      existing.position =
        definition.position;

      buildings.push(existing);

      continue;
    }

    const buildingId =
      await ctx.db.insert(
        'buildings',
        {
          worldId,
          kind: definition.kind,
          name: definition.name,
          position: definition.position,
          status: 'active',
          capacity: definition.capacity,

          residents: [],
          workers: [],

          affordances: [
            ...definition.affordances,
          ],

          createdAt: now,
          updatedAt: now,
        },
      );

    await ctx.db.insert(
      'buildingInventories',
      {
        worldId,
        buildingId,

        food:
          definition.kind === 'farm'
            ? 20
            : 0,

        wood:
          definition.kind === 'warehouse'
            ? 20
            : 0,

        stone:
          definition.kind === 'warehouse'
            ? 10
            : 0,

        goods:
          definition.kind === 'workshop'
            ? 5
            : 0,

        money:
          definition.kind === 'market'
            ? 100
            : 0,

        updatedAt: now,
      },
    );

    const created =
      await ctx.db.get(buildingId);

    if (created) {
      buildings.push(created);
    }
  }

  // Получаем уже обновлённые здания.
  const currentBuildings =
    await ctx.db
      .query('buildings')
      .withIndex('worldId', (q) =>
        q.eq('worldId', worldId),
      )
      .collect();

  const homes =
    currentBuildings.filter(
      (building) =>
        building.kind === 'home' &&
        building.status === 'active',
    );

  const workplaces =
    currentBuildings.filter(
      (building) =>
        (
          building.kind === 'farm' ||
          building.kind === 'workshop' ||
          building.kind === 'market' ||
          building.kind === 'warehouse'
        ) &&
        building.status === 'active',
    );

  // =====================================================
  // POPULATION
  // =====================================================

  const world =
    await ctx.db.get(worldId);

  if (!world) {
    throw new Error(
      `World ${worldId} not found`,
    );
  }

  const npcPlayers =
    world.players.filter(
      (player) => !player.human,
    );

  const residentsAlreadyAssigned =
    new Set<string>();

  const workersAlreadyAssigned =
    new Set<string>();

  for (const home of homes) {
    for (const playerId of home.residents) {
      residentsAlreadyAssigned.add(
        playerId,
      );
    }
  }

  for (const workplace of workplaces) {
    for (const playerId of workplace.workers) {
      workersAlreadyAssigned.add(
        playerId,
      );
    }
  }

  let assignedHomes = 0;
  let assignedJobs = 0;

  for (const player of npcPlayers) {
    // ===================================================
    // NEEDS
    // ===================================================

    const existingNeeds =
      await ctx.db
        .query('npcNeeds')
        .withIndex(
          'world_player',
          (q) =>
            q
              .eq(
                'worldId',
                worldId,
              )
              .eq(
                'playerId',
                player.id,
              ),
        )
        .unique();

    if (!existingNeeds) {
      await ctx.db.insert(
        'npcNeeds',
        {
          worldId,
          playerId: player.id,

          hunger:
            20 +
            Math.floor(
              Math.random() * 20,
            ),

          energy:
            15 +
            Math.floor(
              Math.random() * 20,
            ),

          social:
            20 +
            Math.floor(
              Math.random() * 20,
            ),

          safety: 10,
          updatedAt: now,
        },
      );
    }

    // ===================================================
    // PERSONAL INVENTORY
    // ===================================================

    const existingInventory =
      await ctx.db
        .query('npcInventories')
        .withIndex(
          'world_player',
          (q) =>
            q
              .eq(
                'worldId',
                worldId,
              )
              .eq(
                'playerId',
                player.id,
              ),
        )
        .unique();

    if (!existingInventory) {
      await ctx.db.insert(
        'npcInventories',
        {
          worldId,
          playerId: player.id,

          food: 3,
          wood: 0,
          stone: 0,
          goods: 0,
          money: 20,

          updatedAt: now,
        },
      );
    }

    // ===================================================
    // HOME
    // ===================================================

    if (
      !residentsAlreadyAssigned.has(
        player.id,
      )
    ) {
      const home =
        homes
          .slice()
          .sort(
            (a, b) =>
              a.residents.length -
              b.residents.length,
          )
          .find(
            (candidate) =>
              candidate.residents.length <
              candidate.capacity,
          );

      if (home) {
        home.residents = [
          ...home.residents,
          player.id,
        ];

        await ctx.db.patch(
          home._id,
          {
            residents:
              home.residents,
            updatedAt: now,
          },
        );

        residentsAlreadyAssigned.add(
          player.id,
        );

        assignedHomes++;
      }
    }

    // ===================================================
    // JOB
    // ===================================================

    if (
      !workersAlreadyAssigned.has(
        player.id,
      )
    ) {
      const workplace =
        workplaces
          .slice()
          .sort(
            (a, b) =>
              a.workers.length -
              b.workers.length,
          )
          .find(
            (candidate) =>
              candidate.workers.length <
              candidate.capacity,
          );

      if (workplace) {
        workplace.workers = [
          ...workplace.workers,
          player.id,
        ];

        await ctx.db.patch(
          workplace._id,
          {
            workers:
              workplace.workers,
            updatedAt: now,
          },
        );

        workersAlreadyAssigned.add(
          player.id,
        );

        assignedJobs++;
      }
    }
  }

  return {
    worldId,
    buildings:
      currentBuildings.length,

    population:
      npcPlayers.length,

    assignedHomes,
    assignedJobs,
  };
}

export const seedStarterSettlement = mutation({
  args: {
    worldId: v.id('worlds'),
  },

  handler: async (ctx, args) => {
    return await ensureSettlement(
      ctx,
      args.worldId,
    );
  },
});

export const seedDefaultSettlement = mutation({
  args: {},

  handler: async (ctx) => {
    const worldStatus =
      await ctx.db
        .query('worldStatus')
        .filter((q) =>
          q.eq(
            q.field('isDefault'),
            true,
          ),
        )
        .unique();

    if (!worldStatus) {
      throw new Error(
        'Default world not found',
      );
    }

    return await ensureSettlement(
      ctx,
      worldStatus.worldId,
    );
  },
});
