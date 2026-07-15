# 소비자 여정·보안·아모라 출시 감사

> **역사적 스냅샷:** 아래 테스트 수·107개 migration·preview `/api/chat` 결과는 2026-07-11 당시 후보의 증거이며 현재 작업트리나 출시 승인서가 아니다. 현재 NO-GO 사유와 최신 수치는 [`codex-tasks/FULL_QA_2026-07-12.md`](./codex-tasks/FULL_QA_2026-07-12.md), 실제 운영 순서는 [`PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md`](./PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md)를 우선한다.

## 2026-07-11 재검증 업데이트

이 절이 아래의 초기 감사 기록보다 우선한다. 초기 기록은 당시의 보수적 판단과 발견 경위를 보존하되, 현재 검증 상태는 다음 증거로 판단한다.

### 새로 확인된 것

- 폐기 가능한 Supabase preview를 완전히 비운 뒤 baseline부터 `20260711148000`까지 migration 107개를 연속 재실행했다. DB lint, 함수 50개·cron 5개·직접 호출 차단 trigger 함수와 실제 binding 각 8개의 exact contract도 통과했다.
- 커플 합류·초기화·차단된 초대 코드·legacy 6자리 코드 복구·구성원 0명 커플 거부·계정 삭제 격리를 실제 PostgreSQL lifecycle smoke로 검증했다.
- anon key로 민감 테이블 10개를 조회했을 때 모두 정확한 권한 거부가 발생했다.
- AI 보존 함수와 persistent rate-limit RPC에 남아 있던 anon/auth 실행 권한을 제거했다. rate-limit은 service role과 `rl:` + 64자리 해시 키만 허용하고, 인증 사용자 subject는 탈퇴 lifecycle FK·잠금·cascade로 정리한다. service role도 bucket의 직접 INSERT/UPDATE는 할 수 없고 canonical RPC만 쓰도록 고정해 계정 삭제와의 잠금 순서 역전을 막았다. 업체 이미지·사업자등록증의 일반 사용자 업로드는 provenance·보존 정책이 승인될 때까지 차단한다.
- 최종 DB 상태와 production-like rate-limit secret 조건에서 실제 OpenAI 호출로 `gpt-5.6-luna`와 `gpt-5.6-terra`의 SSE 스트리밍, 동일 요청 replay, 단일 메시지 저장, 정확한 감사 모델 기록을 확인했다. 마지막 fresh reset 뒤 응답 길이는 각각 259자와 386자였고 테스트 데이터는 정리했다.
- Web Vitest 120개 파일·833개 테스트와 모바일 UX 11개 테스트, 전체 typecheck·lint, 104개 정적 페이지 production build, 모바일 release check 56개, production dependency audit가 모두 통과했다.
- 웹은 새 커플 공간 요청이 전송된 뒤 응답이 유실돼도 이전 여정을 계속 편집하지 않고 새로고침한다. 모바일은 새 couple ID를 확인하기 전까지 편집 데이터를 비우고 복구 전용 화면으로 막는다.
- OpenAI 런타임에서 Anthropic 호출은 사용하지 않으며 기본 Luna, 제한된 고난도 조건에서만 Terra로 승격한다.
- 실제 브라우저에서 데스크톱과 375×812 모바일의 웨딩 홈·WeddingCode·로그인·maintenance·아모라 인증 리다이렉트를 재검증했다. 커뮤니티 초기 빈 feed의 무한 skeleton, 모바일 카테고리 줄바꿈, 로그인 자동완성, WeddingCode 진행률 설명, 인증 변경 시 이전 사용자의 투표·북마크 캐시와 늦은 feed 응답 경합을 수정했다.
- 과거 개발 계획 문서에 실제 카카오 플랫폼 키 3개가 2026-04-09부터 Git 이력과 현재 tree에 남아 있음을 독립 검증했다. 저장소는 private이지만 모든 repo reader와 clone에는 노출됐으므로 현재 문서에서 값을 제거하고 추적 파일 secret scan을 QA 첫 단계에 추가했다. Kakao 콘솔의 키 교체·기존 키 삭제·제한 설정·사용량 감사와 조율된 이력 정리는 아직 남아 있다.

