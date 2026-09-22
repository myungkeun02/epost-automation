# Windows에서 시작하기

[문서 홈](README.md) · [빠른 시작](getting-started.md) · [미리보기](preview.md)

Node.js 22.14 이상과 Git이 설치된 Windows PowerShell에서 실행합니다. 아래 명령은 저장소 루트 기준입니다.

```powershell
git clone https://github.com/myungkeun02/epost-automation.git
cd epost-automation
npm.cmd ci
npm.cmd run browser:install
node bin/epost.js init --dir my-shipping
```

`npm.cmd`는 PowerShell의 스크립트 실행 정책을 바꾸지 않고 npm 명령을 실행하는 방법입니다. 이후 명령은 한 줄씩 실행하세요. 다른 문서의 `node bin/epost.js ...` 명령도 그대로 사용할 수 있습니다.

1. `my-shipping/config.local.json`의 발송정보·방문일·규격을 수정합니다.
2. `my-shipping/.env`에 본인 계정과 필요한 결제 정보를 넣습니다.
3. `my-shipping/shipments.local.csv`의 수취인 목록을 작성합니다.
4. 입력 검사와 미리보기를 실행합니다.

```powershell
node bin/epost.js doctor --payment --env-file my-shipping/.env --config my-shipping/config.local.json
node bin/epost.js batch-reserve my-shipping/shipments.local.csv --config my-shipping/config.local.json --batch-id shipping-001
node bin/epost.js batch-reserve my-shipping/shipments.local.csv --config my-shipping/config.local.json --env-file my-shipping/.env --batch-id shipping-001 --preview
```

Excel에서는 전화번호·우편번호·규격 코드 열을 **텍스트**로 지정하고 **CSV UTF-8**로 저장하세요. 이미 숫자로 변환되어 사라진 앞자리 0은 자동 복원하지 않습니다. PowerShell에서 만든 파일도 UTF-8인지 확인하세요. 경로에 공백이 있으면 `--config "C:\My Shipping\config.local.json"`처럼 따옴표로 감쌉니다.

기존 Chrome을 사용할 때는 `.env`에 실제 실행 파일의 절대 경로를 지정할 수 있습니다. 예:

```dotenv
EPOST_BROWSER_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"
```

설치 위치는 환경마다 다르므로 실제 경로를 확인하세요. 경로만 지정해도 브라우저 버전과 실제 우체국 화면 호환성이 보장되는 것은 아닙니다.

실제 입력을 확인한 뒤 다음 명령을 사용합니다.

```powershell
node bin/epost.js batch-reserve my-shipping/shipments.local.csv --config my-shipping/config.local.json --env-file my-shipping/.env --batch-id shipping-001 --output my-shipping/result.local.csv --execute
```

**Excel에서 결과 CSV를 열고 있으면 파일 교체가 막힐 수 있습니다.** 실행 전 결과 파일을 닫으세요. 저장 실패 시 journal을 보존하고 Excel을 닫은 뒤 같은 배치 ID·입력·journal로 다시 실행합니다. 입력 검사, 미리보기와 복구 안내는 실제 접수를 하지 않습니다.

개발용 검사:

```powershell
npm.cmd run check
$env:EPOST_TEST_BROWSER = "1"
node --test test/browser.test.js
Remove-Item Env:EPOST_TEST_BROWSER
```

CI에서 Windows와 macOS는 단위·CLI·타입·패키지 검사를 실행하고, Linux에서 오프라인 Chromium 통합 테스트를 추가 실행합니다. 실제 우체국 계정과 결제 검증은 별도입니다.
