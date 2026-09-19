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
