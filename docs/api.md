# JavaScript / TypeScript API

[문서 홈](README.md) · [타입 선언 전체](../src/index.d.ts) · [설계](design.md)

Node.js 22.14 이상, ESM 환경을 지원합니다. TypeScript 선언을 함께 제공합니다. 패키지를 설치한 프로젝트에서는 아래의 `../src/index.js` 대신 `@myungkeun02/epost-automation`을 import합니다.

## 배치 접수

다음 코드는 저장소의 `examples/run.local.mjs`에 넣어 실행할 수 있는 예입니다. **실제 접수 코드**이므로 입력과 계정 정보를 수정하고 CLI 입력 검사를 먼저 수행하세요. 예제는 가상 주소와 먼 미래 날짜를 사용합니다.

```js
import { readFile } from "node:fs/promises";
import { EpostClient, KoreaPostWeb, parseBatchInput } from "../src/index.js";

const provider = new KoreaPostWeb({
  credentials: {
    username: process.env.EPOST_USERNAME,
    password: process.env.EPOST_PASSWORD,
    card: {
      number: process.env.EPOST_CARD_NUMBER,
      expiry: process.env.EPOST_CARD_EXPIRY,
      passwordPrefix: process.env.EPOST_CARD_PASSWORD_PREFIX,
      identity: process.env.EPOST_CARD_IDENTITY,
    },
  },
  executablePath: process.env.EPOST_BROWSER_PATH,
});
const client = new EpostClient({
  provider,
  journalPath: ".epost/operations.sqlite",
});
try {
  const batch = parseBatchInput(
    await readFile(
      new URL("./batch-reservations.json", import.meta.url),
      "utf8",
    ),
    { kind: "reserve", format: "json" },
  );
  const report = await client.reserveMany(batch.items, {
    batchId: batch.batchId,
    intervalMs: 1000,
    onProgress: ({ summary }) => console.error(summary),
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  client.close();
}
```

`node --env-file=.env examples/run.local.mjs`로 실행합니다. SDK는 환경변수 파일을 자동으로 읽지 않습니다.

## 클라이언트 메서드

| 메서드                                             | 결과·역할                                              |
| -------------------------------------------------- | ------------------------------------------------------ |
| `reserve(input, { idempotencyKey, retryFailed? })` | 접수. `OperationResult` 반환                           |
| `cancel(input, { idempotencyKey, retryFailed? })`  | 해당 예약 전체 취소. `OperationResult` 반환            |
| `lookup(reservationNumber)`                        | 최신 예약 상태 `Reservation` 반환                      |
| `options()`                                        | 현재 사이트의 중량·크기·내용품·보관장소 코드와 표시명  |
| `reserveMany(items, options)`                      | 여러 접수 순차 실행, `BatchReport` 반환                |
| `cancelMany(items, options)`                       | 여러 전체 취소 순차 실행, `BatchReport` 반환           |
| `lookupMany(items, options)`                       | 여러 예약 상태 순차 조회, 항상 새로 조회               |
| `getOperation(key)`                                | 계정과 키의 기록 또는 `null`                           |
| `listOperations({ status?, limit? })`              | 현재 계정의 최근 작업 기록(기본 20, 최대 100)          |
| `resolveOperation(key, resolution)`                | 실제 대조한 결과로 수동 복구; [복구 문서](recovery.md) |
| `close()`                                          | 클라이언트가 생성한 기본 저장소 종료                   |

`Reservation`은 `{ reservationNumber, trackingNumber, status }`입니다. `status`는 `reserved`, `canceled`, `unknown`이며 배송 추적 단계가 아닙니다. `trackingNumber`는 확인되지 않으면 `null`입니다. `OperationResult`에는 `operationId`, `replayed`가 추가됩니다. 기존 성공 작업 재호출의 `replayed: true`는 과거 성공 결과의 재사용이며 현재 상태는 `lookup`으로 확인합니다.

## 입력과 사전 검사

- 단건 접수: [reservation.json](../examples/reservation.json). 한 행은 소포 1개, `parcel.quantity`는 생략하거나 `1`만 가능.
- 단건 취소: [cancellation.json](../examples/cancellation.json). 예약번호와 확인용 수취인 전화번호 필요.
- 배치: `{ id, request }[]`. `id`와 `batchId`는 첫 글자 영숫자, 이후 영숫자/점/밑줄/하이픈으로 최대 48자. 개인정보 대신 주문 관리용 ID 사용.
- `parseBatchInput(text, { format, kind, defaults? })`: UTF-8 문자열 CSV/JSON을 읽고 공통값을 병합. 파싱만 수행하며 입력 검증은 별도.
- `validateReservation(input)`, `validateCancellation(input)`, `validateBatch(kind, items, { batchId })`: 오프라인 검증 및 정규화. `validateBatch`는 각 잘못된 행의 첫 오류를 `issues`로 모음.

접수 필드와 CSV 열 매핑, 공통값 우선순위는 [배치 입력](batch.md)을 참고하세요. 단건 SDK는 공통 설정 파일을 직접 읽지 않습니다.

## BatchOptions / BatchReport

필수 `batchId`, 선택 `continueOnError=false`, `retryFailed=false`, `intervalMs=1000`, `signal`, `onProgress`를 받습니다. 전체 입력의 사전 검사가 실패하면 `EpostError`를 throw하고 원격 작업을 시작하지 않습니다. 실행 중 개별 실패는 반환 보고서에 포함됩니다. 보고서의 성공 여부를 반드시 확인하세요.

