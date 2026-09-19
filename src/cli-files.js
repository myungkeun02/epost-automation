import {
  readFile,
  stat,
  open,
  rename,
  unlink,
  mkdir,
  access,
  realpath,
} from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname, extname, join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { stringify } from "csv-stringify/sync";
import { EpostError } from "./errors.js";

export async function readInput(path, input = process.stdin) {
  try {
    let bytes;
    if (path === "-") {
      const chunks = [];
      let length = 0;
      for await (const chunk of input) {
        const buffer = Buffer.from(chunk);
        length += buffer.length;
        if (length > 2 * 1024 * 1024) throw new EpostError("INPUT_FILE");
        chunks.push(buffer);
      }
      bytes = Buffer.concat(chunks);
    } else {
      if (!path || (await stat(path)).size > 2 * 1024 * 1024)
        throw new EpostError("INPUT_FILE");
      bytes = await readFile(path);
    }
    if (bytes.length > 2 * 1024 * 1024) throw new EpostError("INPUT_FILE");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new EpostError("INPUT_FILE");
  }
}
export async function readJSON(path) {
  try {
    return JSON.parse((await readInput(path)).replace(/^\uFEFF/, ""));
  } catch {
    throw new EpostError("INPUT_FILE");
  }
}
export async function loadConfig(path) {
  if (!path) return { defaults: {} };
  const config = await readJSON(path);
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    Object.keys(config).some(
      (key) => !["defaults", "journalPath"].includes(key),
    ) ||
    (config.defaults !== undefined &&
      (!config.defaults ||
        typeof config.defaults !== "object" ||
        Array.isArray(config.defaults))) ||
    (config.journalPath !== undefined && typeof config.journalPath !== "string")
  )
    throw new EpostError("VALIDATION", { field: "config" });
  return {
    defaults: config.defaults ?? {},
    journalPath: config.journalPath
      ? resolve(dirname(path), config.journalPath)
      : undefined,
  };
}
export function serializeReport(report, format = "json") {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format !== "csv" || !Array.isArray(report.items))
    throw new EpostError("OUTPUT_FILE");
  return stringify(
    report.items.map((item) => ({
      batchId: report.batchId,
      kind: report.kind,
      batchStatus: report.status,
      stopReason: report.stopReason ?? "",
      id: item.id,
      key: item.key,
      status: item.status,
      replayed: item.result?.replayed ?? "",
      reservationNumber: item.result?.reservationNumber ?? "",
      reservationStatus: item.result?.status ?? "",
      trackingNumber: item.result?.trackingNumber ?? "",
      operationId: item.result?.operationId ?? item.error?.operationId ?? "",
      errorCode: item.error?.code ?? "",
      field: item.error?.field ?? "",
    })),
    { header: true, bom: true, escape_formulas: true },
  );
}
async function canonicalPath(path) {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (error.code !== "ENOENT") throw new EpostError("OUTPUT_FILE");
    if (dirname(absolute) === absolute) return absolute;
    return join(await canonicalPath(dirname(absolute)), basename(absolute));
  }
}
export async function assertOutputPath(path, protectedPaths = []) {
  if (!path) return;
  if (![".json", ".csv"].includes(extname(path).toLowerCase()))
    throw new EpostError("OUTPUT_FILE");
  const target = await canonicalPath(path);
  for (const source of protectedPaths.filter((p) => p && p !== "-"))
    if ((await canonicalPath(source)) === target)
      throw new EpostError("OUTPUT_FILE");
}
export async function writeReport(path, report) {
  const target = resolve(path),
    temp = join(dirname(target), `.epost-report-${randomUUID()}.tmp`);
  let file;
  try {
    const content = serializeReport(
      report,
      extname(target).toLowerCase() === ".csv" ? "csv" : "json",
    );
    file = await open(temp, "wx", 0o600);
    await file.writeFile(content, "utf8");
    await file.sync();
    await file.close();
    file = null;
    await rename(temp, target);
  } catch {
    throw new EpostError("OUTPUT_FILE");
  } finally {
    await file?.close().catch(() => {});
    await unlink(temp).catch(() => {});
  }
}
export async function initializeDirectory(path) {
  const target = resolve(path);
  try {
    await mkdir(target, { mode: 0o700 });
  } catch {
    throw new EpostError("OUTPUT_FILE", { field: "newDirectory" });
  }
  const config = {
    journalPath: ".epost/operations.sqlite",
    defaults: {
      pickupDate: "2099-01-02",
      sender: {
        name: "발송인 예시",
        phone: "010-0000-0000",
        zipCode: "00000",
        address: "테스트시 예시로 1",
        detailAddress: "테스트 주소",
      },
      parcel: {
        description: "예시 물품",
        weightCode: "02",
        sizeCode: "02",
        contentCode: "023",
      },
    },
  };
  const files = {
    "config.local.json": `${JSON.stringify(config, null, 2)}\n`,
    ".env":
      "EPOST_USERNAME=\nEPOST_PASSWORD=\nEPOST_CARD_NUMBER=\nEPOST_CARD_EXPIRY=\nEPOST_CARD_PASSWORD_PREFIX=\nEPOST_CARD_IDENTITY=\n",
    "shipments.local.csv":
      "\uFEFF작업ID,받는분,받는분전화,받는분우편번호,받는분주소,받는분상세주소\norder-001,수취인 예시,010-0000-0001,00000,테스트시 예시로 2,테스트 주소\n",
    "cancellations.local.csv":
      "\uFEFF작업ID,예약번호,확인전화\ncancel-001,2099010200000000,010-0000-0001\n",
    ".gitignore": ".env\n.epost/\n*.local.*\nreports/\n",
  };
  try {
    for (const [name, body] of Object.entries(files)) {
      const handle = await open(join(target, name), "wx", 0o600);
      try {
        await handle.writeFile(body, "utf8");
      } finally {
        await handle.close();
      }
    }
  } catch {
    throw new EpostError("OUTPUT_FILE");
  }
  return {
    directory: target,
    files: Object.keys(files),
    next: "가상 발송정보와 날짜를 수정한 뒤 doctor 및 batch-reserve 입력 검사를 실행하세요.",
  };
}
export async function checkWritableParent(path) {
  let parent = dirname(resolve(path));
  while (true) {
    try {
      await access(parent, constants.W_OK);
      return true;
    } catch (error) {
      if (error.code !== "ENOENT" || dirname(parent) === parent) return false;
      parent = dirname(parent);
    }
  }
}
