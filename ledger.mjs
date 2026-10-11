import { uid, now, hash } from './lib/core.mjs';
const num = (x) => (Number.isFinite(x) && x >= 0 ? x : null);
export function usageFields(u) {
  return {
    inputTokens: num(u?.input),
    outputTokens: num(u?.output),
    cacheReadTokens: num(u?.cacheRead),
    cacheWriteTokens: num(u?.cacheWrite),
    reasoningTokens: num(u?.reasoning),
    totalTokens: num(u?.totalTokens),
  };
}
export function priceEstimate(u, price, { inputIncludesCache = false, local = false } = {}) {
  if (!u || !price) return null;
  const fields = usageFields(u);
  if (fields.inputTokens === null || fields.outputTokens === null) return null;
  const rates = ['input', 'output', 'cacheRead', 'cacheWrite'];
  if (rates.some((k) => num(price[k]) === null) || (rates.every((k) => price[k] === 0) && !local))
    return null;
  const input = inputIncludesCache
    ? Math.max(
        0,
        fields.inputTokens - (fields.cacheReadTokens ?? 0) - (fields.cacheWriteTokens ?? 0),
      )
    : fields.inputTokens;
  return (
    (input * price.input +
      fields.outputTokens * price.output +
      (fields.cacheReadTokens ?? 0) * price.cacheRead +
      (fields.cacheWriteTokens ?? 0) * price.cacheWrite) /
    1e6
  );
}
export function residualUsage(total, knownCalls) {
  const mapping = {
    input: 'inputTokens',
    output: 'outputTokens',
    cacheRead: 'cacheReadTokens',
    cacheWrite: 'cacheWriteTokens',
    reasoning: 'reasoningTokens',
    totalTokens: 'totalTokens',
  };
  const result = {};
  for (const [field, column] of Object.entries(mapping))
    result[field] = Number.isFinite(total?.[field])
      ? Math.max(0, total[field] - knownCalls.reduce((sum, c) => sum + (c[column] ?? 0), 0))
      : undefined;
  result.cost = {
    total: Number.isFinite(total?.cost?.total)
      ? Math.max(
          0,
          total.cost.total - knownCalls.reduce((sum, c) => sum + (c.estimatedCostUsd ?? 0), 0),
        )
      : 0,
  };
  return result;
}
export function callIdentity(m, fallback = uid()) {
  return `${m.provider ?? 'unknown'}/${m.responseId ?? m.providerRequestId ?? m[Symbol.for('pi-suite.call-id')] ?? (m.timestamp != null ? `${m.model}/${m.timestamp}` : fallback)}`;
}
export function summarize(calls, tasks = [], tools = [], events = []) {
  const sum = (field) => calls.reduce((n, r) => n + (r[field] ?? 0), 0);
  const effective = (r) => r.observedCostUsd ?? r.estimatedCostUsd;
  const total = calls.reduce((n, r) => n + (effective(r) ?? 0), 0);
  const latestTasks = new Map();
  for (const t of tasks) latestTasks.set(t.taskId, t);
  const cohort = [...latestTasks.values()];
  const accepted = cohort.filter((t) => t.status === 'accepted');
  const attempted = cohort.filter((t) => t.status !== 'draft');
  return {
    callCount: calls.length,
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    reasoningTokens: calls.some((r) => r.reasoningTokens !== null) ? sum('reasoningTokens') : null,
    totalTokens: sum('totalTokens'),
    estimatedApiCostUSD: sum('estimatedCostUsd'),
    reportedProviderCostUSD: calls.some((r) => r.observedCostUsd !== null)
      ? sum('observedCostUsd')
      : null,
    effectiveCostUSD: total,
    unknownPrice: calls.filter((r) => effective(r) === null).length,
    unknownUsage: calls.filter((r) => r.totalTokens === null).length,
    pricingCoverage: calls.length
      ? calls.filter((r) => effective(r) !== null).length / calls.length
      : null,
    classifierCostUSD: calls
      .filter((r) => r.category === 'classifier')
      .reduce((n, r) => n + (effective(r) ?? 0), 0),
    retryCount: calls.filter((r) => r.reason === 'retry').length,
    retryCostUSD: calls
      .filter((r) => r.reason === 'retry')
      .reduce((n, r) => n + (effective(r) ?? 0), 0),
    wallTimeMs: sum('durationMs'),
    firstTokenLatencyMs: calls.filter((r) => r.firstTokenMs != null).length
      ? sum('firstTokenMs') / calls.filter((r) => r.firstTokenMs != null).length
      : null,
    tokensPerSecond: sum('durationMs') ? sum('outputTokens') / (sum('durationMs') / 1000) : null,
    modelSwitches: calls.filter((r, i) => i > 0 && r.modelId !== calls[i - 1].modelId).length,
    toolCallCount: tools.length,
    mcpToolCalls: tools.filter((t) => t.toolName?.startsWith('mcp__')).length,
    verifiedAcceptanceRate: attempted.length ? accepted.length / attempted.length : null,
    costPerAcceptedTask: accepted.length ? total / accepted.length : null,
    costPerAttempt: new Set(calls.map((c) => c.attemptId).filter(Boolean)).size
      ? total / new Set(calls.map((c) => c.attemptId).filter(Boolean)).size
      : null,
    humanReviewRate: attempted.length
      ? cohort.filter((t) => t.status === 'needs_human_review').length / attempted.length
      : null,
    reworkCostShare: total
      ? calls
          .filter((r) => r.reason === 'retry' || r.rework)
          .reduce((n, r) => n + (effective(r) ?? 0), 0) / total
      : null,
    failureRate: calls.length
      ? calls.filter((r) => ['error', 'aborted', 'unknown'].includes(r.outcome)).length /
        calls.length
      : null,
    localEnergyEstimateUSD: sum('localEnergyEstimateUSD'),
    localDepreciationEstimateUSD: sum('localDepreciationEstimateUSD'),
    opportunityCostEstimateUSD: sum('opportunityCostEstimateUSD'),
    toolInfraCostUSD: tools.reduce((n, r) => n + (r.infraCostUSD ?? 0), 0),
    testRevisions: events.filter((e) => e.kind === 'gate.revision_requested').length,
    loopSuspicions: events.filter((e) => e.kind === 'loop.suspected').length,
    gateStatus: cohort.map((t) => ({ taskId: t.taskId, status: t.status })),
    outcomeConfidence: accepted.length ? 'verified-against-configured-criteria' : null,
    models: [...new Set(calls.map((c) => c.modelId))],
    notAcceptedTasks: cohort.filter((t) => t.status !== 'accepted').map((t) => t.taskId),
  };
}
export function checkBudgets(budgets, calls, reservations, scope, estimate = 0) {
  const effective = (r) => r.observedCostUsd ?? r.estimatedCostUsd ?? 0;
  const decisions = [];
  for (const b of budgets) {
    const scopeId =
      b.scope === 'task' ? scope.taskId : b.scope === 'session' ? scope.sessionId : null;
    if (b.scopeId && b.scopeId !== scopeId) continue;
    const belongs = (r) =>
      b.scope === 'task'
        ? scope.taskId
          ? r.taskId === scope.taskId
          : (r.taskId === null || r.taskId === 'unattributed') && r.sessionId === scope.sessionId
        : b.scope === 'session'
          ? r.sessionId === scope.sessionId
          : true;
    const spent = calls.filter(belongs).reduce((n, r) => n + effective(r), 0);
    const pending = reservations
      .filter((r) => r.active && belongs(r))
      .reduce((n, r) => n + r.estimate, 0);
    const hard = b.hardUsd,
      soft = b.softUsd;
    const denied =
      Number.isFinite(hard) &&
      (estimate === null ||
        calls.some((r) => belongs(r) && r.observedCostUsd == null && r.estimatedCostUsd == null) ||
        spent + pending + estimate > hard ||
        spent >= hard);
    const percent = soft > 0 ? spent / soft : 0;
    decisions.push({
      scope: b.scope,
      locked: !!b.locked,
      spent,
      pending,
      hardUsd: hard ?? null,
      softUsd: soft ?? null,
      denied,
      threshold: percent >= 1 ? 100 : percent >= 0.8 ? 80 : percent >= 0.5 ? 50 : 0,
    });
  }
  return { allow: !decisions.some((d) => d.denied), decisions };
}
export class Ledger {
  constructor() {
    this.calls = new Map();
  }
  add(m, task = null) {
    if (m.role !== 'assistant' || m.stopReason === 'pending') return false;
    const id = callIdentity(m);
    if (this.calls.has(id)) return false;
    const u = m.usage;
    this.calls.set(id, {
      task,
      model: `${m.provider}/${m.model}`,
      tokens: num(u?.totalTokens),
      estimated:
        u && num(u.cost?.total) !== null && (u.cost.total > 0 || u.totalTokens === 0)
          ? u.cost.total
          : null,
      stopReason: m.stopReason,
    });
    return true;
  }
  report(task) {
    const rows = [...this.calls.values()].filter((r) => task === undefined || r.task === task);
    return {
      calls: rows.length,
      tokens: rows.reduce((n, r) => n + (r.tokens ?? 0), 0),
      unknownUsage: rows.filter((r) => r.tokens === null).length,
      estimatedUsd: rows.reduce((n, r) => n + (r.estimated ?? 0), 0),
      unknownPrice: rows.filter((r) => r.estimated === null).length,
      billedUsd: null,
      models: [...new Set(rows.map((r) => r.model))],
    };
  }
}