`signal`은 건과 건 사이에서 반영됩니다. 진행 중인 접수는 완료/불확실 여부를 기록한 뒤 중단합니다. `onProgress`는 첫 건 전, 매 건 처리 후, 종료 시 호출되며 반환 Promise를 기다립니다. 독립 스냅샷을 전달하므로 콜백에서 값을 변경해도 내부 기록은 변하지 않습니다. 콜백이 실패하면 `stopReason: 'OUTPUT_FAILED'`로 멈춥니다. 최종 파일 저장 실패 시 앞선 접수는 이미 완료되었을 수 있으므로 journal이 기준입니다.

보고서에는 배치 상태, 중단 이유, 시간, 합계, 건별 `id`, `key`, 상태, 결과/오류가 들어갑니다. 입력 이름·주소·전화·카드정보는 담지 않습니다. 성공 합계에는 재사용 건이 포함되며 `replayed`는 그 부분집합입니다. [상태와 복구 의미](batch.md#중단과-재개)를 확인하세요.

## 인증과 자원 관리

`KoreaPostWeb`은 `credentials` 객체 또는 `{ username, credentials: async () => credentials }` 형태의 공급 함수를 받습니다. 공급 함수가 반환하는 계정은 고정 `username`과 일치해야 합니다. 비밀 관리 시스템과 연결할 때 사용하세요.

선택 옵션: `headless=true`, `executablePath`, `timeoutMs`, `operationTimeoutMs`. 조회·취소에는 `card`가 필요 없습니다. 실제 사이트가 요구하는 추가 인증을 우회하지 않습니다.

단건은 실행마다 브라우저를 열고 닫습니다. 배치는 브라우저 프로세스를 재사용하되 매 건 독립 context로 로그인하고 종료합니다. 한 provider에서 겹쳐 실행하면 `ACCOUNT_BUSY`로 거절될 수 있으므로 `Promise.all` 대신 배치 메서드를 쓰세요. 같은 계정을 쓰는 프로세스는 같은 journal을 공유해야 합니다.

## 교체 가능한 구성요소

`EpostProvider`는 계정 ID와 접수·취소·조회 구현을 제공합니다. 접수/취소의 첫 외부 변경 전 반드시 `await guard.beforeSubmit()`을 호출하고 자체 제출 재시도를 하지 않아야 합니다. 선택적 `withBrowser(work)`는 배치의 자원 수명만 감싸며 건별 격리를 보존해야 합니다.

`OperationStore`는 동기식 원자적 영구 저장 계약입니다. 기본 `SqliteOperationStore`를 직접 생성하여 전달하면 `client.close()` 후 **호출자가 `store.close()`**를 호출합니다. `list`는 선택적이며 미지원 저장소의 `listOperations`는 `UNSUPPORTED`입니다. `claim`의 `retryFailed` 지원 시 동일 지문·`failed` 상태를 확인하고 계정 잠금 획득과 상태 변경을 하나의 트랜잭션으로 처리해야 합니다. 이전 사용자 정의 저장소가 옵션을 무시하면 실패 작업 재시도가 활성화되지 않습니다.

오류의 공개 속성은 `code`, `field?`, `operationId?`, `issues?`이며 `toJSON()`으로 안전한 형식을 받습니다. 원본 사이트 응답·예외 cause는 제공하지 않습니다. [오류별 대응](recovery.md)과 [트랜잭션 경계](design.md)를 참고하세요.

## 미리보기와 복구 안내 API (0.3)

`client.previewBatch(kind, items, { batchId, retryFailed? })`는 동기식 `BatchPreview`를 반환합니다. 사이트에는 접속하지 않으며 현재 계정의 로컬 기록과 정규화한 입력 지문을 대조합니다. 상태와 중복 경고의 의미, 읽기 전용 구성 예제는 [미리보기](preview.md)에 있습니다.

`client.getRecoveryGuide({ key?, limit? })`는 동기식 `RecoveryGuide`를 반환합니다. 키가 없으면 미해결 상태만 검색하며 전체 `total`, 표시 `items`, 잘림 여부 `truncated`를 제공합니다. 특정 키가 없으면 `NOT_FOUND`이며 기본 limit은 20, 최대 100입니다. 복구를 실행하거나 잠금을 해제하지 않습니다.

`new SqliteOperationStore(path, { readOnly: true })`는 기존 DB를 읽기 전용으로 열고, 파일이 없으면 빈 읽기 결과와 `journalExists: false`를 반환합니다. 모든 상태 변경 메서드는 `STORAGE`로 거절합니다. 이 구성은 `lookup` 같은 원격 읽기에도 사용할 수 없습니다. 원격 조회에는 계정 조회 잠금 기록이 필요하기 때문입니다. 로컬 진단용 client에는 `{ accountId }`만 가진 provider를 전달할 수 있습니다.

사용자 정의 저장소에서 미리보기를 지원하려면 `inspectBatch`, 복구 안내를 지원하려면 `listRecovery`를 구현해야 합니다. 두 메서드는 선택적이고 미지원 시 `UNSUPPORTED`입니다. `inspectBatch`는 동일 시점의 작업·계정 잠금·중복 후보를 읽기만 해야 하며 `claim`으로 흉내 내면 안 됩니다. 기존 단건/배치 실행 계약은 그대로 유지됩니다.
