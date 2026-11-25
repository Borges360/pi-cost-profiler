import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { verifyVendor } from '../vendor/inteiro-terminal/verify-vendor.mjs';

const root = new URL('../', import.meta.url);
// Built from parts so this shipped test file does not match its own check.
const BRAND = ['INT', 'EIRO'].join('');
const MARK = new RegExp(`${BRAND}|${['Não eliminar', 'a tensão'].join(' ')}`);
const vendorDir = new URL('vendor/inteiro-terminal/', root);

test('vendored terminal adapter matches its manifest hashes (no IDS checkout needed)', () => {
  const result = verifyVendor(fileURLToPath(vendorDir));
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  const m = result.manifest;
  assert.equal(m.package, '@inteiro/terminal');
  assert.equal(m.version, '2.0.0-rc.1');
  assert.equal(m.format, 'js', 'plain ESM: Node 22/24 run it without type stripping or a build');
  assert.equal(m.source.dirty, false);
  assert.deepEqual(m.patches, [], 'the copy is identical to upstream');
  // Only the Pi host is external: no width library, no prompts/linear adapters.
  assert.deepEqual(m.externals, ['@earendil-works/pi-tui']);
  // 12 adapter modules plus the theme data and its installer (pi-themes.js, pi-theme-install.js).
  assert.equal(m.files.length, 14);
});

test('vendored copy carries no design-system tokens, palette or fixed colors', async () => {
  const files = (await readdir(vendorDir)).filter((f) => f.endsWith('.js'));
  assert.ok(!files.includes('roles.js') && !files.includes('catalog.js') && !files.includes('prompts.js'));
  for (const file of files) {
    const source = await readFile(new URL(file, vendorDir), 'utf8');
    assert.doesNotMatch(source, /\\x1b\[[0-9;]*m|\\u001b\[[0-9;]*m/, `${file} has fixed ANSI color`);
    assert.doesNotMatch(source, /color\.identity|SEMANTIC_ROLES/, `${file} imports tokens`);
  }
});

test('only the entry point imports the host adapter; the extension stays loadable without pi-tui', async () => {
  for (const file of ['extension.mjs', 'menu.mjs', 'lib/panel.mjs', 'lib/core.mjs', 'lib/i18n.mjs', 'ledger.mjs']) {
    const source = await readFile(new URL(file, root), 'utf8');
    assert.doesNotMatch(source, /vendor\/inteiro-terminal\/pi\.js/, `${file} must not import the host adapter`);
  }
  const panel = await readFile(new URL('lib/panel.mjs', root), 'utf8');
  assert.match(panel, /from '\.\.\/vendor\/inteiro-terminal\/settings\.js'/);
  const settings = await readFile(new URL('settings.js', vendorDir), 'utf8');
  assert.doesNotMatch(settings, /@earendil-works/, 'the state code has no host import');
});

test('package ships the copy and declares the real host range', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.ok(pkg.files.includes('vendor/'));
  for (const name of ['@earendil-works/pi-tui', '@earendil-works/pi-coding-agent', '@earendil-works/pi-ai'])
    assert.equal(pkg.peerDependencies[name], '>=1.5.2 <1.7.0', name);
  assert.equal(pkg.devDependencies['@earendil-works/pi-tui'], '1.6.0');
  assert.equal(pkg.engines.node, '>=22.19.0', 'pi-tui 1.6.0 requires Node 22.19+');
  assert.ok(!('string-width' in (pkg.dependencies ?? {})));
  const manifest = JSON.parse(await readFile(new URL('VENDOR.json', vendorDir), 'utf8'));
  assert.equal(manifest.peerDependencies['@earendil-works/pi-tui'], '^1.5.2');
});

test('no design-system mark, slogan or attribution ships outside the vendor directory', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const walk = async (rel) => {
    let entries;
    try {
      entries = await readdir(new URL(rel, root), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOTDIR') return [rel];
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    return (
      await Promise.all(entries.map((e) => (e.isDirectory() ? walk(`${rel}/${e.name}`) : [`${rel}/${e.name}`])))
    ).flat();
  };
  const shipped = (await Promise.all(pkg.files.map((p) => walk(p.replace(/\/$/, ''))))).flat()
    .filter((path) => !/^vendor(\/|$)/.test(path));
  assert.ok(shipped.includes('README.md') && shipped.includes('lib/panel.mjs'));
  for (const path of shipped) {
    assert.doesNotMatch(path, new RegExp(`${BRAND}|mark\\.svg`, 'i'), `${path} ships a design-system asset`);
    // Test files hold absence guards (e.g. test/agent-context.test.mjs), not product text.
    if (/^test(-support)?\//.test(path)) continue;
    const text = await readFile(new URL(path, root), 'utf8');
    assert.doesNotMatch(text, MARK, `${path} carries the design-system mark or slogan`);
  }
  const readme = await readFile(new URL('README.md', root), 'utf8');
  assert.doesNotMatch(readme, new RegExp(BRAND, 'i'), 'the README does not advertise the design system');
});
