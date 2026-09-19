# epost-automation

[한국어](README.md) · [Documentation](docs/README.md) · [CLI reference](docs/cli.md) · [API reference](docs/api.md)

Unofficial Korea Post prepaid pickup reservation automation for Node.js 22.14+. An ESM SDK and CLI with TypeScript declarations, durable operation records and sequential CSV/JSON batches.

**Experimental 0.2.** The extracted public package has not yet been validated against a live Korea Post account/payment flow. Tests use synthetic inputs and offline browser fixtures. This is not an official Korea Post API or an npm registry release.

## What it supports

- Single and batch pickup reservations, reservation status lookup and full cancellation.
- Up to 1,000 rows per batch, Korean/English CSV columns and shared sender/parcel defaults.
- All-row preflight validation, terminal progress and JSON/CSV result reports.
- Resume with stable batch/item IDs: successful mutations replay their stored result.
- Explicit retry of a failed operation only when no external submission occurred or an operator verified non-submission. Uncertain outcomes always require reconciliation.
- Local setup diagnostics, project templates, operation history and audited manual recovery.

Each parcel is a separate reservation. A batch is sequential and is not atomic; earlier successful reservations remain if a later row fails. Multi-parcel reservations, partial cancellation, distributed deployments and delivery tracking events are outside the current scope.

## Try without contacting Korea Post

```sh
git clone https://github.com/myungkeun02/epost-automation.git
cd epost-automation
npm ci
node bin/epost.js batch-reserve examples/batch-reservations.json
node bin/epost.js batch-reserve examples/shipments.csv --config examples/config.json --batch-id demo-csv
node bin/epost.js batch-cancel examples/cancellations.csv --batch-id demo-cancel
```

Without `--execute`, mutation and batch commands only validate the input. `lookup` and `options` contact the site immediately. Validation does not establish address deliverability, pickup availability, card validity or live compatibility.

## Set up real inputs

```sh
npm run browser:install
node bin/epost.js init --dir my-shipping
```

Edit the generated `config.local.json` (sender, pickup date and parcel codes), `.env` (credentials) and `shipments.local.csv` (recipients). All shipped inputs are fictitious. Save CSV as UTF-8 and keep phone numbers, postal codes and codes as text to preserve leading zeroes.

```sh
node bin/epost.js doctor --env-file my-shipping/.env --config my-shipping/config.local.json --payment
node bin/epost.js batch-reserve my-shipping/shipments.local.csv --config my-shipping/config.local.json --batch-id shipment-001
```

`doctor` checks local installation and credential format only; it does not log in or verify payment. To inspect current form codes, run `options --env-file my-shipping/.env`. An existing Chrome/Chromium executable can be selected with `EPOST_BROWSER_PATH`.

After reviewing your actual inputs, execute:

```sh
node bin/epost.js batch-reserve my-shipping/shipments.local.csv --env-file my-shipping/.env --config my-shipping/config.local.json --batch-id shipment-001 --output my-shipping/result.local.csv --execute
```

Keep the same journal, batch ID, item IDs and payload when resuming. Changing keys or deleting the journal can create duplicate reservations. A first Ctrl+C finishes and records the current item before stopping; a second forces termination. `--continue-on-error` skips only safe item-level errors, never unknown outcomes, account locks or storage failures. `--retry-failed` explicitly permits retrying matching `failed` records; it cannot retry `unknown`, `running` or `submitted` records.

Result reports omit contact/card data but include operational IDs and reservation references. Keep inputs, reports, `.env` and journal files private. The journal is the source of operation state if a report could not be saved.

## SDK

Install this GitHub repository as a dependency, pinned to a reviewed tag or commit. Import `EpostClient`, `KoreaPostWeb`, `parseBatchInput` and validators from `@myungkeun02/epost-automation`. The [complete SDK example](examples/use-sdk.mjs), [batch example and API reference](docs/api.md) and [TypeScript declarations](src/index.d.ts) describe the interfaces.

The package exposes `reserveMany`, `cancelMany`, `lookupMany` in addition to single-item methods. Batch progress callbacks receive independent snapshots; an `AbortSignal` stops between items. The browser process is reused within a batch, with a fresh logged-in context for each item.

## Documentation and verification

The detailed guides are currently in Korean:

- [Getting started](docs/getting-started.md), [CSV/JSON formats and resume](docs/batch.md)
- [CLI commands and exit codes](docs/cli.md), [SDK API](docs/api.md)
- [Unknown outcomes and recovery](docs/recovery.md), [transaction boundaries](docs/design.md)
- [Upgrading from 0.1](docs/migration.md): existing single-item keys differ from batch keys; do not batch already-completed orders.

```sh
npm run check
npm run browser:install
EPOST_TEST_BROWSER=1 node --test test/browser.test.js
```

CI verifies Node.js 22.14 and 24, offline browser fixtures, package contents, dependency audit and repository secret scanning. No real credentials or customer data are used. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [MIT license](LICENSE).
