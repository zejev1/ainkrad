import { ConvexError, v } from 'convex/values';
import { DatabaseReader, MutationCtx, internalAction, mutation, query } from '../_generated/server';
import { insertInput } from './insertInput';
import { Game } from './game';
import { internal } from '../_generated/api';
import { sleep } from '../util/sleep';
import { Id } from '../_generated/dataModel';
import { ENGINE_ACTION_DURATION } from '../constants';

export async function createEngine(ctx: MutationCtx) {
  const now = Date.now();
  const engineId = await ctx.db.insert('engines', {
    currentTime: now,
    generationNumber: 0,
    running: true,
  });
  return engineId;
}

async function loadWorldStatus(db: DatabaseReader, worldId: Id<'worlds'>) {
  const worldStatus = await db
    .query('worldStatus')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .unique();
  if (!worldStatus) {
    throw new Error(`No engine found for world ${worldId}`);
  }
  return worldStatus;
}

export async function startEngine(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const { engineId } = await loadWorldStatus(ctx.db, worldId);
  const engine = await ctx.db.get(engineId);
  if (!engine) {
    throw new Error(`Invalid engine ID: ${engineId}`);
  }
  if (engine.running) {
    throw new Error(`Engine ${engineId} isn't currently stopped`);
  }
  const now = Date.now();
  const generationNumber = engine.generationNumber + 1;
  await ctx.db.patch(engineId, {
    // Forcibly advance time to the present. This does mean we'll skip
    // simulating the time the engine was stopped, but we don't want
    // to have to simulate a potentially large stopped window and send
    // it down to clients.
    lastStepTs: engine.currentTime,
    currentTime: now,
    running: true,
    generationNumber,
  });
  await ctx.scheduler.runAfter(0, internal.aiTown.main.runStep, {
    worldId: worldId,
    generationNumber,
    maxDuration: ENGINE_ACTION_DURATION,
  });
}

export async function kickEngine(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const { engineId } = await loadWorldStatus(ctx.db, worldId);
  const engine = await ctx.db.get(engineId);
  if (!engine) {
    throw new Error(`Invalid engine ID: ${engineId}`);
  }
  if (!engine.running) {
    throw new Error(`Engine ${engineId} isn't currently running`);
  }
  const generationNumber = engine.generationNumber + 1;
  await ctx.db.patch(engineId, { generationNumber });
  await ctx.scheduler.runAfter(0, internal.aiTown.main.runStep, {
    worldId: worldId,
    generationNumber,
    maxDuration: ENGINE_ACTION_DURATION,
  });
}

export async function stopEngine(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const { engineId } = await loadWorldStatus(ctx.db, worldId);
  const engine = await ctx.db.get(engineId);
  if (!engine) {
    throw new Error(`Invalid engine ID: ${engineId}`);
  }
  if (!engine.running) {
    throw new Error(`Engine ${engineId} isn't currently running`);
  }
  await ctx.db.patch(engineId, { running: false });
}



export const sendInput = mutation({
  args: {
    worldId: v.id('worlds'),
    name: v.string(),
    args: v.any(),
  },
  handler: async (ctx, args) => {
    return await insertInput(ctx, args.worldId, args.name as any, args.args);
  },
});

export const inputStatus = query({
  args: {
    inputId: v.id('inputs'),
  },
  handler: async (ctx, args) => {
    const input = await ctx.db.get(args.inputId);
    if (!input) {
      throw new Error(`Invalid input ID: ${args.inputId}`);
    }
    return input.returnValue ?? null;
  },
});
