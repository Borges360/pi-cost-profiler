// Vendored from @inteiro/terminal 2.0.0-rc.1 (packages/terminal/src/settings.ts). Do not edit; see VENDOR.json.
import { normalizeLocale, resolveMessages, } from "./i18n.js";
import { formatProductError, isCancellation, } from "./errors.js";
const clone = (value) => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export class PersistenceOutcomeUnknown extends Error {
}
class NoAcknowledgement extends Error {
}
/** Snapshot ownership prevents consumers from mutating persisted state through shared references. */
export class SettingsSession {
    stored;
    working;
    editor;
    controller;
    userCancel = false;
    generation = 0;
    disposed = false;
    persistenceUnknown = false;
    currentFields;
    loaded = new Map();
    options;
    messages;
    /** Current UI locale of the session messages. */
    locale;
    /** False while the locale is the package default (no `locale` option, no `setLocale`). */
    localeChosen;
    errors = {};
    focusedId;
    statusText = "";
    /** Tone of `status`, for renderers that color feedback. Set together with `status`. */
    statusKind = "";
    closeDecision = false;
    closed = false;
    constructor(fields, initial, options = {}) {
        this.options = options;
        this.messages = resolveMessages(options.locale, options.messages);
        this.locale = normalizeLocale(options.locale);
        this.localeChosen = options.locale !== undefined;
        this.currentFields = fields;
        if (new Set(fields.map((f) => f.id)).size !== fields.length)
            throw new Error(this.messages.duplicateFieldIds);
        for (const f of fields)
            if (!(f.id in initial))
                throw new Error(this.messages.missingValue(f.id));
        this.stored = clone(initial);
        this.working = clone(initial);
        this.focusedId = fields[0]?.id ?? "";
    }
    get fields() {
        return this.currentFields;
    }
    /** Plain assignment keeps 1.3 semantics (neutral tone); use `setStatus` to set a tone. */
    get status() {
        return this.statusText;
    }
    set status(value) {
        this.statusText = value;
        this.statusKind = value ? "info" : "";
    }
    setStatus(value, kind = value ? "info" : "") {
        this.statusText = value;
        this.statusKind = value ? kind : "";
    }
    /** Adjusts save policy after construction (used by controllers/adapters). */
    configure(options) {
        this.options = { ...this.options, ...options };
    }
    get cancellableSave() {
        return !!this.options.cancellableSave;
    }
    /** True after an unconfirmed save; saving stays blocked until `reconcilePersistence` or `allowSaveRetry`. */
    get outcomeUnknown() {
        return this.persistenceUnknown;
    }
    /** Switches session messages (live preview of the UI language). Values are untouched. */
    setLocale(locale, messages) {
        this.messages = resolveMessages(locale, messages ?? this.options.messages);
        this.locale = normalizeLocale(locale);
        this.localeChosen = true;
    }
    /** True when a locale was given (constructor option or `setLocale`), not the package default. */
    get hasLocale() {
        return this.localeChosen;
    }
    /** Replaces labels/descriptions/choices with a translated set. Ids and kinds must match. */
    relabelFields(fields) {
        if (fields.length !== this.currentFields.length ||
            fields.some((f, i) => f.id !== this.currentFields[i].id ||
                f.kind !== this.currentFields[i].kind))
            throw new Error(this.messages.unknownField);
        this.currentFields = fields;
    }
    /** Choices currently valid for a field: loaded ones first, then static ones. */
    choicesOf(field) {
        return this.loaded.get(field.id) ?? field.choices;
    }
    setChoices(id, choices) {
        if (!this.currentFields.some((f) => f.id === id))
            throw new Error(this.messages.unknownField);
        this.loaded.set(id, clone([...choices]));
    }
    get persisted() {
        return clone(this.stored);
    }
    get draft() {
        return clone(this.working);
    }
    get effective() {
        return Object.fromEntries(this.fields.map((f) => [
            f.id,
            clone(f.override?.value ?? this.working[f.id]),
        ]));
    }
    get editing() {
        return this.editor ? clone(this.editor) : undefined;
    }
    get saving() {
        return !!this.controller;
    }
    get dirty() {
        return Object.keys(this.working).some((k) => !same(this.working[k], this.stored[k]));
    }
    get changes() {
        return this.fields
            .filter((f) => !same(this.working[f.id], this.stored[f.id]))
            .map((f) => ({
            id: f.id,
            label: f.label,
            before: f.kind === "secret"
                ? this.messages.protectedValue
                : clone(this.stored[f.id]),
            after: f.kind === "secret"
                ? this.messages.protectedValue
                : clone(this.working[f.id]),
        }));
    }
    begin(id) {
        if (this.disposed || this.saving)
            return;
        const f = this.fields.find((f) => f.id === id);
        if (!f)
            throw new Error(this.messages.unknownField);
        this.focusedId = id;
        if (f.override) {
            this.setStatus(this.messages.overrideStatus(f.override.source), "warning");
            return;
        }
        if (f.locked) {
            this.setStatus(this.messages.lockedStatus(f.locked.source), "warning");
            return;
        }
        this.editor = { id, value: clone(this.working[id]) };
    }
    edit(value) {
        if (this.editor && !this.saving && !this.disposed)
            this.editor.value = clone(value);
    }
    error(field, value) {
        const m = this.messages;
        const validType = field.kind === "number"
            ? typeof value === "number" && Number.isFinite(value)
            : field.kind === "boolean"
                ? typeof value === "boolean"
                : field.kind === "multiselect"
                    ? Array.isArray(value) && value.every((v) => typeof v === "string")
                    : typeof value === "string";
        if (!validType)
            return m.invalidValue;
        const values = Array.isArray(value) ? value : [value];
        if (field.kind === "multiselect" && new Set(values).size !== values.length)
            return m.duplicateChoice;
        const choices = this.choicesOf(field);
        // Choices that are loaded on demand are not known before activation: trust the stored value.
        if ((field.kind === "select" || field.kind === "multiselect") &&
            !(choices === undefined && field.loadChoices) &&
            values.some((v) => !choices?.some((c) => c.id === v && !c.disabled)))
            return m.unavailableChoice;
        try {
            return field.validate?.(clone(value), {
                ...this.draft,
                [field.id]: clone(value),
            });
        }
        catch {
            return m.validatorFailed;
        }
    }
    confirmEdit() {
        if (!this.editor)
            return true;
        const { id, value } = this.editor, field = this.fields.find((f) => f.id === id);
        const message = this.error(field, value);
        if (message) {
            this.errors[id] = message;
            this.focusedId = id;
            return false;
        }
        // A success status describes the previous saved state; a new change makes it stale.
        if (!same(this.working[id], value) && this.statusKind === "success")
            this.setStatus("");
        this.working[id] = clone(value);
        delete this.errors[id];
        this.editor = undefined;
        return true;
    }
    /** Leaves the field without applying the edit; its validation error goes with it. */
    abandonEdit() {
        if (this.editor)
            delete this.errors[this.editor.id];
        this.editor = undefined;
    }
    validate() {
        this.errors = {};
        for (const f of this.fields) {
            const error = this.error(f, f.override?.value ?? this.working[f.id]);
            if (error)
                this.errors[f.id] = error;
        }
        const first = Object.keys(this.errors)[0];
        if (first)
            this.focusedId = first;
        return !first;
    }
    /** Requests cancellation of the running save (cancellable sessions only). */
    cancelSave() {
        if (!this.controller || !this.cancellableSave)
            return false;
        this.userCancel = true;
        this.controller.abort();
        return true;
    }
    async save(persist, options = {}) {
        const m = this.messages;
        if (this.disposed || this.saving || this.persistenceUnknown)
            return {
                status: "invalid",
                message: this.persistenceUnknown
                    ? m.reconcileBeforeSave
                    : m.saveUnavailable,
            };
        if (options.signal?.aborted)
            return { status: "cancelled", message: m.sessionEnded };
        const timeoutMs = options.timeoutMs ?? this.options.saveTimeoutMs ?? 15000;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647)
            return { status: "invalid", message: m.invalidSaveTimeout };
        if (!this.confirmEdit() || !this.validate())
            return { status: "invalid", message: m.fixFields };
        const formatError = options.formatError ?? this.options.formatError;
        const cancellable = this.cancellableSave;
        const generation = ++this.generation, controller = new AbortController();
        this.controller = controller;
        this.userCancel = false;
        let timedOut = false;
        const snapshot = this.draft;
        if (cancellable)
            this.setStatus(m.saving, "info");
        const abort = () => controller.abort();
        options.signal?.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(() => {
            timedOut = true;
            abort();
        }, timeoutMs);
        let grace;
        const cancelled = new Promise((_, reject) => controller.signal.addEventListener("abort", () => {
            if (!cancellable)
                reject(new Error("aborted"));
            else
                grace = setTimeout(() => reject(new NoAcknowledgement()), Math.max(0, this.options.cancelGraceMs ?? 100));
        }, { once: true }));
        const current = () => !this.disposed && generation === this.generation;
        try {
            await Promise.race([
                persist(clone(snapshot), controller.signal),
                cancelled,
            ]);
            if (!current() || (!cancellable && controller.signal.aborted))
                return { status: "outcomeUnknown", message: m.saveUnconfirmed };
            // A cancellable persist that completed despite the abort request is still a success.
            this.stored = clone(snapshot);
            this.setStatus(m.saved, "success");
            return { status: "succeeded", value: clone(snapshot) };
        }
        catch (error) {
            const aborted = controller.signal.aborted;
            if (error instanceof PersistenceOutcomeUnknown ||
                error instanceof NoAcknowledgement ||
                (!cancellable && aborted)) {
                if (current()) {
                    this.setStatus(m.saveUnconfirmed, "error");
                    this.persistenceUnknown = true;
                }
                return { status: "outcomeUnknown", message: m.saveUnconfirmed };
            }
            if (cancellable && (aborted || isCancellation(error))) {
                const message = timedOut
                    ? m.saveTimedOut
                    : options.signal?.aborted && !this.userCancel
                        ? m.sessionEnded
                        : m.saveCancelled;
                if (current())
                    this.setStatus(message, "warning");
                return { status: "cancelled", message };
            }
            const message = formatProductError(formatError, error, { phase: "save" }, m.saveFailed);
            if (current())
                this.setStatus(message, "error");
            return { status: "failed", message };
        }
        finally {
            clearTimeout(timeout);
            clearTimeout(grace);
            options.signal?.removeEventListener("abort", abort);
            if (generation === this.generation)
                this.controller = undefined;
        }
    }
    /**
     * After an unconfirmed save without a storage read, lets the user explicitly write the draft
     * again. The persisted snapshot is unchanged, so the draft stays dirty until that save succeeds.
     */
    allowSaveRetry() {
        if (this.disposed || this.saving || !this.persistenceUnknown)
            return;
        this.persistenceUnknown = false;
        this.setStatus("");
    }
    /** The consumer supplies a fresh storage read; this never repeats a write. */
    reconcilePersistence(current) {
        if (this.disposed || this.saving)
            return;
        const probe = new SettingsSession(this.fields, current, {
            ...(this.options.locale !== undefined ? { locale: this.options.locale } : {}),
        });
        for (const [id, choices] of this.loaded)
            probe.setChoices(id, choices);
        if (!probe.validate())
            throw new Error(this.messages.invalidPersistedState);
        this.stored = clone(current);
        this.persistenceUnknown = false;
        this.setStatus(this.messages.storageReconciled, "info");
    }
    back() {
        if (this.saving) {
            this.setStatus(this.messages.waitForSave, "warning");
            return;
        }
        if (this.editor) {
            this.abandonEdit();
            return;
        }
        if (this.closeDecision) {
            this.closeDecision = false;
            return;
        }
        if (this.dirty)
            this.closeDecision = true;
        else
            this.closed = true;
    }
    async decide(decision, persist, options = {}) {
        if (!this.closeDecision || this.saving)
            return;
        if (decision === "continue")
            this.closeDecision = false;
        if (decision === "discard") {
            this.working = clone(this.stored);
            this.abandonEdit();
            this.errors = {};
            this.closeDecision = false;
            this.closed = true;
        }
        if (decision === "saveClose" &&
            (await this.save(persist, options)).status === "succeeded") {
            this.closeDecision = false;
            this.closed = true;
        }
    }
    dispose() {
        this.disposed = true;
        this.generation++;
        this.controller?.abort();
        this.controller = undefined;
        this.abandonEdit();
    }
}
