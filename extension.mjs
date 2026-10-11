import {
  createRuntime,
  scopeOf,
  setTask,
  output,
  usageText,
  buildCompletions,
  words,
  uid,
  now,
  hash,
  safePath,
  atomicJson,
  redact,
} from './lib/core.mjs';
import {
  usageFields,
  priceEstimate,
  callIdentity,
  summarize,
  checkBudgets,
  residualUsage,
} from './ledger.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export const defaults = {
  costProfiler: {
    enabled: true,
    priceCatalogTtlHours: 24,
    warnUnknownPricing: true,
    budgets: {},
    localModels: [],
    localEnergyUsdPerHour: 0,
    localDepreciationUsdPerHour: 0,
    opportunityUsdPerHour: 0,
    inputIncludesCache: false,
    maxRequestOutputTokens: 2048,
  },
};
export default function profiler(pi, makeStream) {
  const rt = createRuntime(pi, 'cost', defaults),
    wrapped = new Map(),
    started = new Map(),
    reportedByRoot = new Map(),
    warnings = new Set();
  const activeRoot = () => {
    const ids = [...new Set([...started.values()].map((v) => v.root))];
    return ids.length === 1 ? ids[0] : null;
  };
  let directCategory = null,
    retry = false,
    lastRoute = null,
    previousModel = null;
  const budgets = async (scope) => {
    const conf = rt.config.costProfiler;
    const entries = Object.entries(conf.budgets ?? {}).map(([key, b]) => ({
      ...b,
      scope: ['project', 'task', 'session'].includes(key) ? key : 'project',
      locked: key === 'locked',
    }));
    const latest = new Map();
    for (const b of await rt.store.rows('budgets')) latest.set(`${b.scope}/${b.scopeId}`, b);
    return [...entries, ...latest.values()];
  };
  const allCalls = async () => {
    const reconciled = new Map(
      (await rt.store.rows('reconciliations')).map((r) => [r.providerRequestId, r.observedCostUsd]),
    );
    return (await rt.store.rows('model-calls')).map((r) =>
      reconciled.has(r.providerRequestId)
        ? { ...r, observedCostUsd: reconciled.get(r.providerRequestId) }
        : r,
    );
  };
  const reserve = async (model, context, options, id) => {
    if (!rt.config?.costProfiler)
      throw Error(
        'Cost policy configuration invalid; fix configuration and reload before dispatch',
      );
    const scope = scopeOf(rt.ctx),
      conf = rt.config.costProfiler;
    const applicable = await budgets(scope);
    const financial = applicable.some(
      (b) =>
        Number.isFinite(b.hardUsd) &&
        (!b.scopeId || b.scopeId === (b.scope === 'task' ? scope.taskId : scope.sessionId)),
    );
    const cap = financial || conf.capOutput === true;
    const maxOutputTokens = cap
      ? Math.min(options?.maxTokens ?? conf.maxRequestOutputTokens, conf.maxRequestOutputTokens)
      : undefined;
    const local = conf.localModels.includes(`${model.provider}/${model.id}`);
    const input = Math.ceil(JSON.stringify(context).length / 4);
    const fixed =
      rt.config.modelEconomist?.classifier?.decisionPrices?.[`${model.provider}/${model.id}`];
    const estimate =
      model.type === 'classifier' && Number.isFinite(fixed)
        ? fixed
        : priceEstimate(
            {
              input,
              output:
                maxOutputTokens ??
                options?.maxTokens ??
                model.maxTokens ??
                conf.maxRequestOutputTokens,
              cacheRead: 0,
              cacheWrite: 0,
            },
            model.cost,
            { local },
          );
    const store = rt.store;
    try {
      await store.lock(async () => {
        const active = new Map();
        for (const row of await store.rows('reservations')) active.set(row.reservationId, row);
        const checked = checkBudgets(
          await budgets(scope),
          await allCalls(),
          [...active.values()],
          scope,
          estimate,
        );
        if (!checked.allow)
          throw Error(
            'Pi cost budget: new request denied before provider dispatch (unknown price or hard limit).',
          );
        await store.appendUnlocked('reservations', {
          id: uid(),
          reservationId: id,
          active: true,
          estimate: estimate ?? 0,
          ...scope,
          occurredAt: now(),
        });
        for (const d of checked.decisions)
          if (
            d.threshold &&
            !warnings.has(`${d.scope}/${d.threshold}/${scope.taskId ?? scope.sessionId}`)
          ) {
            warnings.add(`${d.scope}/${d.threshold}/${scope.taskId ?? scope.sessionId}`);
            output(rt.ctx, `Budget ${d.scope}: ${d.threshold}% soft threshold reached`, 'warning');
          }
      });
      return { scope, estimate, local, maxOutputTokens };
    } catch (error) {
      if (financial || conf.auditRequired || /budget:.*denied/.test(error.message)) throw error;
      output(
        rt.ctx,
        `Informational cost tracking unavailable: ${error.message}; provider execution preserved`,
        'warning',
      );
      return { scope, estimate, local, maxOutputTokens, untracked: true };
    }
  };
  const record = async (message, meta = {}) => {
    if (!rt.store || message.budgetBlocked) return;
    const scope = meta.scope ?? scopeOf(rt.ctx),
      modelId = `${message.provider ?? meta.provider}/${message.model ?? meta.model}`,
      key = callIdentity(
        {
          ...message,
          [Symbol.for('pi-suite.call-id')]: message[Symbol.for('pi-suite.call-id')],
          provider: message.provider ?? meta.provider,
          model: message.model ?? meta.model,
        },
        meta.id,
      );
    if ((await rt.store.rows('model-calls')).some((r) => r.id === key)) {
      if (meta.id)
        await rt.store.append('reservations', {
          id: uid(),
          reservationId: meta.id,
          active: false,
          ...scope,
        });
      return;
    }
    const model = meta.modelObject ?? rt.ctx.modelRegistry.find(message.provider, message.model);
    const price = model?.cost;
    const priceSnapshotId = price
      ? hash({
          modelId,
          price,
          period: Math.floor(Date.now() / (rt.config.costProfiler.priceCatalogTtlHours * 3600000)),
        })
      : null;
    if (price)
      await rt.store.append('pricing-snapshots', {
        id: priceSnapshotId,
        modelId,
        price,
        currency: 'USD',
        source: 'pi-catalogue',
        effectiveFrom: now(),
        expiresAt: new Date(
          Date.now() + rt.config.costProfiler.priceCatalogTtlHours * 3600000,
        ).toISOString(),
      });
    const u =
      message.usage?.totalTokens === 0 &&
      (['error', 'aborted', 'deferred'].includes(message.stopReason) || message.content?.length > 0)
        ? null
        : message.usage;
    const calculated = priceEstimate(u, price, {
      inputIncludesCache: rt.config.costProfiler.inputIncludesCache,
      local: meta.local,
    });
    const estimated = meta.local
      ? 0
      : (calculated ??
        (Number.isFinite(u?.cost?.total) && u.cost.total > 0
          ? u.cost.total
          : meta.category === 'classifier' && Number.isFinite(meta.estimate)
            ? meta.estimate
            : null));
    const durationMs = meta.durationMs ?? message.durationMs ?? null;
    const row = {
      id: key,
      projectId: rt.projectId,
      providerRequestId: message.responseId ?? message.providerRequestId ?? meta.id ?? null,
      ...scope,
      taskId: scope.taskId ?? 'unattributed',
      provider: message.provider ?? meta.provider,
      modelId,
      kind: meta.kind ?? lastRoute?.assessment?.kind ?? 'unknown',
      toolRootId: meta.toolRootId ?? null,
      category: meta.category ?? 'executor',
      reason: meta.reason ?? 'user',
      outcome: message.stopReason ?? 'unknown',
      ...usageFields(u),
      estimatedCostUsd: estimated,
      observedCostUsd: meta.observedCostUsd ?? null,
      priceSnapshotId,
      startedAt: meta.startedAt ?? new Date(message.timestamp ?? Date.now()).toISOString(),
      finishedAt: now(),
      occurredAt: now(),
      durationMs,
      firstTokenMs: meta.firstTokenMs ?? null,
      localEnergyEstimateUSD:
        meta.local && durationMs
          ? (durationMs / 3600000) * rt.config.costProfiler.localEnergyUsdPerHour
          : null,
      localDepreciationEstimateUSD:
        meta.local && durationMs
          ? (durationMs / 3600000) * rt.config.costProfiler.localDepreciationUsdPerHour
          : null,
      opportunityCostEstimateUSD: durationMs
        ? (durationMs / 3600000) * rt.config.costProfiler.opportunityUsdPerHour
        : null,
    };
    if (
      row.estimatedCostUsd === null &&
      row.observedCostUsd === null &&
      rt.config.costProfiler.warnUnknownPricing &&
      !warnings.has('price:' + modelId)
    ) {
      warnings.add('price:' + modelId);
      output(rt.ctx, `Unknown API price/usage: ${modelId}. /cost now for coverage.`, 'warning');
    }
    if (await rt.store.append('model-calls', row)) {
      if (row.category === 'executor') {
        if (previousModel && previousModel !== modelId)
          await rt.emit('cache.model_switched', {
            previousModel,
            modelId,
            reportedCacheReadTokens: row.cacheReadTokens,
            cacheMissCostUsd: null,
            note: 'Cache boundary changed; no exact miss cost inferred',
          });
        previousModel = modelId;
      }
      await rt.emit('model.call_completed', { ...row, callId: key }, `call:${key}`);
    }
    const financial = checkBudgets(await budgets(scope), await allCalls(), [], scope, 0);
    for (const decision of financial.decisions) {
      const key = `${decision.scope}/${decision.threshold}/${scope.taskId ?? scope.sessionId}`;
      if (decision.threshold && !warnings.has(key)) {
        warnings.add(key);
        await rt.emit('budget.threshold_crossed', decision);
        output(
          rt.ctx,
          `Budget ${decision.scope}: ${decision.threshold}% soft threshold reached`,
          'warning',
        );
      }
    }
    if (meta.id)
      await rt.store.append('reservations', {
        id: uid(),
        reservationId: meta.id,
        active: false,
        ...scope,
      });
  };
  const wrap = (ctx) => {
    if (!makeStream || rt.config?.costProfiler?.enabled === false) return;
    const ids = new Set(
      [...ctx.modelRegistry.getAll(), ...ctx.modelRegistry.getModelsOfType('classifier')]
        .filter((m) => m.api !== 'pi-virtual')
        .map((m) => m.provider),
    );
    for (const id of ids) {
      if (wrapped.has(id)) continue;
      const original = ctx.modelRegistry.getProvider(id);
      if (!original) continue;
      const oldNative = ctx.modelRegistry.getRegisteredNativeProvider?.(id),
        oldConfig = ctx.modelRegistry.getRegisteredProviderConfig?.(id);
      const provider = {
        id: original.id,
        name: original.name,
        auth: original.auth,
        baseUrl: original.baseUrl,
        headers: original.headers,
      };
      for (const method of [
        'getModels',
        'getAllModels',
        'refreshModels',
        'filterModels',
        'filterAllModels',
        'fetchDeferred',
        'cancelDeferred',
      ])
        if (original[method]) provider[method] = original[method].bind(original);
      const stream =
        (method) =>
        (model, context, options = {}) => {
          const out = makeStream();
          const call = uid(),
            start = Date.now(),
            scope = scopeOf(ctx),
            toolRootId = activeRoot(),
            category = directCategory ?? (toolRootId || ctx.isIdle() ? 'auxiliary' : 'executor'),
            reason =
              category !== 'executor'
                ? 'direct'
                : retry
                  ? 'retry'
                  : (lastRoute?.reason ??
                    ([...context.messages].reverse().find((m) => m.role !== 'system')?.role ===
                    'toolResult'
                      ? 'continuation'
                      : 'user'));
          retry = false;
          (async () => {
            let reservation,
              firstTokenMs = null,
              observedCostUsd = null;
            try {
              reservation = await reserve(model, context, options, call);
              const instrumented = {
                ...options,
                maxTokens: reservation.maxOutputTokens ?? options.maxTokens,
                onProviderStreamEvent: async (data, m) => {
                  const cost = data?.usage?.cost ?? data?.response?.usage?.cost;
                  if (Number.isFinite(cost) && cost >= 0) observedCostUsd = cost;
                  await options.onProviderStreamEvent?.(data, m);
                },
              };
              const source = original[method](model, context, instrumented);
              let final;
              let terminal;
              for await (const e of source) {
                if (firstTokenMs === null && e.type.endsWith('_delta'))
                  firstTokenMs = Date.now() - start;
                if (e.type === 'done') {
                  final = e.message;
                  terminal = e;
                } else if (e.type === 'error') {
                  final = e.error;
                  terminal = e;
                } else out.push(e);
              }
              if (
                !terminal ||
                !final ||
                !['stop', 'length', 'toolUse', 'error', 'aborted', 'deferred'].includes(
                  final.stopReason,
                )
              )
                throw Error('provider_failure: stream ended without terminal finish_reason');
              Object.defineProperty(final, Symbol.for('pi-suite.call-id'), {
                value: call,
                configurable: true,
              });
              try {
                await record(final, {
                  ...reservation,
                  id: call,
                  modelObject: model,
                  category,
                  reason,
                  durationMs: Date.now() - start,
                  firstTokenMs,
                  observedCostUsd,
                });
              } catch (error) {
                output(
                  ctx,
                  `Cost journal unavailable: ${error.message}; usage coverage incomplete`,
                  'error',
                );
              }
              if (terminal) out.push(terminal);
              out.end(final);
            } catch (error) {
              const m = {
                role: 'assistant',
                api: model.api,
                provider: model.provider,
                model: model.id,
                timestamp: start,
                content: [],
                stopReason: 'error',
                budgetBlocked: !reservation,
                errorMessage: redact(error.message),
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
              };
              if (reservation) {
                try {
                  await record(m, {
                    ...reservation,
                    id: call,
                    toolRootId,
                    modelObject: model,
                    category,
                    reason,
                    durationMs: Date.now() - start,
                  });
                } catch (error) {
                  output(ctx, `Cost journal unavailable: ${error.message}`, 'error');
                }
              }
              out.push({ type: 'error', reason: 'error', error: m });
              out.end(m);
            }
          })().catch((error) => output(ctx, error.message, 'error'));
          return out;
        };
      Object.defineProperty(provider, 'stream', { value: stream('stream') });
      Object.defineProperty(provider, 'streamSimple', { value: stream('streamSimple') });
      for (const method of ['classify', 'generateImages'])
        if (original[method])
          Object.defineProperty(provider, method, {
            value: async (model, context, options = {}) => {
              const call = uid(),
                start = Date.now(),
                toolRootId = activeRoot();
              let reservation;
              try {
                reservation = await reserve(model, context, options, call);
                const result = await original[method](model, context, options);
                Object.defineProperty(result, Symbol.for('pi-suite.call-id'), {
                  value: call,
                  configurable: true,
                });
                try {
                  await record(result, {
                    ...reservation,
                    id: call,
                    toolRootId,
                    provider: model.provider,
                    model: model.id,
                    modelObject: model,
                    category: method === 'classify' ? 'classifier' : 'image',
                    reason: 'direct',
                    durationMs: Date.now() - start,
                  });
                } catch (error) {
                  output(ctx, `Auxiliary cost journal unavailable: ${error.message}`, 'error');
                }
                return result;
              } catch (e) {
                if (reservation)
                  await rt.store.append('reservations', {
                    id: uid(),
                    reservationId: call,
                    active: false,
                    ...reservation.scope,
                  });
                return {
                  provider: model.provider,
                  model: model.id,
                  stopReason: 'error',
                  errorMessage: redact(e.message),
                  answers: {},
                  usage: undefined,
                };
              }
            },
          });
      pi.registerProvider(provider);
      wrapped.set(id, { oldNative, oldConfig, installed: provider });
    }
  };
  const initialize = async (ctx) => {
    try {
      await rt.init(ctx);
    } catch (error) {
      wrap(ctx);
      output(ctx, `Cost configuration invalid; dispatch will be denied: ${error.message}`, 'error');
      return;
    }
    wrap(ctx);
  };
  pi.on('session_start', async (_e, ctx) => {
    previousModel = null;
    await initialize(ctx);
  });
  pi.on('before_agent_start', async (_e, ctx) => {
    await initialize(ctx);
  });
  pi.on('session_before_compact', () => {
    directCategory = 'compaction';
  });
  pi.on('session_compact', () => {
    directCategory = null;
  });
  pi.on('session_compact_failed', () => {
    directCategory = null;
  });
  pi.on('message_end', async (e, ctx) => {
    await rt.init(ctx);
    if (rt.config.costProfiler.enabled && e.message.role === 'assistant') {
      retry = e.message.stopReason === 'error';
      await record(e.message);
    }
  });
  const unsub = rt.listen(async (e) => {
    if (e.kind === 'model.routed') lastRoute = e.payload;
    if (e.kind === 'model.call_completed' && e.source !== 'cost') {
      const p = e.payload;
      if (!p.provider || !p.model) return;
      await record(
        {
          provider: p.provider,
          model: p.model,
          providerRequestId: p.callId,
          usage: p.usage,
          stopReason: p.stopReason,
        },
        { id: p.callId, category: p.category, reason: 'direct', durationMs: p.durationMs },
      );
    }
    if (e.kind === 'gate.evaluated') {
      await rt.store.append('outcomes', {
        id: e.id,
        taskId: e.taskId,
        sessionId: e.sessionId,
        kind: lastRoute?.assessment?.kind ?? 'unknown',
        model: lastRoute?.selectedModelId ?? null,
        verified: e.payload.verified,
        accepted: e.payload.status === 'accepted',
        durationMs: (await rt.store.rows('model-calls'))
          .filter((c) => c.taskId === e.taskId)
          .reduce((n, c) => n + (c.durationMs ?? 0), 0),
        occurredAt: now(),
      });
    }
  });
  pi.on('tool_execution_start', (e) => {
    if (rt.config?.costProfiler.enabled)
      started.set(e.toolCallId, {
        at: Date.now(),
        root: e.parentToolCallId
          ? (started.get(e.parentToolCallId)?.root ?? e.parentToolCallId)
          : e.toolCallId,
      });
  });
  pi.on('tool_result', (e) => {
    if (!rt.config?.costProfiler.enabled || !e.usage) return;
    const root = started.get(e.toolCallId)?.root ?? e.parentToolCallId ?? e.toolCallId;
    const parts = reportedByRoot.get(root) ?? new Map();
    parts.set(e.toolCallId, e.usage);
    reportedByRoot.set(root, parts);
  });
  pi.on('tool_execution_end', async (e, ctx) => {
    await rt.init(ctx);
    if (!rt.config.costProfiler.enabled) return;
    await rt.store.append('tool-calls', {
      id: `${scopeOf(ctx).sessionId}/${e.toolCallId}`,
      ...scopeOf(ctx),
      toolCallId: e.toolCallId,
      parentToolCallId: e.parentToolCallId ?? null,
      toolName: e.toolName,
      infraCostUSD: rt.config.costProfiler.toolInfraCostsUSD?.[e.toolName] ?? null,
      isError: e.isError,
      durationMs: e.durationMs ?? Date.now() - (started.get(e.toolCallId)?.at ?? Date.now()),
      occurredAt: now(),
    });
    const span = started.get(e.toolCallId);
    started.delete(e.toolCallId);
    if (!e.parentToolCallId) {
      const parts = reportedByRoot.get(e.toolCallId);
      if (!parts && e.result?.usage)
        reportedByRoot.set(e.toolCallId, new Map([[e.toolCallId, e.result.usage]]));
      const usages = [...(reportedByRoot.get(e.toolCallId)?.values() ?? [])];
      reportedByRoot.delete(e.toolCallId);
      if (usages.length) {
        const total = { cost: { total: 0 } };
        for (const u of usages) {
          for (const key of [
            'input',
            'output',
            'cacheRead',
            'cacheWrite',
            'reasoning',
            'totalTokens',
          ])
            if (Number.isFinite(u[key])) total[key] = (total[key] ?? 0) + u[key];
          total.cost.total += u.cost?.total ?? 0;
        }
        const rows = await allCalls();
        const known = rows.filter((c) => c.toolRootId === e.toolCallId);
        const unowned = rows.some(
          (c) =>
            c.toolRootId === null &&
            c.category !== 'executor' &&
            Date.parse(c.startedAt) >= (span?.at ?? Date.now()) &&
            Date.parse(c.finishedAt) <= Date.now(),
        );
        const usage = unowned ? null : residualUsage(total, known);
        if (unowned || (usage?.totalTokens ?? 0) > 0 || usage?.cost?.total > 0)
          await record(
            {
              provider: 'tool',
              model: e.toolName,
              providerRequestId: e.toolCallId,
              usage,
              stopReason: unowned ? 'unknown' : e.isError ? 'error' : 'stop',
            },
            { category: 'tool-auxiliary', reason: 'direct' },
          );
        if (unowned)
          await rt.emit('cost.usage_attribution_uncertain', {
            toolCallId: e.toolCallId,
            reason: 'Parallel unowned provider calls; raw totals preserved without double charging',
            reportedUsage: total,
          });
      }
    }
  });
  pi.on('session_shutdown', async () => {
    unsub?.();
    for (const [id, old] of wrapped) {
      const current = rt.ctx?.modelRegistry.getRegisteredNativeProvider?.(id);
      if (current && current !== old.installed) continue;
      pi.unregisterProvider(id);
      if (old.oldNative) pi.registerProvider(old.oldNative);
      else if (old.oldConfig) pi.registerProvider(id, old.oldConfig);
    }
    wrapped.clear();
    await rt.dispose();
  });
  const LEVELS = [
    { value: 'task', description: 'cap the selected task' },
    { value: 'session', description: 'cap this session only' },
    { value: 'project', description: 'cap everything in this repository' },
  ];
  const LEVEL_IDS = LEVELS.map((l) => l.value);
  const WINDOWS = [
    { value: '7d', description: 'last week' },
    { value: '30d', description: 'last month (default)' },
    { value: '90d', description: 'last quarter' },
  ];
  const WINDOW_IDS = WINDOWS.map((w) => w.value);
  /** Task IDs with recorded spend, most recent first. */
  const knownTasks = async () => {
    try {
      const rows = await rt.store.rows('tasks');
      const seen = new Map();
      for (const r of rows)
        if (r.taskId && !seen.has(r.taskId)) seen.set(r.taskId, r.occurredAt ?? '');
      return [...seen.entries()]
        .sort((a, b) => (a[1] < b[1] ? 1 : -1))
        .slice(0, 40)
        .map(([id, at]) => ({ value: id, label: id, description: at ? at.slice(0, 10) : '' }));
    } catch {
      return [];
    }
  };
  /** Models actually seen in this project, for `compare`. */
  const knownModels = async () => {
    try {
      const calls = await allCalls();
      const seen = new Map();
      for (const c of calls) {
        if (!c.modelId) continue;
        const prev = seen.get(c.modelId) ?? { usd: 0, n: 0 };
        seen.set(c.modelId, {
          usd: prev.usd + Number(c.estimatedCostUsd ?? c.observedCostUsd ?? 0),
          n: prev.n + 1,
        });
      }
      return [...seen.entries()]
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, 40)
        .map(([id, s]) => ({
          value: id,
          label: id,
          description: `${s.n} call(s) · $${s.usd.toFixed(4)} known`,
        }));
    } catch {
      return [];
    }
  };
  const costSpec = {
    name: 'cost',
    description: 'Cost accounting, budgets and exports per task/project',
    actions: {
      now: { hint: '', description: 'this session spend and coverage' },
      task: {
        hint: 'TASK-ID',
        description: 'select a task and report its spend',
        args: [{ provide: knownTasks, hint: 'task id' }],
      },
      project: {
        hint: '[--last Nd]',
        description: 'project window totals',
        flags: {
          '--last': {
            values: WINDOWS,
            hint: '7d|30d|90d',
          },
        },
      },
      compare: {
        hint: 'MODEL MODEL [--kind K]',
        description: 'cost/acceptance per model cohort',
        args: [{ provide: knownModels, hint: 'provider/model', advance: true }, { provide: knownModels, hint: 'provider/model' }],
        flags: { '--kind': { hint: 'request kind' } },
      },
      budget: {
        hint: 'LEVEL N USD',
        description: 'set a limit (warn 50/80/100%)',
        args: [
          { values: LEVELS, hint: 'level', advance: true },
          {
            values: ['0.50', '1.00', '5.00', '20.00'].map((v) => ({
              value: v,
              description: 'hard cap, warns at 50/80%',
            })),
            hint: 'amount',
            advance: true,
          },
          { values: [{ value: 'USD', description: 'only USD is supported' }], hint: 'USD' },
        ],
      },
      export: {
        hint: '[--format json|csv] [--raw]',
        description: 'aggregate report, no prompts or credentials',
        flags: {
          '--format': { values: ['json', 'csv'], hint: 'json|csv' },
          '--raw': { hint: 'redacted audit records (json only, confirmed)' },
        },
      },
      reconcile: {
        hint: 'BILLING.json',
        description: 'import observed costs after confirmation',
        args: [{ hint: 'path to [{providerRequestId,observedCostUsd}]' }],
      },
      help: { hint: '', description: 'show this list' },
    },
  };
  pi.registerCommand('cost', {
    description: 'Costs — now | task ID | project | compare | budget | export | reconcile | help',
    getArgumentCompletions: buildCompletions(costSpec),
    handler: async (args, ctx) => {
      await rt.init(ctx);
      const [action = 'now', ...rest] = words(args);
      if (action === 'help') return output(ctx, usageText('cost', costSpec));
      let calls = await allCalls(),
        tasks = await rt.store.rows('tasks'),
        tools = await rt.store.rows('tool-calls');
      const scope = scopeOf(ctx);
      if (action === 'task') {
        if (!rest[0]) {
          const ids = await knownTasks();
          throw Error(
            `task needs a TASK-ID.${ids.length ? ` Known: ${ids.slice(0, 8).map((i) => i.value).join(', ')}${ids.length > 8 ? ` (+${ids.length - 8})` : ''}` : ' No tasks recorded yet in this project.'}`,
          );
        }
        setTask(pi, rest[0]);
        calls = calls.filter((r) => r.taskId === rest[0]);
        tasks = tasks.filter((t) => t.taskId === rest[0]);
      } else if (action === 'now' || action === 'json') {
        calls = calls.filter((r) => r.sessionId === scope.sessionId);
        tools = tools.filter((r) => r.sessionId === scope.sessionId);
        tasks = tasks.filter((r) => r.sessionId === scope.sessionId);
      } else if (action === 'project') {
        const at = rest.indexOf('--last'),
          duration = rest[at + 1] ?? '30d';
        if (!/^\d+d$/.test(duration))
          throw Error(
            `--last needs a day window like 7d or ${WINDOW_IDS.join('/')} (got "${duration}")`,
          );
        const since = Date.now() - Number(duration.slice(0, -1)) * 86400000;
        calls = calls.filter((r) => Date.parse(r.occurredAt) >= since);
      } else if (action === 'budget') {
        const [level, amount, currency] = rest;
        if (level === 'task' && !scope.taskId)
          throw Error('Select a task with /cost task ID first');
        const n = Number(amount);
        if (
          !LEVEL_IDS.includes(level) ||
          !Number.isFinite(n) ||
          n <= 0 ||
          currency !== 'USD'
        )
          throw Error(
            `Usage: /cost budget ${LEVEL_IDS.join('|')} <amount> USD — for example: /cost budget task 0.50 USD`,
          );
        await rt.store.append('budgets', {
          id: uid(),
          scope: level,
          scopeId: level === 'task' ? scope.taskId : level === 'session' ? scope.sessionId : null,
          hardUsd: n,
          softUsd: n * 0.8,
          actor: 'user-command',
          occurredAt: now(),
        });
        return output(ctx, { scope: level, hardUsd: n });
      } else if (action === 'compare') {
        const at = rest.indexOf('--kind');
        const models = rest.slice(0, 2);
        if (!models.length) {
          const known = await knownModels();
          throw Error(
            `compare needs one or two models.${known.length ? ` Seen: ${known.slice(0, 6).map((m) => m.value).join(', ')}` : ' No model calls recorded yet in this project.'}`,
          );
        }
        return output(
          ctx,
          models.map((model) => {
            const rows = calls.filter(
              (r) => r.modelId === model && (at < 0 || r.kind === rest[at + 1]),
            );
            const ids = new Set(rows.map((r) => r.taskId));
            return {
              model,
              ...summarize(
                rows,
                tasks.filter((t) => ids.has(t.taskId)),
                tools,
              ),
            };
          }),
        );
      } else if (action === 'reconcile') {
        if (!rest[0])
          throw Error(
            'reconcile needs a PATH to a JSON array of [{providerRequestId,observedCostUsd}] — export one from your billing provider.',
          );
        const rows = JSON.parse(
          await readFile(await safePath(rt.root, rest[0], { existing: true }), 'utf8'),
        );
        if (!(await rt.confirm(ctx, 'Reconcile reported billing?', `${rows.length} records`)))
          throw Error('Human confirmation required');
        for (const r of rows) {
          if (
            typeof r.providerRequestId !== 'string' ||
            !calls.some((c) => c.providerRequestId === r.providerRequestId) ||
            !Number.isFinite(r.observedCostUsd) ||
            r.observedCostUsd < 0
          )
            throw Error('Invalid reported cost');
          await rt.store.append('reconciliations', {
            id: uid(),
            providerRequestId: r.providerRequestId,
            observedCostUsd: r.observedCostUsd,
            occurredAt: now(),
          });
        }
        return output(ctx, { reconciled: rows.length });
      } else if (action === 'export') {
        const formatIndex = rest.indexOf('--format');
        const f = formatIndex < 0 ? 'json' : rest[formatIndex + 1];
        if (!['json', 'csv'].includes(f)) throw Error('Format json|csv');
        const raw = rest.includes('--raw');
        if (
          raw &&
          (f !== 'json' ||
            !(await rt.confirm(
              ctx,
              'Export redacted audit and call records?',
              'Current project only; inspect before sharing.',
            )))
        )
          throw Error('Raw audit export requires JSON format and human confirmation');
        const report = raw
            ? {
                summary: summarize(calls, tasks, tools),
                calls,
                tools,
                audit: await rt.store.rows('audit'),
              }
            : summarize(calls, tasks, tools),
          file = join(rt.store.home, `report-${uid()}.${f}`);
        if (f === 'json') await atomicJson(file, report);
        else
          await writeFile(
            file,
            Object.keys(report).join(',') +
              '\n' +
              Object.values(report)
                .map((v) => '"' + JSON.stringify(v).replaceAll('"', '""') + '"')
                .join(',') +
              '\n',
            { mode: 0o600 },
          );
        return output(ctx, { export: file, scope: 'current-project' });
      } else throw Error(`Unknown /cost ${action}\n${usageText('cost', costSpec)}`);
      const rec = await rt.store.rows('reconciliations');
      calls = calls.map((c) => {
        const r = rec.filter((r) => r.providerRequestId === c.providerRequestId).at(-1);
        return r ? { ...c, observedCostUsd: r.observedCostUsd } : c;
      });
      const cohortIds = new Set(calls.map((r) => r.taskId));
      const audit = (await rt.store.rows('audit')).filter(
        (e) => action === 'project' || e.sessionId === scope.sessionId,
      );
      output(
        ctx,
        summarize(
          calls,
          tasks.filter((t) => cohortIds.has(t.taskId)),
          tools,
          audit,
        ),
      );
    },
  });
}
