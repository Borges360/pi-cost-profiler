import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG, costEnv, chat, waitFor } from '../test-support/panel.mjs';
import {
  FIELDS,
  fieldValues,
  enumItems,
  panelItems,
  applyField,
  amountRows,
  c0,
  host,
} from '../menu.mjs';
import { validateConfig } from '../lib/core.mjs';

const text = (env) => String(env.f.notifications.at(-1));
const SECTION = new Set(Object.keys(c0()));
const effective = async (env) => ({ ...c0(), ...(await env.saved()) });

/* ------------------------------------------------------------------ *
 *  1. The table, on its own.
 * ------------------------------------------------------------------ */

test('every field offers values, patches a real key and points at a real lock', () => {
  assert.ok(Object.keys(FIELDS).length >= 12, 'a tabela tem que cobrir os dials todos');
  for (const [id, field] of Object.entries(FIELDS)) {
    const values = fieldValues(id, c0(), { routable: ['openrouter/x'], contractHosts: [] });
    assert.ok(Array.isArray(values), `${id}.values`);
    if (field.kind !== 'list') assert.ok(values.length, `${id}: values vazia`);
    assert.ok(SECTION.has(field.lock), `${id}.lock aponta para chave inexistente: ${field.lock}`);
    for (const value of values) {
      const { patch } = applyField(c0(), id, value, { state: { routable: ['openrouter/x'] } });
      for (const key of Object.keys(patch))
        assert.ok(SECTION.has(key), `${id}: patch escreve fora da seção: ${key}`);
      const merged = { ...c0(), ...patch };
      validateConfig({ costProfiler: merged });
      if (field.kind === 'list') {
        const list = merged[field.listKey] ?? {};
        if (id === 'budgets') {
          if (String(value).startsWith('remove:'))
            assert.ok(!Object.hasOwn(list, value.split(':')[1]), `${value} não saiu`);
        } else if (String(value).startsWith('add:'))
          assert.ok(list.includes(value.slice(4)), `${value} não entrou`);
        else if (String(value).startsWith('remove:'))
          assert.ok(!list.includes(value.slice(7)), `${value} não saiu`);
        continue;
      }
      assert.equal(field.current(merged), value, `${id}: ${value} não sobrevive ao round-trip`);
    }
  }
});

test('validateConfig knows the new fields and refuses nonsense before the write', () => {
  assert.throws(() => validateConfig({ costProfiler: { scope: { source: 'weekly' } } }), /scope source/);
  assert.throws(() => validateConfig({ costProfiler: { scope: { strict: 'mais' } } }), /strict flag/);
  assert.throws(() => validateConfig({ costProfiler: { capOutput: 'sim' } }), /boolean/i);
  assert.throws(
    () => validateConfig({ costProfiler: { budgets: { project: { hardUsd: -1 } } } }),
    /financial/i,
  );
  assert.doesNotThrow(() =>
    validateConfig({
      costProfiler: { scope: { source: 'task', strict: false }, capOutput: true },
      acceptanceGate: { autoSelect: false },
      unrelated: { anything: 1 },
    }),
  );
});

test('the side-effect dials say what they cost the user', () => {
  assert.match(FIELDS.capOutput.note('on', c0()), /no máximo \d+ tokens/);
  assert.match(FIELDS.auditRequired.note('on'), /NEGADO/);
  assert.match(FIELDS.budgets.note('set:task:5.00'), /vale para toda sessão/);
  assert.match(FIELDS.scopeStrict.note('off', c0()), /soma maior, menos fiel/);
});

/* ------------------------------------------------------------------ *
 *  2. Parity: what the panel offers, the file receives.
 * ------------------------------------------------------------------ */

test('every offered field value stays draft-only until Ctrl+S commits the same table value', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const s = env.settings();
  const rows = s.options.rows.filter((row) => FIELDS[row.id]?.kind !== 'list' && FIELDS[row.id]);
  assert.ok(rows.length >= 10, `esperava pelo menos 10 linhas enum, achei ${rows.length}`);
  const before = await env.file();
  for (const row of rows) {
    const values = fieldValues(row.id, c0());
    for (const value of values) await s.activate(row.id, value);
    assert.equal(FIELDS[row.id].current(await effective(env)), FIELDS[row.id].current(c0()), row.id);
  }
  assert.equal(await env.file(), before, 'navigation and selection do not write configuration');
  for (const item of enumItems({ conf: c0() }))
    assert.ok(s.row(item.id), `${item.id} remains in the menu`);
  assert.equal(await s.save(), true);
  for (const row of rows) {
    const expected = fieldValues(row.id, c0()).at(-1);
    assert.equal(FIELDS[row.id].current(await effective(env)), expected, `${row.id} saved from the shared table`);
  }
  s.close();
  await running;
});

