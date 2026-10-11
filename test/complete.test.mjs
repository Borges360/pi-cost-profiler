import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakePi } from '../test-support/fakes.mjs';
import { projectIdentity, VERSION } from '../lib/core.mjs';
import costProfiler from '../extension.mjs';

/** Seed the append-only journals the way a real session would have written them. */
const seed = async (home, dir, entity, rows) => {
  const id = await projectIdentity(dir);
  const folder = join(home, 'projects', id.projectId);
  await mkdir(folder, { recursive: true });
  const text = rows.map((r) => JSON.stringify({ schemaVersion: VERSION, ...r })).join('\n') + '\n';
  await writeFile(join(folder, `${entity}.jsonl`), text);
};

test('/cost task completes with the task ids recorded for this project', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cost-complete-'));
  const home = join(dir, 'state');
  const old = process.env.PI_SUITE_HOME;
  process.env.PI_SUITE_HOME = home;
  t.after(async () => {
    process.env.PI_SUITE_HOME = old;
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(join(dir, '.pi'), { recursive: true });
  await seed(home, dir, 'tasks', [
    { taskId: 'TASK-002', sessionId: 'S1', occurredAt: '2026-10-11T00:00:00Z' },
    { taskId: 'TASK-001', sessionId: 'S1', occurredAt: '2026-10-09T00:00:00Z' },
    { taskId: 'unattributed', sessionId: 'S1', occurredAt: '2026-10-08T00:00:00Z' },
  ]);
  await seed(home, dir, 'model-calls', [
    {
      modelId: 'openrouter/qwen/qwen3-flash',
      taskId: 'TASK-001',
      sessionId: 'S1',
      occurredAt: '2026-10-09T00:00:00Z',
      estimatedCostUsd: 0.002,
      providerRequestId: 'r1',
    },
    {
      modelId: 'openrouter/qwen/qwen3-flash',
      taskId: 'TASK-002',
      sessionId: 'S1',
      occurredAt: '2026-10-11T00:00:00Z',
      estimatedCostUsd: 0.001,
      providerRequestId: 'r2',
    },
    {
      modelId: 'openrouter/openai/gpt-sol',
      taskId: 'TASK-002',
      sessionId: 'S1',
      occurredAt: '2026-10-11T00:00:00Z',
      estimatedCostUsd: 0.2,
      providerRequestId: 'r3',
    },
  ]);

  const f = fakePi(dir, []);
  costProfiler(f.pi);
  await f.emit('session_start');
  const cmd = [...f.commands.values()][0];

  const tasks = await cmd.getArgumentCompletions('task ');
  assert.deepEqual(
    tasks.map((i) => i.label),
    ['TASK-002', 'TASK-001', 'unattributed'],
    'most recent task first',
  );

  const models = await cmd.getArgumentCompletions('compare ');
  // Most-used first: that is the cohort the user is most likely comparing.
  assert.deepEqual(
    models.map((i) => i.label),
    ['openrouter/qwen/qwen3-flash', 'openrouter/openai/gpt-sol'],
  );
  assert.match(
    models.find((i) => i.label === 'openrouter/qwen/qwen3-flash').description,
    /2 call\(s\).*\$0\.0030 known/,
  );

  // A task-less selection must not silently report zero spend.
  await assert.rejects(
    () => f.command('cost', 'budget task 0.50 USD'),
    /task \/cost task|Select a task/,
  );
});
