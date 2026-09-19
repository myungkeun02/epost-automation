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
const bin = new URL("../bin/epost.js", import.meta.url).pathname;
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
