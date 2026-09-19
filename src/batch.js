import { setTimeout as pause } from "node:timers/promises";
import { EpostError, safeError } from "./errors.js";
import {
  validateReservation,
  validateCancellation,
  validateReservationNumber,
} from "./validation.js";

const kinds = ["reserve", "cancel", "lookup"];
const safeToContinue = new Set([
  "VALIDATION",
  "NOT_FOUND",
  "NOT_CANCELABLE",
  "OPERATION_FAILED",
  "KEY_CONFLICT",
]);
const identifier = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/.test(value);
export function batchKey(kind, batchId, itemId) {
  return `batch:${kind}:${batchId}:${itemId}`;
}

export function validateBatch(
  kind,
  items,
  { batchId, allowPast = false } = {},
) {
  const issues = [];
  if (!kinds.includes(kind))
    throw new EpostError("VALIDATION", { field: "kind" });
  if (!identifier(batchId))
    throw new EpostError("VALIDATION", { field: "batchId" });
  if (!Array.isArray(items) || !items.length || items.length > 1000)
    throw new EpostError("VALIDATION", { field: "items" });
  const seen = new Set();
  const normalized = items.map((item, index) => {
    try {
      if (!item || typeof item !== "object" || !identifier(item.id))
        throw new EpostError("VALIDATION", { field: "id" });
      if (seen.has(item.id))
        throw new EpostError("VALIDATION", { field: "duplicateId" });
      seen.add(item.id);
      const request =
        kind === "reserve"
          ? validateReservation(item.request, { allowPast })
          : kind === "cancel"
            ? validateCancellation(item.request)
            : {
                reservationNumber: validateReservationNumber(
                  item.request?.reservationNumber,
                ),
              };
      return { id: item.id, key: batchKey(kind, batchId, item.id), request };
    } catch (error) {
      const safe = safeError(error);
      issues.push({
        row: index + 1,
        field: safe.field ?? "request",
        code: safe.code,
      });
      return null;
    }
  });
  if (issues.length) throw new EpostError("BATCH_VALIDATION", { issues });
  return normalized;
}

function summarize(items) {
  const summary = {
    total: items.length,
    succeeded: 0,
    replayed: 0,
    failed: 0,
    unknown: 0,
    skipped: 0,
    pending: 0,
  };
  for (const item of items) {
    summary[item.status]++;
    if (item.result?.replayed) summary.replayed++;
  }
  return summary;
}

export async function runBatch(
  client,
  kind,
  input,
  {
    batchId,
    continueOnError = false,
    retryFailed = false,
    intervalMs = 1000,
    signal,
    onProgress,
  } = {},
) {
  if (
    typeof continueOnError !== "boolean" ||
    typeof retryFailed !== "boolean" ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 0 ||
    intervalMs > 60_000 ||
    (onProgress !== undefined && typeof onProgress !== "function") ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  )
    throw new EpostError("VALIDATION", { field: "batchOptions" });
  const items = validateBatch(kind, input, { batchId, allowPast: true });
  // Check every new reservation date before the first remote operation. Old
  // successful requests remain replayable without requiring a future date.
  if (kind === "reserve") {
    const issues = [];
    items.forEach((item, index) => {
      try {
        if (client.getOperation(item.key)?.status !== "succeeded")
          validateReservation(item.request);
      } catch (error) {
        if (error.code !== "VALIDATION") throw error;
        issues.push({ row: index + 1, field: error.field, code: error.code });
      }
    });
    if (issues.length) throw new EpostError("BATCH_VALIDATION", { issues });
  }
  const report = {
    batchId,
    kind,
    status: "running",
    stopReason: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    items: items.map(({ id, key }) => ({ id, key, status: "pending" })),
    summary: null,
  };
  const snapshot = () =>
    structuredClone({ ...report, summary: summarize(report.items) });
  const notify = async () => {
    if (!onProgress) return true;
    try {
      await onProgress(snapshot());
      return true;
    } catch {
      report.stopReason = "OUTPUT_FAILED";
      return false;
    }
  };
  if (await notify()) {
    for (let index = 0; index < items.length; index++) {
      if (signal?.aborted) {
        report.stopReason = "INTERRUPTED";
        break;
      }
      if (index && intervalMs) {
        try {
          await pause(intervalMs, undefined, { signal });
        } catch {
          report.stopReason = "INTERRUPTED";
          break;
        }
      }
      const item = items[index];
      try {
        const result =
          kind === "lookup"
            ? await client.lookup(item.request.reservationNumber)
            : await client[kind](item.request, {
                idempotencyKey: item.key,
                retryFailed,
              });
        report.items[index] = {
          id: item.id,
          key: item.key,
          status: "succeeded",
          result,
        };
      } catch (error) {
        const safe = safeError(error);
        report.items[index] = {
          id: item.id,
          key: item.key,
          status: safe.code === "OUTCOME_UNKNOWN" ? "unknown" : "failed",
          error: safe.toJSON(),
        };
        if (!continueOnError || !safeToContinue.has(safe.code))
          report.stopReason = safe.code;
      }
      if (!(await notify()) || report.stopReason) break;
    }
  }
  for (const item of report.items)
    if (item.status === "pending") item.status = "skipped";
  report.status = report.stopReason
    ? "stopped"
    : report.items.some((item) => item.status !== "succeeded")
      ? "completed-with-errors"
      : "completed";
  report.finishedAt = new Date().toISOString();
  if (!(await notify())) report.status = "stopped";
  return snapshot();
}
