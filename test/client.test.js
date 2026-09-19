import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  EpostClient,
  EpostError,
  SqliteOperationStore,
  validateReservation,
} from "../src/index.js";
import { digest } from "../src/store.js";

const input = JSON.parse(
  readFileSync(new URL("../examples/reservation.json", import.meta.url)),
);
const result = {
  reservationNumber: "2099010200000000",
  trackingNumber: null,
  status: "reserved",
};
const canceled = { ...result, status: "canceled" };
const cancellation = {
  reservationNumber: result.reservationNumber,
  recipientPhone: "010-0000-0001",
};
function setup(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "epost-test-"));
  const path = join(dir, "operations.sqlite");
  const store = new SqliteOperationStore(path);
  const provider = {
    accountId: "test-account",
    reserve: async (_r, guard) => {
      await guard.beforeSubmit();
      return result;
    },
    cancel: async (_r, guard) => {
      await guard.beforeSubmit();
      return canceled;
    },
    lookup: async () => result,
    ...overrides,
  };
  const client = new EpostClient({ provider, store });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { client, store, provider, path };
}
const isCode = (code) => (error) => {
  assert.ok(error instanceof EpostError);
  assert.equal(error.code, code);
  return true;
};

test("successful identical key returns durable result without another submission", async (t) => {
  let calls = 0;
  const { client } = setup(t, {
    reserve: async (_r, guard) => {
      calls++;
      await guard.beforeSubmit();
      return result;
    },
  });
  const first = await client.reserve(input, { idempotencyKey: "order-1" });
  const replay = await client.reserve(structuredClone(input), {
    idempotencyKey: "order-1",
  });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.operationId, first.operationId);
  assert.equal(calls, 1);
});
test("changed payload with the same key is rejected", async (t) => {
  const { client } = setup(t);
  await client.reserve(input, { idempotencyKey: "order-1" });
  await assert.rejects(
    client.reserve(
      { ...input, memo: "changed" },
      { idempotencyKey: "order-1" },
    ),
    isCode("KEY_CONFLICT"),
  );
});
test("concurrent different keys for one account cannot submit in parallel", async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { client } = setup(t, {
    reserve: async (_r, g) => {
      await gate;
      await g.beforeSubmit();
      return result;
    },
  });
  const first = client.reserve(input, { idempotencyKey: "one" });
  await assert.rejects(
    client.reserve(input, { idempotencyKey: "two" }),
    isCode("ACCOUNT_BUSY"),
  );
  await assert.rejects(
    client.reserve(input, { idempotencyKey: "one" }),
    isCode("OUTCOME_UNKNOWN"),
  );
  release();
  await first;
});
test("provider failure after the durable barrier blocks same and new keys", async (t) => {
  let calls = 0;
  const { client } = setup(t, {
    reserve: async (_r, guard) => {
      calls++;
      await guard.beforeSubmit();
      throw new Error("secret-card-and-address");
    },
  });
  await assert.rejects(
    client.reserve(input, { idempotencyKey: "one" }),
    (error) => {
      assert.equal(error.code, "OUTCOME_UNKNOWN");
      assert.ok(!JSON.stringify(error).includes("secret"));
      assert.equal(error.cause, undefined);
      return true;
    },
  );
  assert.equal(client.getOperation("one").status, "unknown");
  await assert.rejects(
    client.reserve(input, { idempotencyKey: "one" }),
    isCode("OUTCOME_UNKNOWN"),
  );
  await assert.rejects(
    client.reserve(input, { idempotencyKey: "two" }),
    isCode("ACCOUNT_BUSY"),
  );
  assert.equal(calls, 1);
});
test("failure before submission releases account but never silently retries that key", async (t) => {
  let calls = 0;
  const { client } = setup(t, {
    reserve: async (_r, guard) => {
      if (++calls === 1) throw new Error("private data");
      await guard.beforeSubmit();
      return result;
    },
  });
  await assert.rejects(
    client.reserve(input, { idempotencyKey: "one" }),
    isCode("PROVIDER_FAILURE"),
  );
  await assert.rejects(
    client.reserve(input, { idempotencyKey: "one" }),
    isCode("OPERATION_FAILED"),
  );
  await client.reserve(input, { idempotencyKey: "two" });
});
test("commit-record failure after external success becomes unknown, never retryable", async (t) => {
  const { provider, store } = setup(t);
  const client = new EpostClient({
    provider,
    store: {
      claim: store.claim.bind(store),
      get: store.get.bind(store),
      markSubmitted: store.markSubmitted.bind(store),
      finish(id, status, data) {
        if (status === "succeeded") throw new Error("disk full");
        return store.finish(id, status, data);
      },
    },
  });
  await assert.rejects(
    client.reserve(input, { idempotencyKey: "one" }),
    isCode("OUTCOME_UNKNOWN"),
  );
  assert.equal(client.getOperation("one").status, "unknown");
});
test("failed durable barrier prevents provider submission", async (t) => {
  let submitted = false;
  const { provider, store } = setup(t, {
    reserve: async (_r, g) => {
      await g.beforeSubmit();
      submitted = true;
      return result;
    },
  });
  const client = new EpostClient({
    provider,
    store: {
      claim: store.claim.bind(store),
      markSubmitted() {
        throw new EpostError("STORAGE");
      },
      finish: store.finish.bind(store),
    },
  });
  await assert.rejects(
    client.reserve(input, { idempotencyKey: "one" }),
    isCode("STORAGE"),
  );
  assert.equal(submitted, false);
});
test("unknown registration can be resolved only by explicit manual verification", async (t) => {
  const { client } = setup(t, {
    reserve: async (_r, g) => {
      await g.beforeSubmit();
      throw new Error();
    },
  });
  await assert.rejects(client.reserve(input, { idempotencyKey: "one" }));
  assert.throws(
    () => client.resolveOperation("one", { outcome: "succeeded", result }),
    isCode("RECOVERY_REQUIRED"),
  );
  client.resolveOperation("one", {
    outcome: "succeeded",
    result,
    confirmedProcessStopped: true,
    verifiedWithKoreaPost: true,
  });
  assert.equal(
    (await client.reserve(input, { idempotencyKey: "one" })).replayed,
    true,
  );
});
test("uncertain cancellation cannot be resolved with a different reservation number", async (t) => {
  const { client } = setup(t, {
    cancel: async (_r, g) => {
      await g.beforeSubmit();
      throw new Error();
    },
  });
  await assert.rejects(
    client.cancel(cancellation, { idempotencyKey: "cancel-1" }),
  );
  assert.throws(
    () =>
      client.resolveOperation("cancel-1", {
        outcome: "succeeded",
        result: { ...canceled, reservationNumber: "2099010200000001" },
        confirmedProcessStopped: true,
        verifiedWithKoreaPost: true,
      }),
    isCode("PROVIDER_FAILURE"),
  );
});
test("already canceled reservation succeeds without any mutation", async (t) => {
  const { client } = setup(t, { cancel: async () => canceled });
  assert.equal(
    (await client.cancel(cancellation, { idempotencyKey: "cancel-1" })).status,
    "canceled",
  );
});
test("wrong result id and non-final cancellation are never recorded as success", async (t) => {
  const { client } = setup(t, {
    cancel: async (_r, g) => {
      await g.beforeSubmit();
      return result;
    },
  });
  await assert.rejects(
    client.cancel(cancellation, { idempotencyKey: "cancel-1" }),
    isCode("OUTCOME_UNKNOWN"),
  );
});
test("journal survives reopening and stores no contact, credential or key plaintext", async (t) => {
  const { client, path, provider } = setup(t);
  await client.reserve(input, { idempotencyKey: "customer-private-key" });
  const reopened = new SqliteOperationStore(path);
  try {
    const second = new EpostClient({ provider, store: reopened });
    assert.equal(
      (await second.reserve(input, { idempotencyKey: "customer-private-key" }))
        .replayed,
      true,
    );
    const disk = readFileSync(path).toString("utf8");
    for (const value of [
      input.sender.name,
      input.sender.address,
      input.recipient.phone,
      "customer-private-key",
    ])
      assert.ok(!disk.includes(value));
    if (process.platform !== "win32")
      assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    reopened.close();
  }
});
test("a worker process crash leaves a persistent lock; no timeout steals it", async (t) => {
  const { path, store, client } = setup(t);
  const script = `import { SqliteOperationStore } from ${JSON.stringify(new URL("../src/store.js", import.meta.url).href)};
    const s=new SqliteOperationStore(process.argv[1]);
    const op=s.claim(${JSON.stringify(digest("test-account"))},'crashed','reserve','fingerprint');
    s.markSubmitted(op.operation.id);process.exit(0);`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, path],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  await assert.rejects(
    client.reserve(input, { idempotencyKey: "after-crash" }),
    isCode("ACCOUNT_BUSY"),
  );
  assert.equal(
    store.get(digest("test-account"), "crashed").status,
    "submitted",
  );
  client.resolveOperation("crashed", {
    outcome: "not-submitted",
    confirmedProcessStopped: true,
    verifiedWithKoreaPost: true,
  });
  await client.reserve(input, { idempotencyKey: "after-recovery" });
});
test("live owner cannot be manually unlocked by another client", async (t) => {
  const { client, store } = setup(t);
  store.claim(digest("test-account"), "live", "reserve", "test");
  assert.throws(
    () =>
      client.resolveOperation("live", {
        outcome: "not-submitted",
        confirmedProcessStopped: true,
        verifiedWithKoreaPost: true,
      }),
    isCode("RECOVERY_REQUIRED"),
  );
});
test("different process observes atomic account claim", async (t) => {
  const { store, path } = setup(t);
  store.claim(digest("test-account"), "owner", "reserve", "test");
  const script = `import { SqliteOperationStore } from ${JSON.stringify(new URL("../src/store.js", import.meta.url).href)};
    const s=new SqliteOperationStore(process.argv[1]);
    try{s.claim(${JSON.stringify(digest("test-account"))},'other','reserve','test');process.exit(1)}
    catch(e){process.stdout.write(e.code);s.close()}`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, path],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0);
  assert.equal(child.stdout, "ACCOUNT_BUSY");
});
test("historical successful requests can still replay after pickup date", async (t) => {
  const { store, client, path } = setup(t);
  const past = { ...input, pickupDate: "2020-01-02" };
  const request = validateReservation(past, { allowPast: true });
  const claimed = store.claim(
    digest("test-account"),
    "old",
    "reserve",
    digest(JSON.stringify({ kind: "reserve", request })),
  );
  store.markSubmitted(claimed.operation.id);
  store.finish(claimed.operation.id, "succeeded", { result });
  assert.equal(
    (await client.reserve(past, { idempotencyKey: "old" })).replayed,
    true,
  );
  await assert.rejects(
    client.reserve(past, { idempotencyKey: "new" }),
    isCode("VALIDATION"),
  );
  const db = new DatabaseSync(path);
  try {
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM events WHERE operation_id=?")
        .get(claimed.operation.id).n,
      3,
    );
  } finally {
    db.close();
  }
});
test("input snapshot is independent of caller mutations during work", async (t) => {
  const callerInput = structuredClone(input);
  let seen;
  const { client } = setup(t, {
    reserve: async (r, g) => {
      await Promise.resolve();
      seen = r.recipient.name;
      await g.beforeSubmit();
      return result;
    },
  });
  const promise = client.reserve(callerInput, { idempotencyKey: "one" });
  callerInput.recipient.name = "changed";
  await promise;
  assert.equal(seen, input.recipient.name);
});
test("a lookup session prevents concurrent mutation and releases its read lock", async (t) => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const { client } = setup(t, {
    lookup: async () => {
      await gate;
      return result;
    },
  });
  const lookup = client.lookup(result.reservationNumber);
  await assert.rejects(
    client.reserve(input, { idempotencyKey: "one" }),
    isCode("ACCOUNT_BUSY"),
  );
  release();
  await lookup;
  await client.reserve(input, { idempotencyKey: "one" });
});
test("unknown operations allow serialized lookup but retain their mutation lock", async (t) => {
  const { client } = setup(t, {
    reserve: async (_r, g) => {
      await g.beforeSubmit();
      throw new Error();
    },
  });
  await assert.rejects(client.reserve(input, { idempotencyKey: "one" }));
  assert.equal(
    (await client.lookup(result.reservationNumber)).status,
    "reserved",
  );
  await assert.rejects(
    client.reserve(input, { idempotencyKey: "two" }),
    isCode("ACCOUNT_BUSY"),
  );
});
test("a failed read releases the account and hides upstream details", async (t) => {
  const { client } = setup(t, {
    lookup: async () => {
      throw new Error("secret customer");
    },
  });
  await assert.rejects(
    client.lookup(result.reservationNumber),
    isCode("PROVIDER_FAILURE"),
  );
  await client.reserve(input, { idempotencyKey: "one" });
});
