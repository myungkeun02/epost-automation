# epost-automation

[한국어](README.md) · [Recovery](docs/recovery.md) · [Design](docs/design.md)

An unofficial Node.js library and CLI for Korea Post prepaid pickup reservations, reservation lookup, and full cancellation. Framework-independent JavaScript with TypeScript declarations; no build step.

**Experimental 0.1:** tested with unit tests and synthetic Chromium fixtures. This extracted public version has not been verified against a live reservation/payment/cancellation. Site changes may require adapter updates.

## Quick start

Requires Node.js 22.14+. Node 22 may show an experimental SQLite warning.

```sh
git clone https://github.com/myungkeun02/epost-automation.git
cd epost-automation
npm ci
node bin/epost.js validate examples/reservation.json
npm run browser:install
cp .env.example .env
```

Edit `.env` locally. Never commit credentials or real recipient data. `examples/` contains synthetic contacts and dates. `validate` is offline and checks structure, not address existence or actual pickup availability.

```sh
node --env-file=.env bin/epost.js options
node bin/epost.js reserve request.local.json --key order-001
node --env-file=.env bin/epost.js reserve request.local.json --key order-001 --execute
node --env-file=.env bin/epost.js lookup YOUR_RESERVATION_NUMBER
node --env-file=.env bin/epost.js cancel cancel.local.json --key cancel-001 --execute
```

Choose weight, size, contents, and pickup-location codes from `options`; sample codes are not shipping advice. An explicit unavailable pickup date/time is rejected. Without a time interval, the first available interval on the requested day is selected. `--headed` shows the browser. `EPOST_BROWSER_PATH` selects an existing Chrome/Chromium executable. Production sessions enable Chromium sandbox; Linux containers need a non-root environment with sandbox support.

CLI reservation/cancellation commands default to offline validation. `--execute` performs the action. Exit code 3 means **outcome unknown — reconcile, do not resubmit**. Lookup/cancellation need login credentials only; reservation also needs the four card fields documented in `.env.example`.

## Library

Not yet published to the npm registry. Install from GitHub:

```sh
npm install github:myungkeun02/epost-automation
npx playwright-core install chromium
```

```js
import { EpostClient, KoreaPostWeb } from "@myungkeun02/epost-automation";
const client = new EpostClient({
  journalPath: "./.epost/operations.sqlite",
  provider: new KoreaPostWeb({ credentials }),
});
try {
  const reservation = await client.reserve(request, {
    idempotencyKey: "order-001",
  });
  console.log(reservation.reservationNumber);
} finally {
  client.close();
}
```

Supply `credentials` and `request` using the schemas in [the Korean guide](README.md), `.env.example` and `examples/reservation.json`. Library mutations execute immediately; use `validateReservation`/`validateCancellation` for offline validation. Credentials can be loaded with an async callback when `username` is supplied separately.

## Reliability model

- Durable idempotency keys and payload fingerprints; conflicting requests are rejected.
- Account-level SQLite locks serialize mutation and read sessions on one host.
- A committed local barrier precedes draft writes, card checks, and final submission.
- Uncertain outcomes retain the lock, with no automatic retry or timeout-based unlock.
- Cancellation succeeds only when the reservation's remaining parcel count is verified as zero. Blank counters are unknown. Partial cancellation is rejected.
- Existing website drafts are preserved and require manual attention.
- Results contain no raw HTML, addresses, credentials, or cookies. Journal rows include hashes, statuses, reservation identifiers, timestamps, and manual-recovery audit events.

These guarantees require every worker for an account to use the **same persistent local journal**. Separate databases, other hosts, manual website use, and other tools are outside the lock. SQLite on NFS/shared network filesystems is unsupported. External website mutations and local persistence are not one atomic transaction; exactly-once delivery is not promised. Do not delete a journal to clear an uncertain operation.

One physical parcel per reservation. Prepaid website flow only. No shipment event tracking, contract API, cash-on-delivery, batch shipping, partial cancellation, or receipt delivery. Additional authentication is not bypassed.

## Recovery

Inspect `operation YOUR_KEY`, stop the original process and browser, and verify the reservation in Korea Post. Never guess that a timed-out request failed.

```sh
# Only after manually matching the real reservation to the original request:
node --env-file=.env bin/epost.js resolve YOUR_KEY --result verified-result.local.json --verified
# Or, only after confirming that nothing was submitted:
node --env-file=.env bin/epost.js resolve YOUR_KEY --not-submitted --verified
```

The result file has `{ "reservationNumber": "...", "trackingNumber": null, "status": "reserved" }` (or `"canceled"` for cancellation). This is an operator attestation, not automatic matching. Mutation keys remain consumed; a verified non-submission can be attempted with a new key. Live owners of interrupted running/submitted operations cannot be unlocked.

## Development

```sh
npm run check
EPOST_TEST_BROWSER=1 npm test
```

Browser tests explicitly disable network access and serve synthetic HTML/XML. See [contribution guidance](CONTRIBUTING.md), [security policy](SECURITY.md), and [MIT license](LICENSE). This project is not affiliated with Korea Post.
