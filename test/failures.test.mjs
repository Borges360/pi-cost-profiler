import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import install from '../extension.mjs';
import { FileStore } from '../lib/core.mjs';
import { fakePi, TestStream } from '../test-support/fakes.mjs';
function fixture(dir) {
  const model = {
    provider: 'fake',
    id: 'm',
    api: 'test',
    contextWindow: 10000,
    maxTokens: 100,
    cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
  };
  const f = fakePi(dir, [model]);
  let calls = 0;
  f.providers.set('fake', {
    id: 'fake',
    name: 'Fake',
    auth: {},
    getModels: () => [model],
    streamSimple: () => {
      calls++;
      const s = new TestStream();
      queueMicrotask(() => {
        const message = {
          role: 'assistant',
          provider: 'fake',
          api: 'test',
          model: 'm',
          timestamp: Date.now(),
          responseId: 'R' + calls,
          content: [{ type: 'text', text: 'OK' }],
          stopReason: 'stop',
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { total: 0.000002 },
          },
        };
        s.push({ type: 'done', message });
        s.end(message);
      });
      return s;
    },
  });
  return { f, model, calls: () => calls };
}
test('malformed financial policy cannot be cached/bypassed and blocks native dispatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cost-invalid-'));
  const old = process.env.PI_SUITE_HOME;
  process.env.PI_SUITE_HOME = join(dir, 'state');
  try {
    await mkdir(process.env.PI_SUITE_HOME);
    await writeFile(
      join(process.env.PI_SUITE_HOME, 'config.yaml'),
      'costProfiler:\n  budgets:\n    session:\n      hardUsd: not-a-number\n',
    );
    const { f, model, calls } = fixture(dir);
    install(f.pi, () => new TestStream());
    await f.emit('session_start');
    await f.emit('before_agent_start');
    const result = await f.providers.get('fake').streamSimple(model, { messages: [] }, {}).result();
    assert.equal(result.stopReason, 'error');
    assert.match(result.errorMessage, /configuration invalid/);
    assert.equal(calls(), 0);
    await f.emit('session_shutdown');
  } finally {
    if (old === undefined) delete process.env.PI_SUITE_HOME;
    else process.env.PI_SUITE_HOME = old;
    await rm(dir, { recursive: true, force: true });
  }
});
test('informational storage failure preserves native response without silently fabricating a ledger', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cost-informational-'));
  const old = process.env.PI_SUITE_HOME;
  process.env.PI_SUITE_HOME = join(dir, 'state');
  const original = FileStore.prototype.lock;
  try {
    const { f, model, calls } = fixture(dir);
    install(f.pi, () => new TestStream());
    await f.emit('session_start');
    FileStore.prototype.lock = async () => {
      throw Error('read-only storage');
    };
    const result = await f.providers.get('fake').streamSimple(model, { messages: [] }, {}).result();
    assert.equal(result.stopReason, 'stop');
    assert.equal(calls(), 1);
    assert.ok(f.notifications.some((n) => n.includes('unavailable')));
    FileStore.prototype.lock = original;
    await f.emit('session_shutdown');
  } finally {
    FileStore.prototype.lock = original;
    if (old === undefined) delete process.env.PI_SUITE_HOME;
    else process.env.PI_SUITE_HOME = old;
    await rm(dir, { recursive: true, force: true });
  }
});
