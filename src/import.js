import { parse } from "csv-parse/sync";
import { EpostError } from "./errors.js";

export const csvFields = {
  id: "작업ID",
  pickupDate: "방문일",
  "sender.name": "보내는분",
  "sender.phone": "보내는분전화",
  "sender.zipCode": "보내는분우편번호",
  "sender.address": "보내는분주소",
  "sender.detailAddress": "보내는분상세주소",
  "recipient.name": "받는분",
  "recipient.phone": "받는분전화",
  "recipient.zipCode": "받는분우편번호",
  "recipient.address": "받는분주소",
  "recipient.detailAddress": "받는분상세주소",
  "parcel.description": "품목명",
  "parcel.weightCode": "중량코드",
  "parcel.sizeCode": "크기코드",
  "parcel.contentCode": "내용품코드",
  "pickup.locationCode": "보관장소코드",
  "pickup.locationDescription": "보관장소",
  "pickup.timeInterval": "방문시간대",
  memo: "요청사항",
  reservationNumber: "예약번호",
  recipientPhone: "확인전화",
};
const objects = new Set(["sender", "recipient", "parcel", "pickup"]);
const lookupFields = new Set(["id", "reservationNumber"]);
const cancelFields = new Set([...lookupFields, "recipientPhone"]);
const aliases = new Map(
  Object.entries(csvFields).flatMap(([key, name]) => [
    [key, key],
    [name, key],
  ]),
);
function assertObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new EpostError("VALIDATION", { field });
}
export function mergeDefaults(defaults, request) {
  assertObject(defaults, "defaults");
  assertObject(request, "request");
  const merged = { ...defaults, ...request };
  for (const key of objects) {
    if (request[key] === undefined && defaults[key] === undefined) continue;
    if (request[key] !== undefined) assertObject(request[key], key);
    if (defaults[key] !== undefined)
      assertObject(defaults[key], `defaults.${key}`);
    merged[key] = { ...defaults[key], ...request[key] };
  }
  return merged;
}

/** Values stay strings, preserving leading zeroes in postal/phone/code fields. */
export function parseBatchInput(
  text,
  { format = "json", kind = "reserve", defaults = {} } = {},
) {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024 ||
    !["reserve", "cancel", "lookup"].includes(kind)
  )
    throw new EpostError("INPUT_FILE");
  try {
    if (format === "json") {
      const data = JSON.parse(text.replace(/^\uFEFF/, ""));
      const rows = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(rows) || rows.length > 1000)
        throw new EpostError("INPUT_FILE");
      const common =
        kind === "reserve"
          ? mergeDefaults(
              defaults,
              Array.isArray(data) ? {} : (data.defaults ?? {}),
            )
          : {};
      return {
        batchId: Array.isArray(data) ? undefined : data.batchId,
        items: rows.map((row) => ({
          id: row?.id,
          request:
            kind === "reserve"
              ? mergeDefaults(common, row?.request ?? {})
              : row?.request,
        })),
      };
    }
    if (format !== "csv") throw new EpostError("INPUT_FILE");
    const rows = parse(text, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      cast: false,
      max_record_size: 16_384,
      columns(headers) {
        const names = headers.map((header) => aliases.get(header));
        if (
          names.some((name) => !name) ||
          new Set(names).size !== names.length ||
          !names.includes("id") ||
          (kind === "lookup" &&
            names.some((name) => !lookupFields.has(name))) ||
          (kind === "cancel" &&
            names.some((name) => !cancelFields.has(name))) ||
          (kind === "reserve" &&
            names.some((name) =>
              ["reservationNumber", "recipientPhone"].includes(name),
            ))
        )
          throw new EpostError("INPUT_FILE", { field: "csv.headers" });
        return names;
      },
    });
    if (rows.length > 1000) throw new EpostError("INPUT_FILE");
    return {
      items: rows.map((row) => {
        const request = {};
        for (const [path, value] of Object.entries(row)) {
          if (path === "id" || value === "") continue;
          const [group, field] = path.split(".");
          if (field) {
            request[group] ??= {};
            request[group][field] = value;
          } else request[group] = value;
        }
        return {
          id: row.id,
          request:
            kind === "reserve" ? mergeDefaults(defaults, request) : request,
        };
      }),
    };
  } catch (error) {
    if (error instanceof EpostError) throw error;
    // CSV parser errors may include the full recipient record. Never forward.
    throw new EpostError("INPUT_FILE");
  }
}
