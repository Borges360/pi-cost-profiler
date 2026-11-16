import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CATALOGS,
  LOCALES,
  catalogKeys,
  placeholderNames,
  translate,
  readProjectLocale,
  writeProjectLocale,
  wrapPanelText,
} from '../lib/i18n.mjs';

const SAMPLE = {
  accounting: 'Accounting on', spend: '$0.0000', coverage: '12/14', scope: 'project',
  unavailable: '', id: 'task-1', count: 8, amount: '100.00', prefix: '',
  model: 'provider/model', priced: 12, calls: 14, models: 'provider/model',
  limits: 'project: hard limit USD 5.00', tokens: 2048, cap: 'On',
  error: 'sample error', field: 'Accounting', value: 'On',
  notes: '· Accounting updated to On', file: 'project/.pi/pi-suite.yaml',
  language: 'Português (Brasil)',
};

test('English and pt-BR catalogs have identical keys and placeholders', () => {
  assert.deepEqual(LOCALES, ['en', 'pt-BR']);
  assert.deepEqual(catalogKeys('en').sort(), catalogKeys('pt-BR').sort());
  for (const key of catalogKeys('en'))
    assert.deepEqual(placeholderNames(CATALOGS.en[key]), placeholderNames(CATALOGS['pt-BR'][key]), key);
});

test('first-use, invalid locale and missing-key fallback stay in English', () => {
  assert.equal(translate(undefined, 'title'), 'Cost');
  assert.equal(translate('not-a-locale', 'title'), 'Cost');
  assert.equal(translate('pt-BR', 'notDefined'), 'notDefined');
  assert.equal(translate('pt-BR', 'shellUnsaved'), 'Há alterações sem salvar. Ctrl+S salva; pressione Esc novamente para descartar.');
});

test('localized dashboard copy wraps within 40, 80 and 120 columns', () => {
  for (const locale of LOCALES) {
    for (const key of catalogKeys(locale)) {
      const rendered = translate(locale, key, SAMPLE);
      for (const width of [40, 80, 120]) {
        const lines = wrapPanelText(rendered, width);
        assert.ok(lines.every((line) => line.length <= width), locale + '.' + key + ' at ' + width);
      }
    }
  }
});

test('project locale is trusted-project only and survives reload without a global preference', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cost-locale-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const initial = await readProjectLocale({ root, trusted: true });
  assert.equal(initial.locale, 'en');
  assert.equal(initial.canPersist, true);
  assert.equal(initial.issue, null);
  const file = await writeProjectLocale({ root, trusted: true, locale: 'pt-BR' });
  assert.equal(file, join(root, '.pi', 'pi-cost-profiler.locale.json'));
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { schemaVersion: 1, locale: 'pt-BR' });
  assert.equal((await readProjectLocale({ root, trusted: true })).locale, 'pt-BR');
  const untrusted = await readProjectLocale({ root, trusted: false });
  assert.equal(untrusted.locale, 'en');
  assert.equal(untrusted.canPersist, false);
  assert.equal(untrusted.file, null);
  await assert.rejects(writeProjectLocale({ root, trusted: false, locale: 'pt-BR' }), /Project trust/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).locale, 'pt-BR');
});

test('missing and malformed locale files fall back safely, and canceled saves write nothing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cost-locale-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, '.pi', 'pi-cost-profiler.locale.json');
  assert.equal((await readProjectLocale({ root, trusted: true })).locale, 'en');
  await mkdir(join(root, '.pi'), { recursive: true });
  await writeFile(file, '{"schemaVersion":8,"locale":"fr"}\n');
  const invalid = await readProjectLocale({ root, trusted: true });
  assert.equal(invalid.locale, 'en');
  assert.equal(invalid.issue, 'invalid');
  const controller = new AbortController();
  controller.abort(new Error('Operation canceled'));
  await assert.rejects(writeProjectLocale({ root, trusted: true, locale: 'pt-BR', signal: controller.signal }), /Operation canceled/);
  assert.equal((await readFile(file, 'utf8')).includes('"locale":"fr"'), true);
});