### 아직 확인되지 않은 것

- tool follow-up, 실제 PDF·이미지 입력, refusal, abort, 429/5xx, 장시간 스트림 단절의 실비용 canary
- 높은 동시성에서의 quota 경쟁, KST 일일 경계, `pg_cron` 장시간 운용과 장애 복구
- 운영 스냅샷 clone에서의 전체 upgrade·lock 시간·rollback rehearsal
- 실제 운영 Vercel 환경 변수와 배포 SHA, production URL canary
- 법률·개인정보 처리 주체, DPA, 국외 이전, 보존·삭제 고지의 최종 승인

### 출시 판정

코드·preview·OpenAI 실제 호출 검증은 크게 진전됐지만 **운영 배포는 아직 NO-GO**다. 운영에는 초대 코드·legacy Amora·개인정보·계정 삭제 관련 정합성 blocker가 남아 있고, 직접 DB/Storage 쓰기 차단 증거가 `not_configured`이며, maintenance 이후 완료 백업과 Vercel 운영 환경 검증도 없다. 따라서 이 감사는 “OpenAI 전환과 새 체인이 작동함”을 입증하지만 “운영 배포 완료”를 의미하지 않는다.

---

감사 기준일: 2026-07-11
현재 서비스 기준: [`../WEDDINGHANBANG_SERVICE_DOC.md`](../WEDDINGHANBANG_SERVICE_DOC.md)
대상: 웹, 모바일, 공유 패키지, Supabase migration/RLS/RPC, 아모라 런타임, 공개 문구, 개인정보·약관, 저장소 문서와 Git 이력

> 이 문서는 2026-07-11 브랜치 코드의 보수적 출시 판정이다. `CONSUMER_JOURNEY_AND_AMORA_REVIEW_2026-07-11.md`보다 이 문서를 우선한다.
> 코드·정적 계약·로컬 테스트와 실제 운영 상태를 구분한다. OpenAI 키, 원격 Supabase, OAuth 공급자, 실기기와 외부 처리자 계약 없이 확인하지 못한 항목은 통과로 간주하지 않는다.

## 결론

### 현재 판정

- 코드 병합 준비: **로컬 전체 테스트·lint·production build 통과. 아래 운영 게이트를 전제로 조건부 가능**
- 제한된 내부/초대 베타: **스테이징 DB·권한·2인 계정 검증 후 조건부 가능**
- 불특정 다수 공개 베타: **보류**
- 유료 거래·예약 확정·전자계약 서비스: **출시 불가**
- 2026-07-11 신규 Supabase migration: **저장소 코드만 존재하며 운영 적용 미확인**

사용자가 느끼는 정직성, 채팅 실패 복구와 비용 통제는 좋아졌다. 업체 연결은 `BOOKING_REQUESTS_ENABLED=false`로 인증·본문 파싱·PII 저장 전에 차단했지만, 이 상태를 실제 전달 기능으로 설명하면 안 된다. 정식 법적 주체와 개인정보 보호책임자가 확정되기 전에는 추가 PII를 처리하는 공개 베타를 차단한다. 아모라 비용 원장, 예약 RPC, 업체 승인, 커뮤니티 검수, 보존 삭제 job도 실제 PostgreSQL/JWT 동시성·권한 probe 전까지 운영 안전으로 인정하지 않는다.

### 보수 점수

점수는 현재 코드 설계와 확인 가능한 증거에 대한 평가이며 보안·법무 인증이 아니다.

