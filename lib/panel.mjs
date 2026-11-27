/**
 * The `/cost` settings panel on the vendored Pi settings adapter (`vendor/inteiro-terminal`).
 *
 * The panel edits a flat draft of the `costProfiler` section plus the project language. Nothing is
 * written until Ctrl+S; the panel stays open after saving. Esc in a field goes back without applying,
 * Esc with a draft warns and a second Esc discards and closes, Esc during an operation cancels it.
 *
 * Values come from the shared `FIELDS` table in `menu.mjs` (the same writer the text commands use),
 * so the panel has no private copy of a value list. Budgets become one select per level; locked keys
 * from the global policy are shown with their source and never written.
 *
 * `openSettings` is the adapter's `openPiSettings`, statically imported by `index.ts` (Pi maps host
 * modules only for static imports). This module imports only the adapter's host-free state code.
 */
import { SettingsSession } from '../vendor/inteiro-terminal/settings.js';
import { FIELDS, BUDGET_AMOUNTS, fieldValues } from '../menu.mjs';
import { merge, redact } from './core.mjs';
import {
  translate,
  fieldDisplayValue,
  readProjectLocale,
  writeProjectLocale,
} from './i18n.mjs';

export const LANGUAGE = 'language';
export const LOCAL_MODELS = 'localModels';
export const BUDGET_LEVEL_IDS = ['project', 'task', 'session'];
export const budgetField = (level) => `budget.${level}`;
const BUDGET_FIELDS = BUDGET_LEVEL_IDS.map(budgetField);
const TABLE_FIELDS = Object.keys(FIELDS).filter((id) => FIELDS[id].kind !== 'list');
// Read the static lists directly: `fieldValues()` defaults to `defaults`, which is not initialised
// yet while extension.mjs (which imports this module) is still loading.
const BOOLEAN_FIELDS = new Set(
  TABLE_FIELDS.filter((id) => {
    const values = FIELDS[id].values;
    return Array.isArray(values) && values.length === 2 && values.includes('on') && values.includes('off');
  }),
);
/** Field order: language, then the lists (budgets, local models), then the table dials. */
export const FIELD_ORDER = [LANGUAGE, ...BUDGET_FIELDS, LOCAL_MODELS, ...TABLE_FIELDS];
/** Read-only rows: the money state, refreshed on Enter, plus the command-line reminder. */
export const ACTION_ORDER = ['spend', 'coverage', 'limits', 'help'];

const LABEL_KEYS = {
  [LANGUAGE]: 'rowLanguage',
  'budget.project': 'rowBudgetProject',
  'budget.task': 'rowBudgetTask',
  'budget.session': 'rowBudgetSession',
  [LOCAL_MODELS]: 'rowLocalModels',
  enabled: 'rowEnabled',
  warnUnknownPricing: 'rowWarnUnknownPricing',
  capOutput: 'rowCapOutput',
  auditRequired: 'rowAuditRequired',
  inputIncludesCache: 'rowInputIncludesCache',
  maxRequestOutputTokens: 'rowMaxRequestOutputTokens',
  priceCatalogTtlHours: 'rowPriceCatalogTtlHours',
  localEnergyUsdPerHour: 'rowLocalEnergyUsdPerHour',
  localDepreciationUsdPerHour: 'rowLocalDepreciationUsdPerHour',
  opportunityUsdPerHour: 'rowOpportunityUsdPerHour',
  scopeSource: 'rowScopeSource',
  scopeStrict: 'rowScopeStrict',
};
const LOCK_KEYS = {
  ...Object.fromEntries(TABLE_FIELDS.map((id) => [id, FIELDS[id].lock])),
  ...Object.fromEntries(BUDGET_FIELDS.map((id) => [id, FIELDS.budgets.lock])),
  [LOCAL_MODELS]: FIELDS.localModels.lock,
};
const MODEL_ID = /^[\w.:@/+-]{1,120}$/;
const firstLine = (error) => redact(String(error?.message ?? error)).split('\n')[0];
const unique = (values) => [...new Set(values)];
/** A budget amount as a choice id: the table's spelling when it matches, the stored number otherwise. */
const amountId = (hardUsd) =>
  BUDGET_AMOUNTS.find((amount) => Number(amount) === Number(hardUsd)) ?? String(Number(hardUsd));
