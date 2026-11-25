// Vendored from @inteiro/terminal 2.0.0-rc.1 (packages/terminal/src/pi.ts). Do not edit; see VENDOR.json.
import { Input, matchesKey, truncateToWidth, visibleWidth, } from "@earendil-works/pi-tui";
import { keyAction, keyLabel, resolveBindingsLenient, standardKeyHints, } from "./keyboard.js";
import { PanelController, } from "./controller.js";
import { actionSegments, } from "./components.js";
import { setCellWidthMeasure } from "./text.js";
import { resolveMessages, } from "./i18n.js";
import { WorkspaceModel } from "./workspace.js";
// Layout must measure exactly like the host renderer: pi-tui stops the TUI when a line is wider
// than the terminal. The adapter therefore never depends on another width library.
setCellWidthMeasure(visibleWidth);
const HOST_ACTIONS = [
    ["navigate.up", "tui.select.up"],
    ["navigate.down", "tui.select.down"],
    ["activate", "tui.select.confirm"],
    ["back", "tui.select.cancel"],
    ["navigate.pageUp", "tui.select.pageUp"],
    ["navigate.pageDown", "tui.select.pageDown"],
];
/**
 * Host keys first (`tui.select.*`), with readable labels (`↑`, `Enter`, `Esc`, `PgDn`). A host remap
 * that collides with a default no longer prevents the panel from opening: the host key wins.
 */
export function piBindings(keys, reserved = [], ctrlS = true, options = {}) {
    const messages = resolveMessages(options.locale, options.messages);
    const host = HOST_ACTIONS.flatMap(([action, id]) => keys.getKeys(id).map((key) => ({
        action,
        key,
        label: keyLabel(key, messages),
        scope: action.startsWith("navigate.")
            ? "navigation"
            : "panel",
    })));
    return resolveBindingsLenient(host, reserved, ctrlS, options);
}
const selected = (theme, text) => theme.bg ? theme.bg("selectedBg", text) : text;
function paintButton(theme, role, text) {
    switch (role) {
        case "commit": {
            const colored = theme.fg("bashMode", text);
            return theme.bold ? theme.bold(colored) : colored;
        }
        case "choose":
            return theme.fg("accent", text);
        case "muted":
            return theme.fg("muted", text);
        default:
            return text;
    }
}
/**
 * Paints semantic line kinds with the host theme only; no fixed ANSI. The focused row is marked by
 * `>` and by the host selection background across the whole width, not by color alone.
 */
