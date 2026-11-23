// Vendored from @inteiro/terminal 1.4.0 (packages/terminal/src/components.ts). Do not edit; see VENDOR.json.
import { keyHints } from "./keyboard.js";
import { resolveMessages } from "./i18n.js";
import { cellWidth, pad, safeText, truncate, wrap } from "./text.js";
const PT = () => resolveMessages();
const view = (lines, focusedLine = 0, kinds = []) => {
    const safe = lines.map(safeText);
    return {
        lines: safe,
        focusedLine,
        fullText: [...safe],
        kinds: safe.map((line, i) => kinds[i] ?? (line.startsWith(">") ? "focus" : undefined)),
    };
};
export function MenuList(items, focusedId, messages = PT()) {
    const lines = items.map((i) => `${i.id === focusedId ? ">" : " "} ${i.label}${i.value !== undefined ? `: ${i.value}` : ""}${i.kind === "route" ? " >" : i.kind === "action" ? ` ${messages.actionMarker}` : ""}${i.disabled ? ` ${messages.unavailable(i.disabled)}` : ""}`);
    return view(lines.length ? lines : [messages.noItems], Math.max(0, items.findIndex((i) => i.id === focusedId)));
}
/**
 * Rows for a settings list. Legacy: `label: value` (stacked below 60 columns). Standard: labels and
 * values aligned in columns when there is room; a label too long for the column stacks.
 */
