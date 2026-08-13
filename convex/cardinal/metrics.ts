export type NpcMetricInput = {
  profileKey: string;
  stress: number;
  trustInTown: number;
  lastMeaningfulEventAt?: number;
};

export type RelationshipMetricInput = {
  fromProfileKey: string;
  toProfileKey: string;
  trust: number;
  affection: number;
  respect: number;
  tension: number;
  familiarity: number;
};

export type EventMetricInput = {
  kind: string;
  importance: number;
  createdAt: number;
  expiresAt?: number;
};

export type DerivedWorldMetrics = {
  socialIsolation: number;
  unresolvedConflict: number;
  resourcePressure: number;
  safetyPressure: number;
  economicImbalance: number;
  routineStagnation: number;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

function activeImportance(events: EventMetricInput[], prefix: string, now: number): number {
  const values = events
    .filter((e) => e.kind.startsWith(prefix))
    .filter((e) => e.expiresAt === undefined || e.expiresAt > now)
    .map((e) => clamp01(e.importance));
  if (!values.length) return 0;
  // A single serious problem should matter even if several trivial ones exist.
  return clamp01(Math.max(...values) * 0.65 + mean(values) * 0.35);
}

export function deriveWorldMetrics(
  npcs: NpcMetricInput[],
  relationships: RelationshipMetricInput[],
  events: EventMetricInput[],
  now: number,
): DerivedWorldMetrics {
  const socialScores = npcs.map((npc) => {
    const outgoing = relationships.filter((r) => r.fromProfileKey === npc.profileKey);
    if (!outgoing.length) return 1;
    const connection = Math.max(
      ...outgoing.map((r) => clamp01(r.familiarity * 0.45 + r.trust * 0.35 + r.affection * 0.20)),
    );
    return 1 - connection;
  });

  const conflictEdges = relationships.map((r) => clamp01(
    r.tension * 0.7 + (1 - r.trust) * 0.2 + (1 - r.respect) * 0.1,
  ));
  const highConflicts = conflictEdges.filter((v) => v >= 0.45);

  const staleThreshold = 6 * 60 * 60 * 1000;
  const stagnant = npcs.map((npc) => {
    if (!npc.lastMeaningfulEventAt) return 0.55;
    return clamp01((now - npc.lastMeaningfulEventAt) / staleThreshold);
  });

  const stress = mean(npcs.map((n) => clamp01(n.stress)));
  const institutionalDistrust = mean(npcs.map((n) => 1 - clamp01(n.trustInTown)));
  const rawResource = Math.max(activeImportance(events, 'resource:', now), activeImportance(events, 'health:', now) * 0.65);
  const rawSafety = activeImportance(events, 'safety:', now);
  const rawEconomy = activeImportance(events, 'economy:', now);

  return {
    socialIsolation: clamp01(mean(socialScores)),
    unresolvedConflict: clamp01(highConflicts.length ? mean(highConflicts) : mean(conflictEdges) * 0.6),
    resourcePressure: clamp01(rawResource * 0.8 + stress * 0.2),
    safetyPressure: clamp01(rawSafety * 0.85 + institutionalDistrust * 0.15),
    economicImbalance: clamp01(rawEconomy * 0.75 + rawResource * 0.15 + institutionalDistrust * 0.10),
    routineStagnation: clamp01(mean(stagnant)),
  };
}
