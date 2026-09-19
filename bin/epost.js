#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  EpostClient,
  KoreaPostWeb,
  EpostError,
  validateReservation,
  validateCancellation,
} from "../src/index.js";

const help = `epost-automation — 우체국 방문접수소포 자동화 (비공식)

  validate request.json                         입력 확인 (네트워크 사용 없음)
  reserve request.json --key order-001           접수 미리 확인 (네트워크 사용 없음)
  reserve request.json --key order-001 --execute 실제 접수
  cancel cancel.json --key cancel-001            취소 입력 확인
  cancel cancel.json --key cancel-001 --execute  실제 취소
  lookup 예약번호                               예약 상태 조회
  options                                       현재 사이트의 중량·크기·내용품 코드 조회
  operation 작업키                              저장된 작업 상태 조회
  resolve 작업키 --result result.json --verified 결과를 직접 확인한 작업 복구
  resolve 작업키 --not-submitted --verified      접수되지 않았음을 직접 확인한 작업 복구

공통: --journal .epost/operations.sqlite, --headed, --help
--verified: 원래 실행 프로세스 종료와 우체국 내역 대조를 모두 완료했다는 확인입니다.
계정: EPOST_USERNAME / EPOST_PASSWORD. 카드 설정은 .env.example 참고.
환경변수 파일은 자동으로 읽지 않습니다. node --env-file=.env bin/epost.js ... 사용 가능.
`;

let client;
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      key: { type: "string" },
      journal: { type: "string" },
      execute: { type: "boolean" },
      headed: { type: "boolean" },
      help: { type: "boolean" },
      verified: { type: "boolean" },
      result: { type: "string" },
      "not-submitted": { type: "boolean" },
    },
  });
  const [command, argument] = positionals;
  const emit = (value) =>
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  const readJSON = async (path) => {
    if (!path) throw new EpostError("VALIDATION", { field: "inputFile" });
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      throw new EpostError("VALIDATION", { field: "inputFile" });
    }
  };
  if (values.help || !command) process.stdout.write(help);
  else {
    if (
      positionals.length > 2 ||
      ![
        "validate",
        "reserve",
        "cancel",
        "lookup",
        "options",
        "operation",
        "resolve",
      ].includes(command)
    )
      throw new EpostError("VALIDATION", { field: "command" });
    let request;
    if (["validate", "reserve", "cancel"].includes(command)) {
      const raw = await readJSON(argument);
      request = command === "cancel" ? validateCancellation(raw) : raw;
      // The client permits replay of an old success; offline validation requires
      // a future date only when planning a new reservation.
      if (command === "validate" || (command === "reserve" && !values.execute))
        request = validateReservation(raw);
    }
    if (
      command === "validate" ||
      (["reserve", "cancel"].includes(command) && !values.execute)
    ) {
      emit({
        valid: true,
        mode: "dry-run",
        message:
          "입력 형식을 확인했습니다. 우체국 접속·접수·결제는 실행하지 않았습니다.",
      });
    } else {
      const credentials = {
        username: process.env.EPOST_USERNAME,
        password: process.env.EPOST_PASSWORD,
        card: {
          number: process.env.EPOST_CARD_NUMBER,
          expiry: process.env.EPOST_CARD_EXPIRY,
          passwordPrefix: process.env.EPOST_CARD_PASSWORD_PREFIX,
          identity: process.env.EPOST_CARD_IDENTITY,
        },
      };
      const provider = ["operation", "resolve"].includes(command)
        ? { accountId: credentials.username }
        : new KoreaPostWeb({
            credentials,
            headless: !values.headed,
            executablePath: process.env.EPOST_BROWSER_PATH,
          });
      client = new EpostClient({
        provider,
        journalPath: values.journal ?? process.env.EPOST_JOURNAL_PATH,
      });
      if (command === "reserve")
        emit(await client.reserve(request, { idempotencyKey: values.key }));
      if (command === "cancel")
        emit(await client.cancel(request, { idempotencyKey: values.key }));
      if (command === "lookup") emit(await client.lookup(argument));
      if (command === "options") emit(await client.options());
      if (command === "operation") emit(client.getOperation(argument));
      if (command === "resolve") {
        if (!!values.result === !!values["not-submitted"])
          throw new EpostError("VALIDATION", { field: "resolution" });
        emit(
          client.resolveOperation(argument, {
            outcome: values.result ? "succeeded" : "not-submitted",
            result: values.result ? await readJSON(values.result) : undefined,
            confirmedProcessStopped: values.verified === true,
            verifiedWithKoreaPost: values.verified === true,
          }),
        );
      }
    }
  }
} catch (error) {
  const safe =
    error instanceof EpostError ? error : new EpostError("VALIDATION");
  process.stderr.write(`${JSON.stringify(safe.toJSON())}\n`);
  process.exitCode = safe.code === "OUTCOME_UNKNOWN" ? 3 : 1;
} finally {
  client?.close();
}
