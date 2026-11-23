// Drives the real /cost panel (vendored Pi settings adapter) by terminal bytes, with the real
// pi-tui KeybindingsManager. No model, provider or network is used; only the fixture's files.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG, KEY, costEnv, chat, visibleWidth, waitFor } from '../test-support/panel.mjs';
import { FIELDS, fieldValues, applyField, c0, host } from '../menu.mjs';
import { FIELD_ORDER, patchFrom, valuesFrom } from '../lib/panel.mjs';
import { validateConfig } from '../lib/core.mjs';

const text = (env) => String(env.f.notifications.at(-1));
const SECTION = new Set(Object.keys(c0()));
const effective = async (env) => ({ ...c0(), ...(await env.saved()) });
const TABLE = Object.keys(FIELDS).filter((id) => FIELDS[id].kind !== 'list');
const isBoolean = (id) => String(fieldValues(id)) === 'on,off';
/** Portuguese words that must never appear while the panel is in English. */
const PT_WORDS =
  /Salvar|Ajuda|Fechar|navegar|editar|Orçamento|Configurações|Custos|Alterações|Rascunho|nenhum|sessão|Ativa|Desativada|Contabilidade|Gasto|Limite|chamada/;

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

test('panel values are flat and their patch round-trips through the shared table', () => {
  const conf = { ...c0(), budgets: { session: { hardUsd: 0.01, softUsd: 0.008 } }, scope: { source: 'task', strict: false } };
  const before = valuesFrom(conf, 'en');
  assert.deepEqual(Object.keys(before).sort(), [...FIELD_ORDER].sort());
  assert.equal(before['budget.session'], '0.01');
  assert.equal(before['budget.project'], 'none');
  assert.equal(before.scopeStrict, false);
  const after = { ...before, 'budget.session': 'none', 'budget.task': '5.00', scopeSource: 'project', scopeStrict: true, capOutput: true };
  const { patch, unset, changed } = patchFrom(before, after, conf);
  assert.deepEqual(unset, [['budgets', 'session']]);
  assert.deepEqual(patch.budgets, { task: { hardUsd: 5, softUsd: 4 } });
  assert.deepEqual(patch.scope, { source: 'project', strict: true }, 'both scope dials merge into one patch');
  assert.equal(patch.capOutput, true);
  assert.deepEqual(changed, ['budget.task', 'budget.session', 'capOutput', 'scopeSource', 'scopeStrict']);
  assert.deepEqual(patchFrom(before, after, conf, { locked: { budgets: 1, scope: 1 } }).changed, ['capOutput'], 'locked keys are never written');
});

/* ------------------------------------------------------------------ *
 *  2. Keyboard, draft and Ctrl+S on the real adapter.
 * ------------------------------------------------------------------ */

test('/cost opens the panel in English with current values; Esc on a clean panel closes it', async (t) => {
  const env = await costEnv(t);
  const before = await env.file();
  const { running } = await env.open();
  const p = env.panel;
  await env.ready();
  const s = p.screen(120);
  for (const expected of ['Cost / Settings', 'Accounting on', 'scope session', 'Language', 'English (default)',
    'Project budget', 'No limit', 'Local models', 'Output token limit', '2048', 'Spend in window', '$0.0000',
    'Price coverage', '0/0', 'Active limits', 'Command line', 'Ctrl+S save', 'Esc close'])
    assert.ok(s.includes(expected), `missing ${expected}`);
  assert.doesNotMatch(s, PT_WORDS, 'English panel shows no Portuguese');
  assert.doesNotMatch(p.lines(120)[0], /\*/);
  assert.equal(p.overlays[0].overlay, true);
  await p.key(KEY.esc);
  assert.equal(p.closed(), true);
  await running;
  assert.equal(await env.file(), before, 'opening and closing writes nothing');
  assert.equal(text(env), 'Cost · no changes were saved.');
});

