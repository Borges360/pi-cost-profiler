# Third-party code in `vendor/`

## `inteiro-terminal/`

- Origin: `@inteiro/terminal` (the closure of its Pi adapter, `pi.ts`), from the IDS repository
  (`packages/terminal/src`). Version, contract, source commit, date and the sha256 of every file
  (upstream source and emitted JavaScript) are recorded in `inteiro-terminal/VENDOR.json`.
- Format: plain ESM JavaScript (`--format js`, ES2022, transpiled by the upstream TypeScript), so
  Node runs it without a build step or type stripping.
- License: MIT, copied verbatim in `inteiro-terminal/LICENSE`.
- Local patches: none (`"patches": []`). Do not edit these files by hand; regenerate them from the
  IDS checkout with
  `node scripts/vendor-terminal.mjs --out <this repo>/vendor/inteiro-terminal --format js`
  and check them with `node scripts/vendor-terminal.mjs --check <this repo>/vendor/inteiro-terminal --upstream`.
- Integrity without an IDS checkout: `node vendor/inteiro-terminal/verify-vendor.mjs` (also run by
  `test/vendor.test.mjs`).
- Only the panel and state code is used. No design-system tokens, palette, mark or slogan are
  included; the panel paints with the Pi host theme (`theme.fg`/`theme.bold`).
- This notice lives outside `inteiro-terminal/` because the verifier reports any extra file inside
  the vendored directory.