test('closing the panel reports only changes explicitly saved with Ctrl+S', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const s = env.settings();
  await s.activate('capOutput', 'on');
  await s.activate('priceCatalogTtlHours', '72');
  assert.equal((await effective(env)).capOutput, false);
  assert.equal((await effective(env)).priceCatalogTtlHours, 24);
  assert.equal(s.dirty(), true);
  assert.equal(await s.save(), true);
  assert.equal(s.dirty(), false);
  s.close();
  await running;
  assert.match(text(env), /Cost · 2 change\(s\) saved/);
  assert.ok(text(env).includes(join(env.dir, '.pi', 'pi-suite.yaml')));
  const written = await env.saved();
  assert.equal(written.capOutput, true);
  assert.equal(written.priceCatalogTtlHours, 72);
});

test('an invalid current config keeps the draft and a corrected save can be retried', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const s = env.settings();
  await s.activate('capOutput', 'on');
  const original = await env.file();
  await writeFile(join(env.dir, '.pi', 'pi-suite.yaml'), 'costProfiler:\n  maxRequestOutputTokens: -1\n');
  const invalid = await env.file();
  assert.equal(await s.save(), false);
  assert.equal(s.dirty(), true, 'failed validation does not reset the draft');
  assert.equal(await env.file(), invalid, 'the invalid configuration was not rewritten');
  assert.match(s.status.at(-1), /Save failed:/);
  await writeFile(join(env.dir, '.pi', 'pi-suite.yaml'), original);
  assert.equal(await s.save(), true, 'a later valid save succeeds');
  assert.equal((await env.saved()).capOutput, true);
  assert.equal(s.dirty(), false);
  s.close();
  await running;
});

test('a canceled save signal leaves the file untouched and the draft usable', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const s = env.settings();
  await s.activate('capOutput', 'on');
  const before = await env.file();
  assert.equal(await s.save({ cancelBeforeWrite: true }), false);
  assert.equal(await env.file(), before);
  assert.equal(s.dirty(), true);
  assert.match(s.status.at(-1), /Operation canceled/);
  assert.equal(await s.save(), true);
  assert.equal((await env.saved()).capOutput, true);
  s.close();
  await running;
});

test('a command write cites the options when wrong, writes nothing, and never says /reload', async (t) => {
  const env = await costEnv(t);
  const before = await env.file();
  await assert.rejects(env.command('limits 999'), (e) => {
    assert.match(e.message, /Invalid maxRequestOutputTokens: 999/);
    assert.match(e.message, /Use: 1024 \| 2048 \| 4096 \| 8192/);
    return true;
  });
  assert.equal(await env.file(), before, 'nada foi escrito');
  await env.command('limits 4096');
  assert.match(text(env), /já em efeito/);
  assert.doesNotMatch(env.f.notifications.join('\n'), /\/reload/i);
  assert.equal((await env.saved()).maxRequestOutputTokens, 4096);
  // And it touched only its own section.
  assert.ok((await env.file()).includes('costProfiler:'));
});

test('a locked key is hidden from the panel and refused by the command', async (t) => {
  const env = await costEnv(t, { global: 'locked:\n  costProfiler:\n    capOutput: false\n' });
  const before = await env.file();
  await assert.rejects(env.command('cap on'), /travado por política global/);
  assert.equal(await env.file(), before);
  const { running } = await env.open();
  assert.ok(!env.settings().hasRow('capOutput'), 'locked row is hidden');
  assert.ok(env.settings().hasRow('auditRequired'));
  env.settings().close();
  await running;
});

/* ------------------------------------------------------------------ *
 *  3. Scope, budgets (two levels) and the pricing rescue.
 * ------------------------------------------------------------------ */

