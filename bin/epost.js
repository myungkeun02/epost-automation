#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { loadEnvFile } from "node:process";
import {
  EpostClient,
  KoreaPostWeb,
  EpostError,
  SqliteOperationStore,
  validateReservation,
  validateCancellation,
  validateBatch,
  parseBatchInput,
} from "../src/index.js";
import { mergeDefaults } from "../src/import.js";
import {
  readInput,
  readJSON,
  loadConfig,
  assertOutputPath,
  writeReport,
  initializeDirectory,
} from "../src/cli-files.js";
import { credentialsFromEnv, diagnose } from "../src/doctor.js";
import { commands, help, nextStep } from "../src/cli-help.js";

let client, readOnlyStore, interruptHandler;
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      key: { type: "string" },
      journal: { type: "string" },
      execute: { type: "boolean" },
      preview: { type: "boolean" },
      headed: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
      verified: { type: "boolean" },
      result: { type: "string" },
      "not-submitted": { type: "boolean" },
      "batch-id": { type: "string" },
      "continue-on-error": { type: "boolean" },
      "retry-failed": { type: "boolean" },
      interval: { type: "string" },
      output: { type: "string" },
      format: { type: "string" },
      config: { type: "string" },
      "env-file": { type: "string" },
      dir: { type: "string" },
      payment: { type: "boolean" },
      json: { type: "boolean" },
      quiet: { type: "boolean" },
      status: { type: "string" },
      limit: { type: "string" },
    },
  });
  const [command, argument] = positionals;
  const emit = (value) => {
    if (process.stdout.isTTY && !values.json && value?.mode === "preview") {
      const labels = {
        new: "신규",
        completed: "완료·재사용",
        retryable: "재시도 가능",
        "needs-review": "확인 필요",
        conflict: "입력 충돌",
        invalid: "입력 오류",
        lookup: "새로 조회",
      };
      process.stdout.write(
        `${value.batchId}: 실행 전 미리보기 (${value.summary.total}건)\n`,
      );
      for (const item of value.items) {
        process.stdout.write(
          `  ${item.id}: ${labels[item.state]}${item.error?.field ? ` (${item.error.field})` : ""}\n`,
        );
        if (item.state === "retryable" && !item.willExecute)
          process.stdout.write(
            "    원인을 해결한 뒤 같은 요청에 --retry-failed를 지정하세요.\n",
          );
        for (const warning of item.warnings)
          process.stdout.write(
            `    중복 의심: ${warning.itemId ?? warning.operationId}\n`,
          );
      }
      if (!value.journalExists)
        process.stdout.write(
          "기존 journal이 없습니다. 예전에 실행했다면 계정과 기록 경로를 먼저 확인하세요.\n",
        );
      if (value.accountBlocked)
        process.stdout.write(
          "같은 계정에 진행 중이거나 확인이 필요한 작업이 있습니다. recovery로 확인하세요.\n",
        );
      process.stdout.write(
        `로컬 기록 확인: ${value.ready ? "진행 가능 (중복 경고 별도 확인)" : "보완 필요"}\n`,
      );
      process.stdout.write(`${value.message}\n`);
    } else if (
      process.stdout.isTTY &&
      !values.json &&
      value?.mode === "recovery"
    ) {
      process.stdout.write(
        `작업 확인 안내: ${value.total}건${value.truncated ? ` 중 ${value.items.length}건 표시 (--limit 최대 100)` : ""}\n`,
      );
      for (const item of value.items) {
        process.stdout.write(
          `\n${item.key ?? item.operation.id}: ${item.operation.kind} / ${item.operation.status}\n`,
        );
        item.steps.forEach((step, index) =>
          process.stdout.write(`  ${index + 1}. ${step}\n`),
        );
      }
      process.stdout.write(`\n${value.message}\n`);
    } else if (process.stdout.isTTY && !values.json && value?.summary) {
      const s = value.summary;
      process.stdout.write(
        `${value.batchId}: ${value.status}\n총 ${s.total}건 · 성공 ${s.succeeded} (재사용 ${s.replayed}) · 실패 ${s.failed} · 결과 불명 ${s.unknown} · 미실행 ${s.skipped}\n`,
      );
      if (value.stopReason)
        process.stdout.write(`중지 사유: ${value.stopReason}\n`);
      for (const item of value.items.filter(
        (item) => item.status !== "succeeded",
      ))
        process.stdout.write(
          `  ${item.id}: ${item.error?.code ?? item.status}\n`,
        );
    } else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  };
  if (values.version) {
    const pkg = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    process.stdout.write(`${pkg.version}\n`);
  } else if (values.help || !command || command === "help")
    process.stdout.write(help(command === "help" ? argument : command));
  else {
    if (positionals.length > 2 || !Object.hasOwn(commands, command))
      throw new EpostError("VALIDATION", { field: "command" });
    if (values["env-file"]) {
      try {
        loadEnvFile(values["env-file"]);
      } catch {
        throw new EpostError("INPUT_FILE", { field: "envFile" });
      }
    }
    const config = await loadConfig(values.config);
    const journalPath =
      values.journal ??
      process.env.EPOST_JOURNAL_PATH ??
      config.journalPath ??
      ".epost/operations.sqlite";
    const isBatch = command.startsWith("batch-"),
      kind = command.replace("batch-", "");
    if (values.preview && (!isBatch || values.execute || values.output))
      throw new EpostError("VALIDATION", { field: "preview" });
    if (values.output && !isBatch)
      throw new EpostError("VALIDATION", { field: "output" });
    await assertOutputPath(values.output, [
      argument,
      values.config,
      values["env-file"],
      journalPath,
    ]);
    if (command === "init")
      emit(await initializeDirectory(values.dir ?? "epost-workspace"));
    else if (command === "doctor") {
      const report = await diagnose({ journalPath, payment: values.payment });
      emit(report);
      if (!report.ok) process.exitCode = 1;
    } else {
      let request, batch, batchId;
      if (isBatch) {
        batch = parseBatchInput(await readInput(argument), {
          kind,
          defaults: config.defaults,
          format:
            values.format ??
            (extname(argument ?? "").toLowerCase() === ".csv" ? "csv" : "json"),
        });
        if (
          values["batch-id"] &&
          batch.batchId &&
          values["batch-id"] !== batch.batchId
        )
          throw new EpostError("VALIDATION", { field: "batchIdMismatch" });
        batchId = values["batch-id"] ?? batch.batchId;
        const checked = validateBatch(kind, batch.items, {
          batchId,
          allowPast: !!values.execute || !!values.preview,
        });
        if (!values.execute && !values.preview)
          emit({
            valid: true,
            mode: "dry-run",
            batchId,
            kind,
            count: checked.length,
            networkUsed: false,
            message:
              "전체 입력 형식을 확인했습니다. --execute를 지정하면 건별로 실행합니다.",
          });
      } else if (["validate", "reserve", "cancel"].includes(command)) {
        const raw = await readJSON(argument);
        request =
          command === "cancel"
            ? validateCancellation(raw)
            : mergeDefaults(config.defaults, raw);
        if (
          command === "validate" ||
          (command === "reserve" && !values.execute)
        )
          request = validateReservation(request);
        if (command === "validate" || !values.execute)
          emit({
            valid: true,
            mode: "dry-run",
            networkUsed: false,
            message:
              "입력 형식을 확인했습니다. 우체국 접속·접수·결제는 실행하지 않았습니다.",
          });
      }
      const needsClient =
        command !== "validate" &&
        (!["reserve", "cancel"].includes(command) || values.execute) &&
        (!isBatch || values.execute || values.preview);
      if (needsClient) {
        const credentials = credentialsFromEnv();
        const localOnly =
          values.preview ||
          ["operation", "history", "recovery"].includes(command);
        const provider =
          localOnly || command === "resolve"
            ? { accountId: credentials.username }
            : new KoreaPostWeb({
                credentials,
                headless: !values.headed,
                executablePath: process.env.EPOST_BROWSER_PATH,
              });
        if (localOnly)
          readOnlyStore = new SqliteOperationStore(journalPath, {
            readOnly: true,
          });
        client = new EpostClient({
          provider,
          journalPath,
          ...(readOnlyStore ? { store: readOnlyStore } : {}),
        });
        if (isBatch && values.preview) {
          const preview = client.previewBatch(kind, batch.items, {
            batchId,
            retryFailed: values["retry-failed"] ?? false,
          });
          emit(preview);
          if (!preview.ready)
            process.exitCode = preview.summary["needs-review"] ? 3 : 1;
        } else if (isBatch) {
          const controller = new AbortController();
          let interrupts = 0;
          interruptHandler = () => {
            if (++interrupts > 1) process.exit(130);
            controller.abort();
            process.stderr.write("현재 건의 결과를 기록한 뒤 중지합니다.\n");
          };
          process.on("SIGINT", interruptHandler);
          let previous = -1;
          const report = await client[`${kind}Many`](batch.items, {
            batchId,
            continueOnError: values["continue-on-error"] ?? false,
            retryFailed: values["retry-failed"] ?? false,
            intervalMs:
              values.interval === undefined ? 1000 : Number(values.interval),
            signal: controller.signal,
            onProgress: async (report) => {
              if (values.output) await writeReport(values.output, report);
              const count =
                report.summary.total -
                report.summary.pending -
                report.summary.skipped;
              if (!values.quiet && process.stderr.isTTY && count !== previous)
                process.stderr.write(
                  `[${count}/${report.summary.total}] 성공 ${report.summary.succeeded} · 실패 ${report.summary.failed} · 결과 불명 ${report.summary.unknown}\n`,
                );
              previous = count;
            },
          });
          emit(report);
          process.exitCode = report.summary.unknown
            ? 3
            : report.stopReason === "INTERRUPTED"
              ? 130
              : report.status === "completed"
                ? 0
                : 1;
        }
        if (command === "reserve")
          emit(
            await client.reserve(request, {
              idempotencyKey: values.key,
              retryFailed: values["retry-failed"] ?? false,
            }),
          );
        if (command === "cancel")
          emit(
            await client.cancel(request, {
              idempotencyKey: values.key,
              retryFailed: values["retry-failed"] ?? false,
            }),
          );
        if (command === "lookup") emit(await client.lookup(argument));
        if (command === "options") emit(await client.options());
        if (command === "operation") emit(client.getOperation(argument));
        if (command === "history")
          emit(
            client.listOperations({
              status: values.status,
              limit: values.limit === undefined ? 20 : Number(values.limit),
            }),
          );
        if (command === "recovery")
          emit(
            client.getRecoveryGuide({
              key: argument,
              limit: values.limit === undefined ? 20 : Number(values.limit),
            }),
          );
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
  }
} catch (error) {
  const safe =
    error instanceof EpostError ? error : new EpostError("VALIDATION");
  process.stderr.write(
    `${JSON.stringify({ ...safe.toJSON(), nextStep: nextStep(safe.code) })}\n`,
  );
  process.exitCode = safe.code === "OUTCOME_UNKNOWN" ? 3 : 1;
} finally {
  if (interruptHandler) process.off("SIGINT", interruptHandler);
  client?.close();
  readOnlyStore?.close();
}