function paint(theme, kind, line, width, bar) {
    switch (kind) {
        case "focus":
            return selected(theme, theme.fg("accent", line + " ".repeat(Math.max(0, width - visibleWidth(line)))));
        case "actions":
            if (!bar)
                return line;
            return actionSegments(line, bar.actions, bar.focusedId)
                .map((s) => {
                const painted = paintButton(theme, s.role, s.text);
                return s.focused ? selected(theme, painted) : painted;
            })
                .join("");
        case "error":
            return theme.fg("error", line);
        case "warning":
            return theme.fg("warning", line);
        case "success":
            return theme.fg("success", line);
        case "muted":
            return theme.fg("muted", line);
        case "title":
            return theme.bold ? theme.bold(line) : line;
        default:
            return line;
    }
}
/** Never return a line wider than the host asked for (pi-tui aborts the TUI on overflow). */
function fit(line, width) {
    return visibleWidth(line) > width ? truncateToWidth(line, width, "") : line;
}
function overlayRows(total, overlay) {
    const max = overlay?.maxHeight;
    if (typeof max === "number")
        return Math.max(1, Math.min(total, max));
    if (typeof max === "string") {
        const pct = Number.parseFloat(max);
        if (Number.isFinite(pct) && pct > 0)
            return Math.max(1, Math.floor((total * Math.min(100, pct)) / 100));
    }
    return Math.max(1, total);
}
/** A temporary host component: no writes to process streams, no editor/footer replacement. */
export class PiSettingsPanel {
    focused = true;
    controller;
    input;
    editingId;
    disposed = false;
    pasting = false;
    pending = new Set();
    theme;
    requestRender;
    done;
    rows;
    reserved;
    constructor(options, theme, requestRender, done, rows, task, reserved = []) {
        this.theme = theme;
        this.requestRender = requestRender;
        this.done = done;
        this.rows = rows;
        this.reserved = reserved;
        const onChange = options.onChange;
        this.controller = new PanelController({
            ...options,
            onChange: () => {
                onChange?.();
                if (!this.disposed)
                    this.requestRender();
            },
        }, task);
    }
    invalidate() { }
    syncInput() {
        if (this.controller.searchEditing) {
            if (this.editingId !== "@search") {
                this.input = new Input();
                this.input.setValue(this.controller.search);
                this.editingId = "@search";
            }
            return;
        }
        const f = this.controller.field;
        if (f &&
            ["text", "number", "secret"].includes(f.kind) &&
            this.editingId !== f.id) {
            this.input = new Input();
            this.input.focused = true;
            const value = f.kind === "secret"
                ? ""
                : String(this.controller.session.editing?.value ?? "");
            // Paste-style insertion leaves the cursor at the end of the current value.
            if (value && !value.includes("\x1b"))
                this.input.handleInput(`\x1b[200~${value}\x1b[201~`);
            else
                this.input.setValue(value);
            this.editingId = f.id;
        }
        if (!f) {
            this.input = undefined;
            this.editingId = undefined;
        }
    }
    execute(action) {
        if (this.input &&
            !this.controller.help &&
            (action === "save" || action === "activate"))
            this.controller.setText(this.input.getValue());
        const pending = this.controller
            .dispatch(action)
            .then(() => {
            if (this.disposed)
                return;
            this.syncInput();
            this.requestRender();
            if (this.controller.session.closed) {
                this.dispose();
                this.done();
            }
        })
            .catch(() => {
            if (!this.disposed) {
                this.controller.session.setStatus(this.controller.messages.actionFailed, "error");
                this.requestRender();
            }
        })
            .finally(() => this.pending.delete(pending));
        this.pending.add(pending);
        this.requestRender();
    }
    handleInput(data) {
        if (this.disposed ||
            this.reserved.some((key) => matchesKey(data, key)))
            return;
        this.syncInput();
        // Native Input owns complete/fragmented bracketed paste. Never dispatch pasted characters.
        if (this.pasting || data.includes("\x1b[200~")) {
            this.pasting = !data.includes("\x1b[201~");
            this.input?.handleInput(data);
            this.requestRender();
            return;
        }
        const bindings = this.controller.bindings;
        if (this.controller.searchEditing && this.input) {
            const binding = bindings.find((b) => matchesKey(data, b.key));
            const action = binding && keyAction(binding.key, bindings, "field");
            if (action === "back" || action === "activate") {
                if (action === "activate")
                    this.controller.filter(this.input.getValue());
                this.controller.searchEditing = false;
                this.input = undefined;
                this.editingId = undefined;
            }
            else
                this.input.handleInput(data);
            this.requestRender();
            return;
        }
        const context = this.controller.help
            ? "navigation"
            : this.input
                ? "field"
                : this.controller.busy
                    ? "operation"
                    : "navigation";
        const binding = bindings.find((b) => matchesKey(data, b.key));
        const action = binding
            ? keyAction(binding.key, bindings, context)
            : undefined;
        if (action)
            this.execute(action);
        else if (this.input) {
            this.input.handleInput(data);
            this.requestRender();
        }
    }
    render(columns) {
        this.syncInput();
        const width = Math.max(1, Math.floor(columns)), rows = Math.max(1, this.rows()), c = this.controller, m = c.messages;
        let lines, kinds;
        if (c.searchEditing && this.input) {
            const edit = this.input.render(width);
            lines = [
                m.searchPrompt,
                ...edit,
                standardKeyHints(c.bindings, [
                    ["activate", m.hintApply],
                    ["back", m.hintBack],
                ]),
            ];
            kinds = ["label", ...edit.map(() => "raw"), "muted"];
        }
        else {
            const frame = c.render(width, rows);
            lines = [...frame.lines];
            kinds = frame.lines.map((_, i) => frame.kinds?.[i]);
            if (this.input &&
                c.field &&
                !c.session.closeDecision &&
                !c.help &&
                !c.confirm &&
                width >= 40 &&
                rows >= 12) {
                const secret = c.field.kind === "secret";
                const edit = secret ? [m.protectedInput] : this.input.render(width);
                const editKinds = edit.map(() => (secret ? undefined : "raw"));
                // The value line is marked by the projection, so a wrapped or repeated label never hides it.
                const at = kinds.indexOf("input");
                if (at >= 0) {
                    let end = at;
                    while (kinds[end + 1] === "input")
                        end++;
                    lines.splice(at, end - at + 1, ...edit);
                    kinds.splice(at, end - at + 1, ...editKinds);
                }
                else {
                    const after = Math.min(2, lines.length);
                    lines.splice(after, 0, ...edit);
                    kinds.splice(after, 0, ...editKinds);
                }
            }
        }
        const bar = { actions: c.actions, focusedId: c.focusedActionId };
        return lines
            .slice(0, rows)
            .map((line, i) => paint(this.theme, kinds[i], fit(line, width), width, bar));
    }
    async drain() {
        await Promise.all([...this.pending]);
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.input?.setValue("");
        this.input = undefined;
        this.controller.dispose();
    }
}
/**
 * Pi defaults: English unless `locale` (or a session locale) is given, standard presentation,
 * second Esc discards, cancellable save, resize message below 40×12. Pass the options explicitly
 * to opt out.
 *
 * With a cancellable save, a `persist` that ignores its AbortSignal past `cancelGraceMs` leaves
 * the outcome unknown: pass `reconcile` (a fresh storage read), or the panel asks before writing
 * the draft again.
 */
