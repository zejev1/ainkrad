import { v } from 'convex/values';
import { api, internal } from './_generated/api';
import {
  DatabaseReader,
  MutationCtx,
  mutation,
} from './_generated/server';
import { Descriptions } from '../data/characters';
import * as map from '../data/gentle';
import { insertInput } from './aiTown/insertInput';
import { Id } from './_generated/dataModel';
import { createEngine } from './aiTown/main';
import { ENGINE_ACTION_DURATION } from './constants';
import { detectMismatchedLLMProvider } from './util/llm';

const init = mutation({
  args: {
    numAgents: v.optional(v.number()),
  },

  handler: async (ctx, args) => {
    detectMismatchedLLMProvider();

    const {
      worldStatus,
      engine,
    } = await getOrCreateDefaultWorld(ctx);

    if (worldStatus.status !== 'running') {
      console.warn(
        `Engine ${engine._id} is not active! Run "npx convex run testing:resume" to restart it.`,
      );

      return;
    }

    // Проверяем, есть ли уже логические здания.
    const existingBuilding =
      await ctx.db
        .query('buildings')
        .withIndex(
          'worldId',
          (q) =>
            q.eq(
              'worldId',
              worldStatus.worldId,
            ),
        )
        .first();

    const needsSettlement =
      !existingBuilding;

    // =====================================================
    // STARTER SETTLEMENT
    // =====================================================
    //
    // Запускаем проверку при каждом init.
    //
    // Сам seed идемпотентный:
    // если здания уже существуют,
    // он ничего не пересоздаёт.
    // =====================================================

    await ctx.scheduler.runAfter(
      0,
      (api as any).world.seed.seedStarterSettlement,
      {
        worldId: worldStatus.worldId,
      },
    );

    // =====================================================
    // NPC
    // =====================================================

    const shouldCreate =
      await shouldCreateAgents(
        ctx.db,
        worldStatus.worldId,
        worldStatus.engineId,
      );

    if (shouldCreate) {
      const toCreate =
        args.numAgents !== undefined
          ? args.numAgents
          : Descriptions.length;

      for (
        let i = 0;
        i < toCreate;
        i++
      ) {
        await insertInput(
          ctx,
          worldStatus.worldId,
          'createAgent',
          {
            descriptionIndex:
              i %
              Descriptions.length,
          },
        );
      }
    }

    // =====================================================
    // INITIAL POPULATION ASSIGNMENT
    // =====================================================
    //
    // Запускаем только в двух случаях:
    //
    // 1. NPC создаются впервые.
    // 2. Это старый мир, который существовал
    //    ещё до появления нашей системы зданий.
    //
    // Сам population.ts теперь не трогает
    // уже инициализированных жителей.
    // =====================================================

    if (
      shouldCreate ||
      needsSettlement
    ) {
      await ctx.scheduler.runAfter(
        7000,
        (api as any).world.population.assignPopulation,
        {
          worldId: worldStatus.worldId,
        },
      );
    }

    // Cardinal hooks остаются подключёнными.
    // Старый искусственный Cardinal seed
    // пока не запускается.
  },
});

export default init;

async function getOrCreateDefaultWorld(
  ctx: MutationCtx,
) {
  const now = Date.now();

  let worldStatus =
    await ctx.db
      .query('worldStatus')
      .filter((q) =>
        q.eq(
          q.field('isDefault'),
          true,
        ),
      )
      .unique();

  if (worldStatus) {
    const engine =
      (await ctx.db.get(
        worldStatus.engineId,
      ))!;

    return {
      worldStatus,
      engine,
    };
  }

  const engineId =
    await createEngine(ctx);

  const engine =
    (await ctx.db.get(
      engineId,
    ))!;

  const worldId =
    await ctx.db.insert(
      'worlds',
      {
        nextId: 0,
        agents: [],
        conversations: [],
        players: [],
      },
    );

  const worldStatusId =
    await ctx.db.insert(
      'worldStatus',
      {
        engineId,
        isDefault: true,
        lastViewed: now,
        status: 'running',
        worldId,
      },
    );

  worldStatus =
    (await ctx.db.get(
      worldStatusId,
    ))!;

  await ctx.db.insert(
    'maps',
    {
      worldId,

      width:
        map.mapwidth,

      height:
        map.mapheight,

      tileSetUrl:
        map.tilesetpath,

      tileSetDimX:
        map.tilesetpxw,

      tileSetDimY:
        map.tilesetpxh,

      tileDim:
        map.tiledim,

      bgTiles:
        map.bgtiles,

      objectTiles:
        map.objmap,

      animatedSprites:
        map.animatedsprites,
    },
  );

  await ctx.scheduler.runAfter(
    0,
    internal.aiTown.main.runStep,
    {
      worldId,

      generationNumber:
        engine.generationNumber,

      maxDuration:
        ENGINE_ACTION_DURATION,
    },
  );

  return {
    worldStatus,
    engine,
  };
}

async function shouldCreateAgents(
  db: DatabaseReader,
  worldId: Id<'worlds'>,
  engineId: Id<'engines'>,
) {
  const world =
    await db.get(worldId);

  if (!world) {
    throw new Error(
      `Invalid world ID: ${worldId}`,
    );
  }

  if (
    world.agents.length >
    0
  ) {
    return false;
  }

  const unactionedJoinInputs =
    await db
      .query('inputs')
      .withIndex(
        'byInputNumber',
        (q) =>
          q.eq(
            'engineId',
            engineId,
          ),
      )
      .order('asc')
      .filter((q) =>
        q.eq(
          q.field('name'),
          'createAgent',
        ),
      )
      .filter((q) =>
        q.eq(
          q.field(
            'returnValue',
          ),
          undefined,
        ),
      )
      .first();

  if (
    unactionedJoinInputs
  ) {
    return false;
  }

  return true;
}