test('budget level and amount stay in the draft until save', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const s = env.settings();
  await s.activate('budgets', 'new:project', 'set:project:5.00');
  assert.equal((await effective(env)).budgets.project, undefined);
  assert.equal(s.dirty(), true);
  assert.deepEqual(s.choiceCalls[0].choices.map((choice) => choice.value), [
    'new:project', 'new:task', 'new:session',
  ]);
  assert.deepEqual(s.choiceCalls[1].choices.map((choice) => choice.value).sort(), [
    'set:project:0.50', 'set:project:1.00', 'set:project:100.00', 'set:project:20.00', 'set:project:5.00',
  ]);
  assert.equal(await s.save(), true);
  const written = await env.saved();
  assert.equal(written.budgets.project.hardUsd, 5);
  assert.equal(written.budgets.project.softUsd, 4, 'soft é 80% do hard');
  s.close();
  await running;
});

test('a command budget is visible as active and reports spend in its own scope', async (t) => {
  const env = await costEnv(t);
  await env.record({
    modelId: 'openrouter/cheap/model',
    provider: 'openrouter',
    model: 'cheap/model',
    estimatedCostUsd: 0.005,
    observedCostUsd: null,
  });
  await env.command('budget session 0.01 USD');
  const { running } = await env.open();
  const panel = env.settings();
  assert.match(panel.row('limits').value(), /session.*0\.01.*50%/);
  await panel.activate('limits');
  assert.match(panel.status.at(-1), /session.*0\.01.*50%/);
  panel.close();
  await running;
});

test('removing a budget is staged and deleted from persisted YAML on save', async (t) => {
  const env = await costEnv(t, { config: `${CONFIG}  budgets:\n    project:\n      hardUsd: 5\n      softUsd: 4\n` });
  const { running } = await env.open();
  const s = env.settings();
  await s.activate('budgets', 'remove:project');
  assert.equal((await effective(env)).budgets.project.hardUsd, 5, 'selection remains draft-only');
  assert.equal(s.dirty(), true, JSON.stringify({ choices: s.choiceCalls, value: s.row('budgets').value(), status: s.status }));
  const saved = await s.save();
  assert.equal(saved, true, JSON.stringify({ status: s.status, error: s.lastError }));
  assert.equal((await effective(env)).budgets.project, undefined, 'unset path removes the old nested key');
  s.close();
  await running;
});

test('the local-model candidates come from /scoped-models when it is not empty', async (t) => {
  const scoped = await costEnv(t, {
    models: [chat('cheap/model', 0.2), chat('local/llama', null)],
    scoped: [chat('local/llama', null)],
  });
  const { running } = await scoped.open();
  const s = scoped.settings();
  await s.activate('localModels', 'add:openrouter/local/llama');
  assert.equal((await effective(scoped)).localModels.includes('openrouter/local/llama'), false);
  assert.equal(s.dirty(), true);
  await s.save();
  assert.deepEqual((await scoped.saved()).localModels, ['openrouter/local/llama']);
  s.close();
  await running;
  // Empty scope ⇒ the authenticated catalogue is the candidate source (rule E).
  const all = await costEnv(t, { models: [chat('a/model', 1)], scoped: [] });
  const { running: r2 } = await all.open();
  const allPanel = all.settings();
  await allPanel.activate('localModels');
  assert.match(allPanel.status.at(-1), /No local model candidates|Count a\/model as local/);
  allPanel.close();
  await r2;
});

test('an unpriced call is named once, and accepting it persists the local model', async (t) => {
  const env = await costEnv(t);
  await env.record({
    modelId: 'openrouter/ghost/model',
    provider: 'openrouter',
    model: 'ghost/model',
    observedCostUsd: null,
    estimatedCostUsd: null,
  });
  const asks = [];
  env.f.ctx.ui.confirm = async (title, detail) => {
    asks.push([title, detail]);
    return true;
  };
  await env.command('now');
  assert.equal(asks.length, 1, 'perguntou uma vez');
  assert.match(asks[0][1], /ghost\/model/, 'nomeou o modelo');
  assert.match(asks[0][1], /▸ recomendado/);
  assert.deepEqual((await env.saved()).localModels, ['openrouter/ghost/model']);
  await env.command('now');
  assert.equal(asks.length, 1, 'não pergunta de novo depois de resolver');
});

