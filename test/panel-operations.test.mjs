// Operations of the /cost panel against a controllable runtime: opening without waiting for IO,
// Esc during save, disk failure, a save that never answers, and results that arrive after Esc.
// The real vendored adapter is driven by bytes with the real pi-tui keybindings.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KEY, panelHost, waitFor } from '../test-support/panel.mjs';
import { runCostPanel } from '../lib/panel.mjs';
import { openPiSettings } from '../vendor/inteiro-terminal/pi.js';
import { defaults } from '../extension.mjs';
import { merge } from '../lib/core.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};
const STATE = {
  spendText: '$1.2345', scopeLabel: 'sessão', calls: 3, priced: 2,
  unpriced: [{ model: 'openrouter/ghost' }], outside: 0, strict: true, limits: [], percent: {}, routable: [],
};

async function fixture(t, { save, panelState = async () => STATE, writeLocale } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cost-ops-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const writes = [];
  const rt = {
    root,
    config: { costProfiler: structuredClone(defaults.costProfiler), locked: {} },
    async save(section, patch, options) {
      writes.push({ section, patch, unset: options.unset });
      if (save) await save(patch, options);
      rt.config[section] = merge(rt.config[section], patch);
      return join(root, '.pi', 'pi-suite.yaml');
    },
  };
  const ctx = { ui: {}, scopedModels: [], isProjectTrusted: () => true };
  const p = panelHost(ctx.ui);
  const owner = new AbortController();
  const running = runCostPanel({
    ctx,
    rt,
    openSettings: openPiSettings,
    signal: owner.signal,
    panelState,
    ...(writeLocale ? { writeLocale } : {}),
  });
  await waitFor(() => p.opened(), 'painel aberto');
  return { p, rt, root, writes, owner, running };
}

/** Changes capOutput and switches the draft language to pt-BR (preview), without saving. */
async function capAndPortuguese(p) {
  await p.goto('capOutput');
  await p.key(KEY.enter);
  await p.goto('language');
  await p.keys(KEY.enter, KEY.down, KEY.enter);
}

test('the panel opens before the money state is read and fills it in when it arrives', async (t) => {
  const gate = deferred();
  const f = await fixture(t, { panelState: () => gate.promise });
  assert.match(f.p.screen(120), /Spend in window\s+loading…/);
  assert.match(f.p.screen(120), /Accounting on · loading… · loading… priced/);
  gate.resolve(STATE);
  await waitFor(() => f.p.screen(120).includes('$1.2345'), 'estado aplicado');
  assert.match(f.p.screen(120), /Price coverage\s+2\/3/);
  await f.p.key(KEY.esc);
  assert.equal((await f.running).status, 'succeeded');
});