| 영역 | 점수 | 보수 판정 |
|---|---:|---|
| 소비자 안내의 정직성 | 8.5/10 | 결제·확정 예약·가상 피팅·보장 수치와 미검증 수치를 제거하고 업체 연결 준비 상태를 명시 |
| 가입·복귀·장애 복구 | 8.0/10 | 프로필 장애를 로그아웃으로 오인하지 않고, 초안·실패 입력과 허용된 복귀 경로를 보존. 실제 OAuth E2E는 미완료 |
| 아모라 코드 안전·비용 설계 | 8.7/10 | Luna 기본/Terra 제한 승격, 읽기 중심, 멱등 provider 계량, 시작 전 실패 정산, 도구 축소, 결정적 위기 응답을 fresh DB와 실제 모델 기본 경로까지 검증 |
| 아모라 운영 신뢰도 | 6.5/10 | Luna/Terra 접근·한국어 SSE·replay·감사 저장은 통과. 도구 후속·PDF/이미지·429/5xx·중단·장시간 운용 canary는 남음 |
| 업체 연결 소비자 보호 | 7.5/10 | 신규 요청을 PII 처리 전에 하드 차단하고 과거·예시 목록을 분리. 실제 전달·수락·거절·변경·취소·철회 왕복은 없음 |
| 개인정보·커뮤니티 보안 | 7.5/10 | 보존·권한·민감 테이블 anon 거부·rate-limit lifecycle은 preview에서 통과. 운영 적용, 베타 이메일 확인과 법무 승인은 남음 |
| 디자인·접근성 | 8.2/10 | 상태·재시도·44px 터치·dialog focus·모바일 grid·진행률 설명·로그인 자동완성을 브라우저에서 보강. 큰 글씨·스크린리더·실기기 전수 검증은 미완료 |
| migration·구버전 호환 | 8.3/10 | 빈 preview에서 107개 fresh replay와 exact contract·DB lint·anon probe를 통과. 운영 clone upgrade와 마지막 배포 앱 호환은 남음 |
| 운영·출시 준비 | 4.5/10 | 백업·롤백·모니터링·법무·처리자 DPA·최소 앱 버전·원격 canary가 승인되지 않음 |

## 소비자가 느끼는 전체 여정

