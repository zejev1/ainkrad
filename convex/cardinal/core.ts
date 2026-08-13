export type WorldMetrics = {
  socialIsolation: number;
  unresolvedConflict: number;
  resourcePressure: number;
  safetyPressure: number;
  economicImbalance: number;
  routineStagnation: number;
};

export type CardinalInterventionType =
  | 'community_event'
  | 'trade_opportunity'
  | 'resource_relief'
  | 'watch_patrol'
  | 'rumor_seed'
  | 'quiet_period';

export type CardinalIntervention = {
  type: CardinalInterventionType;
  reason: string;
  intensity: number;
  ttlMinutes: number;
};

export type DirectorState = {
  lastInterventionAt: number | null;
  recentTypes: CardinalInterventionType[];
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function normalizeMetrics(metrics: WorldMetrics): WorldMetrics {
  return {
    socialIsolation: clamp01(metrics.socialIsolation),
    unresolvedConflict: clamp01(metrics.unresolvedConflict),
    resourcePressure: clamp01(metrics.resourcePressure),
    safetyPressure: clamp01(metrics.safetyPressure),
    economicImbalance: clamp01(metrics.economicImbalance),
    routineStagnation: clamp01(metrics.routineStagnation),
  };
}

export function chooseCardinalInterventions(
  rawMetrics: WorldMetrics,
  state: DirectorState,
  now: number,
): CardinalIntervention[] {
  const metrics = normalizeMetrics(rawMetrics);
  const cooldownMs = 10 * 60 * 1000;
  if (state.lastInterventionAt !== null && now - state.lastInterventionAt < cooldownMs) return [];

  const candidates: Array<{ score: number; intervention: CardinalIntervention }> = [
    {
      score: metrics.socialIsolation * 0.7 + metrics.routineStagnation * 0.3,
      intervention: {
        type: 'community_event',
        reason: 'Too many residents are socially disconnected and daily routines are becoming repetitive.',
        intensity: clamp01(metrics.socialIsolation),
        ttlMinutes: 180,
      },
    },
    {
      score: metrics.resourcePressure * 0.75 + metrics.economicImbalance * 0.25,
      intervention: {
        type: 'resource_relief',
        reason: 'Essential resource pressure is high enough to create cascading failures.',
        intensity: clamp01(metrics.resourcePressure),
        ttlMinutes: 240,
      },
    },
    {
      score: metrics.economicImbalance * 0.7 + metrics.resourcePressure * 0.3,
      intervention: {
        type: 'trade_opportunity',
        reason: 'Trade is too concentrated and the world needs another legitimate path for goods to circulate.',
        intensity: clamp01(metrics.economicImbalance),
        ttlMinutes: 360,
      },
    },
    {
      score: metrics.safetyPressure,
      intervention: {
        type: 'watch_patrol',
        reason: 'Risk has increased beyond what ordinary routines are absorbing safely.',
        intensity: clamp01(metrics.safetyPressure),
        ttlMinutes: 120,
      },
    },
    {
      score: metrics.unresolvedConflict * 0.65 + metrics.routineStagnation * 0.35,
      intervention: {
        type: 'rumor_seed',
        reason: 'A small piece of non-authoritative public information may force unresolved tensions into conversation.',
        intensity: clamp01(metrics.unresolvedConflict * 0.6),
        ttlMinutes: 90,
      },
    },
  ];

  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.find(
    ({ score, intervention }) => score >= 0.62 && !state.recentTypes.slice(-2).includes(intervention.type),
  );

  if (!chosen) {
    if (Math.max(...Object.values(metrics)) < 0.35) {
      return [{
        type: 'quiet_period',
        reason: 'The world is stable. Cardinal should avoid manufacturing drama simply because it can.',
        intensity: 0,
        ttlMinutes: 120,
      }];
    }
    return [];
  }

  return [chosen.intervention];
}

export type PlayerSignals = {
  minutesAlone: number;
  recentLosses: number;
  repeatedFailures: number;
  explicitDistress: boolean;
  lastSupportContactMinutes: number | null;
  currentlyInDanger: boolean;
};

export type YuiAction =
  | { type: 'observe'; reason: string }
  | { type: 'offer_company'; reason: string }
  | { type: 'check_in'; reason: string }
  | { type: 'suggest_break'; reason: string }
  | { type: 'safety_interrupt'; reason: string };

export function chooseYuiAction(signals: PlayerSignals): YuiAction {
  if (signals.currentlyInDanger) {
    return { type: 'safety_interrupt', reason: 'Immediate in-world danger outranks social subtlety.' };
  }

  if (signals.explicitDistress) {
    return { type: 'check_in', reason: 'The player explicitly expressed distress; ask what they want rather than diagnosing them.' };
  }

  const supportRecent = signals.lastSupportContactMinutes !== null && signals.lastSupportContactMinutes < 30;
  if (supportRecent) return { type: 'observe', reason: 'Yui already made contact recently; avoid becoming intrusive.' };

  const strain =
    Math.min(signals.minutesAlone / 120, 1) * 0.35 +
    Math.min(signals.recentLosses / 3, 1) * 0.35 +
    Math.min(signals.repeatedFailures / 5, 1) * 0.30;

  if (strain >= 0.72) return { type: 'offer_company', reason: 'Several non-clinical strain signals overlap; offer presence without labeling the player.' };
  if (signals.repeatedFailures >= 4) return { type: 'suggest_break', reason: 'Repeated failures can make play less useful; suggest a pause, not a diagnosis.' };
  return { type: 'observe', reason: 'No strong reason to interrupt the player.' };
}
