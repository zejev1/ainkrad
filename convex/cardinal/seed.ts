import { mutation } from '../_generated/server';
import { v } from 'convex/values';
import { CARDINAL_NPC_PROFILES } from '../../data/cardinalNpcProfiles';
import { CARDINAL_RELATIONSHIP_SEEDS } from '../../data/cardinalRelationships';
import { CARDINAL_INITIAL_EVENTS, CARDINAL_INITIAL_STRESS, CARDINAL_INITIAL_TRUST_IN_TOWN } from '../../data/cardinalWorldSeed';

export const seedCardinalState = mutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, { worldId }) => {
    const world = await ctx.db.get(worldId);
    if (!world) throw new Error(`World ${worldId} not found`);

    const playerDescriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .collect();
    const nameByPlayer = new Map(playerDescriptions.map((d) => [d.playerId, d.name]));
    const profileByName = new Map(CARDINAL_NPC_PROFILES.map((p) => [p.name, p]));
    const agentByProfileKey = new Map<string, string>();

    for (const agent of world.agents) {
      const name = nameByPlayer.get(agent.playerId);
      if (!name) continue;
      const profile = profileByName.get(name);
      if (profile) agentByProfileKey.set(profile.key, agent.id);
    }

    const now = Date.now();
    let insertedNpcStates = 0;
    for (const profile of CARDINAL_NPC_PROFILES) {
      const existing = await ctx.db
        .query('cardinalNpcState')
        .withIndex('world_profile', (q) => q.eq('worldId', worldId).eq('profileKey', profile.key))
        .unique();
      if (existing) {
        const mappedAgentId = agentByProfileKey.get(profile.key);
        if (!existing.agentId && mappedAgentId) await ctx.db.patch(existing._id, { agentId: mappedAgentId });
        continue;
      }
      await ctx.db.insert('cardinalNpcState', {
        worldId,
        profileKey: profile.key,
        agentId: agentByProfileKey.get(profile.key),
        moodValence: .55,
        energy: .70,
        stress: CARDINAL_INITIAL_STRESS[profile.key] ?? .45,
        trustInTown: CARDINAL_INITIAL_TRUST_IN_TOWN[profile.key] ?? .62,
        lastMeaningfulEventAt: now,
        currentNeed: profile.privateNeed,
        currentGoal: profile.longTermGoal,
      });
      insertedNpcStates++;
    }

    let insertedRelationships = 0;
    for (const seed of CARDINAL_RELATIONSHIP_SEEDS) {
      const existing = await ctx.db
        .query('cardinalRelationships')
        .withIndex('pair', (q) =>
          q.eq('worldId', worldId).eq('fromProfileKey', seed.from).eq('toProfileKey', seed.to),
        )
        .unique();
      if (existing) continue;
      await ctx.db.insert('cardinalRelationships', {
        worldId,
        fromProfileKey: seed.from,
        toProfileKey: seed.to,
        trust: seed.trust,
        affection: seed.affection,
        respect: seed.respect,
        tension: seed.tension,
        familiarity: seed.familiarity,
        updatedAt: now,
        reason: seed.reason,
      });
      insertedRelationships++;
    }

    const existingInitialEvent = await ctx.db
      .query('cardinalEvents')
      .withIndex('world_kind', (q) => q.eq('worldId', worldId).eq('kind', 'system:initial_conditions'))
      .first();

    if (!existingInitialEvent) {
      const week = 7 * 24 * 60 * 60 * 1000;
      for (const event of CARDINAL_INITIAL_EVENTS) {
        await ctx.db.insert('cardinalEvents', {
          worldId, createdAt: now, source: 'world', expiresAt: now + week, ...event,
        });
      }
    }

    return {
      profiles: CARDINAL_NPC_PROFILES.length,
      mappedAgents: agentByProfileKey.size,
      insertedNpcStates,
      insertedRelationships,
    };
  },
});
