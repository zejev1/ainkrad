import { query } from './_generated/server';
import { v } from 'convex/values';
import { playerId } from './aiTown/ids';

export const listBuildings = query({
  args: {
    worldId: v.id('worlds'),
  },

  handler: async (ctx, args) => {
    return await ctx.db
      .query('buildings')
      .withIndex('worldId', (q) =>
        q.eq('worldId', args.worldId),
      )
      .collect();
  },
});

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

    // -------------------------------------------------
    // БАЗОВЫЙ РИТМ ЖИЗНИ
    // -------------------------------------------------
    //
    // Пока это не жёсткие "08:00–17:00".
    //
    // У каждого NPC свой небольшой временной сдвиг,
    // поэтому весь город не выходит из домов строем
    // в одну секунду.
    //
    // Полный тестовый цикл = 8 минут:
    // примерно 5 минут рабочая фаза,
    // примерно 3 минуты домашняя.
    //
    // Позже этот ритм заменят реальные потребности:
    // голод, энергия, обязанности, отношения и т.д.
    // -------------------------------------------------

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
