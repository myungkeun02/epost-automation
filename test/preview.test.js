import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  EpostClient,
  SqliteOperationStore,
  validateReservation,
} from "../src/index.js";
import { digest } from "../src/store.js";

const request = JSON.parse(
  readFileSync(new URL("../examples/reservation.json", import.meta.url)),
);
const result = {
  reservationNumber: "2099010200000000",
  trackingNumber: null,
  status: "reserved",
};
const account = digest("preview-user");
const row = (id, value = request) => ({ id, request: value });
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "epost-preview-"));
  const path = join(dir, "journal.sqlite");
  const store = new SqliteOperationStore(path);
  const client = new EpostClient({
    store,
    provider: { accountId: "preview-user" },
  });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const seed = (key, status, value = request, identity = account) => {
    const normalized = validateReservation(value, { allowPast: true });
    const claimed = store.claim(
      identity,
      key,
      "reserve",
      digest(JSON.stringify({ kind: "reserve", request: normalized })),
    );
    if (status !== "running") {
      if (status !== "failed") store.markSubmitted(claimed.operation.id);
      if (status !== "submitted")
        store.finish(
          claimed.operation.id,
          status,
          status === "succeeded" ? { result } : {},
        );
    }
    return claimed.operation.id;
  };
  return { client, store, dir, path, seed };
}
test("preview distinguishes all actionable states and never mutates the journal", (t) => {
  const { client, seed, path } = setup(t);
  seed("batch:reserve:demo:done", "succeeded");
  seed("batch:reserve:demo:failed", "failed");
  seed("batch:reserve:demo:changed", "succeeded");
  seed("batch:reserve:demo:uncertain", "unknown");
  const before = readFileSync(path);
  const report = client.previewBatch(
    "reserve",
    [
      row("new"),
      row("done"),
      row("failed"),
      row("changed", { ...request, memo: "different" }),
      row("uncertain"),
    ],
    { batchId: "demo" },
  );
  assert.deepEqual(
    report.items.map((item) => item.state),
    ["new", "completed", "retryable", "conflict", "needs-review"],
  );
  assert.equal(report.ready, false);
  assert.equal(report.accountBlocked, true);
  assert.equal(report.items[2].willExecute, false);
  assert.equal(
    client.previewBatch("reserve", [row("failed")], {
      batchId: "demo",
      retryFailed: true,
    }).items[0].willExecute,
    true,
  );
  assert.deepEqual(readFileSync(path), before);
  assert.ok(!JSON.stringify(report).includes(request.sender.address));
  assert.ok(!JSON.stringify(report).includes(request.recipient.phone));
});
test("preview detects identical requests under older single-item keys and duplicate file rows", (t) => {
  const { client, seed } = setup(t);
  const id = seed("old-single-order", "succeeded");
  seed("someone-elses-order", "succeeded", request, digest("other-user"));
  const report = client.previewBatch("reserve", [row("one"), row("two")], {
    batchId: "demo",
  });
  assert.deepEqual(report.items[0].warnings, [
    { code: "DUPLICATE_IN_JOURNAL", operationId: id, status: "succeeded" },
  ]);
  assert.equal(report.items[1].warnings[0].code, "DUPLICATE_IN_FILE");
  assert.equal(report.ready, true); // Multiple identical parcels can be intentional.
});
test("historical completed rows preview successfully while new past-date rows are invalid", (t) => {
  const { client, seed } = setup(t);
  const past = { ...request, pickupDate: "2000-01-01" };
  seed("batch:reserve:demo:old", "succeeded", past);
  const report = client.previewBatch(
    "reserve",
    [row("old", past), row("new", past)],
    { batchId: "demo" },
  );
  assert.deepEqual(
    report.items.map((item) => item.state),
    ["completed", "invalid"],
  );
  assert.equal(report.items[1].error.field, "pickupDate");
});
test("unknown mutation allows lookup previews but live mutation/read locks block network work", (t) => {
  const { client, store, seed } = setup(t);
  seed("uncertain", "unknown");
  const rows = [row("lookup", { reservationNumber: result.reservationNumber })];
  assert.equal(
    client.previewBatch("lookup", rows, { batchId: "demo" }).ready,
    true,
  );
  const token = store.beginRead(account);
  assert.equal(
    client.previewBatch("lookup", rows, { batchId: "demo" }).accountBlocked,
    true,
  );
  store.endRead(account, token);
});
test("pending mutation outside the input blocks new work but not replay of earlier success", (t) => {
  const { client, seed } = setup(t);
  seed("batch:reserve:demo:done", "succeeded");
  seed("live", "running");
  assert.equal(
    client.previewBatch("reserve", [row("done")], { batchId: "demo" }).ready,
    true,
  );
  assert.equal(
    client.previewBatch("reserve", [row("new")], { batchId: "demo" })
      .accountBlocked,
    true,
  );
  assert.equal(
    client.previewBatch(
      "lookup",
      [row("check", { reservationNumber: result.reservationNumber })],
      { batchId: "demo" },
    ).ready,
    false,
  );
});
test("read-only inspection opens missing journals without creating directories and refuses mutation", (t) => {
  const { dir } = setup(t);
  const store = new SqliteOperationStore(join(dir, "missing/new.sqlite"), {
    readOnly: true,
  });
  t.after(() => store.close());
  const client = new EpostClient({
    provider: { accountId: "preview-user" },
    store,
  });
  const report = client.previewBatch("reserve", [row("new")], {
    batchId: "demo",
  });
  assert.equal(report.journalExists, false);
  assert.equal(report.ready, true);
  assert.deepEqual(client.getRecoveryGuide().items, []);
  assert.deepEqual(readdirSync(dir), ["journal.sqlite"]);
  assert.throws(() => store.claim(account, "new", "reserve", "test"), {
    code: "STORAGE",
  });
});
test("read-only existing journals retain exact bytes and reject all state-changing calls", (t) => {
  const { path, seed } = setup(t);
  seed("unknown", "unknown");
  const before = readFileSync(path);
  const store = new SqliteOperationStore(path, { readOnly: true });
  try {
    const client = new EpostClient({
      provider: { accountId: "preview-user" },
      store,
    });
    assert.equal(
      client.getRecoveryGuide({ key: "unknown" }).items[0].action,
      "verify-with-korea-post",
    );
    assert.throws(
      () =>
        client.resolveOperation("unknown", {
          outcome: "not-submitted",
          confirmedProcessStopped: true,
          verifiedWithKoreaPost: true,
        }),
      { code: "STORAGE" },
    );
    assert.throws(() => store.beginRead(account), { code: "STORAGE" });
  } finally {
    store.close();
  }
  assert.deepEqual(readFileSync(path), before);
});
test("recovery guides distinguish running owners, success, failures and missing keys", (t) => {
  const { client, seed } = setup(t);
  seed("done", "succeeded");
  seed("failed", "failed");
  seed("running", "running");
  assert.equal(
    client.getRecoveryGuide({ key: "done" }).items[0].action,
    "reuse-result",
  );
  assert.equal(
    client.getRecoveryGuide({ key: "failed" }).items[0].action,
    "retry-after-fix",
  );
  assert.equal(client.getRecoveryGuide().items[0].action, "wait-for-owner");
  assert.equal(client.getRecoveryGuide().total, 1);
  assert.throws(() => client.getRecoveryGuide({ key: "missing" }), {
    code: "NOT_FOUND",
  });
  assert.throws(() => client.getRecoveryGuide({ limit: 101 }), {
    code: "VALIDATION",
  });
});
test("recovery finds unresolved records even beyond the recent history window", (t) => {
  const { client, seed, path } = setup(t);
  for (let index = 0; index < 25; index++) seed(`done-${index}`, "succeeded");
  const pending = seed("pending", "unknown");
  const db = new DatabaseSync(path);
  db.prepare("UPDATE operations SET updated_at='2000-01-01' WHERE id=?").run(
    pending,
  );
  db.close();
  assert.ok(
    client
      .listOperations()
      .every((operation) => operation.status === "succeeded"),
  );
  assert.equal(
    client.getRecoveryGuide({ limit: 1 }).items[0].operation.status,
    "unknown",
  );
});
test("custom stores without inspection support fail explicitly", () => {
  const client = new EpostClient({
    provider: { accountId: "custom" },
    store: {},
  });
  assert.throws(
    () => client.previewBatch("reserve", [row("a")], { batchId: "demo" }),
    { code: "UNSUPPORTED" },
  );
  assert.throws(() => client.getRecoveryGuide(), { code: "UNSUPPORTED" });
});
