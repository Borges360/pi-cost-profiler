// harness:managed release v1 — workspace/packages/core/gitflow-release.mjs (não editar no produto)
// gitflow-release.mjs — PR automático no Git Flow e versão semântica por Conventional Commits.
// Roda no GitHub Actions e no Gitea Actions (mesma API REST de pulls/releases), a cada push:
//   feature/** | bugfix/** | codex/**  → abre PR para develop (se ainda não houver);
//   develop                            → calcula a próxima versão; se houver feat/fix/quebra,
//                                        mantém release/<versão> (develop + commit de versão) e o PR para main;
//   release/** | hotfix/**             → hotfix recebe o commit de versão; abre PR para main;
//   main                               → tag v<versão> + release com as notas e PR de retorno main → develop.
// Nunca integra PR: o merge continua humano. Não faz deploy (Jenkins) nem publica pacote.
// Distribuído pelo harness como .github/scripts/gitflow-release.mjs, ao lado de version.mjs.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { applyVersion, findVersionFile, parseCommit, planVersion, releaseCommitVersion } from "./version.mjs";

export const MARKER = "<!-- harness:gitflow-release -->";
const TOPIC = /^(feature|bugfix|codex)\//;
const BOT = ["-c", "user.name=gitflow-release[bot]", "-c", "user.email=gitflow-release@users.noreply.invalid"];
const RANK = { major: 3, minor: 2, patch: 1, none: 0 };

export function createGit(dir) {
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git.try = (...args) => { try { return git(...args); } catch { return null; } };
  return git;
}

/** Cliente REST mínimo comum a GitHub (api.github.com) e Gitea (/api/v1). */
export function createApi({ base, repo, token, fetchImpl = globalThis.fetch }) {
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { Authorization: `token ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`), { status: res.status });
    return text ? JSON.parse(text) : null;
  };
  return {
    async openPulls() {
      const all = [];
      for (let page = 1; page <= 10; page += 1) {
        const items = await call("GET", `/repos/${repo}/pulls?state=open&per_page=50&limit=50&page=${page}`);
        all.push(...items);
        if (items.length < 50) break;
      }
      return all;
    },
    createPull: (baseRef, head, title, body) => call("POST", `/repos/${repo}/pulls`, { base: baseRef, head, title, body }),
    updatePull: (number, fields) => call("PATCH", `/repos/${repo}/pulls/${number}`, fields),
    createRelease: (tag, body, target) => call("POST", `/repos/${repo}/releases`, { tag_name: tag, name: tag, body, target_commitish: target }),
    pendingRuns: async (sha) => (await call("GET", `/repos/${repo}/actions/runs?head_sha=${sha}&status=action_required&per_page=100`))?.workflow_runs ?? [],
    approveRun: (id) => call("POST", `/repos/${repo}/actions/runs/${id}/approve`)
  };
}

/** `.github/harness-release.json`: nomes de main/develop e linha de base do histórico. */
export function loadConfig(dir) {
  const path = join(dir, ".github", "harness-release.json");
  const raw = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  return { main: raw.main ?? "main", develop: raw.develop ?? "develop", baseline: raw.baseline ?? null };
}

/** Commits (mais novo primeiro) de um intervalo, já interpretados. */
function commitsIn(git, range) {
  const raw = git.try("log", "--format=%H%x1f%B%x1e", range) ?? "";
  return raw.split("\x1e").map((c) => c.trim()).filter(Boolean).map((c) => {
    const [sha, ...body] = c.split("\x1f");
    return { sha, ...parseCommit(body.join("\x1f")) };
  });
}

