/**
 * Shared fixture for the `/cost` panel tests: a git project, a fake `pi` with models and a
 * session-scoped model list, and the real vendored Pi settings adapter (`openPiSettings`) driven
 * by terminal bytes with the real pi-tui `KeybindingsManager` (`getKeybindings()`).
 *
 * A recorded call is written straight into the store: the point of these tests is what the panel
 * shows and writes, not re-running the provider wrapper (which has its own suite in
 * `test/accounting.test.mjs`).
 */
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import { getKeybindings, visibleWidth } from '@earendil-works/pi-tui';
import install from '../extension.mjs';
import { host } from '../menu.mjs';
import { FIELD_ORDER, ACTION_ORDER } from '../lib/panel.mjs';
import { openPiSettings } from '../vendor/inteiro-terminal/pi.js';
import { fakePi } from './fakes.mjs';

export { visibleWidth };
export const KEY = Object.freeze({
  up: '\x1b[A',
  down: '\x1b[B',
  enter: '\r',
  esc: '\x1b',
  ctrlS: '\x13',
  space: ' ',
  tab: '\t',
});
/** Host theme without colors: assertions read plain text. */
export const plain = Object.freeze({ fg: (_color, text) => text, bold: (text) => text });
export const ROWS = [...FIELD_ORDER, ...ACTION_ORDER];
export const CONFIG = 'costProfiler:\n  enabled: true\n  maxRequestOutputTokens: 2048\n';
const tick = () => new Promise((resolve) => setImmediate(resolve));

export const chat = (id, price) => ({
  provider: 'openrouter',
  id,
  name: id,
  api: 'openai-completions',
  input: ['text'],
  cost: price == null ? undefined : { input: price, output: price },
  contextWindow: 200000,
  maxTokens: 8192,
});

function check(ok, message) {
  if (!ok) throw Error(message);
}

/**
 * Replaces `ui.custom` with a fake overlay host that builds the adapter's component with the real
 * keybindings, and returns a byte-level driver for it.
 */
export function panelHost(ui, { rows = 40 } = {}) {
  let component;
  let opens = 0;
  let closed = false;
  const overlays = [];
  const terminal = { rows };
  ui.custom = (factory, options) =>
    new Promise((resolve) => {
      overlays.push(options);
      closed = false;
      opens++;
      component = factory({ terminal, requestRender() {} }, plain, getKeybindings(), (value) => {
        closed = true;
        resolve(value);
      });
    });
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await component?.drain?.();
      await tick();
    }
  };
  const key = async (data) => {
    component.handleInput(data);
    await settle();
  };
  const keys = async (...data) => {
    for (const d of data) await key(d);
  };
  const focused = () => component.controller.session.focusedId;
  const goto = async (id) => {
    const position = (row) => ROWS.indexOf(row);
    check(position(id) >= 0, `unknown row ${id}`);
    let guard = ROWS.length * 2;
    while (focused() !== id && guard-- > 0) await key(position(focused()) < position(id) ? KEY.down : KEY.up);
    check(focused() === id, `focus stayed on ${focused()} instead of ${id}`);
  };
  const screen = (width = 100) => component.render(width).join('\n');
  return {
    overlays,
    terminal,
    settle,
    key,
    keys,
    goto,
    focused,
    screen,
    lines: (width = 100) => component.render(width),
    component: () => component,
    controller: () => component.controller,
    session: () => component.controller.session,
    opened: () => Boolean(component),
    opens: () => opens,
    closed: () => closed,
  };
}

export async function costEnv(
  t,
  { config = CONFIG, global = null, models = [chat('cheap/model', 0.2)], scoped = [], rows = 40 } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'cost-panel-'));
  const state = await mkdtemp(join(tmpdir(), 'cost-panel-state-'));
  const old = process.env.PI_SUITE_HOME;
  process.env.PI_SUITE_HOME = state;
  const savedPanel = host.settingsPanel;
  t.after(async () => {
    if (old === undefined) delete process.env.PI_SUITE_HOME;
    else process.env.PI_SUITE_HOME = old;
    host.settingsPanel = savedPanel;
    await rm(dir, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  });
  execFileSync('git', ['init', dir], { stdio: 'ignore' });
  await writeFile(join(dir, 'README.md'), 'fixture\n');
  await mkdir(join(dir, '.pi'), { recursive: true });
  if (config) await writeFile(join(dir, '.pi', 'pi-suite.yaml'), config);
  if (global) await writeFile(join(state, 'config.yaml'), global);
  const f = fakePi(dir, models);
  f.ctx.scopedModels = scoped.map((model) => ({ model }));
  const panel = panelHost(f.ctx.ui, { rows });
  install(f.pi, undefined, { settingsPanel: openPiSettings });
  await f.emit('session_start');
  const command = (args) => f.command('cost', args);
  const env = {
    dir,
    state,
    f,
    command,
    panel,
    localePath: join(dir, '.pi', 'pi-cost-profiler.locale.json'),
    saved: async () =>
      (parseDocument(await readFile(join(dir, '.pi', 'pi-suite.yaml'), 'utf8')).toJS() ?? {}).costProfiler,
    file: async () => {
      try {
        return await readFile(join(dir, '.pi', 'pi-suite.yaml'), 'utf8');
      } catch {
        return '';
      }
    },
    /** Store helper: writes a `model-calls` row through the runtime's own store. */
    record: async (row) => {
      const store = await storeOf(env);
      await store.append('model-calls', {
        id: `r${Math.random().toString(36).slice(2, 8)}`,
        sessionId: f.ctx.sessionManager.getSessionId(),
        taskId: null,
        occurredAt: new Date().toISOString(),
        ...row,
      });
    },
    /** Runs bare `/cost` and waits for the panel (or the fallback), not for the money state. */
    open: async () => {
      const settled = { done: false };
      const before = panel.opens();
      const running = command('').finally(() => {
        settled.done = true;
      });
      await waitFor(() => panel.opens() > before || settled.done, 'abrir o painel (ou degradar)');
      // Wrapped: returning the promise itself would make `await open()` wait for the panel to close.
      return { running };
    },
    /** Waits until the background money state replaced the loading placeholders. */
    ready: async () => {
      await waitFor(
        () => !/loading…|carregando…/.test(panel.screen(120)),
        'estado do gasto no painel',
      );
      await panel.settle();
    },
  };
  return env;
}

/** One store per fixture directory (never a module-level singleton: tests run in temp dirs). */
const stores = new Map();
async function storeOf(env) {
  if (stores.has(env.dir)) return stores.get(env.dir);
  const { FileStore, projectIdentity } = await import('../lib/core.mjs');
  const id = await projectIdentity(env.dir);
  const store = new FileStore(join(process.env.PI_SUITE_HOME, 'projects', id.projectId));
  stores.set(env.dir, store);
  return store;
}

/** Waits on an observable effect, never on a number of ticks. */
export async function waitFor(predicate, what, ms = 4000) {
  const until = Date.now() + ms;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > until) throw Error(`timeout aguardando: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
