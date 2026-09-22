export const commands = {
  init: ["init --dir my-shipping", "설정·CSV 양식 생성 (새 폴더만 가능)"],
  doctor: ["doctor [--payment]", "설치·로그인·결제 설정 형식 진단 (오프라인)"],
  validate: ["validate request.json", "단건 접수 입력 검사"],
  reserve: [
    "reserve request.json --key order-001 [--execute]",
    "단건 접수; 기본은 입력 검사",
  ],
  cancel: [
    "cancel cancel.json --key cancel-001 [--execute]",
    "단건 취소; 기본은 입력 검사",
  ],
  lookup: ["lookup 예약번호", "예약 상태 조회"],
  options: ["options", "현재 사이트의 중량·크기·내용품 코드 목록"],
  "batch-reserve": [
    "batch-reserve shipments.csv --batch-id shipment-001 [--execute]",
    "CSV/JSON 여러 건 접수; 전체 사전 검사 및 건별 기록",
  ],
  "batch-cancel": [
    "batch-cancel cancellations.csv --batch-id cancellation-001 [--execute]",
    "CSV/JSON 여러 건 취소",
  ],
  "batch-lookup": [
    "batch-lookup reservations.csv --batch-id lookup-001 [--execute]",
    "CSV/JSON 여러 건 조회; --execute일 때 사이트 접속",
  ],
  history: [
    "history [--status unknown] [--limit 20]",
    "계정의 최근 작업 기록 조회",
  ],
  recovery: [
    "recovery [작업키] [--limit 20]",
    "미해결 작업 목록과 상태별 복구 절차 (읽기 전용)",
  ],
  operation: ["operation 작업키", "특정 작업 상태 조회"],
  resolve: [
    "resolve 작업키 (--result result.json | --not-submitted) --verified",
    "실제 사이트를 대조한 뒤 결과 불명 작업 복구",
  ],
};
const common = `공통 옵션:
  --env-file .env             명시한 환경변수 파일 로드 (기존 환경변수 우선)
  --config config.local.json  공통 발송정보와 journal 경로
  --journal 경로             영구 작업 기록; 모든 실행에서 같은 파일 사용
  --headed                   브라우저 표시
  --json                     JSON 출력 (파이프/파일 출력은 기본 JSON)

배치 옵션:
  --preview                  journal과 대조한 실행 전 미리보기 (계정 ID 필요)
  --output results.json|csv   건별 완료 시 결과 파일 갱신 (입력 원문 제외)
  --continue-on-error        안전한 건별 오류만 건너뛰고 진행
  --retry-failed             제출 전 실패/미접수 확인 건만 같은 키로 재시도
  --interval 1000            건 사이 대기 시간, 밀리초 (기본 1000)
  --format csv|json          표준입력(-) 등 입력 형식을 직접 지정
  --quiet                    진행률 숨기기

같은 파일과 같은 batch-id로 다시 실행하면 성공한 건은 재접수하지 않습니다.
결과 불명 건은 --retry-failed로도 재시도하지 않습니다.
Ctrl+C 한 번: 현재 건이 끝나면 중지. 두 번: 강제 종료.
미리보기와 recovery는 사이트 접속이나 작업 상태 변경을 하지 않습니다.
예제와 상세 사용법: https://github.com/myungkeun02/epost-automation/tree/main/docs
`;
export function help(command) {
  if (command && commands[command])
    return `epost-automation ${commands[command][0]}\n${commands[command][1]}\n\n${common}`;
  return `epost-automation — 우체국 방문접수소포 자동화 (비공식)\n\n${Object.entries(
    commands,
  )
    .map(([name, [, description]]) => `  ${name.padEnd(16)} ${description}`)
    .join(
      "\n",
    )}\n\n명령별 도움말: help batch-reserve 또는 batch-reserve --help\n\n${common}`;
}
export function nextStep(code) {
  return (
    {
      VALIDATION: "표시된 field를 수정하고 입력 검사를 다시 실행하세요.",
      BATCH_VALIDATION:
        "issues의 행과 필드를 모두 수정하세요. 사이트 작업은 시작하지 않았습니다.",
      INPUT_FILE:
        "UTF-8 CSV/JSON, 알려진 열 이름, 2 MiB 이하 파일인지 확인하세요.",
      OUTPUT_FILE:
        "결과 파일 경로와 권한을 확인하세요. 작업 기록을 지우지 마세요.",
      AUTHENTICATION:
        "doctor로 설정을 확인하고 우체국에서 로그인/추가 인증을 확인하세요.",
      KEY_CONFLICT:
        "같은 키의 원래 요청을 확인하세요. 이미 성공한 요청의 키를 바꾸면 중복 접수될 수 있습니다.",
      OPERATION_FAILED:
        "원인을 해결한 뒤 동일한 입력에 --retry-failed를 지정할 수 있습니다.",
      ACCOUNT_BUSY:
        "recovery/operation으로 진행 중 또는 확인 대기 중인 작업을 확인하세요.",
      OUTCOME_UNKNOWN:
        "recovery 작업키로 다음 절차를 확인하세요. 우체국 내역 대조 전 재접수하지 마세요.",
      EXISTING_DRAFT:
        "우체국 받는 분 임시 목록을 직접 확인하세요. 자동 삭제하지 않습니다.",
    }[code] ?? "help와 docs/recovery.md를 확인하세요."
  );
}
