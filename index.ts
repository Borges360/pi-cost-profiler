import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import install from './extension.mjs';
export default function (pi: ExtensionAPI) {
  install(pi, createAssistantMessageEventStream);
}
