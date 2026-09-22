# epost-automation

[![CI](https://github.com/myungkeun02/epost-automation/actions/workflows/ci.yml/badge.svg)](https://github.com/myungkeun02/epost-automation/actions/workflows/ci.yml)
[English](README.en.md) · [문서 전체 보기](docs/README.md) · [변경 기록](CHANGELOG.md)

**우체국 방문접수소포의 선결제 예약·조회·취소를 자동화하는 비공식 SDK와 CLI.**

CSV 수취인 목록을 한 번에 처리하고, 중간에 끊겨도 같은 작업을 다시 실행해 이어갈 수 있습니다. 공통 발송정보를 한 번만 설정하고 건별 결과를 JSON/CSV로 받아보세요. 특정 서버 프레임워크나 주문 DB가 필요하지 않습니다.

## 무엇을 할 수 있나요?

| 할 일                          | 기능                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| 여러 건 접수·조회·취소         | CSV/JSON 배치, 최대 1,000행, 순차 처리                      |
| 같은 발송정보 반복 입력 줄이기 | 공통 발송인·방문일·규격 설정, 한국어 CSV 열 이름            |
| 중단된 작업 이어 하기          | 성공 건 재사용, 실패·결과 불명·미실행 구분                  |
| 오류 원인 파악                 | 전체 행 사전 검사, 진행률, 건별 결과 파일, 작업 이력        |
| 처음 설치하기                  | `init` 양식 생성, `doctor` 설치·설정 진단, 명령별 도움말    |
| 서비스에 연결하기              | JavaScript SDK, TypeScript 타입, 배치 진행 콜백과 중단 신호 |

배치는 **상자마다 독립 예약을 만드는 방식**입니다. 한 예약번호에 여러 상자를 묶는 기능이나 전체 배치의 원자적 결제를 뜻하지 않습니다. 같은 계정에서 한 건씩 처리하며, 브라우저 프로세스는 재사용하고 각 건의 로그인 context는 분리합니다.

## 바로 확인하기

Node.js **22.14 이상**이 필요합니다. 별도 빌드는 없습니다.

```sh
git clone https://github.com/myungkeun02/epost-automation.git
cd epost-automation
npm ci

# 계정·브라우저 없이 가상 예제 2건의 입력 검사
node bin/epost.js batch-reserve examples/batch-reservations.json

# 실제 작업용 설정과 CSV 양식 생성
node bin/epost.js init --dir my-shipping
```

생성된 파일의 가상 발송정보와 날짜를 수정하세요. 실제 접속 전에는 다음 순서로 설정합니다.

```sh
npm run browser:install
# my-shipping/.env에 본인 계정과 결제 정보를 로컬에서 입력
node bin/epost.js doctor --env-file my-shipping/.env --config my-shipping/config.local.json --payment
node bin/epost.js options --env-file my-shipping/.env

# 기본은 전체 입력 검사
node bin/epost.js batch-reserve my-shipping/shipments.local.csv --config my-shipping/config.local.json --batch-id shipping-001

# 실제 실행과 건별 결과 저장
node bin/epost.js batch-reserve my-shipping/shipments.local.csv --config my-shipping/config.local.json --env-file my-shipping/.env --batch-id shipping-001 --output my-shipping/results.local.json --execute
```

**다시 실행할 때 같은 파일·같은 batch-id·같은 journal을 사용하세요.** 성공한 건은 재접수하지 않습니다. 제출 전 실패 건의 명시적 재시도에는 `--retry-failed`를 사용합니다. 결과 불명 건은 이 옵션으로도 다시 접수하지 않습니다. [배치 사용법과 재개](docs/batch.md)

## 실행 전 확인과 복구

```sh
# 기존 성공·실패·결과 불명·동일 요청 중복 의심 확인 (로그인하지 않음)
node bin/epost.js batch-reserve my-shipping/shipments.local.csv --config my-shipping/config.local.json --env-file my-shipping/.env --batch-id shipping-001 --preview

# 미해결 작업과 다음 확인 절차 (상태를 변경하지 않음)
node bin/epost.js recovery --config my-shipping/config.local.json --env-file my-shipping/.env
```

완료 건 재사용에는 건 사이 대기를 적용하지 않습니다. 실제 사이트 요청 사이에는 지정한 간격을 유지합니다. 미리보기·작업 이력·복구 안내는 journal을 읽기 전용으로 열며 파일이 없어도 새로 만들지 않습니다. [미리보기의 상태와 중복 경고](docs/preview.md) · [Windows 안내](docs/windows.md)

## 문서

| 상황                                         | 읽을 문서                            |
| -------------------------------------------- | ------------------------------------ |
| 처음 설치하고 첫 파일을 검사하고 싶어요      | [빠른 시작](docs/getting-started.md) |
| CSV 양식과 여러 건 실행·중단·재개가 궁금해요 | [배치 작업](docs/batch.md)           |
| 명령과 옵션을 찾고 있어요                    | [CLI 참고](docs/cli.md)              |
| 코드에서 사용하고 싶어요                     | [SDK/API 참고](docs/api.md)          |
| 실패한 작업을 처리해야 해요                  | [오류와 복구](docs/recovery.md)      |
| 동작 원리와 보장 범위를 확인하고 싶어요      | [설계와 검토](docs/design.md)        |
| 이전 버전에서 업데이트하고 싶어요            | [업그레이드 안내](docs/migration.md) |

## 현재 지원 범위

현재는 **실험적 0.3** 버전입니다. 기존에 사용하던 사이트 연동 로직을 기반으로 하며 단위·오프라인 Chromium 통합 테스트를 제공합니다. 공개용 분리 및 변경 이후의 실제 우체국 로그인·카드 인증·접수·취소 호환성은 아직 별도로 검증하지 않았습니다.

방문접수소포의 선결제 웹 흐름을 지원합니다. 계약택배 API, 착불, 한 예약번호에 여러 상자, 부분 취소, 배송 이동 이력 추적, 영수증 발송은 지원하지 않습니다. 조회·취소에는 로그인 정보만, 접수에는 카드 정보도 필요합니다. 중량·크기·내용품 코드는 `options`에서 현재 화면의 선택지를 확인해 지정하세요.

외부 우체국 처리와 로컬 작업 기록은 하나의 트랜잭션이 아닙니다. 중복 보호는 같은 계정에 **같은 로컬 영구 journal 파일**을 사용하는 프로세스 사이에 적용되며, 다른 장비·다른 DB·직접 웹 조작까지 제어하지 않습니다. 결과 불명 시에는 작업 기록을 지우지 말고 [복구 절차](docs/recovery.md)를 따르세요.

## 개발·기여

```sh
npm run check
# 브라우저 설치 후
EPOST_TEST_BROWSER=1 npm test
```

브라우저 테스트는 오프라인 합성 화면을 사용합니다. 실제 계정이나 결제로 테스트하지 않습니다. npm registry에는 아직 게시하지 않았으며 SDK는 `npm install github:myungkeun02/epost-automation`으로 설치할 수 있습니다.

[기여 안내](CONTRIBUTING.md) · [보안 제보](SECURITY.md) · [MIT License](LICENSE)

우체국 공식 SDK가 아니며 제휴 관계가 없습니다.
