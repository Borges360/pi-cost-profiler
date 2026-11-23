// Vendored from @inteiro/terminal 1.4.0 (packages/terminal/src/text.ts). Do not edit; see VENDOR.json.
/** Strip OSC/DCS/APC/CSI (7/8 bit), then all controls. External text is never ANSI. */
export function safeText(value) {
    return String(value ?? "")
        .replace(/(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g, "")
        .replace(/(?:\x1b[P_^]|[\x90\x98\x9e\x9f])[\s\S]*?(?:\x1b\\|\x9c|$)/g, "")
        .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\x1b[ -/]*[@-~]/g, "")
        .replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const graphemes = (value) => [...segmenter.segment(value)].map((s) => s.segment);
/** East Asian Wide/Fullwidth blocks (UAX #11) and emoji blocks rendered in two cells. */
const WIDE = [
    [0x1100, 0x115e],
    [0x231a, 0x231b],
    [0x2329, 0x232a],
    [0x23e9, 0x23ec],
    [0x23f0, 0x23f0],
    [0x23f3, 0x23f3],
    [0x25fd, 0x25fe],
    [0x2614, 0x2615],
    [0x2648, 0x2653],
    [0x267f, 0x267f],
    [0x2693, 0x2693],
    [0x26a1, 0x26a1],
    [0x26aa, 0x26ab],
    [0x26bd, 0x26be],
    [0x26c4, 0x26c5],
    [0x26ce, 0x26ce],
    [0x26d4, 0x26d4],
    [0x26ea, 0x26ea],
    [0x26f2, 0x26f3],
    [0x26f5, 0x26f5],
    [0x26fa, 0x26fa],
    [0x26fd, 0x26fd],
    [0x2705, 0x2705],
    [0x270a, 0x270b],
    [0x2728, 0x2728],
    [0x274c, 0x274c],
    [0x274e, 0x274e],
    [0x2753, 0x2755],
    [0x2757, 0x2757],
    [0x2795, 0x2797],
    [0x27b0, 0x27b0],
    [0x27bf, 0x27bf],
    [0x2b1b, 0x2b1c],
    [0x2b50, 0x2b50],
    [0x2b55, 0x2b55],
    [0x2e80, 0x303e],
    [0x3041, 0x33ff],
    [0x3400, 0x4dbf],
    [0x4e00, 0x9fff],
    [0xa000, 0xa4cf],
    [0xa960, 0xa97f],
    [0xac00, 0xd7a3],
    [0xf900, 0xfaff],
    [0xfe10, 0xfe19],
    [0xfe30, 0xfe6f],
    [0xff00, 0xff60],
    [0xffe0, 0xffe6],
    [0x16fe0, 0x16fe4],
    [0x17000, 0x18cff],
    [0x1aff0, 0x1b2ff],
    [0x1f004, 0x1f004],
    [0x1f0cf, 0x1f0cf],
    [0x1f18e, 0x1f18e],
    [0x1f191, 0x1f19a],
    [0x1f200, 0x1f251],
    [0x1f260, 0x1f265],
    [0x1f300, 0x1f320],
    [0x1f32d, 0x1f335],
    [0x1f337, 0x1f37c],
    [0x1f37e, 0x1f393],
    [0x1f3a0, 0x1f3ca],
    [0x1f3cf, 0x1f3d3],
    [0x1f3e0, 0x1f3f0],
    [0x1f3f4, 0x1f3f4],
    [0x1f3f8, 0x1f43e],
    [0x1f440, 0x1f440],
    [0x1f442, 0x1f4fc],
    [0x1f4ff, 0x1f53d],
    [0x1f54b, 0x1f54e],
    [0x1f550, 0x1f567],
    [0x1f57a, 0x1f57a],
    [0x1f595, 0x1f596],
    [0x1f5a4, 0x1f5a4],
    [0x1f5fb, 0x1f64f],
    [0x1f680, 0x1f6c5],
    [0x1f6cc, 0x1f6cc],
    [0x1f6d0, 0x1f6d2],
    [0x1f6d5, 0x1f6d7],
    [0x1f6dc, 0x1f6df],
    [0x1f6eb, 0x1f6ec],
    [0x1f6f4, 0x1f6fc],
    [0x1f7e0, 0x1f7eb],
    [0x1f7f0, 0x1f7f0],
    [0x1f90c, 0x1f93a],
    [0x1f93c, 0x1f945],
    [0x1f947, 0x1f9ff],
    [0x1fa70, 0x1faff],
    [0x20000, 0x2fffd],
    [0x30000, 0x3fffd],
];
const isWide = (cp) => {
    let lo = 0, hi = WIDE.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1, [a, b] = WIDE[mid];
        if (cp < a)
            hi = mid - 1;
        else if (cp > b)
            lo = mid + 1;
        else
            return true;
    }
    return false;
};
const chr = (code) => String.fromCodePoint(code);
const span = (from, to) => `${chr(from)}-${chr(to)}`;
/**
 * Combining marks, format controls, zero-width spaces/joiners, variation selectors and the
 * default-ignorable Hangul fillers (U+115F, U+3164, U+FFA0) with standalone medial/final jamo.
 */
