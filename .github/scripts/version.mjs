// harness:managed release v1 — workspace/packages/core/version.mjs (não editar no produto)
// version.mjs — versão automática por Conventional Commits (tarefa 07).
// Deriva major/minor/patch dos commits integrados desde a última tag de versão, lê e
// grava o arquivo de versão nativo da stack e é idempotente por SHA: um commit que já
// tem tag de versão não recebe outra. Mensagem inválida bloqueia (não adivinha versão).
// Não cria tag, não faz push e não publica: esses efeitos exigem pedido explícito.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TYPES = new Set(["feat", "fix", "perf", "refactor", "docs", "test", "build", "ci", "chore", "style", "revert"]);
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()\r\n]+)\))?(?<bang>!)?: (?<subject>\S.*)$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const RANK = { none: 0, patch: 1, minor: 2, major: 3 };
// Commit de release gravado pela automação; o sufixo " (#12)" é o do merge squash do host.
export const RELEASE_COMMIT = /^chore\(release\): (\d+\.\d+\.\d+)(?: \(#\d+\))?$/;

/** Versão de um commit de release (`chore(release): 1.2.3`), ou null. */
export function releaseCommitVersion(header) {
  const m = RELEASE_COMMIT.exec(String(header ?? "").trim());
  return m ? m[1] : null;
}

/** Interpreta uma mensagem de commit; merges automáticos do host não contam como mudança. */
export function parseCommit(message) {
  const text = String(message).replace(/\r\n/g, "\n").trim();
  const header = text.split("\n")[0];
  if (/^Merge (pull request|branch|remote-tracking branch|PR) /.test(header) || /^Merge PR #\d+/.test(header)) return { merge: true, valid: true, bump: "none" };
  const m = HEADER.exec(header);
  if (!m || !TYPES.has(m.groups.type)) return { valid: false, header };
  const breaking = Boolean(m.groups.bang) || /^BREAKING[ -]CHANGE: /m.test(text);
  const bump = breaking ? "major" : m.groups.type === "feat" ? "minor" : ["fix", "perf"].includes(m.groups.type) ? "patch" : "none";
  return { valid: true, type: m.groups.type, scope: m.groups.scope ?? null, breaking, bump, header };
}

export function bumpVersion(current, bump) {
  const m = SEMVER.exec(current);
  if (!m) throw new Error(`versão atual inválida: ${current}`);
  let [major, minor, patch] = m.slice(1).map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  return current;
}

// Arquivo de versão nativo por stack. A ordem decide quando o projeto tem mais de um.
const VERSION_FILES = [
  { file: "release.json", read: (t) => JSON.parse(t).version, write: (t, v) => JSON.stringify({ ...JSON.parse(t), version: v }, null, 4) + "\n" },
  { file: "package.json", read: (t) => JSON.parse(t).version, write: (t, v) => replaceJsonVersion(t, v) },
  { file: "composer.json", read: (t) => JSON.parse(t).version, write: (t, v) => replaceJsonVersion(t, v) },
  { file: "VERSION", read: (t) => t.trim(), write: (_t, v) => `${v}\n` }
];

function replaceJsonVersion(text, version) {
  // Troca só o campo de topo, preservando formatação e ordem do restante do arquivo.
  const out = text.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
  if (out === text && JSON.parse(text).version !== version) throw new Error("campo version não encontrado");
  return out;
}

const CSPROJ = /<Version>([^<]+)<\/Version>/;

/** `<version>` do próprio projeto Maven: ignora `<parent>`, dependências, plugins e propriedades. */
function pomVersion(text) {
  const projectStart = text.indexOf("<project");
  if (projectStart < 0) return null;
  let depth = 0; const re = /<(\/?)([A-Za-z][\w.-]*)(?:\s[^>]*)?(\/?)>/g; re.lastIndex = projectStart;
  let m;
  while ((m = re.exec(text))) {
    const [, closing, name, selfClosing] = m;
    if (selfClosing) continue;
    if (closing) { depth -= 1; continue; }
    depth += 1;
    if (depth === 2 && name === "version") {
      const start = m.index + m[0].length; const end = text.indexOf("</version>", start);
      return end > start ? { version: text.slice(start, end).trim(), start, end } : null;
    }
  }
  return null;
}

/** Localiza o arquivo de versão do projeto; ausência é lacuna explícita, não palpite. */
export function findVersionFile(dir) {
  for (const spec of VERSION_FILES) {
    const path = join(dir, spec.file);
    if (!existsSync(path)) continue;
    let value; try { value = spec.read(readFileSync(path, "utf8")); } catch { continue; }
    if (typeof value === "string" && SEMVER.test(value)) return { file: spec.file, version: value, spec };
  }
  const csproj = readdirSync(dir).find((f) => f.endsWith(".csproj"));
  if (csproj) {
    const m = CSPROJ.exec(readFileSync(join(dir, csproj), "utf8"));
    if (m && SEMVER.test(m[1])) return { file: csproj, version: m[1], spec: { write: (t, v) => t.replace(CSPROJ, `<Version>${v}</Version>`) } };
  }
  if (existsSync(join(dir, "pom.xml"))) {
    const text = readFileSync(join(dir, "pom.xml"), "utf8");
    const found = pomVersion(text);
    if (found && SEMVER.test(found.version)) return { file: "pom.xml", version: found.version, spec: { write: (t, v) => { const at = pomVersion(t); return t.slice(0, at.start) + v + t.slice(at.end); } } };
  }
  return null;
}

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Última tag de versão alcançável (`v1.2.3`), se houver. */
function lastVersionTag(dir, ref) {
  try { return git(dir, "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*", ref); } catch { return null; }
}

/** Calcula a próxima versão para `ref` (padrão HEAD). Somente leitura. */
export function planVersion(dir, { ref = "HEAD", since = null, baseline = null } = {}) {
  const sha = git(dir, "rev-parse", ref);
  const tagsAtSha = git(dir, "tag", "--points-at", sha).split("\n").filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  if (tagsAtSha.length) return { ok: true, sha, status: "already-versioned", version: tagsAtSha.sort().at(-1).slice(1), commits: 0 };
  const file = findVersionFile(dir);
  if (!file) return { ok: false, sha, status: "no-version-file", reason: "sem arquivo de versão nativo (package.json/composer.json/release.json/.csproj/VERSION)" };
  // Ordem: --since explícito > última tag de versão > linha de base do inventário (commits anteriores à automação).
  const tag = lastVersionTag(dir, ref);
  const base = since ?? tag ?? baseline;
  const range = base ? `${base}..${sha}` : sha;
  const raw = git(dir, "log", "--format=%H%x1f%B%x1e", range);
  const all = raw.split("\x1e").map((c) => c.trim()).filter(Boolean).map((c) => { const [h, ...b] = c.split("\x1f"); return { sha: h, ...parseCommit(b.join("\x1f")) }; });
  // Commit de release sem tag (versão já gravada) também é base: evita contar duas vezes.
  const releaseAt = all.findIndex((c) => releaseCommitVersion(c.header) !== null);
  const commits = releaseAt >= 0 ? all.slice(0, releaseAt) : all;
  const invalid = commits.filter((c) => !c.valid);
  if (invalid.length) return { ok: false, sha, status: "invalid-commits", reason: "mensagem fora de Conventional Commits bloqueia a versão automática", invalid: invalid.map((c) => ({ sha: c.sha.slice(0, 12), header: c.header })) };
  const bump = commits.reduce((acc, c) => (RANK[c.bump] > RANK[acc] ? c.bump : acc), "none");
  const current = releaseAt >= 0 ? releaseCommitVersion(all[releaseAt].header) : tag && base === tag ? tag.slice(1) : file.version;
  return { ok: true, sha, status: bump === "none" ? "no-release" : "release", base: releaseAt >= 0 ? all[releaseAt].sha : base, current, bump, version: bumpVersion(current, bump), file: file.file, commits: commits.length };
}

/** Grava a versão planejada no arquivo nativo (sem tag nem push). Idempotente. */
export function applyVersion(dir, plan) {
  if (!plan.ok || plan.status !== "release") return { written: false, reason: plan.status };
  const file = findVersionFile(dir);
  if (file.version === plan.version) return { written: false, reason: "arquivo já na versão planejada" };
  const path = join(dir, file.file);
  writeFileSync(path, file.spec.write(readFileSync(path, "utf8"), plan.version), "utf8");
  return { written: true, file: file.file, from: file.version, to: plan.version };
}
