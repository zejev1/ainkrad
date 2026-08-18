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

    const now = Date.now();

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

    if (homes.length === 0) {
      return {
        assigned: false,
        reason: 'no_homes',
      };
    }

    if (workplaces.length === 0) {
      return {
        assigned: false,
        reason: 'no_workplaces',
      };
    }

    const npcPlayers = world.players.filter(
      (player) => !player.human,
    );

    let assignedHomes = 0;
    let assignedJobs = 0;
    let createdNeeds = 0;
    let createdInventories = 0;

    for (
      let index = 0;
      index < npcPlayers.length;
      index++
    ) {
      const player = npcPlayers[index];

      // ===================================================
      // ЖИЛЬЁ
      // ===================================================

      const existingHome = homes.find(
        (home) =>
          home.residents.includes(player.id),
      );

      if (!existingHome) {
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
          await ctx.db.patch(
            homeWithSpace._id,
            {
              residents: [
                ...homeWithSpace.residents,
                player.id,
              ],

              updatedAt: now,
            },
          );

          homeWithSpace.residents = [
            ...homeWithSpace.residents,
            player.id,
          ];

          assignedHomes++;
        }
      }

      // ===================================================
      // РАБОТА
      // ===================================================

      const existingWorkplace =
        workplaces.find(
          (workplace) =>
            workplace.workers.includes(
              player.id,
            ),
        );

      if (!existingWorkplace) {
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
          await ctx.db.patch(
            workplaceWithSpace._id,
            {
              workers: [
                ...workplaceWithSpace.workers,
                player.id,
              ],

              updatedAt: now,
            },
          );

          workplaceWithSpace.workers = [
            ...workplaceWithSpace.workers,
            player.id,
          ];

          assignedJobs++;
        }
      }

      // ===================================================
      // ПОТРЕБНОСТИ
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
                  args.worldId,
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
            worldId:
              args.worldId,

            playerId:
              player.id,

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

        createdNeeds++;
      }

      // ===================================================
      // ЛИЧНЫЕ РЕСУРСЫ
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
                  args.worldId,
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
            worldId:
              args.worldId,

            playerId:
              player.id,

            food: 3,
            wood: 0,
            stone: 0,
            goods: 0,
            money: 20,

            updatedAt: now,
          },
        );

        createdInventories++;
      }
    }

    return {
      assigned: true,

      population:
        npcPlayers.length,

      assignedHomes,
      assignedJobs,

      createdNeeds,
      createdInventories,
    };
  },
});
