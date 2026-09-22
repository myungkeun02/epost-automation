# CLI 참고

[문서 홈](README.md) · [빠른 시작](getting-started.md) · [배치 입력](batch.md)

저장소에서 `node bin/epost.js`로 실행합니다. 패키지를 프로젝트에 설치했다면 `npx epost-automation`으로 바꿔 쓰세요. 현재 npm 레지스트리에는 배포하지 않았습니다. `--help`, `help 명령`, `--version`을 지원합니다.

## 명령

| 명령                                                   | 입력                      | 사이트 접속 조건                              |
| ------------------------------------------------------ | ------------------------- | --------------------------------------------- |
| `init --dir shipping`                                  | 새 폴더 이름              | 접속하지 않음; 설정·CSV·빈 환경변수 파일 생성 |
| `doctor [--payment]`                                   | 환경변수, 설정            | 접속하지 않음; 설치·설정 **형식** 검사        |
| `validate request.json`                                | 단건 접수 JSON            | 접속하지 않음                                 |
| `reserve request.json --key order-001`                 | 단건 접수 JSON            | `--execute`일 때                              |
| `cancel cancel.json --key cancel-001`                  | 단건 취소 JSON            | `--execute`일 때                              |
| `lookup 예약번호`                                      | 예약번호                  | 즉시 접속; 카드 불필요                        |
| `options`                                              | 없음                      | 즉시 접속; 현재 선택 코드 조회                |
| `batch-reserve shipments.csv --batch-id run-001`       | CSV 또는 JSON             | `--execute`일 때                              |
| `batch-cancel cancellations.csv --batch-id cancel-001` | CSV 또는 JSON             | `--execute`일 때                              |
| `batch-lookup lookups.csv --batch-id check-001`        | CSV 또는 JSON             | `--execute`일 때                              |
| `history --status unknown --limit 20`                  | 선택적 상태·개수          | 접속하지 않음; 계정별 journal 조회            |
| `operation 작업키`                                     | 단건 키 또는 배치의 `key` | 접속하지 않음                                 |
| `resolve 작업키 --result 결과.json --verified`         | 실제 대조한 결과          | 접속하지 않음; [수동 복구](recovery.md)       |
| `resolve 작업키 --not-submitted --verified`            | 미접수 확인 선언          | 접속하지 않음; [수동 복구](recovery.md)       |

입력 검사 성공은 주소 검색 결과, 방문 가능일, 카드 인증이나 실제 접수 성공을 보장하지 않습니다. 예제 날짜·주소·번호는 가상 값입니다.

## 설정과 우선순위

| 옵션                                 | 설명                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `--env-file .env`                    | 명시적으로 파일 로드. 이미 설정된 환경변수가 우선하며, `.env`를 자동 검색하지 않음 |
| `--config config.local.json`         | 공통 요청값과 journal 경로. [설정 예제](../examples/config.json)                   |
| `--journal .epost/operations.sqlite` | 영구 작업 기록 위치. 기존 접수를 재실행할 때 같은 파일 사용                        |
| `--headed`                           | 실행 브라우저 표시                                                                 |
| `--json`                             | 터미널에서도 배치 최종 결과를 JSON으로 출력                                        |

Journal 경로 우선순위: `--journal` → `EPOST_JOURNAL_PATH` → 설정 파일 `journalPath` → 현재 폴더의 `.epost/operations.sqlite`. 설정 파일의 상대 경로는 **설정 파일 폴더 기준**, 나머지는 현재 폴더 기준입니다.

환경변수 목록은 [.env.example](../.env.example)에 있습니다. `EPOST_USERNAME`, `EPOST_PASSWORD`는 사이트 접속에 필요하고 `EPOST_CARD_*`는 접수에만 필요합니다. `EPOST_BROWSER_PATH`로 Chrome/Chromium 실행 파일을 지정할 수 있습니다. `history`, `operation`, `recovery`, `resolve`, `--preview`에는 계정 구분용 `EPOST_USERNAME`만 필요합니다.

## 배치 옵션

