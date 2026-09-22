import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { EpostClient } from "../src/index.js";
const bin = fileURLToPath(new URL("../bin/epost.js", import.meta.url));
const request = JSON.parse(
  readFileSync(new URL("../examples/reservation.json", import.meta.url)),
);
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "epost-cli-v2-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (args, extra = {}) =>
    spawnSync(process.execPath, [bin, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { PATH: process.env.PATH },
      ...extra,
    });
  return { dir, run };
}
test("CLI onboarding generates templates; common config allows recipient-only batch CSV", (t) => {
  const { dir, run } = setup(t);
  assert.equal(run(["init", "--dir", "shipping"]).status, 0);
  const report = run([
    "batch-reserve",
    "shipping/shipments.local.csv",
    "--config",
    "shipping/config.local.json",
    "--batch-id",
    "demo",
  ]);
  assert.equal(report.status, 0, report.stderr);
  assert.equal(JSON.parse(report.stdout).count, 1);
  assert.equal(existsSync(join(dir, "shipping/.epost")), false);
});
test("CLI reports all bad rows with helpful fields and no personal input", (t) => {
  const { dir, run } = setup(t);
  writeFileSync(
    join(dir, "bad.json"),
    JSON.stringify({
      batchId: "bad",
      items: [
        { id: "a", request: {} },
        { id: "b", request: { pickupDate: "private-data" } },
      ],
    }),
  );
  const output = run(["batch-reserve", "bad.json"]);
  assert.equal(output.status, 1);
  const error = JSON.parse(
    output.stderr.split("\n").find((line) => line.startsWith("{")),
  );
  assert.equal(error.code, "BATCH_VALIDATION");
  assert.equal(error.issues.length, 2);
  assert.ok(!output.stderr.includes("private-data"));
});
test("CLI accepts JSON stdin, refuses conflicting embedded batch ID and output overwrite", (t) => {
  const { dir, run } = setup(t);
  const input = JSON.stringify({
    batchId: "demo",
    items: [{ id: "one", request }],
  });
  const report = run(["batch-reserve", "-", "--format", "json"], { input });
  assert.equal(report.status, 0, report.stderr);
  assert.equal(
    run(["batch-reserve", "-", "--batch-id", "different"], { input }).status,
    1,
  );
  writeFileSync(join(dir, "batch.json"), input);
  assert.equal(
    run(["batch-reserve", "batch.json", "--output", "batch.json"]).status,
    1,
  );
  assert.equal(readFileSync(join(dir, "batch.json"), "utf8"), input);
});
test("CLI history loads an explicit env file without needing payment/password", (t) => {
  const { dir, run } = setup(t);
  writeFileSync(join(dir, ".env"), "EPOST_USERNAME=history-test\n");
  const output = run(["history", "--env-file", ".env"]);
  assert.equal(output.status, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout), []);
});
test("CLI command help, version and offline doctor are discoverable", (t) => {
  const { run } = setup(t);
  assert.ok(run(["help", "batch-reserve"]).stdout.includes("--output"));
  assert.match(run(["--version"]).stdout, /^0\.\d+\.\d+\n$/);
  const doctor = run(["doctor", "--payment"]);
  assert.equal(doctor.status, 1);
  assert.equal(JSON.parse(doctor.stdout).networkUsed, false);
});
test("CLI preview needs only account ID, creates no journal, and rejects execute/output combination", (t) => {
  const { dir, run } = setup(t);
  const input = JSON.stringify({
    batchId: "demo",
    items: [{ id: "one", request }],
  });
  writeFileSync(join(dir, ".env"), "EPOST_USERNAME=preview-cli\n");
  const args = ["batch-reserve", "-", "--preview", "--env-file", ".env"];
  const output = run(args, { input });
  assert.equal(output.status, 0, output.stderr);
  const preview = JSON.parse(output.stdout);
  assert.equal(preview.mode, "preview");
  assert.equal(preview.journalExists, false);
  assert.equal(preview.items[0].state, "new");
  assert.equal(existsSync(join(dir, ".epost")), false);
  assert.equal(run([...args, "--execute"], { input }).status, 1);
  assert.equal(run([...args, "--output", "out.json"], { input }).status, 1);
  assert.equal(run(["batch-reserve", "-", "--preview"], { input }).status, 1);
});
test("CLI recovery and preview find uncertain work without changing existing journal bytes", async (t) => {
  const { dir, run } = setup(t);
  const path = join(dir, "journal.sqlite");
  const client = new EpostClient({
    journalPath: path,
    provider: {
      accountId: "preview-cli",
      reserve: async (_r, guard) => {
        await guard.beforeSubmit();
        throw new Error("private-input");
      },
    },
  });
  await assert.rejects(
    client.reserve(request, { idempotencyKey: "batch:reserve:demo:one" }),
  );
  client.close();
  const before = readFileSync(path);
  writeFileSync(join(dir, ".env"), "EPOST_USERNAME=preview-cli\n");
  const flags = ["--env-file", ".env", "--journal", path];
  const recovery = run(["recovery", ...flags]);
  assert.equal(recovery.status, 0, recovery.stderr);
  assert.equal(
    JSON.parse(recovery.stdout).items[0].action,
    "verify-with-korea-post",
  );
  const preview = run(["batch-reserve", "-", "--preview", ...flags], {
    input: JSON.stringify({ batchId: "demo", items: [{ id: "one", request }] }),
  });
  assert.equal(preview.status, 3, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).items[0].state, "needs-review");
  assert.deepEqual(readFileSync(path), before);
  assert.ok(!recovery.stdout.includes("private-input"));
});
