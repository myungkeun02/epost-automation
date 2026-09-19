# epost-automation

[![CI](https://github.com/myungkeun02/epost-automation/actions/workflows/ci.yml/badge.svg)](https://github.com/myungkeun02/epost-automation/actions/workflows/ci.yml)
[English](README.en.md) · [오류와 복구](docs/recovery.md) · [설계·검토 기록](docs/design.md)

**우체국 방문접수소포의 선결제 예약·조회·취소를 자동화하는 비공식 Node.js 라이브러리와 CLI입니다.**

쇼핑몰, 개인 발송 도구, 반품 수거 서비스에서 우체국 웹 업무를 연결할 수 있습니다. 특정 서버 프레임워크나 주문 DB가 필요하지 않습니다.

현재 버전은 **실험적 0.1**입니다. 단위 테스트와 합성 화면을 사용한 Chromium 통합 테스트를 제공합니다. 공개용으로 분리한 이 버전의 실제 우체국 접수·결제·취소 검증은 아직 하지 않았습니다. 우체국 사이트 구조가 바뀌면 어댑터 수정이 필요할 수 있습니다.

## 지원 범위

| 기능                               | 지원                                                        |
| ---------------------------------- | ----------------------------------------------------------- |
| 로그인 및 방문접수소포 선결제 예약 | 한 요청에 소포 1개                                          |
| 예약 조회                          | 예약번호로 예약/취소/확인 필요 상태 조회                    |
| 전체 예약 취소                     | 취소 후 잔여 수량 재확인                                    |
| 코드 목록 조회                     | 현재 화면의 중량·크기·내용품·보관장소 선택지                |
| 중복 실행 보호                     | 영구 작업 키, 요청 내용 충돌 감지, 계정 단위 동시 실행 제한 |
| 결과 불명 복구                     | 자동 재접수 없이 수동 확인 후 작업 기록 복구                |

배송 이동 이력 추적, 계약택배 API, 다건 일괄 접수, 부분 취소, 착불, 영수증 발송은 지원하지 않습니다. 로그인 계정과 선결제에 사용할 카드 정보는 사용자가 제공합니다. 추가 인증이 나타나면 중단되며 이를 우회하지 않습니다. [우체국 서비스 안내](https://parcel.epost.go.kr/auth.EpostLogin.parcel)에서 예약조회/취소와 배달조회는 서로 다른 기능입니다.

## 5분 안에 입력 검사하기

Node.js **22.14 이상**이 필요합니다. Node 22에서는 내장 SQLite에 대한 실험적 기능 경고가 나타날 수 있습니다. 별도 컴파일은 없습니다.

```sh
git clone https://github.com/myungkeun02/epost-automation.git
cd epost-automation
npm ci
node bin/epost.js validate examples/reservation.json
```

예제의 주소·연락처·날짜는 모두 가상입니다. 위 명령은 형식만 검사하며 우체국에 접속하지 않습니다. 주소의 실제 존재나 방문 가능 여부까지 검증하는 것은 아닙니다.

실제 사용 전 Chromium을 설치하고 환경변수를 준비합니다.

```sh
npm run browser:install
cp .env.example .env
# .env의 로그인·카드 항목을 로컬에서 작성합니다.
node --env-file=.env bin/epost.js options
```

`options` 결과의 `code`와 `label`을 보고 `weightCode`, `sizeCode`, `contentCode`, `locationCode`를 선택합니다. 코드 의미를 임의로 추정하거나 예제의 값을 그대로 실제 발송에 사용하지 마세요. 사용자가 지정한 코드가 현재 화면에 없으면 제출 전에 중단합니다.

## CLI

예제를 `request.local.json`에 복사한 뒤 실제 발송정보로 수정합니다. `pickupDate`는 한국 시간 기준 내일 이후의 `YYYY-MM-DD`이며, 실제 방문 가능일인지 사이트에서도 확인합니다. 지정한 날짜·시간대가 없으면 다른 일정으로 바꾸지 않습니다. 시간대를 생략하면 해당 날짜의 첫 번째 가능한 시간대를 선택합니다.

```sh
# 기본 동작: 입력 검사만 수행
node bin/epost.js reserve request.local.json --key order-001

# 실제 접수: 로그인과 카드 정보 필요
node --env-file=.env bin/epost.js reserve request.local.json --key order-001 --execute

# 예약 조회: 로그인만 필요
node --env-file=.env bin/epost.js lookup YOUR_RESERVATION_NUMBER

# 취소: examples/cancellation.json 형식의 로컬 파일을 준비
node --env-file=.env bin/epost.js cancel cancel.local.json --key cancel-001 --execute

# 저장된 실행 상태 확인: EPOST_USERNAME만 필요
node --env-file=.env bin/epost.js operation order-001
```

`--headed`로 브라우저를 표시할 수 있습니다. 기존 Chromium/Chrome을 쓰려면 `EPOST_BROWSER_PATH`에 실행파일 경로를 지정합니다. 운영 브라우저는 Chromium sandbox를 활성화하므로 Linux 컨테이너에서는 sandbox를 지원하는 일반 사용자 환경이 필요합니다.

CLI 종료코드: 성공 `0`, 입력/일반 오류 `1`, **결과 불명 `3`**. `3`은 다시 접수하라는 뜻이 아닙니다. [복구 절차](docs/recovery.md)를 따르세요. 환경변수 파일은 자동으로 읽지 않으므로 `--env-file`을 사용하거나 실행 환경에 변수를 설정해야 합니다.

## JavaScript / TypeScript

아직 npm registry에 게시하지 않았습니다. GitHub 소스로 설치할 수 있습니다.

```sh
npm install github:myungkeun02/epost-automation
npx playwright-core install chromium
```

```js
import { EpostClient, KoreaPostWeb } from "@myungkeun02/epost-automation";

const client = new EpostClient({
  journalPath: "./.epost/operations.sqlite",
  provider: new KoreaPostWeb({
    credentials: {
      username: process.env.EPOST_USERNAME,
      password: process.env.EPOST_PASSWORD,
      card: {
        number: process.env.EPOST_CARD_NUMBER,
        expiry: process.env.EPOST_CARD_EXPIRY, // MMYY
        passwordPrefix: process.env.EPOST_CARD_PASSWORD_PREFIX,
        identity: process.env.EPOST_CARD_IDENTITY, // 생년월일 6자리 또는 사업자번호 10자리
      },
    },
  }),
});

try {
  // request는 examples/reservation.json 형식의 실제 발송정보입니다.
  const result = await client.reserve(request, { idempotencyKey: "order-001" });
  const status = await client.lookup(result.reservationNumber);
  console.log(status.status); // reserved | canceled | unknown
} finally {
  client.close();
}
```

라이브러리의 `reserve`와 `cancel`은 실제로 실행합니다. 네트워크 없는 사전 검사는 `validateReservation(request)`와 `validateCancellation(request)`를 사용하세요. 객체 대신 `credentials: async () => ...`와 `username`을 지정해 비밀 관리 서비스에 연결할 수도 있습니다. 반환한 계정이 `username`과 다르면 실행하지 않습니다. 조회·취소에는 카드 정보가 필요하지 않습니다.

## 중복과 장애를 다루는 방식

- **같은 작업 키 + 같은 요청:** 이미 성공했다면 저장된 결과를 반환합니다. 현재 배송 상태가 아니라 해당 작업의 결과입니다. 현재 상태는 `lookup`으로 조회합니다.
- **같은 작업 키 + 다른 요청:** `KEY_CONFLICT` 오류로 중단합니다.
- **같은 계정의 동시 작업:** SQLite 트랜잭션으로 한 작업만 허용합니다. 조회 중 새 접수도 막습니다.
- **제출 이후 통신 오류·프로세스 종료·저장 실패:** 성공/실패를 추측하지 않습니다. 잠금을 유지하고 확인 없이 재접수하지 않습니다.
- **우체국에 남아 있는 임시 받는 분 목록:** 자동으로 삭제하지 않고 `EXISTING_DRAFT`로 중단합니다.
- **취소 불가 항목이 섞인 예약:** 일부만 취소하지 않고 `NOT_CANCELABLE`로 중단합니다.

이 보호는 **같은 계정에 같은 영구 journal 파일을 사용하는 프로세스들**에 적용됩니다. 다른 DB, 별도 장비, 사람이 직접 조작하는 우체국 화면, 다른 자동화 도구까지 제어하지 않습니다. 외부 우체국 처리와 로컬 DB를 하나의 트랜잭션으로 묶을 수 없으므로 exactly-once를 보장하지 않습니다. SDK와 우체국 화면에서 같은 계정을 동시에 조작하지 마세요.

기본 SQLite 저장소는 한 장비의 로컬 디스크용입니다. NFS·공유 네트워크 디스크나 여러 서버에 파일을 복제하는 방식은 지원하지 않습니다. 주문 DB와 연결할 때는 외부 네트워크 호출 동안 주문 트랜잭션을 열어 두지 말고 [outbox 연동 예시](docs/design.md)를 참고하세요.

## 데이터와 테스트

공개 오류에는 페이지 원문·카드·쿠키·주소가 들어가지 않습니다. Journal에는 요청 전체 대신 해시, 작업 상태, 예약번호, 결과와 복구 이력이 저장됩니다. 쿠키·브라우저 trace를 저장하지 않습니다. Journal의 예약번호도 운영 데이터이므로 접근을 제한하고 보관정책을 정하세요. 원본 작업 키 대신 주문 식별용 불투명한 키를 쓰는 것을 권합니다.

```sh
npm run check
# Chromium을 설치한 뒤 전체 브라우저 통합 테스트 실행
EPOST_TEST_BROWSER=1 npm test
```

브라우저 테스트는 네트워크를 오프라인으로 설정하고 모든 요청을 합성 HTML/XML로 대체합니다. 실제 계정이나 실제 결제 없이 화면 입력, 예약 확인, 취소, 응답 유실과 중복 POST 방어를 검사합니다. 이것은 실제 사이트와의 현재 호환성을 보증하는 검증은 아닙니다.

## 기여와 라이선스

[기여 안내](CONTRIBUTING.md) · [보안 제보](SECURITY.md) · [MIT License](LICENSE)

우체국 공식 SDK가 아니며 우체국과 제휴 관계가 없습니다. 본인에게 사용 권한이 있는 계정과 발송정보로 이용하세요.
