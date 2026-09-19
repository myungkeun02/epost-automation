import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  EpostClient,
  SqliteOperationStore,
  EpostError,
  validateBatch,
} from "../src/index.js";
import { batchKey } from "../src/batch.js";

const request = JSON.parse(
  readFileSync(new URL("../examples/reservation.json", import.meta.url)),
);
const result = {
  reservationNumber: "2099010200000000",
  status: "reserved",
  trackingNumber: null,
};
const items = ["one", "two", "three"].map((id) => ({ id, request }));
const options = { batchId: "run-1", intervalMs: 0 };
function setup(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "epost-batch-"));
  const store = new SqliteOperationStore(join(dir, "journal.sqlite"));
  const provider = {
    accountId: "batch-user",
    reserve: async (_r, guard) => {
      await guard.beforeSubmit();
      return result;
    },
    cancel: async (_r, guard) => {
      await guard.beforeSubmit();
      return { ...result, status: "canceled" };
    },
    lookup: async () => result,
    ...overrides,
  };
  const client = new EpostClient({ provider, store });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { client, store, provider };
}
test("batch completes sequentially and reordered rerun replays every success", async (t) => {
  let calls = 0,
    active = 0;
  const { client } = setup(t, {
    reserve: async (_r, g) => {
      assert.equal(active++, 0);
      calls++;
      await g.beforeSubmit();
      await Promise.resolve();
      active--;
      return result;
    },
  });
  const report = await client.reserveMany(items, options);
  assert.equal(report.status, "completed");
  assert.equal(report.summary.succeeded, 3);
  const replay = await client.reserveMany([...items].reverse(), options);
  assert.equal(replay.summary.replayed, 3);
  assert.equal(calls, 3);
});
test("all row errors and duplicate identifiers are reported before any mutation", async (t) => {
  let calls = 0;
  const { client } = setup(t, {
    reserve: async () => {
      calls++;
      return result;
    },
  });
  await assert.rejects(
    client.reserveMany(
      [
        { id: "a", request: {} },
        { id: "a", request },
        {
          id: "b",
          request: { ...request, parcel: { ...request.parcel, quantity: 2 } },
        },
      ],
      options,
    ),
    (error) => {
      assert.equal(error.code, "BATCH_VALIDATION");
      assert.deepEqual(
        error.issues.map((x) => x.row),
        [1, 2, 3],
      );
      return true;
    },
  );
  assert.equal(calls, 0);
  assert.equal(client.listOperations().length, 0);
});
test("invalid date in a later new row prevents earlier valid rows from submitting", async (t) => {
  let calls = 0;
  const { client } = setup(t, {
    reserve: async () => {
      calls++;
      return result;
    },
  });
  await assert.rejects(
    client.reserveMany(
      [
        items[0],
        { id: "past", request: { ...request, pickupDate: "2000-01-01" } },
      ],
      options,
    ),
    { code: "BATCH_VALIDATION" },
  );
  assert.equal(calls, 0);
});
test("uncertain second row stops all remaining work even with continueOnError", async (t) => {
  let calls = 0;
  const { client } = setup(t, {
    reserve: async (_r, g) => {
      await g.beforeSubmit();
      if (++calls === 2) throw new Error("private");
      return result;
    },
  });
  const report = await client.reserveMany(items, {
    ...options,
    continueOnError: true,
  });
  assert.deepEqual(
    report.items.map((x) => x.status),
    ["succeeded", "unknown", "skipped"],
  );
  assert.equal(calls, 2);
  assert.equal(report.stopReason, "OUTCOME_UNKNOWN");
  assert.ok(!JSON.stringify(report).includes("private"));
  const resumed = await client.reserveMany(items, {
    ...options,
    retryFailed: true,
    continueOnError: true,
  });
  assert.equal(resumed.summary.replayed, 1);
  assert.equal(calls, 2);
});
test("explicit retry uses the same safe failed operation; default rerun does not", async (t) => {
  let calls = 0;
  const { client } = setup(t, {
    reserve: async (_r, g) => {
      if (++calls === 1) throw new EpostError("AUTHENTICATION");
      await g.beforeSubmit();
      return result;
    },
  });
  const failed = await client.reserveMany(items, options);
  const operation = client.getOperation(
    batchKey("reserve", options.batchId, "one"),
  );
  assert.equal(failed.summary.skipped, 2);
  assert.equal(
    (await client.reserveMany(items, options)).items[0].error.code,
    "OPERATION_FAILED",
  );
  assert.equal(calls, 1);
  const recovered = await client.reserveMany(items, {
    ...options,
    retryFailed: true,
  });
  assert.equal(recovered.summary.succeeded, 3);
  assert.equal(recovered.items[0].result.operationId, operation.id);
  assert.equal(calls, 4);
});
test("retryFailed never permits changed input under a consumed key", async (t) => {
  const { client } = setup(t, {
    reserve: async () => {
      throw new EpostError("VALIDATION");
    },
  });
  await client.reserveMany([items[0]], options);
  const report = await client.reserveMany(
    [{ id: "one", request: { ...request, memo: "changed" } }],
    { ...options, retryFailed: true },
  );
  assert.equal(report.items[0].error.code, "KEY_CONFLICT");
});
test("safe per-row failures can continue, but account-wide errors stop", async (t) => {
  let calls = 0;
  const { client } = setup(t, {
    cancel: async (_r, g) => {
      if (++calls === 1) throw new EpostError("NOT_CANCELABLE");
      await g.beforeSubmit();
      return { ...result, status: "canceled" };
    },
  });
  const rows = items.map(({ id }) => ({
    id,
    request: {
      reservationNumber: result.reservationNumber,
      recipientPhone: "01000000000",
    },
  }));
  const report = await client.cancelMany(rows, {
    ...options,
    continueOnError: true,
  });
  assert.equal(report.status, "completed-with-errors");
  assert.equal(report.summary.succeeded, 2);
  assert.equal(report.summary.failed, 1);
});
test("AbortSignal waits for the in-flight row, then resume skips that success", async (t) => {
  const controller = new AbortController();
  let calls = 0;
  const { client } = setup(t, {
    reserve: async (_r, g) => {
      calls++;
      await g.beforeSubmit();
      controller.abort();
      return result;
    },
  });
  const stopped = await client.reserveMany(items, {
    ...options,
    signal: controller.signal,
  });
  assert.equal(stopped.stopReason, "INTERRUPTED");
  assert.equal(stopped.summary.succeeded, 1);
  assert.equal(stopped.summary.skipped, 2);
  const resumed = await client.reserveMany(items, options);
  assert.equal(resumed.summary.replayed, 1);
  assert.equal(calls, 3);
});
test("aborted-before-start performs no provider or journal mutation", async (t) => {
  let calls = 0;
  const { client } = setup(t, {
    reserve: async () => {
      calls++;
      return result;
    },
  });
  const report = await client.reserveMany(items, {
    ...options,
    signal: AbortSignal.abort(),
  });
  assert.equal(report.summary.skipped, 3);
  assert.equal(calls, 0);
  assert.equal(client.listOperations().length, 0);
});
test("reporting failure before execution stops without remote effects", async (t) => {
  let calls = 0;
  const { client } = setup(t, {
    reserve: async () => {
      calls++;
      return result;
    },
  });
  const report = await client.reserveMany(items, {
    ...options,
    onProgress: () => {
      throw new Error("disk full");
    },
  });
  assert.equal(report.stopReason, "OUTPUT_FAILED");
  assert.equal(report.summary.skipped, 3);
  assert.equal(calls, 0);
});
test("reporting failure after success preserves the journal and stops the next row", async (t) => {
  let calls = 0;
  const { client } = setup(t, {
    reserve: async (_r, g) => {
      calls++;
      await g.beforeSubmit();
      return result;
    },
  });
  const report = await client.reserveMany(items, {
    ...options,
    onProgress: (r) => {
      if (r.summary.succeeded) throw new Error("disk full");
    },
  });
  assert.equal(report.stopReason, "OUTPUT_FAILED");
  assert.equal(calls, 1);
  assert.equal((await client.reserveMany(items, options)).summary.replayed, 1);
});
test("progress receives independent snapshots without private request fields", async (t) => {
  const { client } = setup(t);
  const reports = [];
  await client.reserveMany(items, {
    ...options,
    onProgress: (r) => {
      reports.push(structuredClone(r));
      r.items.length = 0;
    },
  });
  assert.equal(reports.at(-1).summary.succeeded, 3);
  assert.ok(!JSON.stringify(reports).includes(request.sender.address));
});
test("history is account-scoped and validates filters", async (t) => {
  const { client, store } = setup(t);
  await client.reserveMany(items, options);
  assert.equal(
    client.listOperations({ status: "succeeded", limit: 2 }).length,
    2,
  );
  assert.equal(store.list("different-account").length, 0);
  assert.throws(() => client.listOperations({ limit: 1001 }), {
    code: "VALIDATION",
  });
});
test("read-only lookup batches run afresh and return independent statuses", async (t) => {
  let calls = 0;
  const { client } = setup(t, {
    lookup: async () => {
      calls++;
      return result;
    },
  });
  const rows = items.map(({ id }) => ({
    id,
    request: { reservationNumber: result.reservationNumber },
  }));
  await client.lookupMany(rows, options);
  await client.lookupMany(rows, options);
  assert.equal(calls, 6);
  assert.equal(client.listOperations().length, 0);
});
test("batch identifiers have bounded length; generated operation keys are valid", () => {
  assert.throws(
    () =>
      validateBatch("reserve", items, { batchId: "private email@example.com" }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () => validateBatch("reserve", Array(1001).fill(items[0]), options),
    { code: "VALIDATION" },
  );
  assert.ok(
    validateBatch("reserve", [{ id: "a".repeat(48), request }], {
      batchId: "b".repeat(48),
    })[0].key.length <= 128,
  );
});
