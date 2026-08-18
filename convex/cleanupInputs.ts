import { mutation } from './_generated/server';

const KEEP_RECENT = 500;
const MAX_DELETE_PER_RUN = 500;

export const cleanupProcessedInputs = mutation({
  args: {},

  handler: async (ctx) => {
    const engines = await ctx.db.query('engines').collect();

    let deleted = 0;

    const details: Array<{
      engineId: string;
      processedInputNumber: number;
      cutoff: number;
      deleted: number;
    }> = [];

    for (const engine of engines) {
      if (deleted >= MAX_DELETE_PER_RUN) break;

      const processedInputNumber =
        engine.processedInputNumber ?? -1;

      const cutoff =
        processedInputNumber - KEEP_RECENT;

      if (cutoff < 0) {
        details.push({
          engineId: engine._id,
          processedInputNumber,
          cutoff,
          deleted: 0,
        });

        continue;
      }

      const remaining =
        MAX_DELETE_PER_RUN - deleted;

      const oldInputs = await ctx.db
        .query('inputs')
        .withIndex('byInputNumber', (q) =>
          q
            .eq('engineId', engine._id)
            .lte('number', cutoff),
        )
        .order('asc')
        .take(remaining);

      for (const input of oldInputs) {
        await ctx.db.delete(input._id);
      }

      deleted += oldInputs.length;

      details.push({
        engineId: engine._id,
        processedInputNumber,
        cutoff,
        deleted: oldInputs.length,
      });
    }

    return {
      deleted,
      keepRecent: KEEP_RECENT,
      maxDeletePerRun: MAX_DELETE_PER_RUN,
      runAgain:
        deleted === MAX_DELETE_PER_RUN,
      details,
    };
  },
});