test('every offered field value stays draft-only until Ctrl+S commits the same table value', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const p = env.panel;
  const before = await env.file();
  for (const id of TABLE) {
    await p.goto(id);
    if (isBoolean(id)) await p.key(KEY.enter);
    else {
      await p.key(KEY.enter);
      for (let i = 0; i < fieldValues(id).length; i++) await p.key(KEY.down);
      await p.key(KEY.enter);
    }
    assert.equal(FIELDS[id].current(await effective(env)), FIELDS[id].current(c0()), `${id} is not written by selection`);
  }
  assert.equal(await env.file(), before, 'navigation and selection do not write configuration');
  assert.match(p.lines()[0], /Cost \/ Settings \*/);
  await p.key(KEY.ctrlS);
  assert.equal(p.closed(), false, 'Ctrl+S keeps the panel open');
  assert.match(p.screen(), /Changes saved\. Cost settings are active\./);
  assert.doesNotMatch(p.lines()[0], /\*/);
  for (const id of TABLE) {
    const expected = isBoolean(id)
      ? (FIELDS[id].current(c0()) === 'on' ? 'off' : 'on')
      : fieldValues(id).at(-1);
    assert.equal(FIELDS[id].current(await effective(env)), expected, `${id} saved from the shared table`);
  }
  await p.key(KEY.esc);
  await running;
  assert.match(text(env), new RegExp(`Cost · ${TABLE.length} change\\(s\\) saved`));
  assert.ok(text(env).includes(join(env.dir, '.pi', 'pi-suite.yaml')));
});

test('Esc in a field goes back without applying the choice', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const p = env.panel;
  await p.goto('maxRequestOutputTokens');
  await p.keys(KEY.enter, KEY.down, KEY.down);
  assert.match(p.screen(), /4096/);
  await p.key(KEY.esc);
  assert.equal(p.closed(), false);
  assert.equal(p.session().draft.maxRequestOutputTokens, '2048');
  assert.doesNotMatch(p.lines()[0], /\*/, 'nothing was staged');
  await p.key(KEY.esc);
  await running;
  assert.equal(p.closed(), true);
});

test('Esc with a draft warns, the second Esc discards and closes without writing', async (t) => {
  const env = await costEnv(t);
  const before = await env.file();
  const { running } = await env.open();
  const p = env.panel;
  await p.goto('capOutput');
  await p.key(KEY.enter);
  assert.match(p.lines()[0], /\*/);
  await p.key(KEY.esc);
  assert.equal(p.closed(), false, 'the first Esc only warns');
  assert.match(p.screen(), /There are unsaved changes\./);
  assert.match(p.screen(), /Press Esc again to discard the changes and close\./);
  await p.key(KEY.esc);
  assert.equal(p.closed(), true);
  await running;
  assert.equal(await env.file(), before);
  assert.equal(text(env), 'Cost · no changes were saved.');
});

test('an invalid config on disk keeps the draft and a corrected save can be retried', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const p = env.panel;
  await p.goto('capOutput');
  await p.key(KEY.enter);
  const original = await env.file();
  await writeFile(join(env.dir, '.pi', 'pi-suite.yaml'), 'costProfiler:\n  maxRequestOutputTokens: -1\n');
  const invalid = await env.file();
  await p.key(KEY.ctrlS);
  assert.match(p.screen(), /Save failed:/);
  assert.match(p.lines()[0], /\*/, 'failed validation keeps the draft');
  assert.equal(p.session().draft.capOutput, true);
  assert.equal(await env.file(), invalid, 'the invalid configuration was not rewritten');
  await writeFile(join(env.dir, '.pi', 'pi-suite.yaml'), original);
  await p.key(KEY.ctrlS);
  assert.equal((await env.saved()).capOutput, true, 'a later valid save succeeds');
  assert.doesNotMatch(p.lines()[0], /\*/);
  await p.key(KEY.esc);
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
  assert.ok((await env.file()).includes('costProfiler:'));
});