| 단계 | 소비자가 느끼기 쉬운 불안 | 현재 코드에서 좋아진 점 | 공개 전 남은 조건 |
|---|---|---|---|
| 첫 방문 | “광고만 화려하고 실제 기능은 다른가?” | 미제공 기능, 가짜 후기·성과 수치, 자동 확정·보장 표현을 제거하고 제한 베타 경계를 노출 | 프로덕션 최종 화면 재캡처, 전 화면 문구·가격 출처 법무 확인 |
| 예시 체험 | “가입하지 않았는데 내 정보나 AI 비용이 생기나?” | 합성 데이터만 쓰는 24시간 서명 세션, OpenAI 호출·아모라 전송 서버 차단, 운영 secret 미설정 fail-closed. 서버 검증 결과를 첫 렌더에 전달해 Supabase 키가 없어도 예시 라운지가 즉시 열림 | 운영 `DEMO_SESSION_SECRET` 설정·회전, HTTPS 프로덕션 번들의 전체 키보드 E2E |
| 베타 신청 | “내 정보가 얼마나 남고, 다른 사람이 내 이메일을 덮어쓸 수 있나?” | 필수 동의, 보관 기준 180일과 매일 한 번 정리해 만료 후 최대 약 24시간 이내 삭제하는 계약, 기존 이메일 신청의 PII·동의·만료 덮어쓰기 방지, 신규/기존 동일 응답 | 이메일 확인 링크 또는 동등한 수동 소유 확인, 실제 정기 삭제 job 증빙 |
| 가입·로그인 | “서버 오류인데 계정이 사라진 것처럼 보이나?” | 인증과 프로필 장애를 분리하고 재시도, stale 응답 경합 차단, 허용된 원래 화면 복귀 | 이메일/OAuth별 만료·취소·네트워크 장애 실기기 E2E |
| 온보딩·커플 연결 | “파트너와 내 기록이 섞이거나 과거 기록을 보나?” | 완료 사용자 재진입과 파괴적 자동 repair를 줄이고 재연결 확인·초대 재사용 차단 계약 유지 | 실제 두 계정의 연결·해제·재연결·한 명 탈퇴·마지막 탈퇴 검증 |
| 라운지·예산·일정 | “무엇을 해야 하는지 모르겠고, 저장 성공처럼 보였다가 사라질까?” | 다음 행동을 위에 두고 실패·빈 상태를 분리, 기존 입력과 데이터를 유지하며 재시도 | 배열형 `progress` 키의 동시 수정은 전용 테이블 분리 전 충돌 위험 잔존 |
| 아모라 시작 | “입장만 해도 돈이 들고, 답이 멈추면 입력이 사라지나?” | 유료 자동 인사 호출 제거, 정적 빈 상태, 웹 재시도 시 사용자 메시지 중복 방지, 모바일 120초 상한과 실패 입력 보존 | 느린 네트워크·앱 백그라운드·스트림 중단 실기기 측정 |
| 아모라 상담 | “비싸고, 멋대로 바꾸며, 위험할 때 엉뚱한 답을 하나?” | Luna 기본/Terra 제한 승격, write·후처리·proactive off, 예약 가능성 도구 미노출, 의도별 최대 6개 읽기 도구, 결정적 위기 응답. 실제 Luna/Terra 한국어 SSE·replay 통과 | 거절·도구 후속·PDF/이미지·중단·오류 canary와 한국어 고정 평가셋 |
| 업체 탐색·시세 | “정보가 없는 건가, 서버가 고장 난 건가? 평균 두 개를 더하면 내 총비용인가?” | 업체·상품·시간 로드 실패와 진짜 빈 상태를 분리하고 재시도. 예식장·스드메 평균을 별도 조사값으로 표시하고 단순 합계·통합 순위를 제거 | 공급자 데이터 최신성·정정 SLA, 업체 확인 창구, 가격 출처 주기적 대조 |
| 업체 연결(준비 중) | “버튼을 누르면 업체에 갔나? 목록 상태가 실제 거래인가?” | 웹·모바일 전송 버튼과 문의를 숨기거나 비활성화하고, 구버전 POST도 PII 처리 전 503으로 차단. 목록은 과거·예시 조회용이라고 명시 | 실제 업체 전달·수신 증빙, 수락·거절·변경·취소 왕복, 연락처 보존·철회 E2E와 법적 고지 |
| 커뮤니티·견적 | “실명, 검증 서류, 견적이 퍼지거나 신고가 조작되나?” | 가명 표시, 견적 기본 비공개, 서로 다른 신고자 기준 검수, 검수 중 게시물 숨김, 서버 필드 위조 방지 코드 | base table 민감 열을 safe view/열 권한으로 차단하고 마지막 배포 앱과 전환. 실제 신고·차단·철회 E2E |
| 탈퇴 | “버튼을 눌러도 데이터가 남나?” | 재시도 가능한 영속 삭제 작업과 provider lease, 제한된 오류 코드를 둠 | 스테이징 전체 데이터 그래프, 외부 처리자 삭제 증빙, dead-letter 운영 알림 |

## 아모라 현재 코드 계약

### 모델과 응답 경계

1. 일반 상담과 읽기 도구 계획은 정확히 `gpt-5.6-luna`를 사용한다.
2. 계약 검토 의도, 분쟁·안전 신호, 같은 세션의 반복 교정 등 제한된 조건만 정확히 `gpt-5.6-terra`로 승격한다.
3. OpenAI Responses API는 `store:false`, `reasoning:none`, standard tier, SDK 자동 재시도 0회로 호출한다.
4. 한 provider slot은 exact input-token count와 이어지는 generation을 묶는다. 최종 입력은 최대 48K token, 모든 아모라 응답 래퍼의 출력은 최대 800 token이며 한 사용자 턴은 도구 1라운드·provider slot 최대 2개다.
5. 일정·예산·체크리스트·예약을 직접 생성·수정·취소하는 모델 도구는 제공하지 않는다.
6. 별도 AI 요약·분류·장기 프로필·갈등 자동 중재·커뮤니티 AI 댓글·백그라운드 생성은 코드에서 꺼져 있다.
7. 프롬프트에서 비활성 mutation 도구를 제거하고, 턴 의도별 관련 읽기 도구만 최대 6개 전달한다.
8. DB·업체·도구 결과는 신뢰할 수 없는 문자열로 취급하고 제어문자·목록 수·전체 직렬화 크기를 제한한다.
9. 업체 후보는 품질·인기·예약 가능 순위가 아니다. 직접 입력한 가격 상한 또는 저장된 해당 카테고리 예산, 등록 지역·설명·태그의 일치만 정리하며 총예산 임의 비율·평점 우선 정렬·요일/시간 슬롯 추정은 쓰지 않는다.