test('refusing the pricing rescue leaves the account incomplete and says so without insisting', async (t) => {
  const env = await costEnv(t);
  await env.record({
    modelId: 'openrouter/ghost/model',
    provider: 'openrouter',
    model: 'ghost/model',
    observedCostUsd: null,
    estimatedCostUsd: null,
  });
  const asks = [];
  env.f.ctx.ui.confirm = async () => {
    asks.push(1);
    return false;
  };
  await env.command('now');
  assert.equal(asks.length, 1);
  assert.ok(!((await env.file()) ?? '').includes('localModels'), 'nada foi escrito');
  await env.command('now');
  assert.equal(asks.length, 1, 'sem insistir na mesma sessão');
  // A client with no dialog must still get the exact command, not a silent zero.
  const plain = await costEnv(t);
  await plain.record({ modelId: 'openrouter/x/y', provider: 'openrouter', model: 'x/y' });
  plain.f.ctx.mode = 'rpc';
  plain.f.ctx.ui.confirm = undefined;
  await plain.command('now');
  const advice = plain.f.notifications.find((n) => /fora do escopo de preço/.test(String(n)));
  assert.match(
    String(advice),
    /fora do escopo de preço: openrouter\/x\/y[\s\S]*\/cost local add openrouter\/x\/y/,
  );
});

test('scope task without a task selected reports an out-of-scope window, not a fake zero', async (t) => {
  const env = await costEnv(t);
  await env.record({
    modelId: 'openrouter/cheap/model',
    provider: 'openrouter',
    model: 'cheap/model',
    estimatedCostUsd: 0.01,
  });
  await env.command('scope task');
  // The write itself says what the change means: with no task selected, nothing is
  // attributed — which is exactly the honest answer, not a $0 that looks like a total.
  assert.match(text(env), /sem \/cost task <ID> nada é atribuído/);
  assert.equal((await env.saved()).scope.source, 'task');
  const { running } = await env.open();
  const s = env.settings();
  assert.equal(s.row('scopeSource').value(), 'task');
  assert.match(s.options.summary(), /scope task/);
  assert.match(s.row('coverage').description, /Calls without a known price/);
  s.close();
  await running;
});

/* ------------------------------------------------------------------ *
 *  4. Degradation and the entry point.
 * ------------------------------------------------------------------ */


test('language selection previews pt-BR and saves only to the trusted project on Ctrl+S', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const s = env.settings();
  const configBefore = await env.file();
  assert.equal(s.row('language').label, 'Language');
  assert.equal(s.row('language').value(), 'English (default)');
  assert.equal(s.row('spend').label, 'Spend in window');
  await s.activate('language', 'pt-BR');
  assert.equal(s.row('language').value(), 'Português (Brasil)');
  assert.equal(s.row('spend').label, 'Gasto no período');
  assert.equal(s.row('scopeSource').label, 'Escopo da conta');
  assert.match(s.options.summary(), /Contabilidade ativa/);
  assert.equal(s.options.shell().unsaved.startsWith('Há alterações'), true);
  assert.equal(s.dirty(), true);
  assert.equal(await env.file(), configBefore, 'preview does not write Pi Suite config');
  const localePath = join(env.dir, '.pi', 'pi-cost-profiler.locale.json');
  await assert.rejects(readFile(localePath, 'utf8'), { code: 'ENOENT' });
  assert.equal(await s.save(), true);
  assert.deepEqual(JSON.parse(await readFile(localePath, 'utf8')), { schemaVersion: 1, locale: 'pt-BR' });
  assert.equal(await env.file(), configBefore, 'language preference stays separate from cost settings');
  s.close();
  await running;
});

test('closing with an unsaved language preview discards it without creating a preference', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const s = env.settings();
  const configBefore = await env.file();
  const localePath = join(env.dir, '.pi', 'pi-cost-profiler.locale.json');
  await s.activate('language', 'pt-BR');
  assert.equal(s.row('spend').label, 'Gasto no período');
  assert.equal(s.dirty(), true);
  s.close();
  await running;
  await assert.rejects(readFile(localePath, 'utf8'), { code: 'ENOENT' });
  assert.equal(await env.file(), configBefore);
});