test('a locked key shows its source, cannot be edited and is never written', async (t) => {
  const env = await costEnv(t, { global: 'locked:\n  costProfiler:\n    capOutput: false\n' });
  const before = await env.file();
  await assert.rejects(env.command('cap on'), /travado por política global/);
  assert.equal(await env.file(), before);
  const { running } = await env.open();
  const p = env.panel;
  assert.match(p.screen(), /Cap output tokens\s+Off \[source: global policy\]/);
  await p.goto('capOutput');
  await p.key(KEY.enter);
  assert.match(p.screen(), /Locked by the global policy \(locked\.costProfiler\)/);
  assert.doesNotMatch(p.lines()[0], /\*/, 'a locked row stages nothing');
  await p.goto('auditRequired');
  await p.keys(KEY.enter, KEY.ctrlS);
  const saved = await env.saved();
  assert.equal(saved.auditRequired, true);
  assert.ok(!Object.hasOwn(saved, 'capOutput'), 'the locked key is not written');
  await p.key(KEY.esc);
  await running;
});

/* ------------------------------------------------------------------ *
 *  3. Budgets, local models, scope and the pricing rescue.
 * ------------------------------------------------------------------ */

test('a budget amount stays in the draft until Ctrl+S writes hard and soft (80%)', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const p = env.panel;
  await p.goto('budget.project');
  await p.key(KEY.enter);
  const menu = p.screen();
  for (const choice of ['No limit', 'USD 0.50 · warns at 0.40', 'USD 1.00', 'USD 5.00 · warns at 4.00', 'USD 20.00', 'USD 100.00'])
    assert.ok(menu.includes(choice), `missing ${choice}`);
  await p.keys(KEY.down, KEY.down, KEY.down, KEY.enter);
  assert.match(p.screen(), /Project budget\s+USD 5\.00 · warns at 4\.00/);
  assert.equal((await effective(env)).budgets.project, undefined);
  await p.key(KEY.ctrlS);
  const written = await env.saved();
  assert.equal(written.budgets.project.hardUsd, 5);
  assert.equal(written.budgets.project.softUsd, 4, 'soft é 80% do hard');
  await p.key(KEY.esc);
  await running;
});

test('choosing No limit removes the persisted budget on save', async (t) => {
  const env = await costEnv(t, { config: `${CONFIG}  budgets:\n    project:\n      hardUsd: 5\n      softUsd: 4\n` });
  const { running } = await env.open();
  const p = env.panel;
  assert.match(p.screen(), /Project budget\s+USD 5\.00/);
  await p.goto('budget.project');
  await p.key(KEY.enter);
  for (let i = 0; i < 6; i++) await p.key(KEY.up);
  await p.key(KEY.enter);
  assert.equal((await effective(env)).budgets.project.hardUsd, 5, 'selection remains draft-only');
  await p.key(KEY.ctrlS);
  assert.equal((await effective(env)).budgets?.project, undefined, 'unset path removes the old nested key');
  await p.key(KEY.esc);
  await running;
});

test('values outside the table stay selectable and are not rewritten by an unrelated save', async (t) => {
  const env = await costEnv(t, {
    config: 'costProfiler:\n  maxRequestOutputTokens: 3000\n  budgets:\n    session:\n      hardUsd: 0.01\n      softUsd: 0.005\n',
  });
  const { running } = await env.open();
  const p = env.panel;
  assert.match(p.screen(), /Session budget\s+USD 0\.01 · warns at 0\.005/);
  assert.match(p.screen(), /Output token limit\s+3000/);
  await p.goto('capOutput');
  await p.keys(KEY.enter, KEY.ctrlS);
  const saved = await env.saved();
  assert.equal(saved.capOutput, true);
  assert.equal(saved.maxRequestOutputTokens, 3000);
  assert.deepEqual(saved.budgets.session, { hardUsd: 0.01, softUsd: 0.005 }, 'a custom soft limit is kept');
  await p.key(KEY.esc);
  await running;
});

