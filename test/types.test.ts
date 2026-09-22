import {
  EpostClient,
  KoreaPostWeb,
  SqliteOperationStore,
  validateReservation,
  type EpostProvider,
  type ReservationInput,
} from "../src/index.js";
const provider: EpostProvider = new KoreaPostWeb({
  username: "demo",
  credentials: async () => ({ username: "demo", password: "example" }),
});
const store = new SqliteOperationStore("test.sqlite");
const client = new EpostClient({ provider, store });
const input: ReservationInput = validateReservation({});
void client.reserve(input, { idempotencyKey: "one" });
void client.cancel(
  { reservationNumber: "2099010200000000", recipientPhone: "01000000000" },
  { idempotencyKey: "cancel" },
);
void client.lookup("2099010200000000");
void client.options();
// @ts-expect-error idempotency key is required
void client.reserve(input);
// @ts-expect-error batch quantities are intentionally unsupported
input.parcel.quantity = 2;
// @ts-expect-error manual recovery requires explicit verification
client.resolveOperation("one", { outcome: "not-submitted" });
client.close();
store.close();

void client.reserveMany([{ id: "order-001", request: input }], {
  batchId: "shipment-001",
  retryFailed: true,
  onProgress: (report) => {
    const count: number = report.summary.succeeded;
    void count;
  },
});
void client.cancelMany(
  [
    {
      id: "cancel-001",
      request: {
        reservationNumber: "2099010200000000",
        recipientPhone: "01000000000",
      },
    },
  ],
  { batchId: "cancel-run" },
);
void client.lookupMany(
  [{ id: "one", request: { reservationNumber: "2099010200000000" } }],
  { batchId: "lookup-run" },
);
client.listOperations({ status: "unknown", limit: 10 });
// @ts-expect-error batch IDs are required
void client.reserveMany([{ id: "one", request: input }], {});
const preview = client.previewBatch(
  "reserve",
  [{ id: "one", request: input }],
  { batchId: "demo" },
);
const ready: boolean = preview.ready;
void ready;
client.previewBatch(
  "lookup",
  [{ id: "one", request: { reservationNumber: "2099010200000000" } }],
  { batchId: "demo" },
);
client.getRecoveryGuide({ key: "one", limit: 20 });
const inspectionStore = new SqliteOperationStore("test.sqlite", {
  readOnly: true,
});
new EpostClient({
  provider: { accountId: "inspection-only" },
  store: inspectionStore,
});
inspectionStore.inspectBatch("account", [
  { key: "one", kind: "reserve", fingerprint: "hash" },
]);
// @ts-expect-error lookup requires a reservation number
client.previewBatch("lookup", [{ id: "one", request: input }], {
  batchId: "demo",
});
// @ts-expect-error preview batch ID is required
client.previewBatch("reserve", [{ id: "one", request: input }], {});
