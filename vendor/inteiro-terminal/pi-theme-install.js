// Vendored from @inteiro/terminal 2.0.0-rc.1 (packages/terminal/src/pi-theme-install.ts). Do not edit; see VENDOR.json.
/**
 * Makes the INTEIRO Pi themes available without a separate install step. An extension calls
 * `registerInteiroPiThemes(pi)` in its factory:
 *
 * 1. The themes are written to `<agent-dir>/themes/`, where Pi discovers user themes on every start,
 *    so a theme chosen in `/settings` applies from the first frame of the next session.
 * 2. The same files are returned from `resources_discover`, so they are already listed in the session
 *    that wrote them. Every extension returns the same paths, and Pi merges equal paths, so several
 *    extensions that vendor this module never cause a name collision.
 *
 * The extension never selects a theme: choosing one stays in `/settings`. A file the user edited is
 * never overwritten, and an older copy never replaces a newer one. Failures (read-only home,
 * permissions) are reported in the result and never stop the extension from loading.
 * Opt out with `PI_DESIGN_THEMES=off`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PI_THEMES, PI_THEMES_VERSION } from "./pi-themes.js";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
export function piAgentDir(env = process.env) {
    const dir = env.PI_CODING_AGENT_DIR;
    if (dir)
        return dir === "~" ? homedir() : dir.replace(/^~(?=[\\/])/, homedir());
    return join(homedir(), ".pi", "agent");
}
/** `a < b` for `x.y.z[-pre.n]` versions; a release is newer than its pre-releases. */
export function olderVersion(a, b) {
    const parse = (v) => {
        const [core = "", pre] = v.split("-", 2);
        return { core: core.split(".").map((n) => Number(n) || 0), pre };
    };
    const x = parse(a), y = parse(b);
    for (let i = 0; i < 3; i++) {
        const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
        if (d)
            return d < 0;
    }
    if (x.pre === y.pre)
        return false;
    if (!x.pre)
        return false;
    if (!y.pre)
        return true;
    const px = x.pre.split("."), py = y.pre.split(".");
    for (let i = 0; i < Math.max(px.length, py.length); i++) {
        const s = px[i], t = py[i];
        if (s === undefined)
            return true;
        if (t === undefined)
            return false;
        const ns = Number(s), nt = Number(t);
        const cmp = Number.isInteger(ns) && Number.isInteger(nt)
            ? ns - nt
            : s.localeCompare(t);
        if (cmp)
            return cmp < 0;
    }
    return false;
}
function readLedger(file) {
    try {
        const raw = JSON.parse(readFileSync(file, "utf8"));
        if (typeof raw.version === "string" && raw.files && typeof raw.files === "object")
            return { version: raw.version, files: { ...raw.files } };
    }
    catch {
        /* missing or unreadable: no ownership is assumed */
    }
    return undefined;
}
/** Writes atomically so a concurrent Pi start never reads half a theme. */
function writeAtomic(file, text) {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, file);
}
export function installInteiroPiThemes(options = {}) {
    const env = options.env ?? process.env;
    const result = {
        paths: [],
        written: [],
        kept: [],
        errors: [],
        disabled: false,
    };
    if (/^(0|off|false|no)$/i.test(env.PI_DESIGN_THEMES ?? "")) {
        result.disabled = true;
        return result;
    }
    const agentDir = options.agentDir ?? piAgentDir(env);
    const themesDir = join(agentDir, "themes");
    // Outside `themes/`: Pi would try to load any .json placed there as a theme.
    const ledgerFile = join(agentDir, "state", "inteiro-terminal", "pi-themes.json");
    try {
        mkdirSync(themesDir, { recursive: true });
    }
    catch (e) {
        result.errors.push(`${themesDir}: ${e.message}`);
        return result;
    }
    const ledger = readLedger(ledgerFile);
    const newer = ledger && olderVersion(PI_THEMES_VERSION, ledger.version);
    const owned = { ...(ledger?.files ?? {}) };
    let changed = false;
    for (const theme of PI_THEMES) {
        const file = join(themesDir, `${theme.name}.json`);
        const text = JSON.stringify(theme, null, 2) + "\n";
        const hash = sha256(text);
        try {
            if (!existsSync(file)) {
                writeAtomic(file, text);
                owned[theme.name] = hash;
                result.written.push(file);
                changed = true;
            }
            else {
                const current = sha256(readFileSync(file, "utf8"));
                if (current === hash) {
                    if (owned[theme.name] !== hash) {
                        owned[theme.name] = hash;
                        changed = true;
                    }
                }
                else if (owned[theme.name] === current && !newer) {
                    // Ours and untouched since we wrote it: update to this version.
                    writeAtomic(file, text);
                    owned[theme.name] = hash;
                    result.written.push(file);
                    changed = true;
                }
                else
                    result.kept.push(file);
            }
            result.paths.push(file);
        }
        catch (e) {
            result.errors.push(`${file}: ${e.message}`);
            if (existsSync(file))
                result.paths.push(file);
        }
    }
    if (changed)
        try {
            mkdirSync(join(agentDir, "state", "inteiro-terminal"), { recursive: true });
            const version = ledger && olderVersion(PI_THEMES_VERSION, ledger.version)
                ? ledger.version
                : PI_THEMES_VERSION;
            writeAtomic(ledgerFile, JSON.stringify({ version, files: owned }, null, 2) + "\n");
        }
        catch (e) {
            result.errors.push(`${ledgerFile}: ${e.message}`);
        }
    return result;
}
/** Installs the themes now and lists them in the running session. Call once in the extension factory. */
export function registerInteiroPiThemes(pi, options = {}) {
    const result = installInteiroPiThemes(options);
    if (result.paths.length)
        pi.on("resources_discover", () => ({ themePaths: [...result.paths] }));
    return result;
}