const ZERO = new RegExp(`^(?:\\p{Mn}|\\p{Me}|\\p{Cf}|[${span(0x200b, 0x200f)}${span(0x2028, 0x202e)}${span(0x2060, 0x206f)}${span(0xfe00, 0xfe0f)}${span(0x115f, 0x11ff)}${chr(0x3164)}${chr(0xffa0)}])+$`, "u");
/** Zero width joiner or emoji presentation selector (VS16). */
const EMOJI_JOIN = new RegExp(`[${chr(0x200d)}${chr(0xfe0f)}]`, "u");
/** Emoji keycap sequences: [0-9#*], optional VS16, combining enclosing keycap. */
const KEYCAP = new RegExp(`^[0-9#*]${chr(0xfe0f)}?${chr(0x20e3)}$`, "u");
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const REGIONAL = /^\p{Regional_Indicator}{2}$/u;
/** Dependency-free UAX #11 approximation per grapheme: CJK/fullwidth and emoji take two cells. */
export function fallbackCellWidth(value) {
    let width = 0;
    for (const g of graphemes(value)) {
        if (ZERO.test(g))
            continue;
        const cp = g.codePointAt(0);
        if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0))
            continue;
        if (isWide(cp) ||
            REGIONAL.test(g) ||
            KEYCAP.test(g) ||
            (PICTOGRAPHIC.test(g) && EMOJI_JOIN.test(g)))
            width += 2;
        else
            width += 1;
    }
    return width;
}
let measure = fallbackCellWidth;
/**
 * Injects the renderer's own width function (Pi: `visibleWidth` from pi-tui), so layout and
 * host agree on every line. `undefined` restores the dependency-free fallback.
 */
export function setCellWidthMeasure(next) {
    measure = next ?? fallbackCellWidth;
}
export const getCellWidthMeasure = () => measure;
export const cellWidth = (value) => measure(safeText(value));
export function truncate(value, columns, marker = "…") {
    const text = safeText(value), width = Math.max(0, Math.floor(columns));
    if (cellWidth(text) <= width)
        return text;
    const suffix = cellWidth(marker) <= width ? marker : "";
    let result = "";
    for (const g of graphemes(text)) {
        if (cellWidth(result + g + suffix) > width)
            break;
        result += g;
    }
    return result + suffix;
}
/**
 * Splits text into lines of at most `columns` cells. `grapheme` (default) fills each line;
 * `word` breaks at the last space when there is one and splits only words wider than a line.
 */
export function wrap(value, columns, mode = "grapheme") {
    const width = Math.max(1, Math.floor(columns)), lines = [];
    let line = [];
    const text = () => line.join("");
    for (const g of graphemes(safeText(value))) {
        if (cellWidth(g) > width) {
            if (line.length)
                lines.push(text());
            lines.push("?");
            line = [];
            continue;
        }
        if (cellWidth(text() + g) > width) {
            if (mode === "word" && g === " ") {
                lines.push(text().trimEnd());
                line = [];
                continue;
            }
            const space = mode === "word" ? line.lastIndexOf(" ") : -1;
            if (space > 0 && line.slice(0, space).join("").trim()) {
                lines.push(line.slice(0, space).join("").trimEnd());
                line = line.slice(space + 1);
                if (cellWidth(text() + g) > width) {
                    lines.push(text());
                    line = [];
                }
            }
            else {
                lines.push(text());
                line = [];
            }
        }
        line.push(g);
    }
    if (line.length || !lines.length)
        lines.push(text());
    return lines;
}
/** Pads with spaces to an exact cell width (truncating first when needed). */
export function pad(value, columns, marker = "…") {
    const text = truncate(value, columns, marker);
    return text + " ".repeat(Math.max(0, Math.floor(columns) - cellWidth(text)));
}
