import { EpostError } from "./errors.js";

function invalid(field) {
  throw new EpostError("VALIDATION", { field });
}
function record(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(field);
  return value;
}
function string(value, field, max = 200, optional = false) {
  if (optional && value === undefined) return "";
  if (typeof value !== "string") invalid(field);
  const result = value.trim();
  if (
    (!optional && !result) ||
    result.length > max ||
    /[\u0000-\u001f\u007f]/.test(result)
  )
    invalid(field);
  return result;
}
function phone(value, field) {
  const input = string(value, field, 20);
  if (!/^[0-9 -]+$/.test(input)) invalid(field);
  const digits = input.replace(/[ -]/g, "");
  if (
    !/^(?:02\d{7,8}|0[3-6][1-5]\d{7,8}|01[016789]\d{7,8}|070\d{8}|050\d{8,9})$/.test(
      digits,
    )
  )
    invalid(field);
  return digits;
}
function contact(value, field) {
  const v = record(value, field);
  const zipCode = string(v.zipCode, `${field}.zipCode`, 5);
  if (!/^\d{5}$/.test(zipCode)) invalid(`${field}.zipCode`);
  return {
    name: string(v.name, `${field}.name`, 40),
    phone: phone(v.phone, `${field}.phone`),
    zipCode,
    address: string(v.address, `${field}.address`, 200),
    detailAddress: string(v.detailAddress, `${field}.detailAddress`, 100, true),
  };
}

export function validateReservation(
  value,
  { now = new Date(), allowPast = false } = {},
) {
  const v = record(value, "request");
  const date = string(v.pickupDate, "pickupDate", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid("pickupDate");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    invalid("pickupDate");
  const todayInKorea = new Date(now.getTime() + 9 * 3600_000)
    .toISOString()
    .slice(0, 10);
  if (!allowPast && date <= todayInKorea) invalid("pickupDate");
  const p = record(v.parcel, "parcel");
  // One reservation represents exactly one physical parcel. Do not silently
  // ignore quantities or infer size/contents from a previous site's selection.
  if (p.quantity !== undefined && p.quantity !== 1) invalid("parcel.quantity");
  const code = (value, field) => {
    const output = string(value, field, 3);
    if (!/^\d{2,3}$/.test(output)) invalid(field);
    return output;
  };
  const pickup = v.pickup === undefined ? {} : record(v.pickup, "pickup");
  const timeInterval = string(
    pickup.timeInterval ?? "",
    "pickup.timeInterval",
    8,
    true,
  );
  if (timeInterval && !/^\d{8}$/.test(timeInterval))
    invalid("pickup.timeInterval");
  return {
    pickupDate: date,
    sender: contact(v.sender, "sender"),
    recipient: contact(v.recipient, "recipient"),
    parcel: {
      description: string(p.description, "parcel.description", 100),
      quantity: 1,
      weightCode: code(p.weightCode, "parcel.weightCode"),
      sizeCode: code(p.sizeCode, "parcel.sizeCode"),
      contentCode: code(p.contentCode, "parcel.contentCode"),
    },
    pickup: {
      locationCode: code(pickup.locationCode ?? "01", "pickup.locationCode"),
      locationDescription: string(
        pickup.locationDescription ?? "문 앞",
        "pickup.locationDescription",
        100,
      ),
      timeInterval,
    },
    memo: string(v.memo, "memo", 100, true),
  };
}

export function validateReservationNumber(value) {
  const result = string(value, "reservationNumber", 40);
  if (!/^\d{8}[A-Za-z0-9-]{1,32}$/.test(result)) invalid("reservationNumber");
  return result;
}
export function validateCancellation(value) {
  const v = record(value, "request");
  return {
    reservationNumber: validateReservationNumber(v.reservationNumber),
    recipientPhone: phone(v.recipientPhone, "recipientPhone"),
  };
}
export function validateKey(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  )
    invalid("idempotencyKey");
  return value;
}
export function validateCredentials(value, needsPayment = false) {
  const v = record(value, "credentials");
  const username = string(v.username, "credentials.username", 100);
  // Password whitespace may be intentional.
  if (
    typeof v.password !== "string" ||
    !v.password.length ||
    v.password.length > 256
  )
    invalid("credentials.password");
  const out = { username, password: v.password };
  if (!needsPayment) return out;
  const c = record(v.card, "credentials.card");
  const digits = (value, field, pattern) => {
    if (typeof value !== "string" || !pattern.test(value)) invalid(field);
    return value;
  };
  out.card = {
    number: digits(c.number, "credentials.card.number", /^\d{16}$/),
    expiry: digits(
      c.expiry,
      "credentials.card.expiry",
      /^(0[1-9]|1[0-2])\d{2}$/,
    ),
    passwordPrefix: digits(
      c.passwordPrefix,
      "credentials.card.passwordPrefix",
      /^\d{2}$/,
    ),
    identity: digits(
      c.identity,
      "credentials.card.identity",
      /^(?:\d{6}|\d{10})$/,
    ),
  };
  return out;
}

export function validateResult(value, expectedNumber, expectedStatus) {
  if (!value || typeof value !== "object")
    throw new EpostError("PROVIDER_FAILURE");
  const reservationNumber = validateReservationNumber(value.reservationNumber);
  if (expectedNumber && reservationNumber !== expectedNumber)
    throw new EpostError("PROVIDER_FAILURE");
  if (
    !["reserved", "canceled", "unknown"].includes(value.status) ||
    (expectedStatus && value.status !== expectedStatus)
  )
    throw new EpostError("PROVIDER_FAILURE");
  if (
    value.trackingNumber != null &&
    (typeof value.trackingNumber !== "string" ||
      !/^\d{13}$/.test(value.trackingNumber))
  )
    throw new EpostError("PROVIDER_FAILURE");
  return {
    reservationNumber,
    status: value.status,
    trackingNumber: value.trackingNumber ?? null,
  };
}
