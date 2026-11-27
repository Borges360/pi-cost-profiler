/**
 * Shared fixture for the `/cost` panel tests: a git project, a fake `pi` with models and
 * a session-scoped model list, and the fake TUI wired through the `host` seam.
 *
 * A recorded call is written straight into the store: the point of these tests is what
 * the panel shows and writes, not re-running the provider wrapper (which has its own
 * suite in `test/accounting.test.mjs`).
 */
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import install from '../extension.mjs';
import { host } from '../menu.mjs';
import { fakeTui } from './fake-tui.mjs';
import { fakePi } from './fakes.mjs';

export const CONFIG = 'costProfiler:\n  enabled: true\n  maxRequestOutputTokens: 2048\n';

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

export async function costEnv(
  t,
  {
    config = CONFIG,
    global = null,
    models = [chat('cheap/model', 0.2)],
    scoped = [],
    calls = [],
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'cost-panel-'));
  const state = await mkdtemp(join(tmpdir(), 'cost-panel-state-'));
  const old = process.env.PI_SUITE_HOME;
  process.env.PI_SUITE_HOME = state;
  const savedHost = { tui: host.tui, agent: host.agent, settingsPanel: host.settingsPanel };
  t.after(async () => {
    process.env.PI_SUITE_HOME = old;
    host.tui = savedHost.tui;
    host.agent = savedHost.agent;
    host.settingsPanel = savedHost.settingsPanel;
    await rm(dir, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  });
  execFileSync('git', ['init', dir], { stdio: 'ignore' });
  await writeFile(join(dir, 'README.md'), 'fixture\n');
  await mkdir(join(dir, '.pi'), { recursive: true });
  if (config) await writeFile(join(dir, '.pi', 'pi-suite.yaml'), config);
  if (global) await writeFile(join(state, 'config.yaml'), global);
  const tui = fakeTui();
  host.tui = tui.tuiPkg;
  host.agent = tui.agentPkg;
  const f = fakePi(dir, models);
  f.ctx.scopedModels = scoped.map((model) => ({ model }));
  let activeController;
  let resolvePanel;
  const panelPromise = new Promise((resolve) => { resolvePanel = resolve; });
  host.settingsPanel = async (_ui, options) => {
    const panel = {
      options,
      status: [],
      selections: [],
      choiceCalls: [],
      report(message) { this.status.push(String(message)); },
      queueSelections(...values) { this.selections.push(...values); },
      async choose(title, choices, current) {
        this.choiceCalls.push({ title, choices, current });
        const selected = this.selections.shift();
        if (selected === undefined) return undefined;
        if (!choices.some((choice) => choice.value === selected))
          throw Error(`fake settings panel: ${selected} not offered for ${title}`);
        return selected;
      },
      async input() { return undefined; },
      async confirm() { return false; },
      close(action) { f.ctx.customResult = action; resolvePanel(action); },
      row(id) { return options.rows.find((row) => row.id === id); },
      hasRow(id) { return Boolean(this.row(id)); },
      dirty() { return options.dirty(); },
      activate(id, ...selections) {
        this.queueSelections(...selections);
        const row = this.row(id);
        if (!row) throw Error(`fake settings panel: unknown row ${id}`);
        activeController = new AbortController();
        return row.activate(this, activeController.signal);
      },
      async save({ cancelBeforeWrite = false } = {}) {
        activeController = new AbortController();
        if (cancelBeforeWrite) activeController.abort(Error('Operation canceled'));
        try {
          await options.save(this, activeController.signal);
          return true;
        } catch (error) {
          this.lastError = String(error?.stack ?? error);
          this.report(options.formatError?.(error) ?? String(error?.message ?? error));
          return false;
        }
      },
      cancel() { activeController?.abort(Error('Operation canceled')); },
      finish() { resolvePanel(undefined); },
    };
    f.ctx.lastSettingsPanel = panel;
    return panelPromise;
  };
  const command = (args) => f.command('cost', args);
  install(f.pi, undefined);
  await f.emit('session_start');
  // Seed the ledger directly: the panel reads rows, not the wrapper.
  const env = {
    dir,
    state,
    f,
    tui,
    command,
    settings: () => f.ctx.lastSettingsPanel,
    saved: async () =>
      (parseDocument(await readFile(join(dir, '.pi', 'pi-suite.yaml'), 'utf8')).toJS() ?? {})
        .costProfiler,
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
    open: async () => {
      const settled = { done: false };
      const running = command('')
        .then((r) => {
          settled.done = true;
          return r;
        })
        .catch((e) => {
          settled.done = true;
          throw e;
        });
      await waitFor(() => f.ctx.lastSettingsPanel || settled.done, 'abrir o painel (ou degradar)');
      return { running };
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
    await new Promise((r) => setTimeout(r, 20));
  }
}
