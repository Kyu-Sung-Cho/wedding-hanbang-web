# AI 기록 보관 파기 실행 결과 확인

상태: 관측 코드/회귀 검증의 운영 방법. 실제 운영 완료 영수증이 아니다.

## 기록되는 범위

`/api/cron/ai-log-retention`은 정상 인증 후 `ai_log_retention_run` 이벤트(version1)를 남긴다. HTTP200이어도 비활성이면 `disabled`이며 파기 완료가 아니다. 활성 호출은 `started` 이후 다음 결과 중 하나를 남긴다.

| status | 의미 | 건수 |
|---|---|---|
| disabled | 앱의 파기 설정 비활성, DB 미호출 | 두 건수 null |
| started | 활성 호출 시작, 아직 결과 없음 | 두 건수 null |
| completed | 두 RPC 모두 안전한 비음수 정수를 반환 | redacted / purgedAdminAccess 둘 다 확인됨; 0도 유효 |
| failed | 첫 처리 결과까지 확인하지 못함 | 두 건수 null; failedStep으로 client/ai_interactions 구분 |
| partial | 첫 처리 완료 뒤 관리자 기록 처리 실패 또는 결과 불명 | redacted 확인됨, purgedAdminAccess null |

RPC 통신 오류는 DB 변경이 전혀 없었다는 증거가 아니다. `null`은 미확인이며0으로 바꾸지 않는다. `started`만 있고 terminal 결과가 없으면 시간 초과·중단·로그 누락을 조사한다. 원문 메시지·SQL·고객 식별자·요청 URL/헤더/비밀키는 이벤트에 넣지 않는다. 환경의 배포ID·Git SHA도 형식을 확인하며 없거나 잘못된 값은null이다.

실패/부분 실패는 고정된 단계 문구로 기존 오류 알림 경로에도 전달한다. JSON 출력과 오류 알림은 각각 시도하며 한쪽 기록 장애로 RPC를 재시도하거나 API 응답을 바꾸지 않는다. 이 코드는 외부 알림의 실제 수신까지 보장하지 않는다.

## 운영에서 확인하는 순서

1. 현재 실제 도메인이 가리키는 운영 배포ID와 source commit을 확인한다.
2. Vercel 프로젝트의 Runtime Logs에서 그 배포와 `/api/cron/ai-log-retention` 경로, 유한한 시간 범위를 선택한다. `ai_log_retention_run`으로 결과 이벤트를 찾는다.
3. 같은 `runId`의 시작/결과, 배포/커밋, `occurredAt`, 활성 상태, 두 건수를 대조한다. 다른 배포·preview·비활성·합성 테스트의 이벤트로 운영 완료를 대신하지 않는다.
4. 예약 실행은 플랫폼의 해당 요청 시각/경로와 예약 설정을 함께 대조한다. user-agent 또는 serverless source만으로 예약 발신을 확정하지 않는다.
5. 원문이나 고객 데이터를 내려받지 않고 위 고정 필드와 플랫폼 요청 식별자·확인 시각만 운영 기록에 남긴다. 기록이 없거나 범위가 잘렸으면 완료가 아니라미확인이다.

현재 CLI의 읽기 명령 형태(실제 배포ID로 대체):

```text
vercel logs dpl_ACTUAL_DEPLOYMENT_ID --scope hanbang --environment production --query ai_log_retention_run --since 24h --limit 100 --json
```

이 명령은 기존 로그만 조회한다. 증거를 만들려고 cron URL을 직접 호출하지 않는다. cron 호출은 실제 자료를 비식별화/파기한다.

정상 예약은 `apps/web/vercel.json`의 `30 18 * * *`(UTC18:30 / 한국시간 다음날03:30)이다. 예약 등록과 앱 활성 설정, 실제 완료는 별도다. 기간90일/365일, 활성 설정, RPC 및 예약은 이번 관측 코드에서 변경하지 않는다.

## 한계와 보관

Vercel runtime 로그는 영구 감사 저장소가 아니다. 조회 가능 기간·보관 경로 안에서 확인하고 필요한 비식별 결과를 운영 기록으로 보존한다. 이 관측 추가로 과거 완료 건수를 소급 복원하거나 실제 제품 탈퇴·Storage 삭제·백업 복구 완료를 선언하지 않는다.

[Vercel Runtime Logs](https://vercel.com/docs/logs/runtime) · [Vercel 시스템 환경변수](https://vercel.com/docs/environment-variables/system-environment-variables)
