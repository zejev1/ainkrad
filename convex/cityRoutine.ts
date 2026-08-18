import { query } from './_generated/server';
import { v } from 'convex/values';
import { playerId } from './aiTown/ids';

export const getRoutineTarget = query({
  args: {
    worldId: v.id('worlds'),
    playerId,
    now: v.number(),
  },

  handler: async (ctx, args) => {
    const buildings = await ctx.db
      .query('buildings')
      .withIndex('worldId', (q) =>
        q.eq('worldId', args.worldId),
      )
      .collect();

    const home = buildings.find(
      (building) =>
        building.kind === 'home' &&
        building.status === 'active' &&
        building.residents.includes(
          args.playerId,
        ),
    );

    const workplace = buildings.find(
      (building) =>
        building.status === 'active' &&
        building.workers.includes(
          args.playerId,
        ),
    );

    if (!home && !workplace) {
      return null;
    }

    // Один тестовый жизненный цикл = 8 минут.
    // 5 минут условная рабочая фаза.
    // 3 минуты условная домашняя фаза.
    //
    // У каждого NPC есть собственный сдвиг,
    // поэтому они не идут строем одновременно.

    const cycleDuration =
      8 * 60 * 1000;

    const workDuration =
      5 * 60 * 1000;

    let hash = 0;

    for (
      let i = 0;
      i < args.playerId.length;
      i++
    ) {
      hash =
        (
          hash * 31 +
          args.playerId.charCodeAt(i)
        ) >>> 0;
    }

    const personalOffset =
      hash % cycleDuration;

    const phaseTime =
      (
        args.now +
        personalOffset
      ) %
      cycleDuration;

    const wantsWork =
      phaseTime < workDuration;

    if (
      wantsWork &&
      workplace
    ) {
      return {
        phase: 'work' as const,

        buildingId:
          workplace._id,

        buildingName:
          workplace.name,

        buildingKind:
          workplace.kind,

        destination:
          workplace.position,
      };
    }

    if (home) {
      return {
        phase: 'home' as const,

        buildingId:
          home._id,

        buildingName:
          home.name,

        buildingKind:
          home.kind,

        destination:
          home.position,
      };
    }

    if (workplace) {
      return {
        phase: 'work' as const,

        buildingId:
          workplace._id,

        buildingName:
          workplace.name,

        buildingKind:
          workplace.kind,

        destination:
          workplace.position,
      };
    }

    return null;
  },
});
