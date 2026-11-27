/**
 * Real-host smoke for the `/cost` panel.
 *
 * Same contract as the other packages' smoke: the unit tests drive a hand-written
 * double, and a double is only as good as the host it mirrors. This script loads
 * `index.ts` through the pi's own jiti loader (the static-import host map, M1), checks
 * the export provenance table (M2), opens the panel with bare `/cost`, drives it with
 * terminal bytes, and prints the money state before and after.
 *
 * Nothing here calls a model or a provider: the ledger rows are written straight into
 * the fixture's store, and the panel only writes this repo's config file.
 *
 *   node scripts/smoke-panel.mjs       # optionally PI_CODING_AGENT_ENTRY=<pi>/dist/index.js
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { piExtensions } from './pi-module.mjs';
import { fakePi } from '../test-support/fakes.mjs';
import { HOST_EXPORTS, missingHostExports, panelItems } from '../menu.mjs';
import { defaults as costDefaults } from '../extension.mjs';

const DOWN = '\x1b[B';
const ENTER = '\r';
const ESC = '\x1b';
const SAVE = '\x13';
const url = (p) => pathToFileURL(p).href;
const firstLine = (t) => String(t).split('\n')[0];
const strip = (line) => String(line).replace(/\x1b\[[0-9;]*m/g, '');

async function exists(path) {
  try {
    return (await readFile(path)) && path;
  } catch {
    return undefined;
  }
}

async function agentEntry() {
  const releases = join(homedir(), '.pi', 'agent', 'install', 'releases');
  const candidates = [
    process.env.PI_CODING_AGENT_ENTRY,
    ...(await readdir(releases)
      .catch(() => [])
      .then((versions) =>
        versions
          .sort()
          .reverse()
          .map((v) =>
            join(releases, v, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
          ),
      )),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const path = candidate.replace(/[/\\]$/, '').replace(/[\\/]dist[/\\]?$/, '/dist/index.js');
    if (await exists(path)) return path;
  }
  throw Error('installed pi-coding-agent/dist/index.js not found; set PI_CODING_AGENT_ENTRY');
}

async function realModules() {
  const entry = await agentEntry();
  const dist = dirname(entry);
  const agent = await import(url(entry));
  const theme = await import(url(join(dist, 'modes', 'interactive', 'theme', 'theme.js')));
  let tui;
  for (const candidate of [
    join(dist, '..', '..', 'pi-tui', 'dist', 'index.js'),
    join(dist, '..', '..', '..', 'pi-tui', 'dist', 'index.js'),
  ]) {
    try {
      const mod = await import(url(candidate));
      if (mod.SettingsList && mod.Container && mod.Input && mod.getKeybindings) {
        tui = mod;
        break;
      }
    } catch {
      /* next candidate */
    }
  }
  if (!tui) throw Error('installed pi-tui not importable from the pi release directory');
  return { entry, agent, theme, tui };
}