/** Notas da versão agrupadas por efeito, a partir dos commits do intervalo. */
export function releaseNotes(commits) {
  const groups = [["Mudanças incompatíveis", (c) => c.breaking], ["Novidades", (c) => !c.breaking && c.type === "feat"],
    ["Correções", (c) => !c.breaking && ["fix", "perf"].includes(c.type)], ["Outros", () => true]];
  const used = new Set();
  const out = [];
  for (const [title, match] of groups) {
    const items = commits.filter((c) => c.valid && !c.merge && !used.has(c.sha) && releaseCommitVersion(c.header) === null && match(c));
    if (!items.length) continue;
    items.forEach((c) => used.add(c.sha));
    out.push(`### ${title}`, "", ...items.map((c) => `- ${c.header} (${c.sha.slice(0, 7)})`), "");
  }
  return out.length ? out.join("\n") : "Sem mudanças registradas.";
}

/** Título do PR de tópico: o commit de maior efeito (quebra > feat > fix > demais), o mais antigo. */
export function topicTitle(commits, ref) {
  const valid = commits.filter((c) => c.valid && !c.merge).reverse();
  if (!valid.length) return `chore: ${ref}`;
  const top = Math.max(...valid.map((c) => RANK[c.bump]));
  return valid.find((c) => RANK[c.bump] === top).header;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run({ dir, ref, env = process.env, git = createGit(dir), api, log = console.log, sleep = wait }) {
  const cfg = loadConfig(dir);
  const onGitea = env.GITEA_ACTIONS === "true";
  git("fetch", "--force", "--tags", "--quiet", "origin",
    `+refs/heads/${cfg.main}:refs/remotes/origin/${cfg.main}`, `+refs/heads/${cfg.develop}:refs/remotes/origin/${cfg.develop}`);
  const remote = (branch) => `refs/remotes/origin/${branch}`;
  const isAncestor = (a, b) => git.try("merge-base", "--is-ancestor", a, b) !== null;
  const tagExists = (tag) => git.try("rev-parse", "--verify", "--quiet", `refs/tags/${tag}`) !== null;
  const result = { ref, actions: [] };
  const act = (action, detail = {}) => { result.actions.push({ action, ...detail }); log(`${action} ${JSON.stringify(detail)}`); };

  // PR aberto (ou branch atualizada) com o token do Actions: no GitHub as execuções de
  // pull_request ficam em action_required e os checks obrigatórios não rodam. A automação aprova
  // as execuções pendentes do próprio SHA (as de workflow_dispatch não contam para o PR).
  const approveChecks = async (branch) => {
    if (onGitea) return;
    const sha = (git.try("ls-remote", "--heads", "origin", branch) ?? "").split(/\s+/)[0];
    if (!sha) return;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      let runs;
      try { runs = await api.pendingRuns(sha); } catch (error) { act("checks-falhou", { reason: error.message }); return; }
      if (runs.length) {
        for (const r of runs) {
          try { await api.approveRun(r.id); act("check-aprovado", { workflow: r.name, run: r.id }); }
          catch (error) { act("check-aprovacao-negada", { workflow: r.name, reason: error.message }); }
        }
        return;
      }
      await sleep(5000);
    }
    act("checks-sem-pendencia", { sha: sha.slice(0, 12) });
  };
  const ensurePr = async (base, head, title, body, { refreshBody = false } = {}) => {
    const open = await api.openPulls();
    const found = open.find((p) => p.base?.ref === base && p.head?.ref === head);
    if (found) {
      if (refreshBody && String(found.body ?? "").includes(MARKER) && (found.title !== title || found.body !== body)) {
        await api.updatePull(found.number, { title, body });
        act("pr-atualizado", { number: found.number, base, head });
      } else act("pr-existente", { number: found.number, base, head });
      return { number: found.number, created: false };
    }
    const pr = await api.createPull(base, head, title, body);
    act("pr-aberto", { number: pr.number, base, head, title });
    await approveChecks(head);
    return { number: pr.number, created: true };
  };
  const backMerge = async (version) => {
    if (isAncestor(remote(cfg.main), remote(cfg.develop))) return;
    await ensurePr(cfg.develop, cfg.main, `chore(gitflow): retorno de ${cfg.main} para ${cfg.develop}`,
      [MARKER, `Retorno de \`${cfg.main}\` para \`${cfg.develop}\`${version ? ` depois da v${version}` : ""}.`, "",
        "Integre com **merge commit** (não squash): o commit de versão precisa chegar a develop."].join("\n"));
  };

  if (ref === cfg.main) {
    const head = git("rev-parse", remote(cfg.main));
    const tagged = git("tag", "--points-at", head).split("\n").filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
    let version = tagged.length ? tagged.sort().at(-1).slice(1) : null;
    if (!tagged.length) {
      const last = git.try("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*", head);
      const base = last ?? cfg.baseline;
      const commits = commitsIn(git, base ? `${base}..${head}` : head);
      version = commits.map((c) => releaseCommitVersion(c.header)).find(Boolean) ?? null;
      if (!version) {
        const plan = planVersion(dir, { ref: head, baseline: cfg.baseline });
        if (plan.ok && plan.status === "release") version = plan.version;
        else act("sem-versao", { status: plan.status, reason: plan.reason ?? null });
      }
      if (version && tagExists(`v${version}`)) { act("tag-em-outro-commit", { tag: `v${version}` }); version = null; }
      if (version) {
        const tag = `v${version}`;
        git(...BOT, "tag", "-a", tag, "-m", tag, head);
        git("push", "--quiet", "origin", `refs/tags/${tag}`);
        act("tag-criada", { tag, sha: head.slice(0, 12) });
        await api.createRelease(tag, releaseNotes(commits), head);
        act("release-criada", { tag });
        const branch = `release/${version}`;
        if (git.try("ls-remote", "--exit-code", "--heads", "origin", branch) !== null) {
          git("fetch", "--quiet", "origin", `+refs/heads/${branch}:${remote(branch)}`);
          if (isAncestor(remote(branch), head)) { git("push", "--quiet", "origin", "--delete", branch); act("release-branch-removida", { branch }); }
        }
      }
    } else act("ja-versionado", { tag: `v${version}` });
    await backMerge(version);
    return result;
  }

  if (ref === cfg.develop) {
    const head = git("rev-parse", remote(cfg.develop));
    const plan = planVersion(dir, { ref: head, baseline: cfg.baseline });
    if (!plan.ok) { act("sem-versao", { status: plan.status, reason: plan.reason, invalid: plan.invalid ?? [] }); return result; }
    if (plan.status !== "release") { act("sem-release", { status: plan.status, version: plan.version ?? plan.current }); return result; }
    const version = plan.version;
    if (tagExists(`v${version}`)) { act("aguarda-retorno", { tag: `v${version}` }); await backMerge(version); return result; }
    const branch = `release/${version}`;
    // Versão mudou (ex.: feat depois de um fix): fecha o PR de release anterior da automação.
    for (const pr of await api.openPulls()) {
      if (pr.base?.ref !== cfg.main || !pr.head?.ref?.startsWith("release/") || pr.head.ref === branch) continue;
      if (!String(pr.body ?? "").includes(MARKER)) continue;
      await api.updatePull(pr.number, { state: "closed" });
      act("pr-substituido", { number: pr.number, head: pr.head.ref, by: branch });
      if (git.try("push", "--quiet", "origin", "--delete", pr.head.ref) !== null) act("release-branch-removida", { branch: pr.head.ref });
    }
    git("checkout", "--quiet", "-B", branch, head);
    const applied = applyVersion(dir, plan);
    if (applied.written) {
      git("add", "--", applied.file);
      git(...BOT, "commit", "--quiet", "-m", `chore(release): ${version}`);
      act("versao-gravada", { file: applied.file, from: applied.from, to: applied.to });
    }
    const local = git("rev-parse", "HEAD");
    let pushed = false;
    const remoteTip = git.try("ls-remote", "--exit-code", "--heads", "origin", branch) !== null
      ? (git("fetch", "--quiet", "origin", `+refs/heads/${branch}:${remote(branch)}`), git("rev-parse", remote(branch))) : null;
    if (!remoteTip) { git("push", "--quiet", "origin", `HEAD:refs/heads/${branch}`); pushed = true; act("release-branch-criada", { branch }); }
    else {
      const extra = commitsIn(git, `${head}..${remoteTip}`).filter((c) => releaseCommitVersion(c.header) === null);
      if (extra.length) act("release-branch-manual", { branch, commits: extra.length, note: "commits manuais na release: não sobrescreve" });
      else if (isAncestor(head, remoteTip) && git.try("diff", "--quiet", remoteTip, local) !== null) act("release-branch-atual", { branch });
      else { git("push", "--quiet", `--force-with-lease=refs/heads/${branch}:${remoteTip}`, "origin", `HEAD:refs/heads/${branch}`); pushed = true; act("release-branch-atualizada", { branch }); }
    }
    const since = git.try("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*", head) ?? cfg.baseline;
    const notes = releaseNotes(commitsIn(git, since ? `${since}..${head}` : head));
    const body = [MARKER, `Release **${version}** (${plan.current} → ${version}, ${plan.bump}), calculada pelos Conventional Commits de \`${cfg.develop}\`.`,
      "", notes, "", `Ao integrar em \`${cfg.main}\`, a automação cria a tag \`v${version}\`, a release e o PR de retorno para \`${cfg.develop}\`.`].join("\n");
    const pr = await ensurePr(cfg.main, branch, `chore(release): ${version}`, body, { refreshBody: true });
    if (pushed && !pr.created) await approveChecks(branch);
    git("checkout", "--quiet", "--detach", head);
    return result;
  }

  if (ref.startsWith("hotfix/") || ref.startsWith("release/")) {
    let title = ref.startsWith("release/") ? `chore(release): ${ref.slice("release/".length)}` : null;
    let bumped = false;
    if (ref.startsWith("hotfix/")) {
      const plan = planVersion(dir, { ref: "HEAD", baseline: cfg.baseline });
      if (plan.ok && plan.status === "release") {
        title = `chore(release): ${plan.version}`;
        const file = findVersionFile(dir);
        if (file && file.version !== plan.version) {
          const applied = applyVersion(dir, plan);
          git("add", "--", applied.file);
          git(...BOT, "commit", "--quiet", "-m", title);
          git("push", "--quiet", "origin", `HEAD:refs/heads/${ref}`);
          act("versao-gravada", { file: applied.file, from: applied.from, to: applied.to });
          bumped = true;
        }
      } else act("sem-versao", { status: plan.status, reason: plan.reason ?? null });
      title ??= `fix: ${ref.slice("hotfix/".length)}`;
    }
    const head = git("rev-parse", "HEAD");
    const commits = commitsIn(git, `${remote(cfg.main)}..${head}`);
    if (!commits.length) { act("sem-commits", { base: cfg.main }); return result; }
    const pr = await ensurePr(cfg.main, ref, title, [MARKER, `\`${ref}\` → \`${cfg.main}\`. Depois do merge, o retorno para \`${cfg.develop}\` é aberto automaticamente.`, "", releaseNotes(commits)].join("\n"));
    if (bumped && !pr.created) await approveChecks(ref);
    return result;
  }

  if (TOPIC.test(ref)) {
    const commits = commitsIn(git, `${remote(cfg.develop)}..HEAD`);
    if (!commits.length) { act("sem-commits", { base: cfg.develop }); return result; }
    await ensurePr(cfg.develop, ref, topicTitle(commits, ref), [MARKER, `\`${ref}\` → \`${cfg.develop}\`, aberto automaticamente no push.`, "", releaseNotes(commits)].join("\n"));
    return result;
  }

  act("sem-acao", { ref });
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const env = process.env;
  const dir = process.cwd();
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (!token) { console.error("GH_TOKEN ausente"); process.exit(1); }
  const api = createApi({ base: env.GITHUB_API_URL ?? "https://api.github.com", repo: env.GITHUB_REPOSITORY, token });
  run({ dir, ref: env.GITFLOW_REF ?? env.GITHUB_REF_NAME, env, api }).catch((error) => { console.error(error.message); process.exit(1); });
}
