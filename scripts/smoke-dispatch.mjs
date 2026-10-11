import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';
import { FileStore, projectIdentity } from '../lib/core.mjs';
const cli = process.argv[2];
if (!cli) throw Error('Pass installed Pi dist/cli.js');
const dir = await mkdtemp(join(tmpdir(), 'pi-dispatch-'));
const home = join(dir, 'state');
const args = [
  cli,
  '--offline',
  '--no-extensions',
  '--no-mcp',
  '--no-skills',
  '--no-context-files',
  '--no-approve',
  '--no-session',
  '--print',
  '--model',
  'suite-fixture/deterministic',
  '-e',
  resolve('scripts/fake-provider.ts'),
  '-e',
  resolve('index.ts'),
  'fixture',
];
const run = () =>
  new Promise((resolveResult, reject) => {
    const p = spawn(process.execPath, args, {
      cwd: dir,
      env: { ...process.env, PI_AGENT_DIR: join(dir, 'agent'), PI_SUITE_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    p.stdout.on('data', (b) => (out += b));
    p.stderr.on('data', (b) => (err += b));
    const timer = setTimeout(() => {
      p.kill();
      reject(Error('Native dispatch smoke timed out'));
    }, 20000);
    p.on('error', reject);
    p.on('close', (code) => {
      clearTimeout(timer);
      resolveResult({ code, out, err });
    });
  });
try {
  const first = await run();
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /OK/);
  const { projectId } = await projectIdentity(dir);
  const store = new FileStore(join(home, 'projects', projectId));
  const rows = await store.rows('model-calls');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalTokens, 15);
  assert.equal(rows[0].observedCostUsd, 0.00002);
  await writeFile(
    join(home, 'config.yaml'),
    'costProfiler:\n  budgets:\n    session:\n      hardUsd: 0\n',
  );
  const blocked = await run();
  assert.notEqual(blocked.code, 0);
  assert.match(blocked.err + blocked.out, /budget|denied/i);
  assert.equal((await store.rows('model-calls')).length, 1);
  console.log(
    JSON.stringify({
      nativeDispatch: 'passed',
      billingPrecedence: 'passed',
      hardBudgetBeforeDispatch: 'passed',
      remoteCalls: 0,
    }),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
