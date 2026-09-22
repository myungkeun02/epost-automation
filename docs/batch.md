# 배치 작업

[문서 홈](README.md) · [CLI](cli.md) · [복구](recovery.md)

## 실행 단위

한 파일에서 최대 1,000행을 순차 처리합니다. 접수는 상자마다 독립 예약번호가 생성됩니다. 한 예약번호에 여러 상자를 묶거나, 한 번의 결제로 전체 배치를 처리하지 않습니다. 한 건의 성공을 다른 건의 실패 때문에 자동 취소하지 않습니다.

같은 수취인에게 상자 3개를 보내면 `order-001-box1`, `order-001-box2`, `order-001-box3`처럼 행을 3개 작성하세요. 상자별 중량·크기를 각각 지정할 수 있습니다. `parcel.quantity`를 3으로 설정하는 방식은 지원하지 않습니다.

브라우저 프로세스는 한 배치 동안 재사용합니다. 로그인 context는 건별로 새로 만들고 종료하여 쿠키·임시 폼이 다른 건과 섞이지 않게 합니다. 따라서 건마다 로그인하며, 무제한 병렬 처리를 하지 않습니다. 기본 실제 사이트 요청 사이 대기는 1초입니다. 완료 건 재사용에는 대기가 없으며, 결과 저장·진행 콜백에 쓴 시간도 간격 계산에 포함합니다.

## CSV 형식

UTF-8 CSV를 사용하세요. Excel에서는 **CSV UTF-8** 형식으로 저장합니다. BOM, 쉼표를 포함하는 따옴표 필드와 CRLF를 지원합니다. 전화번호·우편번호·규격 코드는 텍스트 셀로 보관해야 앞의 0이 사라지지 않습니다. 이미 Excel에서 0을 지운 값은 복원하지 않습니다.

```csv
작업ID,받는분,받는분전화,받는분우편번호,받는분주소,받는분상세주소
order-001,수취인 예시,010-0000-0001,00000,테스트시 예시로 2,테스트 주소
```

공통 발송정보와 결합합니다.

```sh
node bin/epost.js batch-reserve examples/shipments.csv --config examples/config.json --batch-id shipment-001
```

| 영어 열 이름                                                          | 한국어 열 이름                                     |
| --------------------------------------------------------------------- | -------------------------------------------------- |
| `id`                                                                  | 작업ID                                             |
| `pickupDate`                                                          | 방문일                                             |
| `sender.name` / `sender.phone`                                        | 보내는분 / 보내는분전화                            |
| `sender.zipCode` / `sender.address` / `sender.detailAddress`          | 보내는분우편번호 / 보내는분주소 / 보내는분상세주소 |
| `recipient.name` / `recipient.phone`                                  | 받는분 / 받는분전화                                |
| `recipient.zipCode` / `recipient.address` / `recipient.detailAddress` | 받는분우편번호 / 받는분주소 / 받는분상세주소       |
| `parcel.description`                                                  | 품목명                                             |
| `parcel.weightCode` / `parcel.sizeCode` / `parcel.contentCode`        | 중량코드 / 크기코드 / 내용품코드                   |
| `pickup.locationCode` / `pickup.locationDescription`                  | 보관장소코드 / 보관장소                            |
| `pickup.timeInterval`                                                 | 방문시간대                                         |
| `memo`                                                                | 요청사항                                           |
| `reservationNumber`                                                   | 예약번호 (조회·취소)                               |
| `recipientPhone`                                                      | 확인전화 (취소)                                    |

알 수 없는 열이나 중복 열은 오류입니다. 입력 행을 조용히 버리지 않습니다. 빈 CSV 셀은 공통 설정을 사용합니다. 공통 상세주소/메모를 명시적으로 비우려면 JSON에서 해당 필드를 `""`로 지정하세요. 취소는 작업ID·예약번호·확인전화, 조회는 작업ID·예약번호 열만 사용합니다.

입력 파일은 2 MiB 이하, CSV 레코드는 16 KiB 이하입니다. `issues.row`는 헤더와 빈 줄을 제외한 **데이터 레코드 번호**이며, 따옴표 안 줄바꿈이 있는 파일의 실제 줄 번호와 다를 수 있습니다. 연락처·주소 필드의 줄바꿈은 입력 검증에서 거부됩니다.

## JSON과 공통 설정

```json
{
  "batchId": "shipment-001",
  "defaults": { "pickupDate": "2099-01-02" },
  "items": [
    { "id": "order-001", "request": { "recipient": { "name": "수취인 예시" } } }
  ]
}
```

