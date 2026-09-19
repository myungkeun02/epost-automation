export type ErrorCode =
  | "VALIDATION"
  | "ACCOUNT_BUSY"
  | "KEY_CONFLICT"
  | "OPERATION_FAILED"
  | "OUTCOME_UNKNOWN"
  | "PROVIDER_FAILURE"
  | "AUTHENTICATION"
  | "NOT_FOUND"
  | "NOT_CANCELABLE"
  | "EXISTING_DRAFT"
  | "STORAGE"
  | "RECOVERY_REQUIRED";
export class EpostError extends Error {
  readonly code: ErrorCode;
  readonly operationId?: string;
  readonly field?: string;
  constructor(
    code: ErrorCode,
    details?: { operationId?: string; field?: string },
  );
  toJSON(): {
    name: string;
    code: ErrorCode;
    message: string;
    operationId?: string;
    field?: string;
  };
}
export interface Contact {
  name: string;
  phone: string;
  zipCode: string;
  address: string;
  detailAddress?: string;
}
export interface ReservationInput {
  pickupDate: string;
  sender: Contact;
  recipient: Contact;
  parcel: {
    description: string;
    quantity?: 1;
    weightCode: string;
    sizeCode: string;
    contentCode: string;
  };
  pickup?: {
    locationCode?: string;
    locationDescription?: string;
    timeInterval?: string;
  };
  memo?: string;
}
export interface NormalizedReservation extends ReservationInput {
  sender: Required<Contact>;
  recipient: Required<Contact>;
  parcel: Required<ReservationInput["parcel"]>;
  pickup: Required<NonNullable<ReservationInput["pickup"]>>;
  memo: string;
}
export interface CancellationInput {
  reservationNumber: string;
  recipientPhone: string;
}
export interface Reservation {
  reservationNumber: string;
  trackingNumber: string | null;
  status: "reserved" | "canceled" | "unknown";
}
export interface OperationResult extends Reservation {
  operationId: string;
  replayed: boolean;
}
export interface Operation {
  id: string;
  kind: "reserve" | "cancel";
  status: "running" | "submitted" | "succeeded" | "failed" | "unknown";
  result: Reservation | null;
  errorCode: ErrorCode | null;
  target: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface SubmissionGuard {
  beforeSubmit(): Promise<void>;
}
export interface FormOptions {
  weights: FormOption[];
  sizes: FormOption[];
  contents: FormOption[];
  pickupLocations: FormOption[];
}
export interface FormOption {
  code: string;
  label: string;
}
/** A provider MUST await beforeSubmit before its first external mutation and never retry submissions. */
export interface EpostProvider {
  readonly accountId: string;
  reserve(
    request: NormalizedReservation,
    guard: SubmissionGuard,
  ): Promise<Reservation>;
  cancel(
    request: CancellationInput,
    guard: SubmissionGuard,
  ): Promise<Reservation>;
  lookup(reservationNumber: string): Promise<Reservation>;
  options?(): Promise<FormOptions>;
}
export interface ManualResolution {
  outcome: "succeeded" | "not-submitted";
  result?: Reservation;
  confirmedProcessStopped: true;
  verifiedWithKoreaPost: true;
}
/** Synchronous, durable and atomic store contract. Locks have no automatic expiration. */
export interface OperationStore {
  get(account: string, key: string): Operation | null;
  beginRead(account: string): string;
  endRead(account: string, token: string): void;
  claim(
    account: string,
    key: string,
    kind: Operation["kind"],
    fingerprint: string,
    target?: string,
  ): { claimed: boolean; operation: Operation };
  markSubmitted(id: string): void;
  finish(
    id: string,
    status: "succeeded" | "failed" | "unknown",
    details?: { result?: Reservation | null; errorCode?: ErrorCode | null },
  ): void;
  resolve(
    account: string,
    key: string,
    resolution: ManualResolution,
  ): Operation;
  close(): void;
}
export class SqliteOperationStore implements OperationStore {
  constructor(path?: string);
  get: OperationStore["get"];
  claim: OperationStore["claim"];
  markSubmitted: OperationStore["markSubmitted"];
  beginRead: OperationStore["beginRead"];
  endRead: OperationStore["endRead"];
  finish: OperationStore["finish"];
  resolve: OperationStore["resolve"];
  close: OperationStore["close"];
}
export class EpostClient {
  constructor(options: {
    provider: EpostProvider;
    store?: OperationStore;
    journalPath?: string;
  });
  reserve(
    input: ReservationInput,
    options: { idempotencyKey: string },
  ): Promise<OperationResult>;
  cancel(
    input: CancellationInput,
    options: { idempotencyKey: string },
  ): Promise<OperationResult>;
  lookup(reservationNumber: string): Promise<Reservation>;
  options(): Promise<FormOptions>;
  getOperation(idempotencyKey: string): Operation | null;
  resolveOperation(
    idempotencyKey: string,
    resolution: ManualResolution,
  ): Operation;
  /** Closes only the default store owned by this client. Caller-owned stores must be closed by the caller. */
  close(): void;
}
export interface Credentials {
  username: string;
  password: string;
  card?: {
    number: string;
    expiry: string;
    passwordPrefix: string;
    identity: string;
  };
}
export type WebOptions = {
  headless?: boolean;
  executablePath?: string;
  timeoutMs?: number;
  operationTimeoutMs?: number;
} & (
  | { credentials: Credentials; username?: never }
  | { username: string; credentials: () => Credentials | Promise<Credentials> }
);
export class KoreaPostWeb implements EpostProvider {
  constructor(options: WebOptions);
  readonly accountId: string;
  reserve: EpostProvider["reserve"];
  cancel: EpostProvider["cancel"];
  lookup: EpostProvider["lookup"];
  options(): Promise<FormOptions>;
}
/** Offline structural/date validation; makes no browser or network calls. */
export function validateReservation(
  input: unknown,
  options?: { now?: Date },
): NormalizedReservation;
export function validateCancellation(input: unknown): CancellationInput;
