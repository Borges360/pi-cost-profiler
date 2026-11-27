// Vendored from @inteiro/terminal 2.0.0-rc.1 (packages/terminal/src/errors.ts). Do not edit; see VENDOR.json.
/** Cancellation acknowledged by the work: `OperationCancelled`, `AbortError` or `code: "CANCELLED"`. */
export function isCancellation(error) {
    if (!error || typeof error !== "object")
        return false;
    const e = error;
    return (e.name === "AbortError" ||
        e.name === "OperationCancelled" ||
        e.code === "CANCELLED" ||
        e.code === "ABORT_ERR");
}
/** Safe call of a product formatter: exceptions and empty text fall back to `fallback`. */
export function formatProductError(format, error, context, fallback) {
    if (!format)
        return fallback;
    try {
        const text = format(error, context);
        return typeof text === "string" && text.trim() ? text : fallback;
    }
    catch {
        return fallback;
    }
}