test('a command budget is visible as an active limit and Enter reports it in its own scope', async (t) => {
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
  const p = env.panel;
  await env.ready();
  assert.match(p.screen(140), /Active limits\s+session · command: hard limit USD 0\.01 · 50% used/);
  assert.match(p.screen(140), /\$0\.0050 · 1\/1 priced/);
  await p.goto('limits');
  await p.key(KEY.enter);
  assert.match(p.screen(140).split('\n').slice(-4).join('\n'), /session · command: hard limit USD 0\.01 · 50% used · output cap 2048 tokens/);
  await p.key(KEY.esc);
  await running;
});

test('local-model candidates come from /scoped-models and the multiselect stays a draft', async (t) => {
  const env = await costEnv(t, {
    models: [chat('cheap/model', 0.2), chat('local/llama', null)],
    scoped: [chat('local/llama', null)],
  });
  const { running } = await env.open();
  const p = env.panel;
  await p.goto('localModels');
  await p.key(KEY.enter);
  assert.match(p.screen(), /\[ \] openrouter\/local\/llama/);
  await p.keys(KEY.space, KEY.enter);
  assert.match(p.screen(), /Local models\s+1 model\(s\)/);
  assert.equal((await effective(env)).localModels.includes('openrouter/local/llama'), false);
  await p.key(KEY.ctrlS);
  assert.deepEqual((await env.saved()).localModels, ['openrouter/local/llama']);
  await p.key(KEY.esc);
  await running;
  // Empty scope: no candidate to offer, and the row says how to add one.
  const empty = await costEnv(t, { models: [chat('a/model', 1)], scoped: [] });
  const second = await empty.open();
  await empty.panel.goto('localModels');
  assert.match(empty.panel.screen(140), /No local model candidates\. Use \/scoped-models or \/cost local add/);
  await empty.panel.key(KEY.esc);
  await second.running;
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
  assert.match(text(env), /sem \/cost task <ID> nada é atribuído/);
  assert.equal((await env.saved()).scope.source, 'task');
  const { running } = await env.open();
  const p = env.panel;
  await env.ready();
  assert.match(p.screen(140), /Accounting scope\s+task/);
  assert.match(p.screen(140), /scope task/);
  // Without /cost task ID the window holds the unattributed calls and says so ("task —").
  assert.match(p.screen(140), /\$0\.0100 · 1\/1 priced · scope task —/);
  await p.goto('coverage');
  assert.match(p.screen(140), /Calls without a known price stay visible/);
  await p.key(KEY.esc);
  await running;
});

/* ------------------------------------------------------------------ *
 *  4. Language: English default, PT-BR preview, Ctrl+S persistence.
 * ------------------------------------------------------------------ */

test('choosing pt-BR previews every text at once and Ctrl+S saves only the project language', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const p = env.panel;
  const configBefore = await env.file();
  await p.goto('language');
  await p.keys(KEY.enter, KEY.down, KEY.enter);
  const s = p.screen(120);
  for (const expected of ['Custos / Configurações *', 'Idioma', 'Português (Brasil)', 'Gasto no período',
    'Orçamento do projeto', 'Escopo da conta', 'Contabilidade ativa', 'Alterações não salvas', '↑↓ navegar', 'Ctrl+S salvar'])
    assert.ok(s.includes(expected), `missing ${expected}`);
  assert.equal(await env.file(), configBefore, 'preview does not write Pi Suite config');
  await assert.rejects(readFile(env.localePath, 'utf8'), { code: 'ENOENT' });
  await p.key(KEY.ctrlS);
  assert.deepEqual(JSON.parse(await readFile(env.localePath, 'utf8')), { schemaVersion: 1, locale: 'pt-BR' });
  assert.equal(await env.file(), configBefore, 'language preference stays separate from cost settings');
  assert.match(p.screen(120), /Alterações salvas\. As configurações de custo estão ativas\./);
  assert.equal(p.closed(), false);
  await p.key(KEY.esc);
  await running;
  assert.match(text(env), /Custos · 1 alteração\(ões\) salva\(s\)\n· Idioma salvo: Português \(Brasil\)\./);
  // Reopening starts in the saved language.
  const again = await env.open();
  assert.match(p.screen(120), /Custos \/ Configurações/);
  await p.key(KEY.esc);
  await again.running;
});

