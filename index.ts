import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { openPiSettings } from './vendor/inteiro-terminal/pi.js';
import install from './extension.mjs';

/**
 * The `/cost` panel uses the vendored Pi settings adapter (`vendor/inteiro-terminal`), whose
 * `pi.js` imports `@earendil-works/pi-tui`. That host module has to be resolved through Pi's static
 * import map, so the adapter is imported here, statically, and handed to the extension.
 *
 * This is not a style preference. pi loads extensions through jiti with a map of host
 * modules, and that map applies to **static** imports
 * (`pi-coding-agent/dist/core/extensions/loader.js`, `getAliases`). A dynamic
 * `await import('@earendil-works/pi-tui')` from inside an extension falls through to Node's
 * native resolver and dies with `ERR_MODULE_NOT_FOUND`. Verified against the installed 1.6.0 by
 * `scripts/smoke-panel.mjs`, which loads a staged copy of the package without `node_modules/@earendil-works`.
 *
 * Unit tests inject the same adapter into `extension.mjs` (with the real pi-tui devDependency);
 * the real host loader is exercised by the smoke.
 */
export default function (pi: ExtensionAPI) {
  install(pi, undefined, { settingsPanel: openPiSettings });
}