### 비용 흐름

1. 인증·입력 크기 상한과 요청 멱등 claim을 먼저 확인한다.
2. 테스트 단계에는 평생·커플별 일일·전역 일일 상담 횟수 차단을 적용하지 않는다. 사용자당 요청 속도 제한과 입력·출력·도구 라운드 상한은 남는다.
3. 실제 외부 호출 직전에 `request_key`, 요청 해시, provider 순번(0 또는 1)으로 `reserve_amora_usage_unlimited_v1`을 원자 기록하고 해당 slot을 `started`로 표시한다.
4. 기록된 slot 안에서 최종 요청 모양의 OpenAI exact input-token count를 실행한다. provider 경계에서 도구·지침이 바뀌면 다시 exact count하고, 48K 이하인 경우에만 generation으로 간다.
5. 같은 요청·같은 provider 순번을 재시도하면 기존 예약을 재사용해 이중 차감하지 않는다. 모든 아모라 응답 래퍼는 출력 토큰을 800개 이하로 강제한다.
6. 일별·커플별 카운터는 비용과 장애 관찰용 지표이며 현재 사용자 허용 여부를 결정하지 않는다.
7. 완료 메시지가 DB에 commit되지 않았고 provider에 진입하지 않은 예약은 복구한다. exact count 또는 generation을 시작해 provider 처리 여부가 불확실한 slot은 감사 장부에 남긴다.
8. DB commit 뒤 HTTP/SSE 응답만 유실된 경우 저장된 완료 메시지를 재생하도록 최종 상태를 다시 확인한다.
9. 직접 `failed` 상태로 바꾸는 경로도 예약 정산을 먼저 수행한다. 15분 넘게 `in_progress`인 요청은 5분마다 최대 100개씩 `FOR UPDATE SKIP LOCKED`로 골라 실패 정산하는 DB job 코드가 있다.

이 설계는 테스트 사용자를 횟수로 막지 않으면서 재시도·실패·불명확한 provider 시도를 추적한다. 그러나 SQL 파일을 읽고 정적 테스트한 것만으로 동시성, 잠금 순서와 응답 유실 복구가 증명되지는 않는다.

### 결정적 위기 응답

- 명확한 한국어 자해·자살 의도는 인증과 제한된 메시지 검증 직후, 일반 rate limit·첨부 처리·비용 원장·OpenAI보다 먼저 검사한다.
- 해당 경로는 provider를 호출하거나 provider 사용량을 만들지 않고 고정된 한국어 안전 응답을 즉시 반환한다.
- 원문이나 판정 결과를 일반 채팅·AI 감사 로그에 복제하지 않는다.
- 즉시 위험하거나 이미 다친 경우 112·119, 당장 위험하지 않지만 생각이 이어지는 경우 24시간 자살예방상담전화 109를 안내하고 현재 안전 여부를 묻는다.
- 이 규칙은 진단·치료·응급 대응을 대신하지 않는다. 오탐·미탐을 포함한 임상 안전성은 별도 전문가 검토 대상이다.

## 개인정보·보안 변경과 남은 경계

### 코드에 추가된 보호