test('untrusted project can preview language but cannot persist it globally or locally', async (t) => {
  const env = await costEnv(t);
  env.f.ctx.isProjectTrusted = () => false;
  const { running } = await env.open();
  const s = env.settings();
  assert.equal(s.row('language').value(), 'English (default)');
  await s.activate('language', 'pt-BR');
  assert.equal(s.row('coverage').label, 'Cobertura de preços');
  assert.equal(await s.save(), false);
  assert.equal(s.dirty(), true, 'failed locale save keeps the preview draft');
  await assert.rejects(readFile(join(env.dir, '.pi', 'pi-cost-profiler.locale.json'), 'utf8'), { code: 'ENOENT' });
  await assert.rejects(readFile(join(env.state, 'config.yaml'), 'utf8'), { code: 'ENOENT' });
  assert.match(s.status.at(-1), /Trust this project|Confie neste projeto/);
  s.close();
  await running;
});

test('a failed locale write retains the draft so Ctrl+S can retry', async (t) => {
  const env = await costEnv(t);
  const localePath = join(env.dir, '.pi', 'pi-cost-profiler.locale.json');
  await mkdir(localePath);
  const { running } = await env.open();
  const s = env.settings();
  await s.activate('language', 'pt-BR');
  assert.equal(await s.save(), false);
  assert.equal(s.dirty(), true);
  assert.match(s.status.at(-1), /Falha ao salvar:/);
  await rm(localePath, { recursive: true, force: true });
  assert.equal(await s.save(), true);
  assert.deepEqual(JSON.parse(await readFile(localePath, 'utf8')), { schemaVersion: 1, locale: 'pt-BR' });
  s.close();
  await running;
});

test('localization leaves the /cost command and direct action identifiers unchanged', async () => {
  const extension = await readFile(new URL('../extension.mjs', import.meta.url), 'utf8');
  assert.match(extension, /pi\.registerCommand\('cost'/);
  assert.match(extension, /name: 'cost'/);
  for (const id of ['now', 'task', 'project', 'compare', 'budget', 'export', 'reconcile', 'help'])
    assert.match(extension, new RegExp('^\\s*' + id + ':', 'm'), id);
});

test('an unavailable settings panel degrades to direct commands and a state summary', async (t) => {
  const env = await costEnv(t);
  host.settingsPanel = undefined;
  await env.command('');
  assert.ok(!env.f.ctx.lastScreen, 'nenhuma tela montada');
  assert.match(env.f.notifications.join('\n'), /Interactive panel unavailable.*settings panel module is unavailable/);
  const fallback = text(env);
  assert.match(fallback, /Cost ·/);
  assert.ok(
    fallback.indexOf('coverage') < fallback.indexOf('/cost now') || fallback.indexOf('cobertura de preço') < fallback.indexOf('/cost now'),
    'state precedes command syntax',
  );
});

test('the pi entry point imports the host modules statically and hands them over', async () => {
  const entry = await readFile(new URL('../index.ts', import.meta.url), 'utf8');
  assert.match(entry, /import \* as piTui from ['"]@earendil-works\/pi-tui['"]/);
  assert.match(entry, /import \* as piAgent from ['"]@earendil-works\/pi-coding-agent['"]/);
  assert.match(entry, /import \{ openSettingsPanel \} from ['"]\.\/lib\/settings-panel\.ts['"]/);
  assert.match(entry, /install\(pi, undefined, \{ tui: piTui, agent: piAgent, settingsPanel: openSettingsPanel \}\)/);
  const extension = await readFile(new URL('../extension.mjs', import.meta.url), 'utf8');
  assert.match(extension, /provideHost\(injected\.tui, injected\.agent\)/);
  assert.match(extension, /provideSettingsPanel\(injected\.settingsPanel\)/);
});

test('amount rows are exactly the table amounts, recommendation first', () => {
  const rows = amountRows('task', { ...c0(), budgets: { task: { hardUsd: 1 } } });
  assert.deepEqual(rows.map((r) => r.value), [
    'set:task:0.50',
    'set:task:1.00',
    'set:task:5.00',
    'set:task:20.00',
    'set:task:100.00',
  ]);
  assert.match(rows[0].label, /^▸ recomendado task \$0\.50/);
  assert.match(rows[1].description, /valor atual/);
});
