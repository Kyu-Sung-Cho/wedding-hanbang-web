# 2026-07-10 보수적 전체 감사 및 출시 경계

- 감사일: 2026-07-10 KST
- 저장소: `Kyu-Sung-Cho/wedding-hanbang-web`
- 작업 브랜치: `agent/wedding-code-plain-language`
- 대상 PR: Draft [#37](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/37)
- 기준: 통과한 자동화만으로 운영 안전 또는 사용자 검증 완료를 선언하지 않는다.

## 결론

현재 변경은 Draft PR에 올릴 수 있는 수준이지만, 운영 배포는 **조건부 NO-GO**다.

코드 수준의 주요 P1 결함은 수정했고 타입검사, 린트, 410개 테스트, 프로덕션 빌드가 통과했다. 그러나 새 DB 마이그레이션은 실제 PostgreSQL/Supabase에 적용·동시성 검증되지 않았다. 과거 QA 문서에 노출됐던 운영 capability는 2026-07-10 읽기 전용 재확인에서 여전히 HTTP 200, `ready`, 2행으로 활성 상태였다. 이 두 항목을 끝내기 전에는 운영 안전 완료로 말할 수 없다.

## 감사 범위와 증거 수준

저장소 전체에는 이력·브랜치·stash 인벤토리, 타입검사, 린트, 전체 테스트, 전체 빌드, 의존성 감사, 추적 파일 비밀값 패턴 검사를 적용했다. 현재 로컬 변경과 WeddingCode 경로에는 API, DB 계약, 페어링 경쟁 조건, 결과 계산, 분석 도구, 문구, 모바일·데스크톱 UI, 접근성, 문서 사실성을 줄 단위로 교차 검토했다.

이는 모든 과거 기능을 사람이 한 줄씩 다시 읽었다는 뜻은 아니다. 자동 검증이 없는 운영 인프라, 실제 DB 트랜잭션, 사람 대상 제품 검증은 별도 게이트로 남긴다.

## 보수적 평가

| 영역 | 현재 평가 | 근거와 제한 |
|---|---:|---|
| 타입·빌드 건전성 | 9/10 | 전 워크스페이스 타입검사와 Next.js 101개 정적 경로 빌드 통과. 모바일 `build`는 EAS 안내 스크립트이므로 실제 네이티브 빌드 증거는 아님. |
| 자동 회귀 방어 | 8.5/10 | 49개 파일, 410개 테스트 통과. 실제 PostgreSQL 병렬 트랜잭션과 브라우저 컴포넌트 E2E는 없음. |
| 보안·개인정보 | 7.5/10 | 현재 파일의 일반 비밀값 패턴과 의존성 취약점은 0건. PostHog URL 유출 경로를 막았지만 과거 운영 QA capability가 아직 활성이라 폐기 필수. |
| 데이터 무결성 | 7/10 | max-two 락, 트리거, 멱등 제출 키를 설계·정적 테스트. 원격 DB에 마이그레이션이 없고 실제 경쟁 테스트를 못 했음. |
| UI·접근성 | 7.5/10 | 모바일/데스크톱 핵심 진입, 상태 안내, 대비, 터치 영역, dialog 초점, live status 개선. 라디오 키보드 패턴과 전면 레이아웃 정리는 남음. |
| 문서 사실성 | 8/10 | README와 소스 오브 트루스, 로컬/PR/main/production 경계를 교정. 깨진 과거 문서는 추측 복원하지 않고 superseded 처리. |
| 제품 타당성 | 3.5/10 | 문구·계산은 candidate 상태. n=5 인지 인터뷰와 n=20 미니 테스트 완료 증거가 없음. |
| 운영 출시 준비 | 5.5/10 | PR 업로드는 가능. DB 선적용, capability 폐기, 실제 2기기 E2E 전 운영 배포는 금지. |

## 이번에 수정한 출시 차단 문제

### 보안·데이터

- PostHog 이벤트뿐 아니라 초기 flags/remote-config 요청에서도 초대 토큰이 나가지 않도록 미사용 feature flags를 끄고 SDK 자체 query masking을 추가했다.
- `form_version`과 `scoring_version`을 분리해 저장하고, 최신 클라이언트가 과거 문구/채점 계약으로 제출하면 거부한다.
- migration-first 배포 중 기존 candidate.1~9 writer가 만드는 행에도 알려진 `scoring_version`을 채우는 호환 트리거를 추가했다.
- boolean과 숫자 문자열을 척도 또는 소요 시간 숫자로 강제 변환하지 않는다.
- 커플 토큰별 advisory transaction lock과 DB trigger/RPC로 최대 2행을 원자적으로 강제한다.
- `submission_id` unique idempotency 계약을 추가하고 초대별 session key를 UUID 소문자로 정규화해 응답 유실·새로고침·대소문자 URL 재시도가 같은 사람의 두 번째 슬롯을 만들지 않게 했다.
- DB는 first-write canonical snapshot을 불변으로 반환한다. 재시도 순서가 뒤집히거나 화면 답을 수정해도 DB 답변과 로컬 결과가 달라지지 않으며, 이전 저장분을 복구했으면 사용자에게 알린다.
- 페어링 RPC는 다중 탭 경쟁에서 DB에 먼저 확정된 canonical token을 반환한다. 가득 찬 토큰과 알 수 없는 RPC 응답은 실패하고, 없는 response capability는 재시도 루프 대신 새 테스트로 보낸다.
- API는 새 RPC가 없으면 안전하게 `503`으로 닫힌다. 따라서 앱보다 DB 마이그레이션을 먼저 배포해야 한다.

### 결과 정확성·상태관리

- 같은 과거 폼 두 건도 candidate.9 문장으로 다시 인용하던 경로를 막았다. 선택 문장 카드는 두 응답 모두 현재 폼일 때만 표시한다.
- 브라우저 결과 백업에 채점 계약을 기록하고, 알려진 candidate.1~9 무버전 백업만 명시적으로 이관한다. 알 수 없는 채점 계약은 최신 계산기로 조용히 재계산하지 않는다.
- 과거 개인 결과의 A/B/C/D를 현재 선택지 문장으로 바꿔 보여주지 않는다.
- 결과 백업을 `localStorage -> sessionStorage -> 현재 탭 메모리` 순으로 보존하고 `updatedAt`으로 최신 페어링 상태를 고른다.
- 새 초대 생성 성공 시 서버의 `waiting/paired` 상태를 저장해 과거 `full` 경고와 `paired=false`가 남지 않게 했다.
- 형식이 깨진 HTTP 2xx 응답을 성공으로 확정하지 않고 같은 pending token으로 재시도한다.
- 영구적인 `incompatible` 연결에는 재복사·새로고침을 권하지 않고 최신 테스트로 새 비교를 시작하게 한다.
- 로컬에만 남은 초대 토큰의 서버 응답 수가 0이면 terminal missing으로 고정해 다른 두 사람을 잘못 연결하지 않는다.
- 커플 리포트 2xx도 status별 필수 필드를 runtime 검증해 깨진 payload를 영구 버전 불일치나 렌더 오류로 오해하지 않는다.
- 모든 축 겹침이 낮으면 상대적 상위 축을 `대화가 쉬운 지점`이라고 부르지 않는다.

### UI·문구·접근성

- 정상 초대 진입과 깨진 초대 링크를 토큰 원문 노출 없이 구분해 안내한다.
- 초대 링크 생성 뒤 링크·복사·재시도 UI가 사라지지 않는다.
- 화면 요약과 저장 카드가 같은 대표 축을 사용한다.
- 점수처럼 보이는 공개 퍼센트를 질적 방향 설명으로 바꿨다.
- 자동 이동 타이머를 이전·재선택·언마운트 시 취소한다.
- 저장 overlay에 dialog 의미, Escape, 초점 트랩·복귀를 추가했다.
- 주요 터치 영역을 44px 이상으로 맞추고 진행률·오류·로딩 상태의 ARIA/live 안내와 작은 글자 대비를 개선했다.
- 작은 landscape에서 저장 overlay를 스크롤할 수 있게 하고, 자유입력에는 개인정보 입력 금지 안내와 클라이언트 길이 제한을 추가했다.
- B3의 추상적인 역할 분담 문구를 실제 항목 예시로 구체화했다.

### 문서·이력

- 루트 README를 추가해 실제 모노레포 구조, 명령, 디자인 소스, 배포 표면을 기록했다.
- `AGENTS.md`, `CLAUDE.md`의 오래된 스택·구조 설명을 현재 코드 우선 원칙과 맞췄다.
- 47번 운영 QA 문서에서 live capability와 response UUID를 제거하고, 이력의 capability가 현재도 활성임과 폐기 필요성을 기록했다.
- 문자 인코딩이 깨진 52·53 문서는 내용을 추측 복원하지 않고 `CORRUPTED / SUPERSEDED` 경계를 추가했다.
- 로컬, PR, `main`, production 버전을 별도 상태로 기록했다. 2026-07-10 확인 당시 production은 candidate.4였으며 현재 브랜치 업로드가 곧 운영 배포라는 뜻은 아니다.

## 검증 결과

저장소 루트에서 다음을 다시 실행했다.

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm --filter @hanbang/web exec vitest run src/lib/analytics src/lib/weddingCode src/app/api/wedding-code src/app/wedding-code/result/resultBackup.test.ts --reporter=dot
corepack pnpm audit --prod --audit-level moderate
git diff --check
```

결과:

- 타입검사: 4/4 workspace 성공
- 린트: 성공
- 전체 테스트: 49 files, 410 tests 성공
- WeddingCode/분석/API 집중 테스트: 13 files, 92 tests 성공
- 프로덕션 빌드: 성공, Next.js 16.2.6, 정적 경로 101개 생성
- production dependency audit: 알려진 취약점 0건
- 추적 파일 일반 비밀값 패턴: 0건
- 추적 환경 파일: 예제 파일 2개만 존재
- `git diff --check`: 오류 없음

로컬 프로덕션 빌드 브라우저 확인:

- 375x812 정상 초대 진입 안내와 깨진 `ct` 경고 확인
- 동의 -> 기본 상황 선택 -> 첫 문항 진입 확인
- 1440px 데스크톱에서 가로 overflow 없음 (`scrollWidth = clientWidth = 1440`)
- 최종 스크린샷은 로컬 `.gstack/.../design-audit-20260710/screenshots/`에 보존

## 운영 DB 읽기 전용 확인

2026-07-10 확인 당시 운영 데이터의 aggregate 상태는 다음과 같았다.

- 커플 토큰이 있는 응답: 4행
- 토큰 그룹: 2개
- 3행 이상인 토큰 그룹: 0개
- `scoring_version` 컬럼: 아직 없음
- 과거 QA capability: 민감값을 출력하지 않는 읽기 전용 재확인에서 HTTP 200, `status: ready`, `responseCount: 2`로 활성

현재 데이터에 이미 3인 연결이 없다는 사실은 새 경쟁 조건이 안전하다는 증거가 아니다. 마이그레이션 적용 뒤 실제 PostgreSQL 병렬 요청으로 3번째 슬롯이 막히는지 확인해야 한다.

## 반드시 남은 게이트

### P0 — 운영 배포 전

1. 47번 QA 문서의 과거 Git revision에서 회수 가능하고 현재도 활성인 production capability를 폐기한다. 해당 QA rows 삭제 또는 token 무효화를 운영 DB에서 확인한다.
2. `supabase/migrations/20260710110000_wedding_code_atomic_pairing.sql`을 **웹 코드보다 먼저** 적용한다.
3. 적용 직후 column, unique index, provenance trigger, max-two trigger, 두 RPC의 owner/search_path/grant를 원격에서 검증한다.
4. 동일 `submission_id`의 순서 역전 재시도와 같은 token의 3개 병렬 제출을 실제 트랜잭션으로 시험한다.
5. 두 브라우저/두 기기에서 waiting -> paired -> ready 비교와 full/error/incompatible 복구 동선을 다시 확인한다.
6. PostHog 네트워크에서 `/flags`가 발생하지 않고 이벤트·replay URL에 `ct`가 없는지 preview/production 환경에서 확인한다.

### P1 — 제품을 final/validated라고 부르기 전

1. n=5 인지 인터뷰를 진행하고 진행자 설명 없이 각 문항·선택지가 이해되는지 기록한다.
2. 반복되는 머뭇거림과 오해를 수정한 뒤 n=20 미니 테스트를 진행한다.
3. 그 전까지 `candidate_pending_human_validation`을 유지하고 심리검사, 궁합, 관계 예측, 검증 완료 표현을 쓰지 않는다.

### P2 — 후속 디자인·DX 부채

- 620px 고정형 데스크톱 레이아웃과 중첩 카드 구조를 넓은 화면 정보 구조로 재설계한다.
- WeddingCode 하드코딩 색상을 공유 디자인 토큰으로 옮긴다.
- 단일선택 버튼에 완전한 radiogroup/화살표 키 패턴과 자동 이동 뒤 질문 heading 초점 공지를 추가한다.
- safe-area와 reduced-motion을 전체 화면·overlay에 일관되게 적용한다.
- 초대/결과/저장 dialog를 브라우저 컴포넌트 테스트로 고정한다.
- 52·53 과거 문서의 원문 복원이 꼭 필요하면 신뢰할 수 있는 원본에서 별도 복구한다.

`UPDATE_LOG.md`는 실제 운영 배포 기록이므로 이번 로컬/PR 작업만으로 갱신하지 않았다.

## 로컬 작업 누락 점검

- 현재 브랜치의 어제 candidate.9 작업은 `d6ff8e88`에 존재한다.
- upstream이 없는 로컬 브랜치 3개는 모두 `origin/main`의 조상이라 고유 미업로드 커밋이 아니다.
- 유일한 별도 stash `local-stale-2026-06-11 (playwright devdep + screenshot script)`는 현재 PR에 섞지 않고 원격 `archive/local-stale-2026-06-11` 브랜치로 보존했다.
- archive 로컬·원격 SHA는 모두 `fda1be093c67baed7006b19b7c4136cf58707409`이며 원본 stash도 삭제하지 않았다.

## 출시 판단

- Draft PR 업로드: **GO**
- PR을 ready로 전환: **DB 마이그레이션 실행 계획과 capability 폐기 담당자가 정해진 뒤 판단**
- 운영 배포: **NO-GO, 위 P0 완료 전 금지**
- 제품을 final/validated로 표현: **NO-GO, n=5 -> n=20 게이트 완료 전 금지**