export async function openPiSettings(ui, options) {
    const locale = options.locale ??
        (options.session.hasLocale ? options.session.locale : "en");
    const messages = options.locale !== undefined || options.messages
        ? resolveMessages(locale, options.messages)
        : options.session.messages;
    if (options.signal.aborted)
        return { status: "cancelled", message: messages.sessionEnded };
    let component;
    const overlay = {
        width: "100%",
        maxHeight: "100%",
        anchor: "center",
        ...options.overlay,
    };
    try {
        await ui.custom((tui, theme, keys, done) => {
            const abort = () => {
                component?.dispose();
                done();
            };
            const { signal, reservedKeys, ctrlS, task, overlay: _overlay, ...rest } = options;
            component = new PiSettingsPanel({
                presentation: "standard",
                discardOnSecondEscape: true,
                cancellableSave: true,
                narrow: "resize",
                ...rest,
                locale,
                bindings: piBindings(keys, reservedKeys, ctrlS ?? true, {
                    locale,
                    ...(options.messages ? { messages: options.messages } : {}),
                }),
            }, theme, () => tui.requestRender(), () => {
                signal.removeEventListener("abort", abort);
                done();
            }, () => overlayRows(tui.terminal?.rows ?? 24, overlay), task, reservedKeys);
            signal.addEventListener("abort", abort, { once: true });
            const dispose = component.dispose.bind(component);
            component.dispose = () => {
                signal.removeEventListener("abort", abort);
                dispose();
            };
            return component;
        }, { overlay: true, overlayOptions: overlay });
        if (options.signal.aborted)
            return { status: "cancelled", message: messages.sessionEnded };
        const closed = component?.controller.closedWith;
        return {
            status: "succeeded",
            value: options.session.persisted,
            ...(closed
                ? {
                    action: closed.id,
                    ...("value" in closed ? { actionValue: closed.value } : {}),
                }
                : {}),
        };
    }
    catch {
        return { status: "failed", message: messages.openFailed };
    }
    finally {
        component?.dispose();
    }
}
export async function openPiWorkspace(ui, model, signal, reservedKeysOrOptions = ["ctrl+c"]) {
    if (signal.aborted)
        return;
    const options = Array.isArray(reservedKeysOrOptions)
        ? { reservedKeys: reservedKeysOrOptions }
        : reservedKeysOrOptions;
    const reservedKeys = options.reservedKeys ?? ["ctrl+c"];
    // English by default in Pi, unless the caller or the model chose a locale.
    if (options.locale !== undefined)
        model.setLocale(options.locale, options.messages);
    else if (!model.hasLocale)
        model.setLocale("en", options.messages);
    if (options.title !== undefined)
        model.title = options.title;
    if (options.scope !== undefined)
        model.scope = options.scope;
    if (options.help !== undefined)
        model.help = options.help;
    model.narrow =
        options.narrow ?? (model.narrowChosen ? model.narrow : "resize");
    const overlay = {
        width: "100%",
        maxHeight: "100%",
        anchor: "center",
        ...options.overlay,
    };
    let dispose;
    try {
        await ui.custom((tui, theme, keys, done) => {
            let closed = false;
            const bindings = piBindings(keys, reservedKeys, false, {
                locale: model.locale,
                ...(options.messages ? { messages: options.messages } : {}),
            });
            const m = model.messages;
            model.hints ??= standardKeyHints(bindings, [
                ["navigate", m.hintNavigate],
                ["nextRegion", m.hintActions],
                ["activate", m.hintChoose],
                ["back", m.hintClose],
            ]);
            const close = () => {
                if (closed)
                    return;
                closed = true;
                signal.removeEventListener("abort", close);
                done();
            };
            signal.addEventListener("abort", close, { once: true });
            dispose = close;
            return {
                focused: true,
                invalidate() { },
                dispose: close,
                render(columns) {
                    const width = Math.max(1, Math.floor(columns));
                    const frame = model.render(width, overlayRows(tui.terminal?.rows ?? 24, overlay));
                    return frame.lines.map((l, i) => paint(theme, frame.kinds?.[i], fit(l, width), width, {
                        actions: model.barActions,
                        focusedId: model.focusedActionId,
                    }));
                },
                handleInput(data) {
                    if (closed ||
                        reservedKeys.some((key) => matchesKey(data, key)))
                        return;
                    const binding = bindings.find((b) => matchesKey(data, b.key));
                    const action = binding && keyAction(binding.key, bindings, "navigation");
                    if (action)
                        model.dispatch(action);
                    if (model.closed)
                        close();
                    else
                        tui.requestRender();
                },
            };
        }, { overlay: true, overlayOptions: overlay });
    }
    finally {
        dispose?.();
    }
}
