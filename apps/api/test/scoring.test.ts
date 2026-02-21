import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSpeed, computeFinalScore, estimateQualityFromContent } from '../src/lib/scoring.js';

test('calculateSpeed clamps into 0..1', () => {
  assert.equal(calculateSpeed(0), 1);
  assert.equal(calculateSpeed(10000), 0);
  assert.equal(calculateSpeed(20000), 0);
});

test('estimateQualityFromContent returns higher score for longer content', () => {
  assert.ok(estimateQualityFromContent('short') < estimateQualityFromContent('x'.repeat(500)));
});

test('computeFinalScore uses 70/30 weights', () => {
  assert.equal(computeFinalScore(0.8, 0.5), 0.71);
});
