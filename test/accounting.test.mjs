import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { priceEstimate, usageFields, summarize, checkBudgets } from '../ledger.mjs';
test('cache accounting no double count, zero unknown vs explicitly local', () => {
  const u = { input: 100, output: 10, cacheRead: 40, cacheWrite: 20 };
  const p = { input: 2, output: 4, cacheRead: 1, cacheWrite: 3 };
  assert.equal(priceEstimate(u, p, { inputIncludesCache: true }), 0.00022);
  assert.equal(priceEstimate(u, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), null);
  assert.equal(
    priceEstimate(u, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, { local: true }),
    0,
  );
  assert.equal(usageFields(undefined).inputTokens, null);
});
test('bill precedence, accepted cohort and zero denominators', () => {
  const rows = [
    {
      taskId: 'T1',
      estimatedCostUsd: 1,
      observedCostUsd: 0.5,
      category: 'classifier',
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
      outcome: 'stop',
      modelId: 'm',
    },
    {
      taskId: 'T2',
      estimatedCostUsd: 2,
      observedCostUsd: null,
      reason: 'retry',
      outcome: 'error',
      modelId: 'm',
    },
  ];
  const r = summarize(rows, [
    { taskId: 'T1', status: 'accepted' },
    { taskId: 'T2', status: 'rejected' },
  ]);
  assert.equal(r.effectiveCostUSD, 2.5);
  assert.equal(r.costPerAcceptedTask, 2.5);
  assert.equal(r.verifiedAcceptanceRate, 0.5);
  assert.equal(r.classifierCostUSD, 0.5);
  assert.equal(summarize([]).costPerAcceptedTask, null);
});
test('all scopes compose: loose task budget cannot relax locked/project, reservations counted', () => {
  const b = [
    { scope: 'project', hardUsd: 1, locked: true },
    { scope: 'task', hardUsd: 10 },
  ];
  const calls = [{ taskId: 'T', estimatedCostUsd: 0.8, observedCostUsd: null }];
  assert.equal(checkBudgets(b, calls, [], { taskId: 'T' }, 0.3).allow, false);
  assert.equal(
    checkBudgets(b, calls, [{ active: true, estimate: 0.15 }], { taskId: 'T' }, 0.1).allow,
    false,
  );
  assert.equal(checkBudgets(b, calls, [], { taskId: 'T' }, null).allow, false);
});
