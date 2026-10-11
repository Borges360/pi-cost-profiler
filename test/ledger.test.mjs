import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Ledger } from '../ledger.mjs';
test('deduplicates 100 events, preserves unknown costs and task attribution', () => {
  const ledger = new Ledger();
  const msg = {
    role: 'assistant',
    provider: 'p',
    model: 'm',
    timestamp: 42,
    stopReason: 'stop',
    usage: { totalTokens: 3, cost: { total: 0.04 } },
  };
  for (let i = 0; i < 100; i++) ledger.add(msg, 'T-1');
  assert.deepEqual(ledger.report('T-1'), {
    calls: 1,
    tokens: 3,
    unknownUsage: 0,
    estimatedUsd: 0.04,
    unknownPrice: 0,
    billedUsd: null,
    models: ['p/m'],
  });
  ledger.add({ ...msg, timestamp: 43, usage: undefined });
  assert.equal(ledger.report().unknownPrice, 1);
  assert.equal(ledger.report().unknownUsage, 1);
});
