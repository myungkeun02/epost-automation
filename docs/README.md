# 문서 안내

원하는 작업부터 시작하세요. 모든 명령은 저장소 루트에서 실행하는 예시입니다.

## 시작하기

1. [빠른 시작](getting-started.md): 설치 → 양식 생성 → 입력 검사 → 설정 확인 → 실행
2. [배치 작업](batch.md): CSV/JSON 형식, 공통 설정, 결과 파일, 중단·재개
3. [실행 전 미리보기](preview.md): 기존 기록과 대조, 중복 의심, 진행 가능 여부
4. [오류와 복구](recovery.md): 오류별 대응, 결과 불명 작업 확인, 안전한 재시도

## 참고 문서

- [Windows 시작하기](windows.md): PowerShell 명령, CSV UTF-8, 경로·파일 잠금 문제
- [CLI](cli.md): 모든 명령과 옵션, 종료코드, 환경변수와 경로 우선순위
- [SDK/API](api.md): 타입, 단건·배치 사용 예제, 진행 콜백, 사용자 정의 어댑터
- [설계와 검토](design.md): 트랜잭션 경계, 동시 실행, 개인정보, 검증 범위
- [업그레이드](migration.md): 0.1 → 0.2 → 0.3 변경점과 기존 기록 유지
- [기여 안내](../CONTRIBUTING.md), [보안 제보](../SECURITY.md), [변경 기록](../CHANGELOG.md)

## 예제 파일

| 파일                                                                                | 용도                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| [batch-reservations.json](../examples/batch-reservations.json)                      | 공통 정보와 2개 수취인이 포함된 완전한 배치 예제 |
| [shipments.csv](../examples/shipments.csv) + [config.json](../examples/config.json) | 한국어 CSV와 공통 발송정보                       |
| [cancellations.csv](../examples/cancellations.csv)                                  | 여러 예약 취소 입력                              |
| [lookups.csv](../examples/lookups.csv)                                              | 여러 예약 조회 입력                              |
| [reservation.json](../examples/reservation.json)                                    | 기존 단건 입력                                   |
| [resolution.json](../examples/resolution.json)                                      | 수동으로 확인한 결과를 복구할 때 쓰는 형식       |

예제는 모두 가상 데이터입니다. 실제 실행 전 사용자 정보와 방문 가능 날짜·코드로 바꿔야 합니다.