- 예약 생성 API는 `BOOKING_REQUESTS_ENABLED=false`일 때 인증·본문 파싱·연락처 조회·RPC보다 먼저 `503 / booking_requests_disabled`를 반환한다. 업체 문의 API도 `VENDOR_MESSAGES_ENABLED=false`일 때 인증·본문 파싱·메시지 저장 전에 `503 / vendor_messages_disabled`를 반환한다. 결과·공개 후기 API는 `BOOKING_OUTCOMES_ENABLED=false`일 때 인증·본문 파싱 전에 `503 / booking_outcomes_disabled`를 반환한다. 구버전 클라이언트도 새 요청 PII·문의·결과·후기를 저장하지 않는다.
- 웹·모바일 업체 상세는 전송 버튼과 문의를 숨기거나 비활성화하고, 예약 목록은 과거·예시 요청 기록이며 실제 업체 전달·수락 증빙이 아님을 표시한다.
- `create_booking_atomic`은 service role만 실행할 수 있도록 함수 내부 역할 검사와 `PUBLIC`·anon·authenticated EXECUTE 회수를 함께 둔다.
- 모델에는 `check_vendor_availability`와 `get_available_slots`를 포함한 예약 가능성 도구를 노출하지 않는다. 등록 운영시간·상품 정보가 실제 가능 슬롯이나 예약 보증으로 바뀌지 않게 한다.
- 업체 소유자가 승인·검증·평점·수수료 등 서버 필드를 직접 바꾸지 못하도록 trigger와 DML 회수 코드를 추가했다.
- 커뮤니티 작성자가 카운터·검증·AI·검수 필드를 위조하지 못하게 하고, 같은 신고자의 중복 신고를 합치며 서로 다른 신고자 3명을 기준으로 검수한다.
- 검수 중 게시물은 작성자 외 공개/member feed에서 숨기고 댓글도 같은 게시물 가시성을 따른다.
- live UI/API가 없는 방명록은 익명 쓰기·이름·예식 정보·반응 IP 노출보다 fail-closed가 안전하므로 권한 회수 코드가 추가됐다.
- 베타 신청은 180일, 익명 설문은 1년을 보관 기준으로 삼고 만료분을 매일 한 번 정리해 최대 약 24시간 이내 삭제하며, 만료 rate-limit bucket도 정리하는 일일 `pg_cron` job 코드가 추가됐다.
- rate-limit 식별자는 DB·메모리에 평문 IP·이메일을 키로 저장하지 않고 해시한다. 운영에서는 `RATE_LIMIT_KEY_SECRET` 설정이 필요하다.
- 외부 API 오류 응답에서 내부 예외·stack·공급자 상세를 제거하고 사용자용 코드와 메시지만 반환한다.

### 아직 닫히지 않은 위험

1. **DB 미배포**: 위 migration은 운영 적용이 확인되지 않았다. 기존 운영 권한이 그대로일 가능성을 전제로 해야 한다.
2. **커뮤니티 민감 열람**: 현재 앱은 필요한 열을 명시해 조회하지만, `community_posts`·`community_profiles` base table의 검증 문서·운영/정체성 필드가 anon/authenticated에게 직접 조회되지 않는다는 DB 증거가 없다. safe view 또는 열 단위 권한과 구버전 전환이 필요하다.
3. **사용자 연구 이메일·선정 운영**: HMAC 기반 이메일 소유 확인과 확인 전 PII 덮어쓰기 방지는 코드에 추가됐지만, 새 비밀값·Resend·운영 DB 전이·재발송·삭제가 아직 실제 배포에서 증명되지 않았다. 선정 기준·책임자·선정/미선정 통지 기한도 사업 승인이 필요하며 이메일 확인을 선정으로 취급하면 안 된다.
4. **업체 연결 미완성**: 현재 하드 차단은 안전한 임시 상태다. 실제 업체 전달, 수락·거절·변경·취소, 연락처 보존·철회와 삭제가 제품·운영 계약으로 닫히기 전에는 재활성화하면 안 된다.
5. **공급자 공개 열**: 업체 catalog 열 권한은 코드에 제한했지만 실제 anon/auth/service-role 결과와 기존 모바일 호환을 원격에서 확인해야 한다.

### 업체 연결 재활성화 게이트

`BOOKING_REQUESTS_ENABLED=false`는 다음 조건을 모두 운영 환경에서 증명할 때까지 유지한다.