const run = async () => {
  const host = await realModules();
  console.log(`host: ${host.entry}`);
  for (const name of HOST_EXPORTS['@earendil-works/pi-tui'])
    console.log(`  pi-tui.${name}: ${typeof host.tui[name]}`);
  for (const name of [...HOST_EXPORTS['@earendil-works/pi-coding-agent'], 'keyHint', 'keyText'])
    console.log(`  pi-coding-agent.${name}: ${typeof host.agent[name]}`);
  const table = missingHostExports(host.tui, host.agent);
  if (table.length) throw Error(`host module shape changed: missing ${table.join(', ')}`);

  const { loadExtensions, createExtensionRuntime } = await piExtensions();
  const entry = join(process.cwd(), 'index.ts');
  const loaded = await loadExtensions([entry], process.cwd(), undefined, createExtensionRuntime());
  if (loaded.errors?.length)
    throw Error(`extension did not load: ${loaded.errors.map((e) => e.error ?? e).join('; ')}`);
  const command = loaded.extensions
    .flatMap((e) => [...e.commands.values()])
    .find((c) => c.name === 'cost');
  if (!command) throw Error('the real loader did not register /cost');

  host.theme.initTheme?.();
  const theme = host.theme.theme;
  const keybindings = host.tui.getKeybindings();

  const dir = await mkdtemp(join(tmpdir(), 'cost-smoke-'));
  const state = await mkdtemp(join(tmpdir(), 'cost-smoke-state-'));
  const old = process.env.PI_SUITE_HOME;
  process.env.PI_SUITE_HOME = state;
  try {
    execFileSync('git', ['init', dir], { stdio: 'ignore' });
    await mkdir(join(dir, '.pi'), { recursive: true });
    await writeFile(join(dir, 'README.md'), 'fixture\n');
    await writeFile(
      join(dir, '.pi', 'pi-suite.yaml'),
      'costProfiler:\n  enabled: true\n  maxRequestOutputTokens: 2048\n',
    );

    const notes = [];
    const f = fakePi(dir, [
      {
        provider: 'openrouter',
        id: 'cheap/model',
        name: 'cheap',
        api: 'openai-completions',
        input: ['text'],
        cost: { input: 0.2, output: 0.6 },
        contextWindow: 200000,
        maxTokens: 8192,
      },
    ]);
    f.ctx.scopedModels = [{ model: f.models?.[0] ?? {} }];
    f.ctx.ui.notify = (text) => notes.push(String(text));
    f.ctx.ui.setStatus = () => {};
    f.ctx.ui.confirm = async () => false;
    let screen = null;
    let close;
    const closed = new Promise((resolve) => (close = resolve));
    f.ctx.ui.custom = (factory) => {
      const terminal = { rows: 24 };
      screen = factory({ terminal, requestRender: () => {} }, theme, keybindings, (result) => close(result));
      return closed;
    };
    const ctx = f.ctx;
    const show = (label, limit = 30) => {
      console.log(`\n──── ${label}`);
      if (!screen) {
        console.log('   (nenhuma tela: /cost não abriu painel)');
        return;
      }
      for (const line of screen.render(96).slice(0, limit)) console.log(`   ${strip(line)}`);
    };
    const send = (bytes) => screen.handleInput(bytes);
    const saved = () => readFile(join(dir, '.pi', 'pi-suite.yaml'), 'utf8').catch(() => '(sem arquivo)');
    const waitFor = async (predicate, what, ms = 8000) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (await predicate()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw Error(`timeout aguardando: ${what}`);
    };
    const decision = async (label, args = 'now') => {
      await command.handler(args, ctx);
      console.log(`\n${label}`);
      for (const line of String(notes.at(-1)).split('\n')) console.log('   ' + strip(line));
    };

    await decision('DECISÃO ANTES DO PAINEL (gasto, cobertura de preço, limites):', 'now');
    const before = await saved();

    const rows = ['language', ...panelItems({ conf: costDefaults.costProfiler, locked: {}, state: {} }).map((r) => r.id)];
    const rowIndex = (id) => rows.indexOf(id);
    let cursor = 0;
    const goto = (index) => {
      const steps = (index - cursor + rows.length) % rows.length;
      for (let i = 0; i < steps; i++) send(DOWN);
      cursor = index;
      return steps;
    };
    const catalogRow = rowIndex('priceCatalogTtlHours');
    const budgetsRow = rowIndex('budgets');
    if (catalogRow < 0 || budgetsRow < 0) throw Error('linhas esperadas fora da tabela');

    const running = command.handler('', ctx);
    await waitFor(() => screen, 'a tela do painel aparecer');
    show('painel aberto com /cost (vazio)');
    for (const width of [40, 80, 120]) {
      assert.ok(screen.render(width).every((line) => host.tui.visibleWidth(line) <= width));
    }

    console.log(`\n(cursor 0 → ${goto(catalogRow)}× ↓ até "Validade do catálogo de preços")`);
    send(ENTER);
    send(DOWN);
    send(ENTER);
    await screen.drain();
    assert.equal(await saved(), before, 'a escolha do TTL só altera o rascunho');
    assert.match(strip(screen.render(96)[0]), /\*/);

    console.log(`\n(cursor ${cursor} → ${goto(budgetsRow)}× ↓ até "Orçamentos")`);
    send(ENTER);
    show('submenu de orçamentos aberto');
    send(ENTER);
    await new Promise((r) => setImmediate(r));
    show('segundo nível aberto para escolher o valor');
    send(ENTER);
    await screen.drain();
    assert.equal(await saved(), before, 'a escolha do limite só altera o rascunho');

    send(SAVE);
    await screen.drain();
    const updated = parse(await saved()).costProfiler;
    assert.ok(updated.priceCatalogTtlHours > 0);
    assert.notEqual(updated.priceCatalogTtlHours, costDefaults.costProfiler.priceCatalogTtlHours);
    assert.ok(Object.values(updated.budgets).some((budget) => budget.hardUsd > 0));
    assert.doesNotMatch(strip(screen.render(96)[0]), /\*/);
    show('após Ctrl+S, TTL e limite persistidos com o painel aberto');
    send(ESC);
    console.log('\nFECHAMENTO →', JSON.stringify(await closed));
    console.log('ÚLTIMAS NOTAS →', JSON.stringify(notes.slice(-4).map(firstLine)));
    await running;

    await decision('DECISÃO DEPOIS DO PAINEL (mesma pergunta, catálogo e limite novos):', 'now');
    console.log('\nARQUIVO FINAL GRAVADO PELO PAINEL:\n' + (await saved()).trimEnd());
    console.log('\nOK: menu abriu, navegou, persistiu e fechou com resumo contra o host real.');
  } finally {
    if (old === undefined) delete process.env.PI_SUITE_HOME;
    else process.env.PI_SUITE_HOME = old;
    await rm(dir, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
};

run().catch((error) => {
  console.error('SMOKE FALHOU:', error?.stack ?? error);
  process.exitCode = 1;
});
