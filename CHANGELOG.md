# Changelog

## Unreleased

The version in package.json is unchanged; nothing was published.

### Changed

- `/cost` runs on a vendored copy of a Pi settings adapter (`vendor/inteiro-terminal`, plain ESM,
  `"patches": []`, provenance and hashes in `VENDOR.json`, notice in `vendor/THIRD_PARTY_NOTICES.md`).
  `lib/settings-panel.ts` was removed; `index.ts` imports the adapter statically and hands it to
  the extension.
- The panel opens without waiting for the ledger. Spend, price coverage and active limits appear in
  the header and in read-only rows as soon as the local state is read; Enter on those rows rereads
  it, and Esc cancels the read.
- Budgets are three settings (project, task, session): No limit or a hard amount (USD 0.50, 1.00,
  5.00, 20.00, 100.00), soft warning at 80%. A value set outside the panel stays selectable and is
  kept as is, including a custom soft limit.
- Yes/no settings switch with one Enter. Local models are a multiselect (Space, then Enter) whose
  candidates come from `/scoped-models`.
- Settings locked by the global policy are shown with `[source: global policy]` instead of being
  hidden, and are never written.
- In an untrusted project the language row is locked (`[locked: project trust]`) instead of
  accepting a preview that could not be saved.
- Ctrl+S keeps the panel open. Esc during a save cancels it through the AbortSignal and keeps the
  draft; a save that cannot be confirmed is checked against storage before writing again.
- Session shutdown closes an open panel and waits for the save or read it started.
- The language preview switches every text, including the adapter's keys, hints and dialogs.
  Below 40×12 the panel asks for a bigger terminal.
- Peer ranges are `>=1.5.2 <1.7.0` instead of `*`; `@earendil-works/pi-tui` 1.6.0 is a
  devDependency for the panel tests; `engines.node` is `>=22.19.0` (required by pi-tui 1.6.0) and
  CI runs Node 22 and 24.

### Fixed

- A Ctrl+S that writes the settings and then fails (or is cancelled with Esc) while writing the
  language no longer reports the whole draft as unsaved: the settings already written become the
  saved baseline, only the language stays in the draft, and a second Esc discards only it.
- A slow first state read no longer replaces a newer refresh (Enter on Spend, Price coverage or
  Active limits) in the rows and the header.
- The degraded `/cost` text (no panel module, no custom screen, overlay failure) follows the saved
  language: English by default, pt-BR when chosen, without mixing the two.
- The closing summary is rendered in the saved language, so its lines no longer mix the language
  previewed at save time with the final one.

### Removed

- The unused `runDashboard` screen, its host-export table and `test-support/fake-tui.mjs`.
- The design-system mark files under `docs/assets/` and their mention in the README.

### Tests

- The panel tests drive the real adapter by terminal bytes with the real pi-tui keybindings:
  keyboard, Ctrl+S, Esc Esc, cancellation, late results, disk failure, English and pt-BR,
  40/80/120 columns with Unicode. `test/vendor.test.mjs` checks the vendored hashes without an IDS
  checkout.
- `npm run smoke` loads a staged, installed-like copy of the package with the loader of the
  installed Pi 1.6.0.
