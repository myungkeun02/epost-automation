import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  stat,
  readdir,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { parseBatchInput, validateBatch } from "../src/index.js";
import {
  serializeReport,
  writeReport,
  assertOutputPath,
  initializeDirectory,
  readInput,
  loadConfig,
} from "../src/cli-files.js";
import { diagnose } from "../src/doctor.js";
const request = JSON.parse(
  await readFile(new URL("../examples/reservation.json", import.meta.url)),
);
const defaults = {
  pickupDate: request.pickupDate,
  sender: request.sender,
  parcel: request.parcel,
};
test("Korean BOM/CRLF CSV preserves leading zeros, commas and escaped quotes", () => {
  const text =
    '\uFEFF작업ID,받는분,받는분전화,받는분우편번호,받는분주소\r\none,"테스트 ""수취인""",01000000001,00000,"테스트로 1, 2층"\r\n';
  const { items } = parseBatchInput(text, { format: "csv", defaults });
  const rows = validateBatch("reserve", items, { batchId: "test" });
  assert.equal(rows[0].request.recipient.zipCode, "00000");
  assert.equal(rows[0].request.recipient.phone, "01000000001");
  assert.equal(rows[0].request.recipient.name, '테스트 "수취인"');
  assert.equal(rows[0].request.recipient.address, "테스트로 1, 2층");
});
test("duplicate, unknown, prototype and wrong-command headers fail closed", () => {
  for (const header of [
    "id,id",
    "id,작업ID",
    "id,__proto__",
    "id,recipient.adress",
    "id,reservationNumber",
  ])
    assert.throws(() => parseBatchInput(`${header}\na,b`, { format: "csv" }), {
      code: "INPUT_FILE",
    });
  assert.throws(
    () =>
      parseBatchInput("id,recipient.name\na,b", {
        format: "csv",
        kind: "cancel",
      }),
    { code: "INPUT_FILE" },
  );
});
test("parser errors never include the invalid original row", () => {
  assert.throws(
    () =>
      parseBatchInput('id,reservationNumber\none,"private-recipient', {
        format: "csv",
        kind: "lookup",
      }),
    (e) => {
      assert.equal(e.code, "INPUT_FILE");
      assert.ok(!JSON.stringify(e).includes("private-recipient"));
      return true;
    },
  );
});
test("defaults merge per nested field; row values override common configuration", () => {
  const batch = parseBatchInput(
    JSON.stringify({
      batchId: "demo",
      defaults: { parcel: { description: "공통 물품" } },
      items: [
        {
          id: "one",
          request: {
            recipient: request.recipient,
            parcel: { description: "개별 물품" },
          },
        },
      ],
    }),
    { defaults },
  );
  const checked = validateBatch("reserve", batch.items, {
    batchId: batch.batchId,
  });
  assert.equal(checked[0].request.parcel.description, "개별 물품");
  assert.equal(checked[0].request.parcel.weightCode, "02");
});
test("size caps, invalid UTF-8 and non-JSON input are rejected", async () => {
  assert.throws(() => parseBatchInput("x".repeat(2 * 1024 * 1024 + 1)), {
    code: "INPUT_FILE",
  });
  await assert.rejects(
    readInput("-", Readable.from([Buffer.from([0xff, 0xfe])])),
    { code: "INPUT_FILE" },
  );
  assert.throws(() => parseBatchInput("not-json"), { code: "INPUT_FILE" });
});
test("result CSV escapes spreadsheet formula cells and omits contact fields", () => {
  const report = {
    batchId: "example",
    kind: "reserve",
    status: "completed",
    items: [
      {
        id: "=SUM(1,2)",
        key: "+danger",
        status: "succeeded",
        result: { reservationNumber: "2099010200000000", status: "reserved" },
        request,
      },
    ],
  };
  const csv = serializeReport(report, "csv");
  assert.ok(csv.includes("'=SUM"));
  assert.ok(csv.includes("'+danger"));
  assert.ok(!csv.includes(request.sender.address));
});
test("atomic reports are private files and cannot overwrite known inputs", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "epost-reports-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "report.json");
  const report = { items: [], status: "running" };
  await writeReport(path, report);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), report);
  if (process.platform !== "win32")
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(assertOutputPath(path, [path]), { code: "OUTPUT_FILE" });
  await assert.rejects(assertOutputPath(join(dir, "journal.sqlite")), {
    code: "OUTPUT_FILE",
  });
  assert.deepEqual(await readdir(dir), ["report.json"]);
  await symlink(
    dir,
    join(dir, "alias"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    assertOutputPath(join(dir, "alias/report.json"), [path]),
    {
      code: "OUTPUT_FILE",
    },
  );
});
test("initializer never overwrites existing files and produces usable dry-run inputs", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "epost-init-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, "new");
  await initializeDirectory(target);
  await assert.rejects(initializeDirectory(target), { code: "OUTPUT_FILE" });
  const config = await loadConfig(join(target, "config.local.json"));
  assert.equal(config.journalPath, join(target, ".epost/operations.sqlite"));
  const batch = parseBatchInput(
    await readInput(join(target, "shipments.local.csv")),
    { format: "csv", defaults: config.defaults },
  );
  assert.equal(
    validateBatch("reserve", batch.items, { batchId: "init" }).length,
    1,
  );
});
test("doctor performs no network action, exposes no credentials and creates no journal", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "epost-doctor-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const report = await diagnose({
    env: {
      EPOST_USERNAME: "secret-username",
      EPOST_PASSWORD: "secret-password",
      EPOST_BROWSER_PATH: "/missing-browser",
    },
    payment: true,
    journalPath: join(dir, "nested/db.sqlite"),
  });
  assert.equal(report.networkUsed, false);
  assert.equal(report.ok, false);
  assert.ok(!JSON.stringify(report).includes("secret-"));
  assert.deepEqual(await readdir(dir), []);
});
