// Explicit real-host smoke test. Never sends a model prompt or reads credentials.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const cli = process.argv[2];
if (!cli) throw Error('Pass the installed Pi dist/cli.js path');
const dir = await mkdtemp(join(tmpdir(), 'suite-pi-smoke-'));
const names = ['model-economist', 'acceptance-gate', 'loop-guard', 'cost-profiler', 'mcp-control'];
const args = [
  cli,
  '--offline',
  '--no-extensions',
  '--no-mcp',
  '--no-skills',
  '--no-context-files',
  '--no-approve',
  '--no-session',
  '--mode',
  'rpc',
  '--model',
  'economist/auto',
  ...names.flatMap((n) => ['-e', resolve(`../pi-${n}/index.ts`)]),
];
try {
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: dir,
      env: { ...process.env, PI_AGENT_DIR: join(dir, 'agent'), PI_SUITE_HOME: join(dir, 'state') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      timer;
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      if (stdout.includes('"id":"commands"')) child.stdin.end();
    });
    child.stderr.on('data', (data) => (stderr += data.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveResult({ code, stdout, stderr });
    });
    timer = setTimeout(() => {
      child.kill();
      reject(Error('Pi smoke timed out'));
    }, 20000);
    child.stdin.write(JSON.stringify({ id: 'commands', type: 'get_commands' }) + '\n');
  });
  if (
    result.code !== 0 ||
    /Failed to load extension|extension_error/.test(result.stderr + result.stdout)
  )
    throw Error(result.stderr + result.stdout);
  const records = result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const response = records.find((r) => r.id === 'commands');
  if (!response?.success) throw Error('No successful get_commands response');
  const commandNames = response.data.commands.map((c) => c.name);
  for (const n of ['economist', 'gate', 'guard', 'cost', 'mcpc'])
    if (!commandNames.includes(n)) throw Error(`Missing command ${n}`);
  console.log(
    JSON.stringify({
      piStartup: 'passed',
      commands: commandNames.filter((n) =>
        ['economist', 'gate', 'guard', 'cost', 'mcpc'].includes(n),
      ),
      providerCalls: 0,
    }),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
