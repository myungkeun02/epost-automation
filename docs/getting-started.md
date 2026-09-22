# 빠른 시작

[문서 홈](README.md) · 다음: [배치 작업](batch.md)

## 1. 설치

Node.js 22.14 이상이 필요합니다. Node 22에서 SQLite 실험적 기능 경고가 나타날 수 있습니다.

```sh
git clone https://github.com/myungkeun02/epost-automation.git
cd epost-automation
npm ci
node bin/epost.js --version
```

## 2. 접속 없이 예제 검사

```sh
node bin/epost.js batch-reserve examples/batch-reservations.json
node bin/epost.js batch-reserve examples/shipments.csv --config examples/config.json --batch-id demo-csv
```

성공하면 `valid: true`, `mode: "dry-run"`, `count: 2`가 출력됩니다. 우체국 접속이나 journal 생성은 하지 않습니다. 잘못된 행이 있으면 `issues`에 데이터 행 번호와 필드를 함께 보여줍니다. 실제 주소 존재나 방문 가능 여부는 이 단계에서 확인하지 않습니다.

## 3. 작업 폴더 만들기

```sh
node bin/epost.js init --dir my-shipping
```

새 폴더에 다음 파일이 생성됩니다. 이미 존재하는 폴더는 덮어쓰지 않습니다.

- `.env`: 로그인·결제 정보 입력 위치
- `config.local.json`: 공통 발송인, 방문일, 택배 규격, journal 경로
- `shipments.local.csv`: 수취인 목록
- `cancellations.local.csv`: 취소 목록
- `.gitignore`: 실제 정보와 journal의 커밋 방지

`2099-01-02`, `00000` 등 가상 예제 값을 실제 정보로 수정하세요. `pickupDate`는 한국 시간 기준 내일 이후 `YYYY-MM-DD`입니다. 설정된 journal은 실행 위치가 달라져도 config 파일 위치를 기준으로 같은 경로를 사용합니다.

## 4. 브라우저와 계정 설정

```sh
npm run browser:install
# my-shipping/.env 파일을 로컬 편집기로 작성
node bin/epost.js doctor --env-file my-shipping/.env --config my-shipping/config.local.json --payment
```

`doctor`는 설치·파일 경로 권한·인증정보 형식만 확인합니다. 실제 로그인과 카드 승인은 하지 않습니다. 조회·취소만 쓰면 카드 설정과 `--payment`가 필요 없습니다. 기존 Chrome/Chromium을 쓰려면 `.env`의 `EPOST_BROWSER_PATH`를 설정합니다.

```sh
node bin/epost.js options --env-file my-shipping/.env
```

이 명령부터 실제 우체국에 로그인합니다. 결과의 `code`와 `label`을 보고 `weightCode`, `sizeCode`, `contentCode`, `locationCode`를 선택하세요. 예제 코드의 의미를 실제 규격으로 추정하지 마세요.

## 5. 실제 실행

```sh
node bin/epost.js batch-reserve my-shipping/shipments.local.csv --config my-shipping/config.local.json --batch-id shipping-001
node bin/epost.js batch-reserve my-shipping/shipments.local.csv --config my-shipping/config.local.json --env-file my-shipping/.env --batch-id shipping-001 --output my-shipping/results.local.json --execute
```

명령을 다시 실행해도 같은 계정·같은 journal·같은 batch-id·같은 작업ID·같은 요청이면 성공 결과를 재사용합니다. `--output`의 상위 폴더는 먼저 존재해야 합니다. 결과 파일 경로가 잘못되어 저장되지 않으면 실행을 시작하지 않습니다.

조회/취소와 중단된 작업 재개는 [배치 작업](batch.md), 오류가 나면 [복구](recovery.md)를 참고하세요. 최초 실서비스 사용은 작은 발송부터 실제 사이트 결과와 대조하며 확인하세요.

## 실행 전 기록 대조

입력 검사를 마친 뒤 같은 계정과 journal의 기록도 확인할 수 있습니다.

```sh
node bin/epost.js batch-reserve my-shipping/shipments.local.csv --config my-shipping/config.local.json --env-file my-shipping/.env --batch-id shipping-001 --preview
```

비밀번호나 카드정보 없이 계정 ID만으로 확인합니다. `completed`는 성공 재사용, `needs-review`는 대조 필요, `conflict`는 같은 키의 입력 변경입니다. 같은 요청이 다른 키에 있으면 중복 의심을 표시합니다. [미리보기 상세](preview.md)를 확인하세요. Windows 사용자는 [PowerShell 시작 안내](windows.md)를 참고하세요.