test('Esc during a save aborts it through the AbortSignal and keeps the draft for Ctrl+S', async (t) => {
  let block = true;
  const started = deferred();
  const f = await fixture(t, {
    save: (_patch, { signal }) =>
      block &&
      new Promise((_resolve, reject) => {
        started.resolve();
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  });
  await f.p.goto('capOutput');
  await f.p.key(KEY.enter);
  f.p.component().handleInput(KEY.ctrlS);
  await started.promise;
  assert.match(f.p.screen(), /Saving…/);
  await f.p.key(KEY.esc);
  await waitFor(() => /Save cancelled\. Your draft was kept\./.test(f.p.screen()), 'cancelamento confirmado');
  assert.match(f.p.lines()[0], /\*/, 'draft kept');
  assert.equal(f.rt.config.costProfiler.capOutput, false, 'nothing applied');
  block = false;
  await f.p.key(KEY.ctrlS);
  assert.equal(f.rt.config.costProfiler.capOutput, true);
  assert.doesNotMatch(f.p.lines()[0], /\*/);
  await f.p.key(KEY.esc);
  const result = await f.running;
  assert.deepEqual(result.notes, ['Cap output tokens updated to On.']);
});

test('a disk failure keeps the draft, explains the cause and a later Ctrl+S succeeds', async (t) => {
  let fail = true;
  const f = await fixture(t, {
    save: async () => {
      if (fail) throw Object.assign(new Error('EACCES: permission denied, open pi-suite.yaml'), { code: 'EACCES' });
    },
  });
  await f.p.goto('priceCatalogTtlHours');
  await f.p.keys(KEY.enter, KEY.down, KEY.enter, KEY.ctrlS);
  assert.match(f.p.screen(), /Save failed: EACCES: permission denied/);
  assert.match(f.p.lines()[0], /\*/);
  assert.equal(f.p.session().draft.priceCatalogTtlHours, '72');
  fail = false;
  await f.p.key(KEY.ctrlS);
  assert.equal(f.rt.config.costProfiler.priceCatalogTtlHours, 72);
  await f.p.key(KEY.esc);
  await f.running;
});

test('a save that ignores Esc becomes unconfirmed; its late result changes nothing until storage is checked', async (t) => {
  const hang = deferred();
  let first = true;
  const f = await fixture(t, {
    save: () => {
      if (!first) return undefined;
      first = false;
      return hang.promise;
    },
  });
  await f.p.goto('auditRequired');
  await f.p.keys(KEY.enter);
  f.p.component().handleInput(KEY.ctrlS);
  // Do not drain here: draining waits for the save itself.
  await waitFor(() => f.p.screen().includes('Saving…'), 'salvando');
  await f.p.key(KEY.esc);
  await waitFor(() => /Save was not confirmed\. Check storage before trying again\./.test(f.p.screen()), 'resultado desconhecido', 5000);
  assert.match(f.p.screen(), /\[Check storage\]/);
  // The write finishes late: the panel still treats the outcome as unknown.
  hang.resolve();
  await f.p.settle();
  assert.match(f.p.screen(), /Save was not confirmed/);
  assert.match(f.p.lines()[0], /\*/);
  // Ctrl+S now reads storage (reconcile) instead of writing blindly.
  await f.p.key(KEY.ctrlS);
  assert.match(f.p.screen(), /Storage checked\. Review the pending changes\./);
  assert.equal(f.writes.length, 1, 'reconcile does not write');
  assert.doesNotMatch(f.p.lines()[0], /\*/, 'the late write is recognised as the stored value');
  await f.p.key(KEY.esc);
  await f.running;
});

test('a refresh cancelled with Esc drops its late result', async (t) => {
  let calls = 0;
  const late = deferred();
  const f = await fixture(t, {
    panelState: () => (++calls === 1 ? Promise.resolve(STATE) : late.promise),
  });
  await waitFor(() => f.p.screen().includes('$1.2345'), 'estado inicial');
  await f.p.goto('spend');
  f.p.component().handleInput(KEY.enter);
  await waitFor(() => f.p.controller().busy, 'atualização em curso');
  await f.p.key(KEY.esc);
  await waitFor(() => /Operation cancelled\./.test(f.p.screen()), 'cancelado', 5000);
  late.resolve({ ...STATE, spendText: '$9.9999' });
  await f.p.settle();
  assert.doesNotMatch(f.p.screen(), /\$9\.9999/, 'a result after Esc is not shown');
  assert.match(f.p.screen(), /Spend in window\s+\$1\.2345/);
  assert.equal(f.p.closed(), false);
  await f.p.key(KEY.esc);
  await f.running;
});

test('the owner signal closes the panel and waits for the work it started', async (t) => {
  const hang = deferred();
  let finished = false;
  const f = await fixture(t, {
    save: async () => {
      await hang.promise;
      finished = true;
    },
  });
  await f.p.goto('capOutput');
  await f.p.key(KEY.enter);
  f.p.component().handleInput(KEY.ctrlS);
  await waitFor(() => f.p.screen().includes('Saving…'), 'salvando');
  f.owner.abort();
  let settled = false;
  f.running.then(() => (settled = true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(f.p.closed(), true, 'the panel closed at once');
  assert.equal(settled, false, 'runCostPanel waits for the save it started');
  hang.resolve();
  const result = await f.running;
  assert.equal(finished, true);
  assert.equal(result.status, 'cancelled');
});

test('a slow first read never replaces a newer refresh (late initial result is dropped)', async (t) => {
  const slow = deferred();
  let calls = 0;
  const f = await fixture(t, {
    panelState: () => (++calls === 1 ? slow.promise : Promise.resolve({ ...STATE, spendText: '$2.0000' })),
  });
  await f.p.goto('spend');
  await f.p.key(KEY.enter);
  assert.match(f.p.screen(120), /Spend in window\s+\$2\.0000/);
  slow.resolve({ ...STATE, spendText: '$1.0000' });
  await f.p.settle();
  assert.match(f.p.screen(120), /Spend in window\s+\$2\.0000/, 'row keeps the newer read');
  assert.match(f.p.lines(120)[1], /Accounting on · \$2\.0000/, 'header keeps the newer read');
  assert.doesNotMatch(f.p.screen(120), /\$1\.0000/);
  await f.p.key(KEY.esc);
  await f.running;
});

test('a slow first read still lands when the newer refresh was cancelled', async (t) => {
  const slow = deferred();
  const never = deferred();
  let calls = 0;
  const f = await fixture(t, { panelState: () => (++calls === 1 ? slow.promise : never.promise) });
  await f.p.goto('spend');
  f.p.component().handleInput(KEY.enter);
  await waitFor(() => f.p.controller().busy, 'atualização em curso');
  await f.p.key(KEY.esc);
  await waitFor(() => /Operation cancelled\./.test(f.p.screen()), 'cancelado', 5000);
  slow.resolve(STATE);
  await waitFor(() => f.p.screen(120).includes('$1.2345'), 'leitura inicial aplicada');
  never.resolve({ ...STATE, spendText: '$9.9999' });
  await f.p.key(KEY.esc);
  await f.running;
});

test('config saved but language write failed: only the language stays in the draft, Esc Esc discards only it', async (t) => {
  const f = await fixture(t, {
    writeLocale: async () => {
      throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    },
  });
  await capAndPortuguese(f.p);
  await f.p.key(KEY.ctrlS);
  assert.equal(f.rt.config.costProfiler.capOutput, true, 'the section was written and is live');
  assert.match(f.p.screen(120), /Configurações de custo salvas e ativas; idioma não salvo: EPERM/);
  assert.equal(f.p.session().persisted.capOutput, true, 'baseline follows what is stored');
  assert.deepEqual(
    f.p.session().changes.map((c) => c.id),
    ['language'],
    'only the language is still unsaved',
  );
  await f.p.key(KEY.esc);
  await f.p.key(KEY.esc);
  assert.equal(f.p.closed(), true);
  const result = await f.running;
  assert.equal(f.writes.length, 1, 'discard writes nothing back');
  assert.equal(result.locale, 'en');
  assert.deepEqual(result.notes, ['Cap output tokens updated to On.'], 'summary reports the real save');
});

test('Esc during the language write cancels only the language; the saved section is the new baseline', async (t) => {
  const started = deferred();
  const f = await fixture(t, {
    writeLocale: ({ signal }) =>
      new Promise((_resolve, reject) => {
        started.resolve();
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  });
  await capAndPortuguese(f.p);
  f.p.component().handleInput(KEY.ctrlS);
  await started.promise;
  await f.p.key(KEY.esc);
  await waitFor(
    () => /Configurações de custo salvas e ativas; troca de idioma cancelada\./.test(f.p.screen(120)),
    'idioma cancelado',
    5000,
  );
  assert.equal(f.p.session().persisted.capOutput, true);
  assert.equal(f.p.session().outcomeUnknown, false);
  assert.deepEqual(f.p.session().changes.map((c) => c.id), ['language']);
  await f.p.key(KEY.esc);
  await f.p.key(KEY.esc);
  const result = await f.running;
  assert.deepEqual(result.notes, ['Cap output tokens updated to On.']);
});

test('the closing summary is rendered in the saved language, never mixed with the preview', async (t) => {
  const f = await fixture(t);
  await capAndPortuguese(f.p);
  await f.p.key(KEY.ctrlS);
  // Back to English and save again: every note follows the final saved language.
  await f.p.goto('language');
  await f.p.keys(KEY.enter, KEY.up, KEY.enter, KEY.ctrlS);
  await f.p.key(KEY.esc);
  const result = await f.running;
  assert.equal(result.locale, 'en');
  assert.deepEqual(result.notes, ['Cap output tokens updated to On.', 'Language saved: English (default).']);
});

test('a pt-BR save renders the whole closing summary in Portuguese', async (t) => {
  const f = await fixture(t);
  await capAndPortuguese(f.p);
  await f.p.key(KEY.ctrlS);
  await f.p.key(KEY.esc);
  const result = await f.running;
  assert.equal(result.locale, 'pt-BR');
  assert.deepEqual(result.notes, ['Limitar tokens de saída atualizado para Ativa.', 'Idioma salvo: Português (Brasil).']);
});

test('an unreadable ledger leaves the settings usable and says the summary is unavailable', async (t) => {
  const f = await fixture(t, {
    panelState: async () => {
      throw new Error('EBUSY: ledger locked');
    },
  });
  await waitFor(() => f.p.screen(120).includes('summary unavailable'), 'estado indisponível');
  assert.match(f.p.screen(120), /Spend in window\s+unavailable/);
  assert.match(f.p.screen(120), /scope unavailable · summary unavailable/);
  await f.p.goto('spend');
  await f.p.key(KEY.enter);
  assert.match(f.p.screen(120), /Spend summary unavailable: EBUSY: ledger locked/);
  await f.p.goto('capOutput');
  await f.p.keys(KEY.enter, KEY.ctrlS);
  assert.equal(f.rt.config.costProfiler.capOutput, true, 'settings still save');
  await f.p.key(KEY.esc);
  await f.running;
});
