import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('Cost Profiler specialization and metadata match across clients', () => {
  const skill = read('.agents/skills/pi-cost-profiler/SKILL.md');
  const cursorSkill = read('.cursor/skills/pi-cost-profiler/SKILL.md');
  const metadata = read('.agents/skills/pi-cost-profiler/metadata.yaml');
  const cursorMetadata = read('.cursor/skills/pi-cost-profiler/metadata.yaml');
  assert.ok(skill.length > 0);
  assert.equal(cursorSkill, skill);
  assert.equal(cursorMetadata, metadata);
  for (const field of ['id: pi-cost-profiler', 'owner: pi-cost-profiler', 'version: 1.0.0']) {
    assert.ok(metadata.includes(field), field);
  }
});

test('product context does not imply a design-system selection', () => {
  const agents = read('AGENTS.md');
  const marker = agents.indexOf('<!-- harness:start -->');
  assert.ok(marker > 0);
  const preamble = agents.slice(0, marker);
  assert.ok(preamble.includes('.agents/skills/pi-cost-profiler/SKILL.md'));
  assert.doesNotMatch(preamble, /INTEIRO/i);
});

test('specialization matches local accounting and explicit dashboard save semantics', () => {
  const skill = read('.agents/skills/pi-cost-profiler/SKILL.md');
  const extension = read('extension.mjs');
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.name, 'pi-cost-profiler');
  assert.ok(extension.includes("createRuntime(pi, 'cost'"));
  for (const phrase of ['/cost without arguments', 'Ctrl+S', 'Unknown prices', 'user-selected local JSON file', 'not a provider gateway']) {
    assert.ok(skill.includes(phrase), phrase);
  }
});
