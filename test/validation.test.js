import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateReservation, validateCancellation } from "../src/index.js";
import { validateCredentials } from "../src/validation.js";
const request = JSON.parse(
  readFileSync(new URL("../examples/reservation.json", import.meta.url)),
);
test("dates use Korea time and reject impossible calendar dates", () => {
  for (const pickupDate of [
    "2099-02-29",
    "2099-04-31",
    "2026-09-19",
    "2026-09-20",
  ]) {
    assert.throws(
      () =>
        validateReservation(
          { ...request, pickupDate },
          { now: new Date("2026-09-19T15:01:00Z") },
        ),
      { code: "VALIDATION" },
    );
  }
  assert.equal(
    validateReservation(
      { ...request, pickupDate: "2026-09-21" },
      { now: new Date("2026-09-19T15:01:00Z") },
    ).pickupDate,
    "2026-09-21",
  );
});
test("single parcel only, no silently ignored batch quantity", () => {
  for (const quantity of [0, 2, -1, "1", null])
    assert.throws(
      () =>
        validateReservation({
          ...request,
          parcel: { ...request.parcel, quantity },
        }),
      { code: "VALIDATION" },
    );
});
test("malformed phone and postal data are not repaired into someone else’s data", () => {
  for (const phone of [
    "+82 10 1234 5678",
    "abc01012345678",
    "123",
    "010\n00000000",
  ])
    assert.throws(
      () =>
        validateReservation({
          ...request,
          sender: { ...request.sender, phone },
        }),
      { code: "VALIDATION" },
    );
  assert.equal(
    validateReservation({
      ...request,
      sender: { ...request.sender, phone: "02-000-0000" },
    }).sender.phone,
    "020000000",
  );
  assert.throws(
    () =>
      validateReservation({
        ...request,
        sender: { ...request.sender, zipCode: "1234" },
      }),
    { code: "VALIDATION" },
  );
});
test("lookup/cancel do not require payment credentials", () => {
  assert.deepEqual(
    validateCredentials({ username: "test", password: " pass " }),
    { username: "test", password: " pass " },
  );
  assert.throws(
    () => validateCredentials({ username: "test", password: "pass" }, true),
    { code: "VALIDATION" },
  );
});
test("card values are strings and expiry is MMYY", () => {
  const value = {
    username: "test",
    password: "pass",
    card: {
      number: "0000000000000000",
      expiry: "1299",
      passwordPrefix: "00",
      identity: "000000",
    },
  };
  assert.equal(validateCredentials(value, true).card.expiry, "1299");
  for (const expiry of ["1399", "0099", "9912", 1299])
    assert.throws(
      () =>
        validateCredentials(
          { ...value, card: { ...value.card, expiry } },
          true,
        ),
      { code: "VALIDATION" },
    );
});
test("reservation identity cannot contain URL fragments or path traversal", () => {
  for (const reservationNumber of [
    "../../secret",
    "https://example.com/",
    "20990102?id=1",
    "",
  ])
    assert.throws(
      () =>
        validateCancellation({
          reservationNumber,
          recipientPhone: "01000000001",
        }),
      { code: "VALIDATION" },
    );
});
test("CLI dry-run needs no credentials, browser or journal and prints no contact data", () => {
  const dir = mkdtempSync(join(tmpdir(), "epost-cli-"));
  try {
    const child = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../bin/epost.js", import.meta.url)),
        "reserve",
        fileURLToPath(new URL("../examples/reservation.json", import.meta.url)),
      ],
      { cwd: dir, env: { PATH: process.env.PATH }, encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout).mode, "dry-run");
    assert.ok(!child.stdout.includes(request.sender.name));
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
