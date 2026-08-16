import { internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { CARDINAL_NPC_PROFILES } from '../../data/cardinalNpcProfiles';

const byName = new Map(CARDINAL_NPC_PROFILES.map((profile) => [profile.name, profile]));
const clamp = (value: number) => Math.max(0, Math.min(1, value));

async function profileForPlayer(ctx: any, worldId: any, playerId: string) {
  const description = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q: any) => q.eq('worldId', worldId).eq('playerId', playerId))
    .first();
  return description ? byName.get(description.name) ?? null : null;
}

async function touchRelationship(ctx: any, worldId: any, fromKey: string, toKey: string, now: number) {
  const existing = await ctx.db
    .query('cardinalRelationships')
    .withIndex('pair', (q: any) =>
      q.eq('worldId', worldId).eq('fromProfileKey', fromKey).eq('toProfileKey', toKey),
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      trust: clamp(existing.trust + 0.01),
      affection: clamp(existing.affection + 0.005),
      tension: clamp(existing.tension - 0.015),
      familiarity: clamp(existing.familiarity + 0.05),
      updatedAt: now,
    });
    return;
  }

  await ctx.db.insert('cardinalRelationships', {
    worldId,
    fromProfileKey: fromKey,
    toProfileKey: toKey,
    trust: 0.5,
    affection: 0.45,
    respect: 0.5,
    tension: 0.12,
    familiarity: 0.15,
    updatedAt: now,
    reason: 'This relationship began through ordinary repeated contact in town.',
  });
}

export const recordConversation = internalMutation({
  args: {
    worldId: v.id('worlds'),
    conversationId: v.string(),
    playerId: v.string(),
    otherPlayerId: v.string(),
  },
  handler: async (ctx, args) => {
    const kind = `conversation:${args.conversationId}`;
    const duplicate = await ctx.db
      .query('cardinalEvents')
      .withIndex('world_kind', (q: any) => q.eq('worldId', args.worldId).eq('kind', kind))
      .first();
    if (duplicate) return { recorded: false };

    const self = await profileForPlayer(ctx, args.worldId, args.playerId);
    const other = await profileForPlayer(ctx, args.worldId, args.otherPlayerId);
    const now = Date.now();

    if (self && other) {
      await touchRelationship(ctx, args.worldId, self.key, other.key, now);
      await touchRelationship(ctx, args.worldId, other.key, self.key, now);
    }

    await ctx.db.insert('cardinalEvents', {
      worldId: args.worldId,
      createdAt: now,
      kind,
      source: 'npc',
      summary:
        self && other
          ? `${self.name} and ${other.name} had a real conversation; their shared history is now slightly deeper.`
          : 'A resident had a meaningful conversation with someone outside the authored NPC graph.',
      importance: self && other ? 0.28 : 0.18,
      participants: [args.playerId, args.otherPlayerId],
      expiresAt: now + 24 * 60 * 60_000,
    });
    return { recorded: true };
  },
});
