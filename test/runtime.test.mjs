import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import install from '../extension.mjs';
import { fakePi, TestStream } from '../test-support/fakes.mjs';
import { FileStore, projectIdentity } from '../lib/core.mjs';
test('native provider wrapper preserves stream and prevents dispatch before hard budget; nested classifier counted once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cost-runtime-'));
  const old = process.env.PI_SUITE_HOME;
  process.env.PI_SUITE_HOME = join(dir, 'state');
  try {
    const model = {
      provider: 'fake',
      id: 'm',
      api: 'test',
      cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
      contextWindow: 100000,
    };
    const f = fakePi(dir, [model]);
    let dispatch = 0;
    const original = {
      id: 'fake',
      name: 'Fake',
      auth: {},
      getModels: () => [model],
      streamSimple: () => {
        dispatch++;
        const s = new TestStream();
        queueMicrotask(() => {
          const message = {
            role: 'assistant',
            api: 'test',
            provider: 'fake',
            model: 'm',
            responseId: `R${dispatch}`,
            timestamp: Date.now(),
            stopReason: 'stop',
            content: [],
            usage: {
              input: 3,
              output: 2,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 5,
              cost: { total: 0.000005 },
            },
          };
          s.push({ type: 'done', message });
          s.end(message);
        });
        return s;
      },
      classify: async () => ({
        provider: 'fake',
        model: 'm',
        stopReason: 'stop',
        answers: {},
        usage: {
          input: 2,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 3,
          cost: { total: 0.000003 },
        },
      }),
    };
    original.stream = original.streamSimple;
    f.providers.set('fake', original);
    install(f.pi, () => new TestStream());
    await f.emit('session_start');
    const wrapped = f.providers.get('fake');
    const stream = wrapped.streamSimple(model, { messages: [] }, { maxTokens: 10 });
    const consumer = (async () => {
      for await (const _ of stream) {
      }
    })();
    const message = await stream.result();
    await consumer;
    await f.emit('message_end', { message });
    const { projectId } = await projectIdentity(dir),
      store = new FileStore(join(process.env.PI_SUITE_HOME, 'projects', projectId));
    assert.equal((await store.rows('model-calls')).length, 1);
    await f.emit('tool_execution_start', { toolCallId: 'T', toolName: 'codemode' });
    const classified = await wrapped.classify({ ...model, type: 'classifier' }, { state: {} }, {});
    await f.emit('tool_result', { toolCallId: 'T', toolName: 'codemode', usage: classified.usage });
    await f.emit('tool_execution_end', {
      toolCallId: 'T',
      toolName: 'codemode',
      result: { usage: classified.usage },
      isError: false,
    });
    assert.equal(
      (await store.rows('model-calls')).length,
      2,
      'classifier and root-reported aggregate counted once',
    );
    await f.emit('tool_execution_start', { toolCallId: 'outside', toolName: 'custom' });
    const outsideUsage = {
      input: 4,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 6,
      cost: { total: 0.000006 },
    };
    await f.emit('tool_result', { toolCallId: 'outside', toolName: 'custom', usage: outsideUsage });
    await f.emit('tool_execution_end', {
      toolCallId: 'outside',
      toolName: 'custom',
      result: { usage: outsideUsage },
      isError: false,
    });
    assert.equal(
      (await store.rows('model-calls')).length,
      3,
      'extension-reported auxiliary usage is retained',
    );
    await f.command('cost', 'budget session 0.000001 USD');
    const blocked = wrapped.streamSimple(model, { messages: [] }, { maxTokens: 10 });
    const result = await blocked.result();
    assert.equal(result.stopReason, 'error');
    assert.equal(dispatch, 1);
    assert.match(result.errorMessage, /denied/);
    await f.emit('session_shutdown');
  } finally {
    if (old === undefined) delete process.env.PI_SUITE_HOME;
    else process.env.PI_SUITE_HOME = old;
    await rm(dir, { recursive: true, force: true });
  }
});
