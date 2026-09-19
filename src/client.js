import { digest, SqliteOperationStore } from "./store.js";
import { EpostError, safeError } from "./errors.js";
import { runBatch } from "./batch.js";
import {
  validateReservation,
  validateCancellation,
  validateReservationNumber,
  validateKey,
  validateResult,
} from "./validation.js";

export class EpostClient {
  #provider;
  #store;
  #account;
  #ownsStore;
  #active = 0;
  constructor({ provider, store, journalPath } = {}) {
    if (
      !provider ||
      typeof provider.accountId !== "string" ||
      !provider.accountId.trim()
    )
      throw new EpostError("VALIDATION", { field: "provider" });
    this.#provider = provider;
    this.#account = digest(provider.accountId.trim().toLowerCase());
    this.#ownsStore = !store;
    this.#store = store ?? new SqliteOperationStore(journalPath);
  }
  async reserve(input, { idempotencyKey, retryFailed = false } = {}) {
    // A successful historical operation remains replayable after its pickup date.
    return this.#run(
      "reserve",
      validateReservation(input, { allowPast: true }),
      validateKey(idempotencyKey),
      retryFailed,
    );
  }
  async cancel(input, { idempotencyKey, retryFailed = false } = {}) {
    return this.#run(
      "cancel",
      validateCancellation(input),
      validateKey(idempotencyKey),
      retryFailed,
    );
  }
  async #run(kind, request, key, retryFailed) {
    if (typeof retryFailed !== "boolean")
      throw new EpostError("VALIDATION", { field: "retryFailed" });
    const fingerprint = digest(JSON.stringify({ kind, request }));
    const { claimed, operation } = this.#store.claim(
      this.#account,
      key,
      kind,
      fingerprint,
      request.reservationNumber,
      { retryFailed },
    );
    if (!claimed) {
      if (operation.status === "succeeded")
        return {
          ...operation.result,
          operationId: operation.id,
          replayed: true,
        };
      throw new EpostError(
        operation.status === "failed" ? "OPERATION_FAILED" : "OUTCOME_UNKNOWN",
        { operationId: operation.id },
      );
    }
    this.#active++;
    let submitted = false;
    const beforeSubmit = async () => {
      if (submitted)
        throw new EpostError("OUTCOME_UNKNOWN", { operationId: operation.id });
      // Durable barrier must commit before the provider can submit externally.
      this.#store.markSubmitted(operation.id);
      submitted = true;
    };
    try {
      if (kind === "reserve") validateReservation(request);
      const raw = await this.#provider[kind](request, { beforeSubmit });
      const result = validateResult(
        raw,
        kind === "cancel" ? request.reservationNumber : undefined,
        kind === "cancel" ? "canceled" : "reserved",
      );
      if (kind === "reserve" && !submitted)
        throw new EpostError("PROVIDER_FAILURE");
      this.#store.finish(operation.id, "succeeded", { result });
      return { ...result, operationId: operation.id, replayed: false };
    } catch (error) {
      const safe = submitted
        ? new EpostError("OUTCOME_UNKNOWN", { operationId: operation.id })
        : safeError(error);
      try {
        this.#store.finish(operation.id, submitted ? "unknown" : "failed", {
          errorCode: safe.code,
        });
      } catch {
        throw new EpostError("OUTCOME_UNKNOWN", { operationId: operation.id });
      }
      throw new EpostError(safe.code, {
        operationId: operation.id,
        field: safe.field,
      });
    } finally {
      this.#active--;
    }
  }
  async lookup(reservationNumber) {
    const number = validateReservationNumber(reservationNumber);
    return this.#read(async () =>
      validateResult(await this.#provider.lookup(number), number),
    );
  }
  async options() {
    if (typeof this.#provider.options !== "function")
      throw new EpostError("PROVIDER_FAILURE");
    return this.#read(() => this.#provider.options());
  }
  async #read(action) {
    const token = this.#store.beginRead(this.#account);
    this.#active++;
    try {
      return await action();
    } catch (error) {
      throw safeError(error);
    } finally {
      this.#active--;
      this.#store.endRead(this.#account, token);
    }
  }
  getOperation(idempotencyKey) {
    return this.#store.get(this.#account, validateKey(idempotencyKey));
  }
  listOperations(options) {
    if (typeof this.#store.list !== "function")
      throw new EpostError("UNSUPPORTED");
    return this.#store.list(this.#account, options);
  }
  reserveMany(items, options) {
    return this.#batch("reserve", items, options);
  }
  cancelMany(items, options) {
    return this.#batch("cancel", items, options);
  }
  lookupMany(items, options) {
    return this.#batch("lookup", items, options);
  }
  #batch(kind, items, options) {
    const work = () => runBatch(this, kind, items, options);
    return typeof this.#provider.withBrowser === "function"
      ? this.#provider.withBrowser(work)
      : work();
  }
  resolveOperation(idempotencyKey, resolution) {
    if (this.#active) throw new EpostError("RECOVERY_REQUIRED");
    const key = validateKey(idempotencyKey);
    const operation = this.#store.get(this.#account, key);
    if (!operation || !resolution) throw new EpostError("RECOVERY_REQUIRED");
    const result =
      resolution.outcome === "succeeded"
        ? validateResult(
            resolution.result,
            operation.target ?? undefined,
            operation.kind === "cancel" ? "canceled" : "reserved",
          )
        : null;
    return this.#store.resolve(this.#account, key, { ...resolution, result });
  }
  close() {
    if (this.#active) throw new EpostError("RECOVERY_REQUIRED");
    if (this.#ownsStore) this.#store.close();
  }
}
