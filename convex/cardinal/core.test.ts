import { strict as assert } from 'node:assert';
import { chooseCardinalInterventions, chooseYuiAction } from './core';

test('Cardinal core interventions and Yui actions', () => {
  const now = 1_000_000;

  assert.equal(
    chooseCardinalInterventions(
      {
        socialIsolation: 0.9,
        unresolvedConflict: 0.2,
        resourcePressure: 0.1,
        safetyPressure: 0.1,
        economicImbalance: 0.1,
        routineStagnation: 0.8,
      },
      { lastInterventionAt: null, recentTypes: [] },
      now,
    )[0]?.type,
    'community_event',
  );

  assert.equal(
    chooseCardinalInterventions(
      {
        socialIsolation: 0.1,
        unresolvedConflict: 0.1,
        resourcePressure: 0.1,
        safetyPressure: 0.1,
        economicImbalance: 0.1,
        routineStagnation: 0.1,
      },
      { lastInterventionAt: null, recentTypes: [] },
      now,
    )[0]?.type,
    'quiet_period',
  );

  assert.equal(
    chooseYuiAction({
      minutesAlone: 180,
      recentLosses: 3,
      repeatedFailures: 5,
      explicitDistress: false,
      lastSupportContactMinutes: null,
      currentlyInDanger: false,
    }).type,
    'offer_company',
  );

  assert.equal(
    chooseYuiAction({
      minutesAlone: 0,
      recentLosses: 0,
      repeatedFailures: 0,
      explicitDistress: false,
      lastSupportContactMinutes: null,
      currentlyInDanger: true,
    }).type,
    'safety_interrupt',
  );
});
