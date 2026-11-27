import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import * as piTui from '@earendil-works/pi-tui';
import * as piAgent from '@earendil-works/pi-coding-agent';
import { openSettingsPanel } from './lib/settings-panel.ts';
import install from './extension.mjs';

/**
 * The `/cost` panel uses the shared settings component and host terminal modules that
 * have to be resolved through Pi's static import map.
 *
 * This is not a style preference. pi loads extensions through jiti with a map of host
 * modules, and that map applies to **static** imports
 * (`pi-coding-agent/dist/core/extensions/loader.js:55-79`, `virtual-modules.js:21,31`).
 * A dynamic `await import('@earendil-works/pi-tui')` from inside an extension falls
 * through to Node's native resolver and dies with `ERR_MODULE_NOT_FOUND` — the same
 * goes for `@earendil-works/pi-ai`. Verified against the installed 1.1.0 by
 * `scripts/smoke-panel.mjs`.
 *
 * Unit tests do not load this file. They inject a settings-panel driver into
 * `extension.mjs`; the real host panel is exercised in the controlled CT57 smoke.
 */
export default function (pi: ExtensionAPI) {
  install(pi, undefined, { tui: piTui, agent: piAgent, settingsPanel: openSettingsPanel });
}
