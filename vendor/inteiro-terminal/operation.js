// Vendored from @inteiro/terminal 1.4.0 (packages/terminal/src/operation.ts). Do not edit; see VENDOR.json.
import { resolveMessages, } from "./i18n.js";
import { formatProductError, isCancellation, } from "./errors.js";
/** A product can report cancellation only after confirming that its work stopped. */
export class OperationCancelled extends Error {
    name = "OperationCancelled";
}
class UnknownOutcome extends Error {
}
export class Operation {
    state = "idle";
    message = "";
    progress = {
        label: "",
    };
    /**
     * True when the last run succeeded although Esc (`cancel`) or the timeout had already aborted
     * its signal. The value is real, but the person asked to stop: do not act on it.
     */
    cancelRequested = false;
    controller;
    generation = 0;
    disposed = false;
    owner;
    effect;
    messages;
    options;
    constructor(owner, effect = "local", options = {}) {
        this.owner = owner;
        this.effect = effect;
        this.options = options;
        this.messages = resolveMessages(options.locale, options.messages);
    }
    setLocale(locale, messages) {
        this.messages = resolveMessages(locale, messages ?? this.options.messages);
    }
    get active() {
        return this.state === "running" || this.state === "cancelling";
    }
    get percent() {
        const { completed, total } = this.progress;
        return total !== undefined && total > 0 && completed !== undefined
            ? Math.max(0, Math.min(100, (completed / total) * 100))
            : undefined;
    }
    cancel() {
        if (this.state === "running") {
            this.state = "cancelling";
            this.message = this.messages.cancelRequested;
            this.controller?.abort();
        }
    }
    async run(work, timeoutMs, runOptions = {}) {
        const m = this.messages;
        if (this.disposed || this.active || this.state === "outcomeUnknown")
            return {
                status: "invalid",
                message: this.state === "outcomeUnknown"
                    ? m.checkResultFirst
                    : m.operationUnavailable,
            };
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
            throw new Error(m.timeoutRequired);
        const generation = ++this.generation, controller = new AbortController();
        this.controller = controller;
        this.state = "running";
        this.cancelRequested = false;
        this.message = m.operationRunning;
        this.progress = {
            label: runOptions.label?.trim() ? runOptions.label : m.operationStarting,
        };
        let timeout;
        let cancellationDeadline;
        const abortResult = new Promise((_, reject) => {
            controller.signal.addEventListener("abort", () => {
                cancellationDeadline = setTimeout(() => reject(new UnknownOutcome()), Math.max(0, this.options.cancelGraceMs ?? 100));
            }, { once: true });
            timeout = setTimeout(() => {
                if (generation === this.generation)
                    this.cancel();
            }, timeoutMs);
        });
        try {
            const value = await Promise.race([
                work(controller.signal, (label, completed, total) => {
                    if (this.disposed ||
                        generation !== this.generation ||
                        controller.signal.aborted)
                        return;
                    this.progress = {
                        label,
                        ...(completed !== undefined ? { completed } : {}),
                        ...(total !== undefined ? { total } : {}),
                    };
                }),
                abortResult,
            ]);
            if (this.disposed || generation !== this.generation)
                return { status: "cancelled", message: m.sessionEnded };
            // Work that completed is reported as completed (1.3 contract), but callers can tell that
            // the person had already asked to stop and must not act on the value (close, open, …).
            this.cancelRequested = controller.signal.aborted;
            let message = m.operationDone;
            try {
                const described = runOptions.describe?.(value);
                if (typeof described === "string" && described.trim())
                    message = described;
            }
            catch {
                /* keep the default message */
            }
            this.state = "succeeded";
            this.message = message;
            return { status: "succeeded", value };
        }
        catch (error) {
            const aborted = controller.signal.aborted;
            // Explicit acknowledgement always counts; AbortError or a rejection after abort only
            // proves a stop for local work (an external request may already have been applied).
            const confirmed = !(error instanceof UnknownOutcome) &&
                (error instanceof OperationCancelled ||
                    error?.name ===
                        "OperationCancelled" ||
                    error?.code === "CANCELLED" ||
                    (this.effect === "local" && (aborted || isCancellation(error))));
            const state = confirmed
                ? "cancelled"
                : error instanceof UnknownOutcome ||
                    this.effect === "external" ||
                    aborted
                    ? "outcomeUnknown"
                    : "failed";
            const message = state === "outcomeUnknown"
                ? m.operationUnconfirmed
                : state === "cancelled"
                    ? m.operationCancelled
                    : formatProductError(runOptions.formatError ?? this.options.formatError, error, runOptions.context ?? { phase: "task" }, m.operationFailed);
            if (!this.disposed && generation === this.generation) {
                this.state = state;
                this.message = message;
            }
            return { status: state, message };
        }
        finally {
            clearTimeout(timeout);
            clearTimeout(cancellationDeadline);
            if (generation === this.generation)
                this.controller = undefined;
        }
    }
    reconcile(state, message) {
        if (this.state !== "outcomeUnknown")
            throw new Error(this.messages.noPendingResult);
        this.state = state;
        this.message = message;
    }
    dispose() {
        this.disposed = true;
        this.generation++;
        this.controller?.abort();
        this.controller = undefined;
    }
}
