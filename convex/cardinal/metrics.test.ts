import { strict as assert } from 'node:assert';
import { deriveWorldMetrics } from './metrics';

const now = 1_000_000_000;
const npcs = [
  { profileKey: 'a', stress: .6, trustInTown: .6, lastMeaningfulEventAt: now - 60_000 },
  { profileKey: 'b', stress: .4, trustInTown: .7, lastMeaningfulEventAt: now - 60_000 },
];
const relationships = [
  { fromProfileKey: 'a', toProfileKey: 'b', trust: .8, affection: .7, respect: .8, tension: .1, familiarity: .9 },
  { fromProfileKey: 'b', toProfileKey: 'a', trust: .8, affection: .7, respect: .8, tension: .1, familiarity: .9 },
];
const stable = deriveWorldMetrics(npcs, relationships, [], now);
assert.ok(stable.socialIsolation < .4);
assert.ok(stable.unresolvedConflict < .4);
const pressured = deriveWorldMetrics(npcs, relationships, [
  { kind: 'resource:food', importance: .9, createdAt: now },
  { kind: 'safety:theft', importance: .8, createdAt: now },
], now);
assert.ok(pressured.resourcePressure > stable.resourcePressure);
assert.ok(pressured.safetyPressure > stable.safetyPressure);
console.log('Cardinal metrics tests passed');
