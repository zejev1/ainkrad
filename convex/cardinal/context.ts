import { internalQuery } from '../_generated/server';
import { v } from 'convex/values';
import { CARDINAL_NPC_PROFILES } from '../../data/cardinalNpcProfiles';

const profileByKey = new Map(CARDINAL_NPC_PROFILES.map((profile) => [profile.key, profile]));
const profileByName = new Map(CARDINAL_NPC_PROFILES.map((profile) => [profile.name, profile]));

async function resolveProfileForPlayer(ctx: any, worldId: any, playerId: string) {
  const world = await ctx.db.get(worldId);
  if (!world) return null;

  const agent = world.agents.find((item: any) => item.playerId === playerId);
  const description = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q: any) => q.eq('worldId', worldId).eq('playerId', playerId))
    .first();

  let state = null;
  if (agent) {
    state = await ctx.db
      .query('cardinalNpcState')
      .withIndex('world_agent', (q: any) => q.eq('worldId', worldId).eq('agentId', agent.id))
      .first();
  }

  const profile = state
    ? profileByKey.get(state.profileKey)
    : description
      ? profileByName.get(description.name)
      : undefined;

  return profile ? { profile, state, agentId: agent?.id ?? null } : null;
}

async function activeEvents(ctx: any, worldId: any, now: number) {
  const events = await ctx.db
    .query('cardinalEvents')
    .withIndex('world_time', (q: any) => q.eq('worldId', worldId))
    .collect();
  return events
    .filter((event: any) => event.expiresAt === undefined || event.expiresAt > now)
    .sort((a: any, b: any) => b.importance - a.importance || b.createdAt - a.createdAt)
    .slice(0, 4);
}

export const getConversationContext = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId: v.string(),
    otherPlayerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const self = await resolveProfileForPlayer(ctx, args.worldId, args.playerId);
    const other = await resolveProfileForPlayer(ctx, args.worldId, args.otherPlayerId);
    const events = await activeEvents(ctx, args.worldId, now);

    const lines: string[] = [];
    if (self) {
      lines.push(`Your private pressure right now: ${self.profile.currentPressure}`);
      lines.push(`What you actually need beneath the surface: ${self.profile.privateNeed}`);
      if (self.state?.currentGoal) lines.push(`Your current personal goal: ${self.state.currentGoal}`);
      if (self.state) {
        const stress = Math.round(self.state.stress * 100);
        const energy = Math.round(self.state.energy * 100);
        lines.push(
          `Internal state: stress ${stress}/100, energy ${energy}/100. Do not state these numbers aloud; let them influence tone and choices.`,
        );
      }
    }

    if (self && other) {
      const relationship = await ctx.db
        .query('cardinalRelationships')
        .withIndex('pair', (q: any) =>
          q
            .eq('worldId', args.worldId)
            .eq('fromProfileKey', self.profile.key)
            .eq('toProfileKey', other.profile.key),
        )
        .first();
      if (relationship) {
        lines.push(
          `Your relationship with ${other.profile.name}: trust ${Math.round(relationship.trust * 100)}/100, affection ${Math.round(relationship.affection * 100)}/100, tension ${Math.round(relationship.tension * 100)}/100. Let this shape subtext; do not quote the scores.`,
        );
        if (relationship.reason) lines.push(`Why the relationship feels this way: ${relationship.reason}`);
      }
    }

    if (events.length) {
      lines.push('Current town context that may naturally enter the conversation if relevant:');
      for (const event of events) lines.push(`- ${event.summary}`);
    }

    lines.push(
      'Do not behave like a quest dispenser. You may ignore town events when your personality, relationship, or immediate situation makes something else more natural.',
    );
    return lines;
  },
});

function professionActivity(profession: string) {
  const p = profession.toLowerCase();
  if (p.includes('tavern')) return { description: 'getting the tavern ready for the next rush', emoji: '🍲' };
  if (p.includes('blacksmith')) return { description: 'repairing a worn tool', emoji: '🔨' };
  if (p.includes('courier')) return { description: 'checking routes and sorting messages', emoji: '📨' };
  if (p.includes('herbal')) return { description: 'sorting medicinal herbs', emoji: '🌿' };
  if (p.includes('carpenter')) return { description: 'measuring timber for a repair', emoji: '🪚' };
  if (p.includes('teacher') || p.includes('archiv')) return { description: 'organizing notes in the archive', emoji: '📚' };
  if (p.includes('watch')) return { description: 'checking the street and nearby exits', emoji: '🛡️' };
  if (p.includes('baker')) return { description: 'preparing the next batch of bread', emoji: '🥖' };
  if (p.includes('hunter') || p.includes('tracker')) return { description: 'checking tracks near the edge of town', emoji: '🐾' };
  if (p.includes('physician')) return { description: 'restocking basic medical supplies', emoji: '🩺' };
  if (p.includes('fisher') || p.includes('river')) return { description: 'checking ropes and river conditions', emoji: '🎣' };
  if (p.includes('tinker') || p.includes('repair')) return { description: 'taking apart a stubborn broken mechanism', emoji: '⚙️' };
  if (p.includes('tailor')) return { description: 'mending a piece of clothing', emoji: '🧵' };
  if (p.includes('merchant')) return { description: 'reviewing prices and deliveries', emoji: '🧾' };
  if (p.includes('farmer')) return { description: 'checking the day’s crops and tools', emoji: '🌾' };
  if (p.includes('builder') || p.includes('mason')) return { description: 'inspecting a public repair', emoji: '🧱' };
  if (p.includes('inn')) return { description: 'tidying a room for a traveler', emoji: '🛏️' };
  return { description: `doing a little ${profession} work`, emoji: '🧭' };
}

export const getActivityHint = internalQuery({
  args: { worldId: v.id('worlds'), playerId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const resolved = await resolveProfileForPlayer(ctx, args.worldId, args.playerId);
    if (!resolved) return null;
    const events = await activeEvents(ctx, args.worldId, now);
    const intervention = events.find((event: any) => event.kind.startsWith('intervention:'));

    let activity = professionActivity(resolved.profile.profession);
    if (intervention?.kind === 'intervention:community_event') {
      activity = { description: 'helping prepare a small community gathering', emoji: '🎏' };
    } else if (intervention?.kind === 'intervention:resource_relief') {
      activity = { description: 'sorting supplies so nothing useful is wasted', emoji: '📦' };
    } else if (intervention?.kind === 'intervention:trade_opportunity') {
      activity = { description: 'checking what the town could trade or spare', emoji: '⚖️' };
    } else if (
      intervention?.kind === 'intervention:watch_patrol' &&
      resolved.profile.profession.toLowerCase().includes('watch')
    ) {
      activity = { description: 'making an extra patrol through the busiest street', emoji: '🛡️' };
    } else if (intervention?.kind === 'intervention:rumor_seed') {
      activity = { description: 'quietly thinking over a rumor that does not quite add up', emoji: '💭' };
    }

    const habit = resolved.profile.habits[Math.floor(now / 60_000) % resolved.profile.habits.length];
    const useHabit = Math.floor(now / 60_000) % 3 === 0;
    return {
      description: useHabit ? habit : activity.description,
      emoji: useHabit ? '✨' : activity.emoji,
      duration: 60_000 + (Math.floor(now / 10_000) % 4) * 15_000,
    };
  },
});
