/**
 * Real-host smoke for the `/cost` panel.
 *
 * The unit tests drive the vendored settings adapter with the pi-tui devDependency; this script
 * proves the same panel under the installed Pi host. It stages a copy of the package as Pi would
 * install it (the `files` of package.json plus `yaml`, and no `node_modules/@earendil-works`), loads
 * `index.ts` with the release's own jiti loader (so `@earendil-works/pi-tui` inside the vendored
 * adapter can only resolve through Pi's static import map), opens bare `/cost`, renders it at
 * 40/80/120 columns with the host theme, drives it with terminal bytes and the host keybindings,
 * saves with Ctrl+S, previews pt-BR and discards it with Esc Esc.
 *
 * Nothing here calls a model or a provider, starts or restarts a Pi session, or touches
 * ~/.pi/agent/settings.json: the project, PI_SUITE_HOME and PI_CODING_AGENT_DIR are temporary.
 *
 *   npm run smoke            # PI_HOST_DIR=<release dir> to pick another installed release
 */
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { fakePi } from '../test-support/fakes.mjs';
import { FIELD_ORDER, ACTION_ORDER } from '../lib/panel.mjs';

const KEY = { up: '\x1b[A', down: '\x1b[B', enter: '\r', esc: '\x1b', ctrlS: '\x13' };
const ROWS = [...FIELD_ORDER, ...ACTION_ORDER];
const repo = fileURLToPath(new URL('..', import.meta.url));
const hostDir = resolve(process.env.PI_HOST_DIR ?? join(homedir(), '.pi', 'agent', 'install', 'releases', '1.6.0'));
const modules = join(hostDir, 'node_modules', '@earendil-works');
const load = (path) => import(pathToFileURL(path).href);
const strip = (line) => String(line).replace(/\x1b\[[0-9;]*m/g, '');
const firstLine = (text) => String(text).split('\n')[0];

/** A copy of the package as installed: shipped files, `yaml`, and no host modules. */
async function stagePackage() {
  const stage = await mkdtemp(join(tmpdir(), 'cost-smoke-pkg-'));
  const pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  await cp(join(repo, 'package.json'), join(stage, 'package.json'));
  for (const entry of pkg.files) {
    if (/^(test|test-support|scripts)\/?$/.test(entry)) continue;
    await cp(join(repo, entry), join(stage, entry), { recursive: true });
  }
  await cp(join(repo, 'node_modules', 'yaml'), join(stage, 'node_modules', 'yaml'), { recursive: true });
  return stage;
}

const run = async () => {
  const { loadExtensions, createExtensionRuntime } = await load(
    join(modules, 'pi-coding-agent', 'dist', 'core', 'extensions', 'index.js'),
  );
  const tui = await load(join(modules, 'pi-tui', 'dist', 'index.js'));
  const themeModule = await load(join(modules, 'pi-coding-agent', 'dist', 'modes', 'interactive', 'theme', 'theme.js'));
  const agentVersion = JSON.parse(await readFile(join(modules, 'pi-coding-agent', 'package.json'), 'utf8')).version;
  const tuiVersion = JSON.parse(await readFile(join(modules, 'pi-tui', 'package.json'), 'utf8')).version;
  console.log(`host: ${hostDir} (pi-coding-agent ${agentVersion}, pi-tui ${tuiVersion})`);

  const stage = await stagePackage();
  const dir = await mkdtemp(join(tmpdir(), 'cost-smoke-'));
  const state = await mkdtemp(join(tmpdir(), 'cost-smoke-state-'));
  const saved = { suite: process.env.PI_SUITE_HOME, agent: process.env.PI_CODING_AGENT_DIR };
  process.env.PI_SUITE_HOME = state;
  process.env.PI_CODING_AGENT_DIR = join(state, 'agent');
  try {
    await assert.rejects(readFile(join(stage, 'node_modules', '@earendil-works', 'pi-tui', 'package.json')), {
      code: 'ENOENT',
    });
    const entry = join(stage, 'index.ts');
    const loaded = await loadExtensions([entry], dir, undefined, createExtensionRuntime());
    if (loaded.errors?.length)
      throw Error(`extension did not load: ${loaded.errors.map((e) => e.error ?? e).join('; ')}`);
    const extension = loaded.extensions[0];
    const command = extension?.commands.get('cost');
    if (!command) throw Error('the real loader did not register /cost');
    console.log(`loaded: ${entry} (staged package without node_modules/@earendil-works)`);

    themeModule.initTheme?.();
    const theme = themeModule.theme;
    const keybindings = tui.getKeybindings();

    execFileSync('git', ['init', dir], { stdio: 'ignore' });
    await mkdir(join(dir, '.pi'), { recursive: true });
    await writeFile(join(dir, 'README.md'), 'fixture\n');
    const configFile = join(dir, '.pi', 'pi-suite.yaml');
    await writeFile(configFile, 'costProfiler:\n  enabled: true\n  maxRequestOutputTokens: 2048\n');

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
    const ctx = f.ctx;
    ctx.ui.notify = (text) => notes.push(String(text));
    ctx.ui.confirm = async () => false;
    let screen = null;
    let overlay = null;
    let closed = false;
    ctx.ui.custom = (factory, options) =>
      new Promise((resolveClose) => {
        overlay = options;
        screen = factory({ terminal: { rows: 30 }, requestRender: () => {} }, theme, keybindings, (value) => {
          closed = true;
          resolveClose(value);
        });
      });
    const settle = async () => {
      for (let i = 0; i < 4; i++) {
        await screen.drain();
        await new Promise((r) => setImmediate(r));
      }
    };
    const send = async (...bytes) => {
      for (const b of bytes) {
        screen.handleInput(b);
        await settle();
      }
    };
    const focused = () => screen.controller.session.focusedId;
    const goto = async (id) => {
      while (focused() !== id) await send(ROWS.indexOf(focused()) < ROWS.indexOf(id) ? KEY.down : KEY.up);
    };
    const text = (width) => screen.render(width).map(strip).join('\n');
    const show = (label, width = 80) => {
      console.log(`\n──── ${label} (${width} columns)`);
      for (const line of screen.render(width)) console.log(`   |${strip(line)}`);
    };
    const widths = (label) => {
      for (const width of [40, 80, 120]) {
        const lines = screen.render(width);
        const widest = Math.max(...lines.map((line) => tui.visibleWidth(line)));
        assert.ok(widest <= width, `${label}: line of ${widest} columns at ${width}`);
        console.log(`${label}: ${width} columns → ${lines.length} rows, widest ${widest}`);
      }
    };
    const file = () => readFile(configFile, 'utf8');

    await command.handler('now', ctx);
    console.log(`\n/cost now antes do painel → ${firstLine(notes.at(-1))}`);
    const before = await file();

    const running = command.handler('', ctx);
    const until = Date.now() + 8000;
    while (!screen && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    assert.ok(screen, '/cost did not open a panel');
    assert.equal(overlay?.overlay, true);
    await settle();
    show('painel aberto com /cost (vazio)');
    widths('en');
    assert.match(text(80), /Cost \/ Settings/);
    assert.match(text(80), /Ctrl\+S save/);

    await goto('priceCatalogTtlHours');
    await send(KEY.enter, KEY.down, KEY.enter);
    await goto('budget.project');
    await send(KEY.enter, KEY.down, KEY.enter);
    assert.equal(await file(), before, 'selections only change the draft');
    assert.match(strip(screen.render(80)[0]), /\*$/);
    show('rascunho: catálogo 72 h e orçamento do projeto USD 0.50');

    await send(KEY.ctrlS);
    const updated = parse(await file()).costProfiler;
    assert.equal(updated.priceCatalogTtlHours, 72);
    assert.deepEqual(updated.budgets.project, { hardUsd: 0.5, softUsd: 0.4 });
    assert.doesNotMatch(strip(screen.render(80)[0]), /\*/);
    assert.equal(closed, false, 'Ctrl+S keeps the panel open');
    assert.match(text(80), /Changes saved\. Cost settings are active\./);

    await goto('language');
    await send(KEY.enter, KEY.down, KEY.enter);
    assert.match(text(80), /Custos \/ Configurações \*/);
    widths('pt-BR');
    show('prévia pt-BR (não salva)');
    await send(KEY.esc);
    assert.match(text(80), /Esc novamente descarta/);
    await send(KEY.esc);
    assert.equal(closed, true, 'the second Esc discards and closes');
    await running;
    await assert.rejects(readFile(join(dir, '.pi', 'pi-cost-profiler.locale.json')), { code: 'ENOENT' });
    console.log(`\nresumo ao fechar → ${JSON.stringify(notes.at(-1))}`);
    assert.match(notes.at(-1), /^Cost · 2 change\(s\) saved/);

    await command.handler('now', ctx);
    console.log(`/cost now depois do painel → ${firstLine(notes.at(-1))}`);
    for (const handler of extension.handlers.get('session_shutdown') ?? []) await handler({ type: 'session_shutdown' }, ctx);
    console.log('\nARQUIVO FINAL GRAVADO PELO PAINEL:\n' + (await file()).trimEnd());
    console.log(
      '\nsmoke ok: /cost carregado pelo loader do Pi a partir de uma cópia instalada, renderizado em 40/80/120 (en e pt-BR), Ctrl+S persistiu com o painel aberto, Esc Esc descartou a prévia de idioma.',
    );
  } finally {
    if (saved.suite === undefined) delete process.env.PI_SUITE_HOME;
    else process.env.PI_SUITE_HOME = saved.suite;
    if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved.agent;
    for (const path of [stage, dir, state]) await rm(path, { recursive: true, force: true });
  }
};

run().catch((error) => {
  console.error('SMOKE FALHOU:', error?.stack ?? error);
  process.exitCode = 1;
});