| 옵션                           | 기본값·동작                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `--batch-id run-001`           | 필수. JSON 최상위 `batchId`로도 지정 가능. 둘을 지정하면 일치해야 함                       |
| `--execute`                    | 생략하면 모든 행의 입력 검사만 수행                                                        |
| `--output reports/result.json` | `.json` 또는 `.csv`. 첫 요청 전·매 건 처리 후·종료 시 파일 갱신. 상위 폴더는 미리 생성     |
| `--continue-on-error`          | 기본은 오류 발생 시 중지. 안전한 건별 오류만 건너뛰기; [정확한 범위](batch.md#중단과-재개) |
| `--retry-failed`               | 동일 요청의 `failed` 기록만 명시적으로 재시도. 결과 불명 재시도 불가. 단건에도 사용 가능   |
| `--interval 1000`              | 건 사이 대기 시간(ms), 0–60000. 실행은 항상 순차적                                         |
| `--format csv`                 | `csv` 또는 `json`. 확장자 없는 파일/표준입력에 사용                                        |
| `--quiet`                      | 터미널 진행률 숨기기. 최종 결과와 오류는 출력                                              |

배치 파일 최대 크기는 2 MiB, 최대 1000행입니다. CSV의 한 레코드는 16 KiB까지입니다. UTF-8 CSV를 사용하세요. `-`를 파일명으로 지정하면 표준입력을 읽습니다.

```sh
cat examples/lookups.csv | node bin/epost.js batch-lookup - --format csv --batch-id preview
```

터미널에서는 배치 진행률을 stderr, 최종 요약을 stdout에 출력합니다. 파이프/파일로 stdout을 연결하거나 `--json`을 지정하면 최종 JSON을 출력합니다. 오류는 값 원문을 뺀 코드·필드·다음 행동을 stderr에 출력합니다. `--output`은 실행 결과용이며 입력 검사만 할 때는 생성하지 않습니다.

Ctrl+C 한 번은 현재 건을 마치고 기록한 후 멈춥니다. 두 번 누르면 강제 종료하며 수동 확인이 필요한 상태가 남을 수 있습니다. 최종 결과 파일이 없어도 journal을 보존하고 [복구 절차](recovery.md)를 따르세요.

## 종료 코드

| 코드  | 의미                                                      |
| ----- | --------------------------------------------------------- |
| `0`   | 검사 성공 또는 모든 건 성공(기존 성공 재사용 포함)        |
| `1`   | 입력/설정 오류, 처리 실패, 일부 실패, 결과 파일 저장 실패 |
| `3`   | 접수·취소 결과가 불확실한 건 있음                         |
| `130` | 사용자 중단. 불확실한 건이 있으면 `3` 우선                |

`history --status`는 `running`, `submitted`, `succeeded`, `failed`, `unknown`을 받습니다. `--limit`은 1–100, 기본 20입니다. 키는 해시로 보관하므로 history에서 원래 키를 복원할 수 없습니다. 입력의 작업 ID와 배치 ID 또는 결과 보고서의 `key`를 함께 보관하세요.

## 0.3의 미리보기와 복구 안내

- `batch-reserve|batch-cancel|batch-lookup 파일 --batch-id ID --preview`: 기존 기록과 대조한 미리보기. `--execute` 및 `--output`과 함께 사용 불가. 계정 ID 필요. [상태·중복 경고·종료 코드](preview.md).
- `recovery [작업키] [--limit 20]`: 미해결 작업과 다음 확인 절차. 최대 100건, 원격 접속·상태 변경 없음. [복구 도우미](recovery.md#복구-도우미).
- `history`, `operation`, `recovery`, `--preview`는 같은 journal을 읽기 전용으로 사용하며 없는 파일을 만들지 않습니다. `resolve`는 확인한 결과를 기록하므로 쓰기 접근이 필요합니다.
- `--interval`은 실제 사이트 요청 간격입니다. 기존 성공 결과 재사용에는 불필요한 대기를 적용하지 않습니다.

Windows의 PowerShell 명령과 경로·Excel 결과 파일 잠금 대응은 [Windows 안내](windows.md)에 있습니다.
