import { CARDINAL_NPC_PROFILES } from '../data/cardinalNpcProfiles.js';
import { CARDINAL_RELATIONSHIP_SEEDS } from '../data/cardinalRelationships.js';
import { CARDINAL_INITIAL_EVENTS, CARDINAL_INITIAL_STRESS, CARDINAL_INITIAL_TRUST_IN_TOWN } from '../data/cardinalWorldSeed.js';
import { deriveWorldMetrics } from '../convex/cardinal/metrics.js';
import { chooseCardinalInterventions } from '../convex/cardinal/core.js';

const now = Date.now();
const npcs = CARDINAL_NPC_PROFILES.map((profile) => ({
  profileKey: profile.key,
  stress: CARDINAL_INITIAL_STRESS[profile.key] ?? .45,
  trustInTown: CARDINAL_INITIAL_TRUST_IN_TOWN[profile.key] ?? .62,
  lastMeaningfulEventAt: now,
}));
const relationships = CARDINAL_RELATIONSHIP_SEEDS.map((r) => ({
  fromProfileKey: r.from, toProfileKey: r.to,
  trust: r.trust, affection: r.affection, respect: r.respect, tension: r.tension, familiarity: r.familiarity,
}));
const events = CARDINAL_INITIAL_EVENTS.map((event) => ({ ...event, createdAt: now, expiresAt: now + 7 * 24 * 60 * 60 * 1000 }));
const metrics = deriveWorldMetrics(npcs, relationships, events, now);
const initialInterventions = chooseCardinalInterventions(metrics, { lastInterventionAt: null, recentTypes: [] }, now);

// Escalate a concrete problem instead of lowering Cardinal's restraint threshold just to make a demo fire.
const escalatedEvents = [
  ...events,
  { kind: 'safety:warehouse_attack', summary: 'A warehouse guard was injured during a new theft.', importance: .96, participants: ['daren-holt', 'renna-voss'], createdAt: now + 1, expiresAt: now + 7 * 24 * 60 * 60 * 1000 },
];
const escalatedMetrics = deriveWorldMetrics(npcs, relationships, escalatedEvents, now + 1);
const escalatedInterventions = chooseCardinalInterventions(escalatedMetrics, { lastInterventionAt: null, recentTypes: [] }, now + 1);

console.log(JSON.stringify({ npcCount: npcs.length, relationshipEdges: relationships.length, initial: { metrics, interventions: initialInterventions }, escalated: { metrics: escalatedMetrics, interventions: escalatedInterventions } }, null, 2));
if (npcs.length !== 20) throw new Error(`Expected 20 NPCs, got ${npcs.length}`);
if (relationships.length < 30) throw new Error('Social graph is too sparse for the prototype.');
if (metrics.resourcePressure <= .35) throw new Error('Seeded shortages are not visible to Cardinal.');
if (initialInterventions.length !== 0) throw new Error('Cardinal is too eager: moderate starting pressure should not force intervention.');
if (escalatedInterventions[0]?.type !== 'watch_patrol') throw new Error(`Expected watch_patrol after safety escalation, got ${JSON.stringify(escalatedInterventions)}`);
