# 실행 전 미리보기

[문서 홈](README.md) · [배치 작업](batch.md) · [복구](recovery.md)

입력 형식 검사에 더해 **현재 계정의 기존 작업 기록**과 대조합니다. 완료 건, 재시도 가능 건, 결과 불명, 입력 충돌과 중복 의심을 실행 전에 확인할 수 있습니다.

```sh
node bin/epost.js batch-reserve my-shipping/shipments.local.csv --config my-shipping/config.local.json --env-file my-shipping/.env --batch-id shipping-001 --preview
```

접수·조회·취소 배치 모두 `--preview`를 지원합니다. `--execute`, `--output`과 함께 사용할 수 없습니다. JSON이 필요하면 `--json`을 사용하세요. 진단 결과를 리다이렉션할 때는 입력 파일과 다른 경로를 사용하세요.

`EPOST_USERNAME`만 필요하며 비밀번호·카드·브라우저는 필요하지 않습니다. journal을 읽기 전용으로 열고 사이트 접속, 키 등록, 잠금 해제나 상태 변경을 하지 않습니다. 지정한 journal이 없으면 새 파일을 생성하지 않고 `journalExists: false`로 안내합니다. 기존 사용자는 잘못된 계정·경로를 선택하지 않았는지 먼저 확인하세요.

## 상태별 의미

| 상태           | 의미                             | 다음 행동                                           |
| -------------- | -------------------------------- | --------------------------------------------------- |
| `new`          | 같은 키의 기록 없음              | 실제로 새 작업인지 확인                             |
| `completed`    | 같은 요청이 이미 성공            | 실행 시 기존 성공 결과 재사용                       |
| `retryable`    | 제출 전 실패 또는 미접수 확인    | 원인 해결 후 같은 요청에 `--retry-failed`           |
| `needs-review` | 진행 중·제출 중·결과 불명        | `recovery 작업키`로 확인 절차 조회                  |
| `conflict`     | 같은 키에 다른 요청/종류         | 원래 주문과 요청 확인; 키만 바꿔 우회하지 않기      |
| `invalid`      | 신규/재시도 접수의 방문일이 지남 | 실제 결과와 원래 작업을 먼저 확인한 뒤 새 요청 준비 |
| `lookup`       | 상태를 새로 조회할 예정          | 조회 배치는 과거 조회 결과를 재사용하지 않음        |

형식 오류와 중복 행 ID는 기존처럼 전체 사전 검사 오류가 됩니다. 이미 성공한 과거 날짜의 접수는 그대로 미리보기 및 재사용할 수 있습니다. 재시도 시나리오를 확인하려면 `--preview --retry-failed`를 함께 지정하세요. 미리보기에서 재시도 자체를 실행하지는 않습니다.

`willExecute`는 해당 행에 사이트 요청이 필요한지를 나타냅니다. `accountBlocked`가 true이면 다른 작업/조회가 계정을 사용 중이거나 확인이 필요한 잠금을 보유하고 있어 실제 실행은 막힙니다. 배치 파일에 없는 미해결 작업도 검사합니다. 완료 건만 다시 읽는 경우에는 사이트 요청이 없으므로 계정 잠금과 무관하게 재사용할 수 있습니다.

`ready`는 해당 순간의 로컬 상태에서 전체 행이 실행 또는 재사용 가능한지를 뜻합니다. 사이트 호환성·로그인·방문 가능일·결제 성공은 확인하지 않습니다. 미리보기가 잠금을 선점하지 않으므로 실제 실행 시 키, 입력 지문, 계정 잠금을 다시 검사합니다.

## 중복 의심

- `DUPLICATE_IN_FILE`: 파일 안에서 ID는 다르지만 정규화한 요청 전체가 같은 행. 먼저 나온 행의 ID를 표시합니다.
- `DUPLICATE_IN_JOURNAL`: 다른 키로 이미 성공했거나 아직 결과가 확정되지 않은 동일 요청. 해당 작업 ID와 상태를 최대 5개까지 표시합니다. 기존 단건 작업도 포함합니다.

이름·주소·전화번호 원문이나 요청 지문은 보고서에 출력하지 않습니다. 비교는 **정규화한 요청 전체의 일치**이며 일부 필드가 다른 유사 주문, 다른 계정/journal, 우체국 웹에서 직접 만든 예약까지 탐지하지는 않습니다.

동일한 수취인에게 같은 규격의 상자를 여러 개 보낼 수 있으므로 중복 의심은 경고이며 `ready`나 종료 코드를 단독으로 바꾸지 않습니다. 주문과 상자 수를 대조하세요. 기존 성공 건을 새 배치 ID로 옮기는 대신 원래 키로 재사용하는 것이 기본입니다.

## 반환과 종료 코드

보고서에는 `mode`, `batchId`, `kind`, `networkUsed`, `journalExists`, `ready`, `accountBlocked`, 선택적 `blockingOperationId`, 상태별 `summary`, 건별 `items`가 있습니다. `summary.warnings`는 경고 수이며 행 수가 아닙니다.

- `0`: 로컬 상태에서 실행/재사용 가능. 중복 경고는 별도 확인.
- `1`: 충돌, 입력 문제, 재시도 옵션 부재, 다른 작업의 계정 잠금 등으로 준비되지 않음.
- `3`: 입력에 `needs-review` 상태가 포함됨.

## SDK

```js
import { readFile } from "node:fs/promises";
import {
  EpostClient,
  SqliteOperationStore,
  parseBatchInput,
} from "../src/index.js";

// examples/preview.local.mjs에 저장한 뒤 저장소 루트에서 실행하는 예제
const store = new SqliteOperationStore(".epost/operations.sqlite", {
  readOnly: true,
});
const client = new EpostClient({
  provider: { accountId: process.env.EPOST_USERNAME },
  store,
});
try {
  const batch = parseBatchInput(
    await readFile(
      new URL("./batch-reservations.json", import.meta.url),
      "utf8",
    ),
  );
  console.log(
    client.previewBatch("reserve", batch.items, { batchId: batch.batchId }),
  );
} finally {
  client.close();
  store.close();
}
```

실제 journal에 대응하는 계정 ID를 지정하세요. TypeScript 사용 시 로컬 진단용 provider는 `{ accountId }`만 전달할 수 있습니다. `client.previewBatch` 자체는 영구 기록을 쓰지 않지만 기본 생성자의 쓰기용 저장소는 파일을 생성할 수 있으므로 읽기 전용 용도에는 위처럼 저장소를 직접 전달하세요.
