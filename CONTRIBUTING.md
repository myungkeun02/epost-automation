# 기여 안내

Node.js 22.14 이상에서 `npm ci`, `npm run check`로 시작합니다. 브라우저 검증은 `npm run browser:install` 후 `EPOST_TEST_BROWSER=1 npm test`로 실행합니다. 기존 Chrome을 쓰려면 `EPOST_TEST_BROWSER_PATH`를 설정하세요. CI는 가짜 계정과 합성 화면만 사용합니다.

변경 전후 동작, 재현 조건과 검증 결과를 PR에 적어주세요. 우체국 DOM 변경은 합성 fixture도 함께 수정하고, 접수/취소 같은 외부 변경 앞의 `beforeSubmit` 호출 순서를 보존해야 합니다. 결과가 불명확한 작업의 자동 재시도나 TTL 잠금 해제를 추가하지 마세요.

실제 이름·주소·전화번호·예약 내역·카드·쿠키·인증정보·우체국 페이지 원문을 이슈나 테스트에 첨부하지 마세요. 재현 자료는 가상 값으로 다시 구성합니다. `npm run format`으로 형식을 맞춥니다.

새 공개 API를 추가하면 `src/index.d.ts`, 사용 예제, 테스트를 함께 갱신합니다. 이 저장소에는 빌드 단계가 없습니다.
