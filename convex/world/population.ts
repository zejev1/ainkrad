import { mutation } from '../_generated/server';
import { v } from 'convex/values';

export const assignPopulation = mutation({
  args: {
    worldId: v.id('worlds'),
  },

  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);

    if (!world) {
      throw new Error(
        `World ${args.worldId} not found`,
      );
    }

    const buildings = await ctx.db
      .query('buildings')
      .withIndex('worldId', (q) =>
        q.eq('worldId', args.worldId),
      )
      .collect();

    const homes = buildings.filter(
      (building) =>
        building.kind === 'home' &&
        building.status === 'active',
    );

    const workplaces = buildings.filter(
      (building) =>
        (
          building.kind === 'farm' ||
          building.kind === 'workshop' ||
          building.kind === 'market' ||
          building.kind === 'warehouse'
        ) &&
        building.status === 'active',
    );

    const npcPlayers = world.players.filter(
      (player) => !player.human,
    );

    let newResidents = 0;
    let assignedHomes = 0;
    let assignedJobs = 0;

    for (const player of npcPlayers) {
      // npcNeeds служит маркером:
      // если запись уже существует,
      // этот NPC уже является частью мира.
      //
      // Его дом, работа, деньги и состояние
      // при повторном запуске НЕ трогаем.
      const existingNeeds = await ctx.db
        .query('npcNeeds')
        .withIndex(
          'world_player',
          (q) =>
            q
              .eq(
                'worldId',
                args.worldId,
              )
              .eq(
                'playerId',
                player.id,
              ),
        )
        .unique();

      if (existingNeeds) {
        continue;
      }

      const now = Date.now();

      // ==============================================
      // НОВЫЙ ЖИТЕЛЬ
      // ==============================================

      await ctx.db.insert(
        'npcNeeds',
        {
          worldId: args.worldId,
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

      await ctx.db.insert(
        'npcInventories',
        {
          worldId: args.worldId,
          playerId: player.id,

          food: 3,
          wood: 0,
          stone: 0,
          goods: 0,
          money: 20,

          updatedAt: now,
        },
      );

      // ==============================================
      // ПЕРВОНАЧАЛЬНЫЙ ДОМ
      // ==============================================

      const homeWithSpace = homes
        .slice()
        .sort(
          (a, b) =>
            a.residents.length -
            b.residents.length,
        )
        .find(
          (home) =>
            home.residents.length <
            home.capacity,
        );

      if (homeWithSpace) {
        const residents = [
          ...homeWithSpace.residents,
          player.id,
        ];

        await ctx.db.patch(
          homeWithSpace._id,
          {
            residents,
            updatedAt: now,
          },
        );

        homeWithSpace.residents =
          residents;

        assignedHomes++;
      }

      // ==============================================
      // ПЕРВОНАЧАЛЬНАЯ РАБОТА
      // ==============================================

      const workplaceWithSpace =
        workplaces
          .slice()
          .sort(
            (a, b) =>
              a.workers.length -
              b.workers.length,
          )
          .find(
            (workplace) =>
              workplace.workers.length <
              workplace.capacity,
          );

      if (workplaceWithSpace) {
        const workers = [
          ...workplaceWithSpace.workers,
          player.id,
        ];

        await ctx.db.patch(
          workplaceWithSpace._id,
          {
            workers,
            updatedAt: now,
          },
        );

        workplaceWithSpace.workers =
          workers;

        assignedJobs++;
      }

      newResidents++;
    }

    return {
      population: npcPlayers.length,
      newResidents,
      assignedHomes,
      assignedJobs,
    };
  },
});