export function ListRows(rows, focusedId, columns = 80, presentation = "legacy", messages = PT()) {
    const lines = [], kinds = [];
    let focusedLine = 0;
    const width = Math.max(1, Math.floor(columns));
    const labelWidth = Math.min(Math.max(0, ...rows.map((r) => cellWidth(r.label))), Math.floor((width - 4) * 0.45));
    for (const r of rows) {
        const focused = r.id === focusedId, mark = focused ? ">" : " ", kind = focused ? "focus" : undefined;
        if (focused)
            focusedLine = lines.length;
        const value = `${r.value}${r.suffix ? ` ${r.suffix}` : ""}`;
        if (presentation === "legacy") {
            if (width < 60)
                lines.push(`${mark} ${r.label}`, `  ${value}`);
            else
                lines.push(`${mark} ${r.label}: ${value}`);
        }
        else if (width < 60 || cellWidth(r.label) > labelWidth)
            lines.push(`${mark} ${r.label}`, `    ${value}`);
        else
            lines.push(`${mark} ${pad(r.label, labelWidth)}  ${value}`);
        while (kinds.length < lines.length)
            kinds.push(kind);
        if (r.error) {
            lines.push(`  ${messages.errorPrefix} ${r.error}`);
            kinds.push("error");
        }
    }
    return view(lines, focusedLine, kinds);
}
/** Text shown for a field value; never used for persistence. */
export function displayValue(field, value, session, presentation = "legacy") {
    const m = session.messages;
    if (field.kind === "secret")
        return m.protectedValue;
    if (field.format)
        try {
            const text = field.format(structuredClone(value), session.draft);
            if (typeof text === "string")
                return text;
        }
        catch {
            /* default display */
        }
    if (presentation === "legacy")
        return String(value);
    const choices = session.choicesOf(field);
    const label = (id) => choices?.find((c) => c.id === id)?.label ?? id;
    if (field.kind === "boolean")
        return value === true ? m.valueOn : m.valueOff;
    if (field.kind === "select")
        return label(String(value));
    if (field.kind === "multiselect")
        return Array.isArray(value) && value.length
            ? value.map(label).join(", ")
            : m.noneSelected;
    return String(value) === "" ? m.emptyValue : String(value);
}
export function fieldRow(field, session, presentation = "legacy") {
    const m = session.messages;
    const suffix = field.override
        ? m.origin(field.override.source)
        : field.locked
            ? m.locked(field.locked.source)
            : undefined;
    const error = session.errors[field.id];
    return {
        id: field.id,
        label: field.label,
        value: displayValue(field, session.effective[field.id], session, presentation),
        ...(suffix ? { suffix } : {}),
        ...(error ? { error } : {}),
    };
}
export function SettingsList(session, columns = 80, presentation = "legacy") {
    return ListRows(session.fields.map((f) => fieldRow(f, session, presentation)), session.focusedId, columns, presentation, session.messages);
}
export function TextInput(label, value, error = "", messages = PT()) {
    return view([label, value, ...(error ? [`${messages.errorPrefix} ${error}`] : [])], 1, ["label", "input", "error"]);
}
export function SecretInput(label, error = "", messages = PT()) {
    return view([
        label,
        messages.protectedInput,
        ...(error ? [`${messages.errorPrefix} ${error}`] : []),
    ], 1, ["label", "input", "error"]);
}
export function Select(label, choices, focusedId, selectedId, messages = PT()) {
    return view([
        label,
        ...choices.map((c) => `${c.id === focusedId ? ">" : " "} (${c.id === selectedId ? "x" : " "}) ${c.label}${c.disabled ? ` ${messages.unavailable(c.disabled)}` : ""}`),
    ], 1 +
        Math.max(0, choices.findIndex((c) => c.id === focusedId)), ["label"]);
}
export function MultiSelect(label, choices, focusedId, selected, messages = PT()) {
    return view([
        `${label} — ${messages.selectedCount(selected.length)}`,
        ...choices.map((c) => `${c.id === focusedId ? ">" : " "} [${selected.includes(c.id) ? "x" : " "}] ${c.label}${c.disabled ? ` ${messages.unavailable(c.disabled)}` : ""}`),
        messages.finishSelection,
    ], 1 +
        Math.max(0, choices.findIndex((c) => c.id === focusedId)), ["label"]);
}
export function SearchField(query, count, messages = PT()) {
    return view([
        messages.searchField(query),
        count ? messages.searchResults(count) : messages.noFilterResults,
    ]);
}
export function ActionBar(actions, focusedId, messages = PT()) {
    return view([
        actions
            .map((a) => `${a.id === focusedId ? ">" : ""}[${a.label}]${a.disabled ? ` ${messages.unavailableShort(a.disabled)}` : ""}`)
            .join(" "),
    ]);
}
export function KeyHints(bindings, actions, ascii = false) {
    return view([keyHints(bindings, actions, ascii ? " | " : " · ")], 0, [
        "muted",
    ]);
}
export function Breadcrumbs(parts) {
    return view([parts.join(" / ")]);
}
export function ConfirmAction(object, consequence, destination, label, messages = PT()) {
    return view([
        messages.confirmObject(object),
        messages.confirmDestination(destination),
        consequence,
        `> [${messages.confirmKeepEditing}]`,
        `  [${label}]`,
    ], 3);
}
export function ChangeSummary(changes, scope, messages = PT()) {
    return view([
        messages.changesIn(scope),
        ...changes.map((c) => `${c.label}: ${c.before} -> ${c.after}`),
        messages.saveHasNoExternalEffects,
    ]);
}
export function StatusMessage(kind, message, next = "", messages = PT()) {
    return view([
        `${{ success: messages.statusSuccess, warning: messages.statusWarning, danger: messages.statusDanger, info: messages.statusInfo }[kind]}: ${message}`,
        ...(next ? [next] : []),
    ], 0, [kind === "danger" ? "error" : kind]);
}
export function Progress(label, state, completed, total, cancellable = false, messages = PT()) {
    const percent = total !== undefined && total > 0 && completed !== undefined
        ? ` ${Math.round(Math.min(100, Math.max(0, (completed / total) * 100)))}% (${completed}/${total})`
        : "";
    return view([
        `${label}: ${state}${percent}`,
        ...(cancellable ? [messages.cancelOperationButton] : []),
    ]);
}
export function TaskList(tasks) {
    return view(tasks.map((t) => `${t.label}: ${t.state}`));
}
export function DetailView(label, fields) {
    return view([label, ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`)]);
}
export function ResultList(items, focusedId, detail, columns = 80) {
    const list = items.map((i) => `${i.id === focusedId ? ">" : " "} ${i.label}`);
    if (columns < 120)
        return view([...list, "", ...detail.lines], Math.max(0, items.findIndex((i) => i.id === focusedId)));
    const left = Math.floor(columns / 3);
    return view(Array.from({ length: Math.max(list.length, detail.lines.length) }, (_, i) => truncate(list[i] ?? "", left - 2) +
        " ".repeat(Math.max(0, left - cellWidth(truncate(list[i] ?? "", left - 2)))) +
        (detail.lines[i] ?? "")));
}
export class TableModel {
    sort;
    columns;
    records;
    messages;
    constructor(columns, records, messages = PT()) {
        this.columns = columns;
        this.records = records;
        this.messages = messages;
    }
    order(id) {
        if (!this.columns.some((c) => c.id === id))
            throw new Error(this.messages.unknownColumn);
        this.sort = {
            id,
            direction: this.sort?.id === id && this.sort.direction === "asc" ? "desc" : "asc",
        };
    }
    get rows() {
        const sort = this.sort;
        return sort
            ? [...this.records].sort((a, b) => (a[sort.id] ?? "").localeCompare(b[sort.id] ?? "", undefined, {
                numeric: true,
            }) * (sort.direction === "asc" ? 1 : -1))
            : [...this.records];
    }
}
export function DataTable(table, columns = 80, linear = false) {
    const m = table.messages;
    const sort = table.sort
        ? m.sortedBy(table.columns.find((c) => c.id === table.sort.id)?.label ?? "", table.sort.direction)
        : m.originalOrder;
    if (linear || columns < 60)
        return view([
            sort,
            ...table.rows.flatMap((r, i) => [
                m.record(i + 1),
                ...table.columns.map((c) => `${c.label}: ${r[c.id] ?? ""}`),
                "",
            ]),
        ]);
    const visible = [...table.columns]
        .sort((a, b) => a.priority - b.priority)
        .slice(0, Math.max(1, Math.floor(columns / 20)));
    const width = Math.max(1, Math.floor(columns / visible.length) - 2);
    const row = (values) => values
        .map((v) => {
        const t = truncate(v, width);
        return t + " ".repeat(Math.max(0, width - cellWidth(t)));
    })
        .join("  ");
    return view([
        sort,
        row(visible.map((c) => c.label)),
        ...table.rows.map((r) => row(visible.map((c) => r[c.id] ?? ""))),
        ...(visible.length < table.columns.length ? [m.moreColumns] : []),
    ]);
}
export class LogModel {
    history = [];
    frozen = [];
    paused = false;
    dropped = 0;
    limit;
    messages;
    constructor(limit = 500, messages = PT()) {
        this.limit = limit;
        this.messages = messages;
        if (!Number.isInteger(limit) || limit < 1)
            throw new Error(messages.invalidLogLimit);
    }
    append(message) {
        for (const line of message.split(/\r?\n/)) {
            this.history.push(safeText(line));
            if (this.history.length > this.limit) {
                this.history.shift();
                this.dropped++;
            }
        }
    }
    toggle() {
        this.paused = !this.paused;
        if (this.paused)
            this.frozen = [...this.history];
    }
    get lines() {
        return [...(this.paused ? this.frozen : this.history)];
    }
    export() {
        return this.history.join("\n");
    }
}
export function LogView(log) {
    return view([
        log.messages.logsHeader(log.paused),
        ...log.lines,
        log.messages.logsDropped(log.dropped),
    ]);
}
export function EmptyState(kind, next, messages = PT()) {
    return view([
        {
            empty: messages.emptyData,
            filtered: messages.emptyFiltered,
            unavailable: messages.emptyUnavailable,
        }[kind],
        next,
    ]);
}
export function ErrorState(message, next, messages = PT()) {
    return view([`${messages.errorPrefix} ${message}`, next], 0, ["error"]);
}
/**
 * Help lists each binding. Without `messages` it keeps the 1.3 output (action ids);
 * with `messages` it shows localized action names.
 */
export function HelpView(mode, bindings, messages) {
    const m = messages ?? PT();
    return view([
        m.helpTitle(mode),
        ...bindings.map((b) => `${b.label}: ${messages ? (messages.actionNames[b.action] ?? b.action) : b.action}`),
        m.helpFooter,
    ], 0, ["title"]);
}
const MIN_COLUMNS = 40, MIN_ROWS = 12;
/** Cell-layout projection. Full text stays available separately; focused content is never scrolled away. */
export function TerminalPanel(p) {
    const m = p.messages ?? PT();
    const width = Math.max(1, Math.floor(p.columns)), height = Math.max(1, Math.floor(p.rows));
    const split = (lines, kinds = []) => {
        const out = [], outKinds = [];
        lines.forEach((line, i) => {
            const kind = kinds[i] ?? (line.startsWith(">") ? "focus" : undefined);
            for (const piece of wrap(line, width, p.wrap ?? "grapheme")) {
                out.push(piece);
                outKinds.push(kind);
            }
        });
        return { lines: out, kinds: outKinds };
    };
    const status = p.dirty ? m.unsavedChanges : m.noChanges;
    const fullHeader = split([p.title, `${p.scope} · ${status}`]).lines;
    const header = [
        truncate(p.title, width, p.ascii ? "..." : "…"),
        truncate(`${p.scope} ${p.ascii ? "|" : "·"} ${status}`, width, p.ascii ? "..." : "…"),
    ];
    const headerKinds = ["title", "muted"];
    const footer = split([...p.actions.lines, ...p.hints.lines], [
        ...(p.actions.kinds ?? p.actions.lines.map(() => undefined)),
        ...(p.hints.kinds ?? p.hints.lines.map(() => "muted")),
    ]);
    const fullFeedback = split([p.feedback || p.help]).lines;
    const feedbackKind = p.feedback
        ? p.feedbackKind
        : "muted";
    const feedback = fullFeedback.length > 2
        ? [fullFeedback[0], m.fullMessageInHelp]
        : fullFeedback;
    const body = split(p.body.lines, p.body.kinds), beforeFocus = split(p.body.lines.slice(0, p.body.focusedLine)).lines
        .length;
    const gap = p.density === "calm" && height > 18 ? [""] : [];
    if (width < MIN_COLUMNS || height < MIN_ROWS) {
        const small = p.narrow === "resize"
            ? split([
                p.title,
                m.terminalTooSmall(width, height, MIN_COLUMNS, MIN_ROWS),
                p.draft === false ? m.enlargeOrGoBack : m.enlargeOrClose,
            ], ["title", "warning", "muted"])
            : split([p.title, m.useLinearMode, m.draftPreserved, m.linearButtons], ["title"]);
        return view(small.lines.slice(0, height), 0, small.kinds.slice(0, height));
    }
    const fits = body.lines.length <=
        height - header.length - footer.lines.length - feedback.length - gap.length * 2;
    const showPosition = p.position !== "overflow" || !fits;
    const available = Math.max(1, height -
        header.length -
        footer.lines.length -
        feedback.length -
        gap.length * 2 -
        (showPosition ? 1 : 0));
    const start = Math.max(0, Math.min(beforeFocus - Math.floor(Math.max(0, available - 2) / 2), body.lines.length - available));
    const position = m.linesRange(Math.min(start + 1, body.lines.length), Math.min(start + available, body.lines.length), body.lines.length);
    const lines = [
        ...header,
        ...gap,
        ...body.lines.slice(start, start + available),
        ...(showPosition ? [truncate(position, width)] : []),
        ...gap,
        ...feedback,
        ...footer.lines,
    ];
    const kinds = [
        ...headerKinds,
        ...gap.map(() => undefined),
        ...body.kinds.slice(start, start + available),
        ...(showPosition ? ["muted"] : []),
        ...gap.map(() => undefined),
        ...feedback.map(() => feedbackKind),
        ...footer.kinds,
    ];
    const fullText = [...fullHeader, ...body.lines, ...fullFeedback, ...footer.lines];
    return {
        lines: lines.slice(0, height),
        fullText,
        focusedLine: header.length + gap.length + beforeFocus - start,
        kinds: kinds.slice(0, height),
    };
}