const cancelled = () => Object.assign(new Error('Operation canceled'), { name: 'AbortError' });
/** Settles with `work`, or rejects with an AbortError as soon as `signal` aborts. */
function abortable(work, signal) {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
const money = (value) => {
  const n = Number(value);
  return n !== 0 && Math.abs(n) < 0.1 ? String(n) : n.toFixed(2);
};

/**
 * One Ctrl+S writes two files: the `costProfiler` section, then the language preference. When the
 * section is already on disk (and live) and the language step fails or is cancelled, the save is
 * partial, not "nothing happened". `persist` records `partial` and this session moves the saved
 * baseline to what is really stored, so only the language stays in the draft and a second Esc
 * discards only what was not written. An unconfirmed outcome is left to the adapter's `reconcile`.
 */
class CostSettingsSession extends SettingsSession {
  partial = null;
  async save(persist, options) {
    this.partial = null;
    const result = await super.save(persist, options);
    const partial = this.partial;
    this.partial = null;
    if (partial && (result.status === 'failed' || result.status === 'cancelled')) {
      this.reconcilePersistence(partial.stored);
      this.setStatus(partial.message(result.status), result.status === 'cancelled' ? 'warning' : 'error');
    }
    return result;
  }
}

/** Candidate local models from the session's model scope (rule E), never from IO. */
export function routableModels(ctx) {
  return (ctx?.scopedModels ?? [])
    .map((s) => `${s.model?.provider ?? 'openrouter'}/${s.model?.id}`)
    .filter((id) => id.includes('/') && MODEL_ID.test(id))
    .slice(0, 24);
}

/** Flat panel values of a `costProfiler` section and a UI locale. */
export function valuesFrom(conf, locale) {
  const values = { [LANGUAGE]: locale === 'pt-BR' ? 'pt-BR' : 'en' };
  for (const level of BUDGET_LEVEL_IDS) {
    const budget = conf.budgets?.[level];
    values[budgetField(level)] = Number.isFinite(Number(budget?.hardUsd)) && budget?.hardUsd != null
      ? amountId(budget.hardUsd)
      : 'none';
  }
  values[LOCAL_MODELS] = [...(conf.localModels ?? [])].map(String);
  for (const id of TABLE_FIELDS) {
    const current = FIELDS[id].current(conf);
    values[id] = BOOLEAN_FIELDS.has(id) ? current === 'on' : String(current);
  }
  return values;
}

/**
 * The `costProfiler` patch (and unset paths) that turns `before` into `values`. Locked ids are
 * never written. Returns the changed field ids in panel order.
 */
export function patchFrom(before, values, conf, { locked = {} } = {}) {
  let patch = {};
  const unset = [];
  const changed = [];
  const isLocked = (id) => Object.hasOwn(locked, LOCK_KEYS[id]);
  const differs = (id) => JSON.stringify(before[id]) !== JSON.stringify(values[id]);
  for (const level of BUDGET_LEVEL_IDS) {
    const id = budgetField(level);
    if (!differs(id) || isLocked(id)) continue;
    changed.push(id);
    if (values[id] === 'none') unset.push(['budgets', level]);
    else {
      const hardUsd = Number(values[id]);
      if (!Number.isFinite(hardUsd) || hardUsd <= 0) throw Error(`Invalid budget for ${level}: ${values[id]}`);
      patch = merge(patch, { budgets: { [level]: { hardUsd, softUsd: Number((hardUsd * 0.8).toFixed(4)) } } });
    }
  }
  if (differs(LOCAL_MODELS) && !isLocked(LOCAL_MODELS)) {
    const list = values[LOCAL_MODELS];
    if (!Array.isArray(list) || !list.every((m) => MODEL_ID.test(String(m))))
      throw Error('Invalid local model list');
    changed.push(LOCAL_MODELS);
    patch.localModels = [...list];
  }
  for (const id of TABLE_FIELDS) {
    if (!differs(id) || isLocked(id)) continue;
    const value = BOOLEAN_FIELDS.has(id) ? (values[id] ? 'on' : 'off') : String(values[id]);
    changed.push(id);
    patch = merge(patch, FIELDS[id].patch(value, conf));
  }
  return { patch, unset, changed };
}

/**
 * Opens the panel and resolves when it closes. Returns what was saved (for the exit summary),
 * or `{ status: 'failed' }` when the host could not show the panel.
 */
export async function runCostPanel({
  ctx,
  rt,
  openSettings,
  signal,
  panelState,
  // Seam for tests that hold the language write; production always uses the real writer.
  writeLocale = writeProjectLocale,
}) {
  const conf = () => rt.config.costProfiler;
  const locked = rt.config.locked?.costProfiler ?? {};
  const trusted = () => ctx.isProjectTrusted();
  const preference = await readProjectLocale({ root: rt.root, trusted: trusted() });
  const initialConf = structuredClone(conf());
  const routable = routableModels(ctx);
  let locale = preference.locale;
  let savedLocale = preference.locale;
  const tr = (key, values = {}) => translate(locale, key, values);

  /** Work started by the panel (state reads, actions, save) is awaited before returning. */
  const inflight = new Set();
  const track = (work) => {
    const promise = Promise.resolve(work);
    inflight.add(promise);
    const forget = () => inflight.delete(promise);
    promise.then(forget, forget);
    return promise;
  };

  // Money state is read after the panel is on screen; the rows say "loading" until then.
  let state = null;
  let stateError = null;
  const scopeName = (level, id = '') => {
    if (level === 'task') return tr('scopeTask', { id }).trim();
    if (level === 'project') return tr('scopeProject');
    return tr('scopeSession');
  };

  const isLocked = (id) => Object.hasOwn(locked, LOCK_KEYS[id]);
  const override = (id) => {
    if (!LOCK_KEYS[id] || !isLocked(id)) return {};
    return { override: { value: valuesFrom(conf(), locale)[id], source: tr('sourceGlobalPolicy') } };
  };
  const label = (id) => tr(LABEL_KEYS[id]);
  const description = (id) => {
    let text = tr(`${LABEL_KEYS[id]}Description`);
    if (id === LANGUAGE) {
      if (!preference.canPersist) text += ' ' + tr('languageTrustRequired');
      else if (preference.issue === 'invalid') text += ' ' + tr('languageInvalid');
      else if (preference.issue === 'unreadable') text += ' ' + tr('languageUnreadable');
    }
    if (id === LOCAL_MODELS && !localModelChoices().length) text += ' ' + tr('reportNoLocalModels');
    return text;
  };
  const budgetChoices = (level, loc = locale) => {
    const current = unique(
      [initialConf, conf()]
        .map((c) => c.budgets?.[level])
        .filter((b) => b?.hardUsd != null && Number.isFinite(Number(b.hardUsd)))
        .map((b) => ({ id: amountId(b.hardUsd), soft: b.softUsd ?? Number(b.hardUsd) * 0.8 })),
    );
    const choices = [
      { id: 'none', label: translate(loc, 'choiceNoLimit') },
      ...BUDGET_AMOUNTS.map((amount) => ({
        id: amount,
        label: translate(loc, 'choiceBudgetAmount', { amount, soft: money(Number(amount) * 0.8) }),
      })),
    ];
    for (const { id, soft } of current)
      if (!choices.some((c) => c.id === id))
        choices.push({ id, label: translate(loc, 'choiceBudgetAmount', { amount: money(id), soft: money(soft) }) });
    return choices;
  };
  const localModelChoices = () =>
    unique([...(initialConf.localModels ?? []), ...(conf().localModels ?? []), ...routable].map(String)).map(
      (id) => ({ id, label: id }),
    );
  const tableChoices = (id) =>
    unique([...fieldValues(id, conf()), FIELDS[id].current(initialConf), FIELDS[id].current(conf())].map(String)).map(
      (value) => ({ id: value, label: fieldDisplayValue(locale, id, value) }),
    );

  const fields = () =>
    FIELD_ORDER.map((id) => {
      const base = { id, label: label(id), description: description(id), ...override(id) };
      if (id === LANGUAGE)
        return {
          ...base,
          kind: 'select',
          choices: [
            { id: 'en', label: translate(locale, 'localeEnglish') },
            { id: 'pt-BR', label: translate(locale, 'localePortuguese') },
          ],
          ...(preference.canPersist ? {} : { locked: { source: tr('sourceProjectTrust') } }),
        };
      if (BUDGET_FIELDS.includes(id))
        return { ...base, kind: 'select', choices: budgetChoices(id.slice('budget.'.length)) };
      if (id === LOCAL_MODELS)
        return {
          ...base,
          kind: 'multiselect',
          choices: localModelChoices(),
          format: (value) =>
            Array.isArray(value) && value.length ? tr('valueModelCount', { count: value.length }) : tr('valueNone'),
        };
      if (BOOLEAN_FIELDS.has(id))
        return { ...base, kind: 'boolean', format: (value) => fieldDisplayValue(locale, id, value ? 'on' : 'off') };
      return { ...base, kind: 'select', choices: tableChoices(id) };
    });

  const displayScope = (draft) => {
    const source = draft.scopeSource ?? 'session';
    if (source === 'task') {
      const label = String(state?.scopeLabel ?? '');
      return scopeName('task', label.startsWith('task ') ? label.slice(5) : '—');
    }
    if (source === 'project') return scopeName('project');
    if (stateError) return tr('scopeUnavailable');
    return scopeName('session');
  };
  const limitValue = (draft) => {
    if (!state && !stateError) return tr('valueLoading');
    const configured = BUDGET_LEVEL_IDS.filter((level) => draft[budgetField(level)] !== 'none').map((level) => {
      const amount = Number(draft[budgetField(level)]);
      const live = (state?.limits ?? []).find(
        (item) => item.source !== 'command' && item.scope === level && item.hardUsd === amount,
      );
      return live
        ? tr('valueLimitUsage', {
            scope: `${scopeName(level)} · ${tr('sourceConfiguration')}`,
            amount: amount.toFixed(2),
            percent: live.percent,
          })
        : tr('valueLimit', { scope: scopeName(level), amount: amount.toFixed(2) });
    });
    const command = (state?.limits ?? [])
      .filter((item) => item.source === 'command')
      .map((item) =>
        tr('valueLimitUsage', {
          scope: `${scopeName(item.scope)} · ${tr('sourceCommand')}`,
          amount: Number(item.hardUsd).toFixed(2),
          percent: item.percent,
        }),
      );
    const entries = [...configured, ...command];
    return entries.length ? entries.join(' · ') : tr('valueNone');
  };
  const spendHint = () => (stateError ? tr('valueUnavailable') : state ? state.spendText : tr('valueLoading'));
  const coverageHint = () =>
    stateError ? tr('valueUnavailable') : state ? `${state.priced ?? 0}/${state.calls ?? 0}` : tr('valueLoading');
  const scope = (draft) =>
    tr('summary', {
      accounting: tr(draft.enabled ? 'accountingOn' : 'accountingOff'),
      spend: spendHint(),
      coverage: coverageHint(),
      scope: displayScope(draft),
      unavailable: stateError ? tr('summaryUnavailable') : '',
    });

  /**
   * Rereads the money state. Esc rejects at once with an AbortError (the operation is cancelled,
   * not left unconfirmed); the read itself is awaited on close and its late result is dropped.
   * Reads are numbered: a read that settles after a newer one was already shown (the slow first
   * read versus an Enter on Spend) is dropped, so stale data never replaces fresher data.
   */
  let started = 0;
  let shown = 0;
  const reload = async (abort) => {
    const seq = ++started;
    let next;
    let failure = null;
    try {
      next = await abortable(track(panelState(ctx)), abort);
    } catch (error) {
      if (abort?.aborted) throw error;
      failure = firstLine(error);
    }
    if (seq < shown) return;
    shown = seq;
    state = failure ? state : next;
    stateError = failure;
    refresh();
  };
  const actions = () => [
    {
      id: 'spend',
      label: tr('rowSpend'),
      description: tr('rowSpendDescription'),
      hint: spendHint(),
      run: async (draft, abort) => {
        await reload(abort);
        return stateError
          ? tr('reportSpendUnavailable', { error: stateError })
          : tr('reportSpend', { scope: displayScope(draft), spend: state.spendText, calls: state.calls });
      },
    },
    {
      id: 'coverage',
      label: tr('rowCoverage'),
      description: tr('rowCoverageDescription'),
      hint: coverageHint(),
      run: async (_draft, abort) => {
        await reload(abort);
        if (stateError) return tr('reportSpendUnavailable', { error: stateError });
        const unknown = (state.unpriced ?? []).map((row) => row.model).join(', ');
        return unknown
          ? tr('reportCoverageUnknown', { priced: state.priced, calls: state.calls, models: unknown })
          : tr('reportCoverage', { priced: state.priced, calls: state.calls });
      },
    },
    {
      id: 'limits',
      label: tr('rowLimits'),
      description: tr('rowLimitsDescription'),
      hint: limitValue(current()),
      run: async (draft, abort) => {
        await reload(abort);
        return tr('reportLimits', {
          limits: limitValue(draft),
          tokens: draft.maxRequestOutputTokens,
          cap: fieldDisplayValue(locale, 'capOutput', draft.capOutput ? 'on' : 'off'),
        });
      },
    },
    {
      id: 'help',
      label: tr('rowHelp'),
      description: tr('rowHelpDescription'),
      run: async () => tr('reportHelp'),
    },
  ];
  const tracked = () =>
    actions().map((action) => ({ ...action, run: (...args) => track(action.run(...args)) }));
  const messages = () => ({
    saved: tr('reportSavedActive'),
    // Empty text falls back to the adapter's catalog.
    overrideStatus: (source) => (source === tr('sourceGlobalPolicy') ? tr('lockedByPolicy') : ''),
    lockedStatus: (source) => (source === tr('sourceProjectTrust') ? tr('languageTrustRequired') : ''),
  });

  const session = new CostSettingsSession(fields(), valuesFrom(conf(), locale), { locale, messages: messages() });
  const current = () => session.draft;

  // The host renderer and the controller are only known inside `ui.custom`.
  let component;
  let requestRender = () => {};
  const ui = {
    custom: (factory, options) =>
      ctx.ui.custom((tui, theme, keys, done) => {
        requestRender = () => tui.requestRender();
        component = factory(tui, theme, keys, done);
        return component;
      }, options),
  };
  let closed = false;
  function refresh() {
    const panel = component?.controller;
    if (closed || !panel) return;
    panel.relabel({ scope: scope(current()), actions: tracked() });
    requestRender();
  }

  /** Saved changes as `id → value`; rendered once, at close, in the saved language. */
  const notes = new Map();
  const files = new Set();
  const noteText = (loc, id, value) => {
    if (id === LANGUAGE)
      return translate(loc, 'reportLanguageSaved', {
        language: translate(loc, value === 'pt-BR' ? 'localePortuguese' : 'localeEnglish'),
      });
    let shown;
    if (id === LOCAL_MODELS) shown = Array.isArray(value) && value.length ? value.join(', ') : translate(loc, 'valueNone');
    else if (BUDGET_FIELDS.includes(id))
      shown = budgetChoices(id.slice('budget.'.length), loc).find((c) => c.id === value)?.label ?? String(value);
    else shown = fieldDisplayValue(loc, id, BOOLEAN_FIELDS.has(id) ? (value ? 'on' : 'off') : value);
    return translate(loc, 'reportSettingChanged', { field: translate(loc, LABEL_KEYS[id]), value: shown });
  };
  const persist = (values, abort) =>
    track(
      (async () => {
        const before = session.persisted;
        const { patch, unset, changed } = patchFrom(before, values, conf(), { locked });
        let sectionSaved = false;
        try {
          if (Object.keys(patch).length || unset.length) {
            const file = await rt.save('costProfiler', patch, { unset, signal: abort });
            sectionSaved = true;
            files.add(file);
            for (const id of changed) notes.set(id, values[id]);
          }
          if (values[LANGUAGE] !== before[LANGUAGE]) {
            if (!preference.canPersist || !trusted() || !rt.root) throw new Error(tr('languageTrustRequired'));
            if (abort.aborted) throw abort.reason ?? cancelled();
            const file = await writeLocale({
              root: rt.root,
              trusted: trusted(),
              locale: values[LANGUAGE],
              signal: abort,
            });
            savedLocale = values[LANGUAGE];
            files.add(file);
            notes.set(LANGUAGE, savedLocale);
          }
        } catch (error) {
          // The section is on disk and in effect: only the language is still unsaved.
          if (sectionSaved)
            session.partial = {
              stored: { ...values, [LANGUAGE]: before[LANGUAGE] },
              message: (status) =>
                status === 'cancelled'
                  ? tr('reportLanguageCancelledAfterSave')
                  : tr('reportLanguageFailedAfterSave', { error: firstLine(error) }),
            };
          throw error;
        }
      })(),
    );

  /** Live language preview: every product and adapter text switches before Ctrl+S. */
  const onDraftChange = (draft, _event, panel) => {
    const next = draft[LANGUAGE] === 'pt-BR' ? 'pt-BR' : 'en';
    if (next !== locale) {
      locale = next;
      panel.setLocale(locale, messages());
      panel.relabel({ title: tr('title'), scope: scope(draft), fields: fields(), actions: tracked() });
    } else panel.relabel({ scope: scope(draft), actions: tracked() });
  };

  // The first read starts with the panel; a failure is shown in the rows, never thrown.
  void track(reload(signal).catch(() => {}));
  let result;
  try {
    result = await openSettings(ui, {
      title: tr('title'),
      scope: scope(session.draft),
      session,
      persist,
      signal,
      locale,
      messages: messages(),
      actions: tracked(),
      reservedKeys: ['ctrl+c'],
      overlay: { width: '85%', minWidth: 40, maxHeight: '95%', anchor: 'center', margin: 1 },
      cancelGraceMs: 1000,
      formatError: (error, context) =>
        context?.phase === 'save'
          ? tr('reportSaveFailed', { error: firstLine(error) })
          : tr('reportActionFailed', { field: context?.label ?? '', error: firstLine(error) }),
      onDraftChange,
      reconcile: async () =>
        valuesFrom(conf(), (await readProjectLocale({ root: rt.root, trusted: trusted() })).locale),
    });
  } catch (error) {
    result = { status: 'failed', message: firstLine(error) };
  } finally {
    closed = true;
    // Work that ignored its AbortSignal is awaited here, so nothing outlives the panel.
    while (inflight.size) await Promise.allSettled([...inflight]);
  }
  return {
    status: result.status,
    message: result.message,
    locale: savedLocale,
    notes: [...notes].map(([id, value]) => noteText(savedLocale, id, value)),
    files: [...files],
  };
}