test('discarding an unsaved language preview returns to English and writes nothing', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const p = env.panel;
  const configBefore = await env.file();
  await p.goto('language');
  await p.keys(KEY.enter, KEY.down, KEY.enter);
  assert.match(p.screen(), /Gasto no período/);
  await p.key(KEY.esc);
  assert.match(p.screen(), /Esc novamente descarta as alterações e fecha\./);
  await p.key(KEY.esc);
  await running;
  await assert.rejects(readFile(env.localePath, 'utf8'), { code: 'ENOENT' });
  assert.equal(await env.file(), configBefore);
  assert.equal(text(env), 'Cost · no changes were saved.');
});

test('an untrusted project shows the language as locked and cannot save it', async (t) => {
  const env = await costEnv(t);
  env.f.ctx.isProjectTrusted = () => false;
  const { running } = await env.open();
  const p = env.panel;
  assert.match(p.screen(120), /Language\s+English \(default\) \[locked: project trust\]/);
  await p.goto('language');
  await p.key(KEY.enter);
  assert.match(p.screen(120), /Trust this project to save its language preference\./);
  assert.doesNotMatch(p.lines()[0], /\*/);
  await p.key(KEY.esc);
  await running;
  await assert.rejects(readFile(env.localePath, 'utf8'), { code: 'ENOENT' });
  await assert.rejects(readFile(join(env.state, 'config.yaml'), 'utf8'), { code: 'ENOENT' });
});

test('a failed locale write keeps the draft so Ctrl+S can retry', async (t) => {
  const env = await costEnv(t);
  await mkdir(env.localePath);
  const { running } = await env.open();
  const p = env.panel;
  await p.goto('language');
  await p.keys(KEY.enter, KEY.down, KEY.enter, KEY.ctrlS);
  assert.match(p.screen(120), /Falha ao salvar:/);
  assert.match(p.lines()[0], /Custos \/ Configurações \*/);
  await rm(env.localePath, { recursive: true, force: true });
  await p.key(KEY.ctrlS);
  assert.deepEqual(JSON.parse(await readFile(env.localePath, 'utf8')), { schemaVersion: 1, locale: 'pt-BR' });
  assert.doesNotMatch(p.lines()[0], /\*/);
  await p.key(KEY.esc);
  await running;
});

/* ------------------------------------------------------------------ *
 *  5. Layout, lifecycle, degradation and the entry point.
 * ------------------------------------------------------------------ */

test('every line fits 40, 80 and 120 columns in English and pt-BR, with Unicode in the state', async (t) => {
  const env = await costEnv(t);
  await env.record({ modelId: 'openrouter/モデル-🎙️-çãé', provider: 'openrouter', model: 'モデル-🎙️-çãé' });
  const { running } = await env.open();
  const p = env.panel;
  await env.ready();
  const check = (label) => {
    for (const width of [40, 80, 120]) {
      const lines = p.lines(width);
      assert.ok(lines.length > 3, `${label} ${width}: rendered`);
      for (const line of lines) assert.ok(visibleWidth(line) <= width, `${label} ${width}: "${line}" is ${visibleWidth(line)} wide`);
    }
  };
  check('en');
  await p.goto('coverage');
  await p.key(KEY.enter);
  assert.match(p.screen(120), /unknown: openrouter\/モデル-🎙️-çãé/);
  check('en status');
  await p.goto('language');
  await p.keys(KEY.enter, KEY.down, KEY.enter);
  check('pt-BR');
  await p.goto('budget.project');
  await p.key(KEY.enter);
  check('pt-BR submenu');
  await p.key(KEY.esc);
  p.terminal.rows = 10;
  // 10 terminal rows, 95% overlay height: 9 rows for the panel.
  assert.match(p.screen(30), /Terminal pequeno demais \(30×9;\s+mínimo 40×12\)/);
  for (const line of p.lines(30)) assert.ok(visibleWidth(line) <= 30);
  p.terminal.rows = 40;
  await p.keys(KEY.esc, KEY.esc);
  await running;
});

