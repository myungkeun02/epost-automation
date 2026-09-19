const messages = {
  BATCH_VALIDATION:
    "배치 입력에 오류가 있습니다. issues의 행 번호와 필드를 확인하세요.",
  INPUT_FILE: "입력 파일의 인코딩·구조·크기를 확인하세요.",
  OUTPUT_FILE:
    "결과 파일을 안전하게 저장할 수 없습니다. 경로와 권한을 확인하세요.",
  UNSUPPORTED: "현재 어댑터에서 지원하지 않는 기능입니다.",
  VALIDATION: "입력값을 확인하세요.",
  ACCOUNT_BUSY: "이 계정에 진행 중이거나 확인이 필요한 작업이 있습니다.",
  KEY_CONFLICT: "동일한 작업 키가 다른 요청에 사용되었습니다.",
  OPERATION_FAILED:
    "제출 전 실패 또는 미접수 확인 이력이 있습니다. 원인을 해결하고 명시적으로 재시도하세요.",
  OUTCOME_UNKNOWN:
    "외부 처리 결과를 확정할 수 없습니다. 다시 접수하지 말고 예약 내역을 확인하세요.",
  PROVIDER_FAILURE:
    "우체국 페이지 처리에 실패했습니다. 로그인 상태, 입력값 또는 사이트 변경을 확인하세요.",
  AUTHENTICATION:
    "우체국 로그인에 실패했습니다. 인증정보 또는 추가 인증 필요 여부를 확인하세요.",
  NOT_FOUND: "예약을 찾지 못했습니다.",
  NOT_CANCELABLE:
    "전체 취소가 가능한 예약이 아닙니다. 우체국에서 예약 상태를 확인하세요.",
  EXISTING_DRAFT:
    "우체국에 작성 중인 받는 분 목록이 있습니다. 직접 확인하고 정리한 후 다시 실행하세요.",
  STORAGE: "작업 기록을 안전하게 저장할 수 없습니다. 저장소를 확인하세요.",
  RECOVERY_REQUIRED:
    "복구 조건을 확인하세요. 실행 프로세스를 종료하고 실제 예약 내역을 대조해야 합니다.",
};

export class EpostError extends Error {
  constructor(code, { operationId, field, issues } = {}) {
    super(messages[code] ?? messages.PROVIDER_FAILURE);
    this.name = "EpostError";
    this.code = Object.hasOwn(messages, code) ? code : "PROVIDER_FAILURE";
    if (operationId) this.operationId = operationId;
    if (field) this.field = field;
    if (issues) this.issues = issues;
  }
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.operationId ? { operationId: this.operationId } : {}),
      ...(this.field ? { field: this.field } : {}),
      ...(this.issues ? { issues: this.issues } : {}),
    };
  }
}

export function safeError(error, fallback = "PROVIDER_FAILURE") {
  // Do not attach an upstream cause: Playwright errors can contain form values,
  // URLs, response bodies, credentials or recipient information.
  return error instanceof EpostError ? error : new EpostError(fallback);
}