1. 실제 업체 전달 채널과 수신 증빙, 실패·중복·지연·응답 유실 표시가 있다.
2. 업체의 수락·거절·변경·취소가 웹·모바일·서버·DB에서 왕복하고 실제 거래 상태와 예시를 구분한다.
3. 연락처 수집 목적·제공 대상·보존기간·동의·철회·삭제가 고지와 일치하며 연락처 보존·철회 E2E, 탈퇴, 재시도와 구버전 클라이언트를 통과한다.
4. 정식 법적 주체, 개인정보 보호책임자, 사업자·제3자 제공 고지, 약관·개인정보처리방침과 동의 버전을 확정한다. 그 전에는 상담 연결 등 추가 PII를 처리하는 공개 베타를 차단한다.
5. 실제 사용자 2인 계정과 업체 계정으로 요청부터 응답·변경·취소·철회까지 장애 주입 E2E를 통과한다.
6. 업체가 확인한 완료 증빙과 예시 데이터 구분이 있고, 검증된 완료 건에서만 결과 저장·공개 후기 게시·철회가 가능하다는 E2E를 통과한다.

## 출시 차단 게이트

### P1: 공개 베타 전 필수

1. 정식 법적 주체와 개인정보 보호책임자를 확정하고 사업자·연락처·처리방침 고지를 법무 검토한다. 그 전에는 추가 PII를 처리하는 불특정 다수 공개 베타를 시작하지 않는다.
2. Luna/Terra 접근·한국어 스트리밍·replay는 통과했다. 남은 도구 후속, PDF/이미지, refusal, abort, 429/5xx canary를 작은 예산으로 통과한다.
3. 빈 preview fresh reset은 통과했다. 운영 migration history를 대조하고 maintenance 이후 백업을 만든 뒤 운영 크기 복원본 upgrade를 별도 스테이징에서 통과한다.
4. 실제 PostgreSQL 무제한 계량 probe를 수행한다: 동시 61개 신규 예약 무차단, 정확한 카운터 증가, 동일 요청·순번 중복, 완료 commit 뒤 응답 유실, 직접 failed 전이와 15분 stale 요청의 5분 job 복구.
5. 실제 anon·authenticated·service role JWT로 비활성 예약·문의 POST의 PII/본문 처리 이전 503 차단, `create_booking_atomic`, 업체 승인 필드, 커뮤니티 검수 필드, 신고, vendor/community storage 경로의 허용·거절을 검증한다.
6. 커뮤니티 base table 민감 열을 safe view 또는 열 권한으로 격리하고, 마지막 배포 모바일과 최소 지원 버전 전환을 확인한다.
7. 베타 이메일 double opt-in 또는 동등한 수동 확인을 도입하고, 180일/1년 만료 행이 만료 후 최대 약 24시간 이내, rate-limit bucket이 정해진 주기에 실제 `pg_cron`으로 삭제되는 증빙을 남긴다.
8. 실제 두 계정으로 가입, 커플 연결·재연결, private/shared 채팅, 동시 예산·일정 편집, 과거 요청 조회, 한 명/마지막 탈퇴를 장애 주입과 함께 검증한다.
9. iOS/Android 실기기, 작은 화면, 큰 글씨, VoiceOver/TalkBack, 웹 키보드와 dialog focus를 전수 확인한다.
10. OpenAI·Supabase·Vercel·Resend 등 외부 처리자 DPA, 처리 리전, 보존과 국외 처리 고지, 국내 AI·전자상거래 관련 문구를 법무 검토한다.
11. 운영 `DEMO_SESSION_SECRET`을 충분히 긴 무작위 비밀값으로 설정·회전하고 미설정 fail-closed, 24시간 만료, 예시 아모라 POST 차단을 프로덕션에서 확인한다.
12. 백업·롤백·오류 모니터링·비용 알림·dead-letter 운영·최소 앱 버전·구버전 트래픽 종료 기준을 승인한다.
13. 과거 Git 이력에 노출된 카카오 REST·JavaScript·Native 플랫폼 키를 교체하고 기존 키를 삭제한다. REST Allowed IP·Client Secret, JavaScript 도메인·redirect, Native package/key hash·bundle 제한과 2026-04-09 이후 사용량을 확인한다. 이력 삭제가 필요하면 모든 clone·열린 PR·배포 참조를 조율한 별도 승인 작업으로 수행한다.

### P2: 추적하되 공개 베타 뒤로 미룰 수 있음