위 코드는 구조 설명용입니다. 생략된 필수 필드는 `--config`의 `defaults` 등에서 제공해야 합니다. 완전히 실행 가능한 가상 예제는 [batch-reservations.json](../examples/batch-reservations.json)입니다.

우선순위는 **config.defaults → 입력 JSON.defaults → 행의 request**입니다. `sender`, `recipient`, `parcel`, `pickup`은 필드 단위로 병합합니다. 인증정보는 config에 넣지 말고 `.env`나 실행 환경에 둡니다. JSON에 batchId가 있는데 다른 `--batch-id`를 전달하면 오류로 중단합니다.

## 조회·취소

```sh
# 먼저 입력 검사
node bin/epost.js batch-lookup examples/lookups.csv --batch-id lookup-001
node bin/epost.js batch-cancel examples/cancellations.csv --batch-id cancel-001
# 실제 내역으로 수정한 파일을 --execute와 함께 실행
node bin/epost.js batch-lookup lookups.local.csv --env-file my-shipping/.env --config my-shipping/config.local.json --batch-id lookup-001 --output my-shipping/lookup.local.csv --execute
```

조회 배치는 실행할 때마다 현재 상태를 새로 조회합니다. 접수·취소 배치의 성공 결과 재사용과 다릅니다. 취소 결과 파일은 접수 때와 다른 경로를 사용하세요.

## 실행 전 미리보기

`--preview`를 지정하면 계정 ID와 같은 journal로 기존 기록을 대조합니다. 신규·완료·재시도 가능·확인 필요·입력 충돌을 구분하고 동일 요청 중복을 안내합니다. `--execute`와 함께 쓸 수 없으며 기록이나 사이트 상태를 바꾸지 않습니다. 자세한 반환 형식과 명령은 [미리보기 문서](preview.md)를 참고하세요.

## 진행률과 결과

터미널에는 진행률과 요약을, 파이프/리다이렉션에는 JSON을 출력합니다. `--json`은 JSON을 강제하고 `--quiet`는 진행률을 숨깁니다. `--output result.json` 또는 `.csv`는 각 건 완료 시 원자적으로 갱신됩니다. 연락처·주소·카드는 결과에 포함되지 않지만 **작업ID와 예약번호는 운영 데이터**입니다.

| 항목 상태   | 의미                                                   |
| ----------- | ------------------------------------------------------ |
| `pending`   | 실행 중 스냅샷의 대기 건                               |
| `succeeded` | 작업 성공; `result.replayed`가 true면 기존 성공 재사용 |
| `failed`    | 해당 작업 오류; `error.code` 확인                      |
| `unknown`   | 외부 제출 이후 결과 불명; 확인 전 재시도 금지          |
| `skipped`   | 중단으로 실행하지 않은 건                              |

`summary.succeeded`에는 재사용된 성공도 포함됩니다. `summary.replayed`는 그중 재사용된 수입니다. 배치 상태는 `completed`, `completed-with-errors`, `stopped` 중 하나입니다. 파일 기록 실패 시 `stopReason: OUTPUT_FAILED`로 중단하지만 journal의 성공 이력은 유지됩니다.

## 중단과 재개

- Ctrl+C 한 번: 현재 건의 결과를 기록하고 다음 건부터 실행하지 않습니다.
- Ctrl+C 두 번/강제 종료: 현재 건이 결과 불명으로 남을 수 있습니다. journal과 우체국 내역을 확인하세요.
- 같은 batch-id와 작업ID로 다시 실행: 이미 성공한 행은 재사용하고 미실행 행은 이어갑니다. 파일 행 순서는 바뀌어도 됩니다.
- 제출 전 실패 건: 원인을 해결한 뒤 **같은 요청에** `--retry-failed`를 지정합니다. 기존 키와 결과 불명 상태를 바꾸지 않습니다.
- 요청 내용을 바꾼 소비된 키: `KEY_CONFLICT`로 중단합니다. 실제 결과를 먼저 확인한 뒤 수정한 행에만 새 작업ID를 부여하세요.

배치 ID를 바꾸거나 journal을 지우면 새 작업으로 간주되어 성공한 건도 재접수할 수 있습니다. 단순 재시도를 위해 바꾸지 마세요. 행을 삭제했다고 이미 만들어진 예약이 자동 취소되지는 않습니다.

기본은 첫 오류에서 중단합니다. `--continue-on-error`는 `VALIDATION`, `NOT_FOUND`, `NOT_CANCELABLE`, `OPERATION_FAILED`, `KEY_CONFLICT`만 건너뜁니다. 결과 불명, 인증 오류, 계정 잠금, 기존 임시 목록, 저장 오류 등은 이 옵션과 무관하게 중단합니다. [복구 절차](recovery.md)
