// Local protocol fixture: no HTTP, credentials or external effects.
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function (pi: ExtensionAPI) {
  pi.registerProvider('suite-fixture', {
    apiKey: 'local-fixture-only',
    api: 'suite-fixture-api',
    baseUrl: 'http://fixture.invalid',
    models: [
      {
        id: 'deterministic',
        name: 'Deterministic fixture',
        reasoning: false,
        input: ['text'],
        contextWindow: 100000,
        maxTokens: 128,
        cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
      },
    ],
    streamSimple(model, _context, options) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(async () => {
        const message = {
          role: 'assistant' as const,
          api: model.api,
          provider: model.provider,
          model: model.id,
          timestamp: Date.now(),
          content: [{ type: 'text' as const, text: 'OK' }],
          stopReason: 'stop' as const,
          responseId: `fixture-${Date.now()}`,
          usage: {
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 15,
            cost: {
              input: 0.00001,
              output: 0.000005,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0.000015,
            },
          },
        };
        stream.push({ type: 'start', partial: { ...message, stopReason: 'pending' } });
        await options?.onProviderStreamEvent?.({ usage: { cost: 0.00002 } }, model);
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end(message);
      });
      return stream;
    },
  });
}