- `progress.__events`와 `__amora_actions`를 전용 테이블로 분리해 JSON 배열 동시 편집 충돌을 제거한다.
- 업체 연결을 다시 제공할 때는 위 재활성화 게이트를 별도 P1 변경으로 모두 통과한다.
- 공급자 데이터 정정·최신성 SLA와 운영자 확인 이력을 제공한다.
- 모바일 실시간 token 표시가 필요하면 현재 응답 완료 후 파싱 경로와 별도로 React Native 스트림 경로를 설계한다.
- 품질·전환 telemetry는 처리자 계약·리전·보존·동의가 승인된 뒤 별도 변경으로 도입한다.

## 검증 증거의 한계

- 최종 커밋 후보에서 웹 전체 테스트는 120개 파일·833개, 모바일 소비자 계약 테스트는 11개가 통과했다.
- 웹·모바일·공유 패키지 타입 검사와 lint, Next.js production build가 통과했고 정적 페이지 104개를 생성했다. 모바일 실제 바이너리 빌드가 아니라 EAS 설정·소스 릴리스 점검 56개가 통과한 결과다.
- 운영 의존성 `pnpm audit --prod`는 info/low/moderate/high/critical 모두 0건이었고, 추적 파일의 대표 비밀값 패턴은 0개였다. 이는 알려진 advisory와 제한된 패턴 검사이며 공급망 안전 또는 비밀 부재의 완전한 증명이 아니다.
- 브라우저에서 데스크톱 웨딩 홈과 375×812 모바일 커뮤니티, WeddingCode 1→2번 문항 자동 진행, 로그인 자동완성, maintenance, 인증 없는 아모라의 안전한 로그인 복귀를 확인했다. 모바일 가로 넘침과 최종 console error/warning은 0건이었다.
- `git diff --check`는 통과했다. Windows의 LF→CRLF 안내는 내용 오류가 아니라 checkout 줄바꿈 경고다.
- 폐기 가능한 원격 Supabase preview에서 107개 migration fresh replay, DB lint, lifecycle smoke, exact contract, rate-limit SQL smoke와 anon 10-table 거부를 통과했다. 이는 운영 snapshot upgrade·고동시성·장시간 `pg_cron` 복구를 증명하지 않는다.
- 실제 OpenAI Luna/Terra 기본 경로는 통과했지만 로컬·preview 자동 검증은 도구 후속·PDF/이미지·refusal·429/5xx·중단, OAuth, 이메일 전달, 업체 수락, 앱스토어 바이너리를 증명하지 않는다.
- 이 감사는 AI 기반 정적 검토다. 독립된 사람의 보안 리뷰, 실제 침투 테스트, 개인정보·법무 검토를 대체하지 않는다.

## Git·배포 계약

- 다른 컴퓨터 작업은 `git fetch --prune` 후 clean worktree에서 일반 merge하고 충돌을 검토한다.
- 강제 push, hard reset, 사용자 변경 폐기는 금지한다.
- migration 파일의 GitHub push와 운영 DB 적용은 별개다. 연결·백업·스테이징·승인 없이 운영 DB에 적용하지 않는다.
- 최종 검증은 push할 정확한 commit SHA에 대해 실행하고, 그 뒤 코드가 바뀌면 다시 실행한다.

## 공식 근거

- OpenAI 모델: https://developers.openai.com/api/docs/models
- GPT-5.6 Luna: https://developers.openai.com/api/docs/models/gpt-5.6-luna
- GPT-5.6 Terra: https://developers.openai.com/api/docs/models/gpt-5.6-terra
- 보건복지부 24시간 자살예방상담전화 109: https://www.mohw.go.kr/menu.es?mid=a10200000000
- 경찰청 112 신고 안내: https://www.police.go.kr/www/agency/intro/intro0601.jsp
- 소방청 119 구급신고 안내: https://www.nfa.go.kr/nfa/safetyinfo/emergencyservice/119emergencydeclaration
- 한국소비자원 결혼서비스 가격 동향: https://www.kca.go.kr/home/sub.do?menukey=4004&mode=view&no=1004008123&page=1
- 인공지능 발전과 신뢰 기반 조성 등에 관한 기본법 제31조: https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0031&lsiSeq=282791&urlMode=lsScJoRltInfoR
- 전자상거래법 제20조: https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900617336
