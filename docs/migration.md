# 버전별 변경 안내

[문서 홈](README.md)

## 0.2 → 0.3

기존 API, 배치 ID, 행 ID와 journal을 그대로 사용합니다. 쓰기용 저장소는 동일 요청 검색을 위한 인덱스만 추가하며 작업 기록을 초기화하지 않습니다.

- `--preview`, `recovery`, SDK `previewBatch`/`getRecoveryGuide` 추가.
- 완료된 행을 재사용할 때 건별 대기를 제거. 실제 요청 간격은 유지.
- `history`와 `operation`도 이제 읽기 전용이며 없는 journal을 생성하지 않음.
- 선택적 저장소 `inspectBatch`/`listRecovery`, `{ readOnly: true }` 구성 추가. 기존 사용자 정의 저장소는 새 기능 호출 시 `UNSUPPORTED`일 수 있으며 원래 실행 API는 유지.
- Windows/macOS 검증과 PowerShell 문서 추가.

같은 요청이 다른 작업 키에 있어도 자동으로 기존 예약에 연결하지 않습니다. 미리보기의 중복 경고를 확인한 뒤 원래 작업 키를 유지하세요.

## 0.1 → 0.2

단건 `reserve`, `cancel`, `lookup` API와 CLI 입력은 유지됩니다. 기본 SQLite journal도 그대로 사용하며 삭제하거나 새 파일로 바꾸지 마세요. 0.2는 아직 실험적 버전입니다.

## 기존 단건 작업을 배치로 옮길 때

배치는 `batch:종류:batchId:id` 형태로 새 작업 키를 만듭니다. **기존 단건으로 성공한 접수를 배치에 그대로 넣으면 기존 단건 키와 다르므로 새로 접수할 수 있습니다.** 기존 성공 건은 새 배치에서 제외하세요. 기존 단건 처리 확인은 원래 `--key`와 journal로 수행합니다.

아직 접수하지 않은 주문은 공통 발송인·규격을 설정 파일에 옮기고, 수취인 목록을 CSV로 작성하면 됩니다. `init`과 [빠른 시작](getting-started.md)을 참고하세요. 이후 이어서 실행할 때는 배치 ID와 행 ID를 바꾸지 않습니다.

## 실패 재시도

0.1에서 실패 키는 재호출할 수 없었습니다. 0.2는 `--retry-failed` / `{ retryFailed: true }`를 명시한 경우에 한해 같은 입력의 `failed` 기록을 다시 사용할 수 있습니다. 기본 동작은 기존처럼 재시도를 막습니다. 입력 지문이 달라지면 `KEY_CONFLICT`이며, `unknown`, `running`, `submitted` 기록은 이 옵션으로 재시도하지 않습니다.

사이트에서 미접수와 임시 목록 정리를 확인하고 수동 복구한 건도 `failed`가 됩니다. 복구 후 동일한 배치를 `--retry-failed`로 이어서 실행할 수 있습니다. [복구 절차](recovery.md)를 먼저 확인하세요.

## 새 기능

- CSV/JSON 배치 접수·전체 취소·조회와 공통 입력값.
- 전체 행 사전 검사, 진행률, JSON/CSV 결과 파일, Ctrl+C 후 이어서 실행.
- `init`, `doctor`, 명령별 도움말, 계정별 작업 `history`.
- `reserveMany`, `cancelMany`, `lookupMany`, `parseBatchInput`, `validateBatch`, `listOperations`.
- 선택적인 저장소 `list` 메서드와 `claim`의 `retryFailed` 옵션. [사용자 정의 구현 계약](api.md#교체-가능한-구성요소).

배치는 개별 예약들을 순서대로 처리합니다. 예약 한 건에 여러 소포를 묶는 기능, 부분 취소, 배치 전체 원자성, 다중 서버 잠금은 제공하지 않습니다.
