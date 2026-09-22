export function recoveryGuide({ total, items }, key) {
  return {
    mode: "recovery",
    networkUsed: false,
    total,
    truncated: total > items.length,
    items: items.map(({ operation, owner }) => {
      const steps = [];
      const status = operation.status;
      const resolveCommand = `resolve ${key ?? "작업키"}`;
      let action;
      if (status === "succeeded") {
        action = "reuse-result";
        steps.push(
          "동일한 입력과 키로 실행하면 저장된 성공 결과를 재사용합니다. 현재 예약 상태가 필요하면 lookup으로 확인하세요.",
        );
      } else if (status === "failed") {
        action = "retry-after-fix";
        steps.push(
          "제출 전 실패 또는 미접수 확인 기록입니다. 원인을 해결한 뒤 동일한 입력과 키에 --retry-failed를 지정하세요.",
        );
      } else if (status !== "unknown" && owner !== "stopped") {
        action = owner === "running" ? "wait-for-owner" : "verify-owner";
        steps.push(
          "원래 작업 프로세스가 실행 중이거나 종료 여부를 확인할 수 없습니다. 작업이 종료되었는지 먼저 확인하세요. 잠금을 강제로 해제하지 마세요.",
        );
      } else {
        action = "verify-with-korea-post";
        steps.push("원래 작업과 브라우저가 완전히 종료되었는지 확인하세요.");
        steps.push(
          operation.kind === "cancel"
            ? "우체국에서 원래 예약번호의 전체 취소 상태를 확인하세요. 일부 소포만 취소되었다면 성공으로 복구하지 마세요."
            : "우체국 예약 내역의 발송인·수취인·방문일·내용품을 원래 입력과 대조하고 예약번호, 카드 처리, 임시 받는 분 목록을 확인하세요.",
        );
        steps.push(
          `실제 성공을 확인했다면 확인한 예약번호와 status: "${operation.kind === "cancel" ? "canceled" : "reserved"}"로 결과 JSON을 작성하고 ${resolveCommand} --result 파일 --verified를 사용하세요.`,
        );
        steps.push(
          `미접수/미취소를 확인하고 남은 임시 작업도 정리한 경우에만 ${resolveCommand} --not-submitted --verified를 사용하세요. 조회 내역이 비었다는 이유만으로 미접수로 판단하지 마세요.`,
        );
      }
      return { ...(key ? { key } : {}), operation, owner, action, steps };
    }),
    message:
      "이 명령은 journal을 읽고 절차만 안내합니다. 사이트 조회나 복구 기록 변경은 하지 않습니다. 원래 작업 키는 배치 미리보기 또는 실행 명령에서 확인하고 같은 계정·journal을 유지하세요.",
  };
}
