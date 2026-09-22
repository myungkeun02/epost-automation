import { digest } from "./store.js";
import { EpostError } from "./errors.js";
import { validateBatch } from "./batch.js";
import { validateReservation } from "./validation.js";

export function previewBatch(
  kind,
  input,
  { batchId, retryFailed = false } = {},
  inspect,
) {
  if (typeof retryFailed !== "boolean")
    throw new EpostError("VALIDATION", { field: "retryFailed" });
  const rows = validateBatch(kind, input, { batchId, allowPast: true });
  const entries = rows.map(({ key, request }) => ({
    key,
    kind,
    fingerprint: digest(JSON.stringify({ kind, request })),
  }));
  const snapshot = inspect(kind === "lookup" ? [] : entries);
  const seen = new Map();
  const items = rows.map(({ id, key, request }, index) => {
    const stored = snapshot.items[index];
    const operation = stored?.operation;
    let state =
      kind === "lookup"
        ? "lookup"
        : !stored.matches
          ? "conflict"
          : !operation
            ? "new"
            : operation.status === "succeeded"
              ? "completed"
              : operation.status === "failed"
                ? "retryable"
                : "needs-review";
    let error;
    if (kind === "reserve" && ["new", "retryable"].includes(state)) {
      try {
        validateReservation(request);
      } catch (cause) {
        if (!(cause instanceof EpostError)) throw cause;
        state = "invalid";
        error = cause.toJSON();
      }
    }
    const warnings = [];
    const earlierId = seen.get(entries[index].fingerprint);
    if (earlierId)
      warnings.push({ code: "DUPLICATE_IN_FILE", itemId: earlierId });
    else seen.set(entries[index].fingerprint, id);
    for (const duplicate of stored?.duplicates ?? [])
      warnings.push({
        code: "DUPLICATE_IN_JOURNAL",
        operationId: duplicate.id,
        status: duplicate.status,
      });
    return {
      id,
      key,
      state,
      willExecute:
        state === "new" ||
        state === "lookup" ||
        (state === "retryable" && retryFailed),
      ...(operation
        ? { operationId: operation.id, operationStatus: operation.status }
        : {}),
      ...(operation?.result ? { result: operation.result } : {}),
      ...(error ? { error } : {}),
      warnings,
    };
  });
  const summary = {
    total: items.length,
    new: 0,
    completed: 0,
    retryable: 0,
    "needs-review": 0,
    conflict: 0,
    invalid: 0,
    lookup: 0,
    warnings: 0,
  };
  for (const item of items) {
    summary[item.state]++;
    summary.warnings += item.warnings.length;
  }
  const accountBlocked =
    items.some((item) => item.willExecute) &&
    (snapshot.reading ||
      !!(
        snapshot.mutation &&
        (kind !== "lookup" || snapshot.mutation.status !== "unknown")
      ));
  return {
    mode: "preview",
    batchId,
    kind,
    networkUsed: false,
    journalExists: snapshot.journalExists,
    ready:
      !accountBlocked &&
      items.every((item) => item.willExecute || item.state === "completed"),
    accountBlocked,
    ...(accountBlocked && snapshot.mutation
      ? { blockingOperationId: snapshot.mutation.id }
      : {}),
    summary,
    items,
    message:
      "현재 계정과 journal의 미리보기입니다. 실제 실행 시 상태를 다시 확인합니다. 중복 의심은 여러 상자일 수도 있으므로 원래 주문과 대조하세요.",
  };
}