test('session shutdown closes an open panel without saving its draft', async (t) => {
  const env = await costEnv(t);
  const before = await env.file();
  const { running } = await env.open();
  const p = env.panel;
  await p.goto('capOutput');
  await p.key(KEY.enter);
  await env.f.emit('session_shutdown');
  assert.equal(p.closed(), true, 'the owner signal closed the panel');
  assert.equal(await running, undefined);
  assert.equal(await env.file(), before);
  assert.ok(!env.f.notifications.some((n) => /change\(s\) saved|no changes were saved/.test(String(n))), 'no summary on a stale session');
});

test('an unavailable settings panel degrades to direct commands and a state summary', async (t) => {
  const env = await costEnv(t);
  host.settingsPanel = undefined;
  await env.command('');
  assert.equal(env.panel.opened(), false, 'nenhuma tela montada');
  assert.match(env.f.notifications.join('\n'), /Interactive panel unavailable.*settings panel module is unavailable/);
  const fallback = text(env);
  assert.match(fallback, /Cost ·/);
  assert.ok(fallback.indexOf('cobertura de preço') < fallback.indexOf('/cost now'), 'state precedes command syntax');
});

test('a host that cannot open the overlay degrades to the text summary', async (t) => {
  const env = await costEnv(t);
  env.f.ctx.ui.custom = () => {
    throw Error('overlay unsupported');
  };
  await env.command('');
  assert.match(text(env), /Interactive panel unavailable: Could not open the panel\. Check the host API\./);
  assert.match(text(env), /\/cost now \| task ID/);
});

test('localization leaves the /cost command and direct action identifiers unchanged', async () => {
  const extension = await readFile(new URL('../extension.mjs', import.meta.url), 'utf8');
  assert.match(extension, /pi\.registerCommand\('cost'/);
  assert.match(extension, /name: 'cost'/);
  for (const id of ['now', 'task', 'project', 'compare', 'budget', 'export', 'reconcile', 'help'])
    assert.match(extension, new RegExp('^\\s*' + id + ':', 'm'), id);
});

test('the pi entry point imports the settings adapter statically and hands it over', async () => {
  const entry = await readFile(new URL('../index.ts', import.meta.url), 'utf8');
  assert.match(entry, /import \{ openPiSettings \} from ['"]\.\/vendor\/inteiro-terminal\/pi\.js['"]/);
  assert.match(entry, /install\(pi, undefined, \{ settingsPanel: openPiSettings \}\)/);
  const extension = await readFile(new URL('../extension.mjs', import.meta.url), 'utf8');
  assert.match(extension, /provideSettingsPanel\(injected\.settingsPanel\)/);
  for (const file of ['../extension.mjs', '../menu.mjs', '../lib/panel.mjs']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /import\(['"]@earendil-works/, `${file} must not import a host module dynamically`);
    assert.doesNotMatch(source, /from ['"]@earendil-works/, `${file} must not import a host module`);
  }
});

test('waitFor helper fails loudly instead of hanging', async () => {
  await assert.rejects(waitFor(() => false, 'nada', 30), /timeout aguardando: nada/);
});

test('a second /cost while the panel is open does not open another one', async (t) => {
  const env = await costEnv(t);
  const { running } = await env.open();
  const opens = env.panel.opens();
  await env.command('');
  assert.equal(env.panel.opens(), opens);
  assert.equal(text(env), 'The /cost panel is already open.');
  await env.panel.key(KEY.esc);
  await running;
});
