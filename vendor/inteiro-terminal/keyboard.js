// Vendored from @inteiro/terminal 1.4.0 (packages/terminal/src/keyboard.ts). Do not edit; see VENDOR.json.
import { resolveMessages, } from "./i18n.js";
export const DEFAULT_BINDINGS = [
    ["navigate.up", "up", "Cima", "navigation"],
    ["navigate.down", "down", "Baixo", "navigation"],
    ["navigate.first", "home", "Home", "navigation"],
    ["navigate.last", "end", "End", "navigation"],
    ["navigate.pageUp", "pageup", "PageUp", "navigation"],
    ["navigate.pageDown", "pagedown", "PageDown", "navigation"],
    ["activate", "enter", "Enter", "panel"],
    ["toggle", "space", "Espaço", "navigation"],
    ["nextRegion", "tab", "Tab", "panel"],
    ["previousRegion", "shift+tab", "Shift+Tab", "panel"],
    ["back", "escape", "Esc", "panel"],
    ["help", "f1", "F1", "panel"],
    ["help", "?", "?", "navigation"],
    ["search", "/", "/", "navigation"],
].map(([action, key, label, scope]) => ({
    action: action,
    key: key,
    label: label,
    scope: scope,
}));
const NAMED = {
    up: "↑",
    down: "↓",
    left: "←",
    right: "→",
    pageup: "PgUp",
    pagedown: "PgDn",
    home: "Home",
    end: "End",
    escape: "Esc",
    esc: "Esc",
    enter: "Enter",
    return: "Enter",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Del",
    insert: "Ins",
    ctrl: "Ctrl",
    alt: "Alt",
    shift: "Shift",
    meta: "Meta",
    super: "Super",
};
/** Human key label from a host key id: `pageDown` → `PgDn`, `ctrl+s` → `Ctrl+S`, `escape` → `Esc`. */
export function keyLabel(key, messages = resolveMessages()) {
    if (key === "+")
        return "+";
    return key
        .split("+")
        .map((part) => {
        const lower = part.toLowerCase();
        if (lower === "space")
            return messages.keySpace;
        const named = NAMED[lower];
        if (named)
            return named;
        if (/^f\d{1,2}$/.test(lower))
            return lower.toUpperCase();
        return part.length === 1 ? part.toUpperCase() : part;
    })
        .join("+");
}
export function resolveBindings(overrides = [], reserved = [], ctrlS = false, options) {
    const messages = options
        ? resolveMessages(options.locale, options.messages)
        : undefined;
    const replacements = new Set(overrides.map((b) => b.action));
    const bindings = [
        ...DEFAULT_BINDINGS.filter((b) => !replacements.has(b.action)).map((b) => messages ? { ...b, label: keyLabel(b.key, messages) } : b),
        ...(ctrlS && !replacements.has("save")
            ? [
                {
                    action: "save",
                    key: "ctrl+s",
                    label: "Ctrl+S",
                    scope: "panel",
                },
            ]
            : []),
        ...overrides,
    ].filter((b) => !reserved.includes(b.key));
    const seen = new Set();
    for (const b of bindings) {
        const id = `${b.scope}:${b.key}`;
        if (seen.has(id))
            throw new Error((messages ?? resolveMessages()).duplicateBinding(id));
        seen.add(id);
    }
    return bindings;
}
/** Same as `resolveBindings` with options, but drops colliding overrides instead of throwing. */
export function resolveBindingsLenient(overrides = [], reserved = [], ctrlS = false, options) {
    try {
        return resolveBindings(overrides, reserved, ctrlS, options);
    }
    catch {
        const keyOf = (b) => `${b.scope}:${b.key}`;
        const accepted = [];
        for (const b of overrides)
            if (!reserved.includes(b.key) &&
                !accepted.some((a) => keyOf(a) === keyOf(b)))
                accepted.push(b);
        const replaced = new Set(accepted.map((b) => b.action)), taken = new Set(accepted.map(keyOf));
        return [
            ...resolveBindings([], reserved, ctrlS, options).filter((b) => !replaced.has(b.action) && !taken.has(keyOf(b))),
            ...accepted,
        ];
    }
}
export function keyAction(key, bindings, context, pasted = false) {
    if (pasted)
        return;
    return (bindings.find((b) => b.key === key && b.scope === context)?.action ??
        bindings.find((b) => b.key === key &&
            b.scope === "panel" &&
            (context !== "field" || !["?", "space"].includes(key)))?.action);
}
export function keyHints(bindings, actions, separator = " · ") {
    return Object.entries(actions)
        .map(([action, label]) => {
        const b = bindings.find((b) => b.action === action);
        return b ? `${b.label} ${label}` : label;
    })
        .join(separator);
}
/**
 * Hints that only show actions with a binding. `navigate` merges up/down labels (`↑↓ navigate`);
 * an empty label hides the entry.
 */
export function standardKeyHints(bindings, actions, separator = " · ") {
    const first = (action) => bindings.find((b) => b.action === action)?.label;
    return actions
        .flatMap(([action, label]) => {
        if (!label)
            return [];
        if (action === "navigate") {
            const up = first("navigate.up"), down = first("navigate.down");
            const key = up && down ? `${up}${down}` : (up ?? down);
            return key ? [`${key} ${label}`] : [];
        }
        const key = first(action);
        return key ? [`${key} ${label}`] : [];
    })
        .join(separator);
}
