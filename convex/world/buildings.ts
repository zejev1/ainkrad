import { query } from '../_generated/server';
import { v } from 'convex/values';

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
