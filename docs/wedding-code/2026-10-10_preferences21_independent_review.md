# 21문항 첫 공개: 독립 검수 기록

상태: ac98 제품 바이트의 로컬 필수 관문 독립 검수 통과 / 필수 원격 CI·첫 운영·운영 후 개선 대기. 아래 초기 판정은 이력이며 마지막 현재 판정을 함께 읽는다.

검수자는 문항·모델·화면·저장·공유 구현 작성에 참여하지 않는다. 수정 범위는 이 문서와
ignored `.verification/preferences21-20261010/`의 읽기 감사 산출물이다. 브라우저·SDK
실행, 앱 설정·권한 변경, 인증·쿠키·비밀값 읽기는 수행하지 않았다. 순수 모델 검사에
사용한 한 번의 `corepack pnpm exec tsx`가 예상과 달리 자동 의존성 확인·설치 경로와
prepare hook를 실행했다. 이 부수 효과와 확인 한계는 아래에 별도로 기록한다.

## 근거와 권위

- 사용자 원문: `C:/Users/kcho1/.codex/attachments/579f2606-4398-4118-b0c9-0417f6ee0637/붙여넣은 텍스트.txt`.
- 직접 읽은 프로젝트 규칙: `AGENTS.md`, `PRINCIPLES.md`, `apps/web/AGENTS.md`,
  `DESIGN.md`, `docs/wedding-code/README.md`.
- `31_fable_mode_adaptation_protocol_v0.1.md`는 **RETIRED / Candidate 4 / 재사용 금지**
  배너를 확인했다. 그 문서의 이전 16문항·사람 수 기준을 새 21문항 공개 조건으로
  소급 적용하지 않는다. 사용자 원문의 정확한 21문항과 P6를 따른다.
- 첫 읽기 HEAD는 `7a4fb2ea0cc2003a48e9529b25bf1bb67629bf95`다. 현재 main이라는
  주장은 root의 별도 최신 원격 확인을 요구한다. 기존 30문항의 문항판
  `preferences-20261008-r2`, 측정판 `likert-preferences-alpha.1`, 표시판
  `likert-letters-alpha.4`는 이번 읽기에서 실제 파일로 확인했다.

확인한 사실은 E, 공식 문서는 S, 근거에서 나온 판단은 I로 구별한다. 합성 검사와
AI 검토는 사람 인지면접·전문가 검토·타당도 검증으로 세지 않는다.

## 요구사항에 따른 출시 판정

아래는 최초 독립 읽기 시점의 기록이며 현재 판정은 마지막 ac98 절을 따른다.

첫 공개는 `/wedding-code/preferences21`에서 새 21문항과 실제 응답 근거 요약을
제공하는 별도 경험이어야 한다. 기존 `/wedding-code`의 30문항·16캐릭터는 자신의
판으로 유지한다. 21문항을 기존 양극 채점에 넣거나 번호만 대응시키면 출시 차단이다.
새 21문항의 네 글자·16캐릭터 연결은 목표로 유지하되 첫 판에서 미확정임을 설명한다.
미확정 연결을 임의 점수·캐릭터로 메우지 않는다.

| 게이트 | 독립적으로 필요한 증거 | 현재 상태 |
|---|---|---|
| 원문 보존 | 21개·ID·순서·본문·상황 안내·척도·별도 응답 전수 원문 대조 | 독립 원문 검사 11/11 PASS; 최종 소스 고정 대기 |
| 결정적 해석 | 같은 답의 동일 결과, 문항별 근거와 한계, 한 문항 수정의 국소 영향 | 독립 순수 실행·정적 화면 PASS; 최종 소스 고정 대기 |
| 상태 구분 | 1~5·모름·비해당·건너뜀·미응답 각각 보존, 응답 수/수치 수 분리 | 독립 합성 상태 전수 PASS; 실제 질문 흐름 대기 |
| 버전·호환 | 문항/해석/표시판 분리, 안정 ID, 구30·구링크·구저장 비변환 | 독립 계약 확인; 기존 운영 결과 회귀 대기 |
| 본인 저장 | 원본 보존, 오류 복구, 실제 30일 만료, 다중 탭 충돌, 외부/상대 답 비저장 | in-memory 계약 PASS; 실제 재진입·삭제 실패 UI 대기 |
| 공개·비교 | 공개 범위 미리보기, 원답 기본 비공개, 명시 동의, 판 불일치 차단 | 독립 계약 PASS; 작성자·동의 인증하지 않음 안내 확인; 실제 흐름 대기 |
| 아모라 | 직접 고른 본인 근거만 아직 보내지 않은 초안에 포함, 자동 기록 변경 없음 | 순수 초안 계약 PASS; 실제 선택·수정·복귀 대기 |
| 실제 UI | 375/390/태블릿/1280, 키보드·초점·확대·이력·복귀, 실제 브라우저 흐름 | root 실행 대기 |
| 개인정보 | 정확한 artifact·새21 범위·활성 ordinary 양성대조·보호 전송 차단 | 미통과 이전 검사 있음 |
| 전체 검사·배포 | actual lint/typecheck/test/build 및 preview/production source·Ready·health | root 실행 대기 |

## 적대적 검수표

| 합성 입력/상황 | 허용되는 결과 | 반드시 잡아야 할 실패 |
|---|---|---|
| 전부 1 | 낮은 동의의 실제 답을 설명, 반대 선호는 미확정 | 정반대 성격/캐릭터 강제 |
| 전부 3 | 각 문장에 중간 동의, 판단 미정과 구별 | 모름 처리 또는 임의 양극 유형 |
| 전부 5 | 21문장 모두 높은 동의를 그대로 보존 | Q05/Q06·Q13/Q14·Q20/Q21 모순·역채점 |
| 전부 모름 | 전체 응답21·수치0, 아직 알 수 없는 부분과 구체적 다음 질문 | 0/3 대입·수치점수·빈 완료 화면 |
| 전부 비해당 | 전체 응답21·수치0, 해당 없음 상태 보존 | 가족 관계·가치관 추정 |
| 전부 건너뜀 | 전체 응답21·수치0, 이번 답하지 않음으로 설명 | 모름/비해당으로 변환 |
| 전부 미응답 | 응답0·수치0, 미완료 또는 명시 부분 결과 | 자동 완료·응답21로 계산 |
| 수치1개+모름20 | 근거1개만 설명, 부족한 범위 명시 | 21개 점수·과도한 대표형 확정 |
| 숫자/모름/비해당/건너뜀 혼합 | 문항마다 원상태·응답 수·수치 수 정확 | 누락 상태 통합·자동 평균 |
| Q20/Q21 모두4 또는5 | 두 휴식 방식 모두 원함, 상황/순서 확인 질문 | 자동 모순·한쪽 강제 |
| 가족 Q13~Q16 비해당 | 가족 주제 비해당이라는 사실만 설명 | 가족 관계/독립성/가족 가치 결론 |
| Q02=5, Q03=1 | 예산 집중과 재배분을 따로 설명 | 둘을 같은 단일 점수로 해석 |
| Q18=5, Q19=5 | 대신 연락/함께 밀린 준비, 다른 장면·도움 구별 | 무조건 역채점·도움 모순 |
| 답 한 개만 3→4 | 그 문항 근거 요약만 관련해서 변함 | 무관한 해석·순위·부탁 무작위 변동 |
| 새로고침/중단/재입장 | 실제 본인 답·현재 문항 복구, 읽기로 TTL 연장 없음 | 저장된 상대 답을 본인 답으로 변환 |
| 저장 실패/손상/미지원판 | 현재 입력 유지, 원본 보존, 명시 복구·삭제 | 자동 덮어쓰기·거짓 저장 성공 |
| storage 삭제 실패 | 저장 끄기 실패 알림, 원본 보호 유지 | 삭제됐다고 표시·보호 해제 |
| 두 탭 서로 답 수정 | 충돌 표시, 다른 탭 원본 무단 덮어쓰기 방지 | last write wins로 조용한 손실 |
| 30문항 저장/링크 입력 | 이전 판 안내·해당 판으로 복귀 | 앞21개 자르기·ID 재배치·새판 재해석 |
| 다른21 문항/해석판 비교 | 판 불일치 차단 또는 원문별 명시 별도 표시 | 같은 점수처럼 직접 비교 |
| 공유 전 취소/수정 | 공개 없음, 수정 후 새로운 공개 확인 | 동의 상태 재사용·구URL 변경 |
| 친구 공유 | 본인 답에서 만든 안전 요약을 공개 전 미리보기 | 원답/가족/상대 답 기본 공개 |
| 파트너 공유 | 본인 원답 범위와 링크 소지자 접근 고지·명시 동의 | 한 사람 입력을 두 사람 합의로 표현 |
| 잘못된/중복/조작 fragment | 정확판·키·범위 검증, 안전 안내와 복귀 | parse 실패를 새 검사가 완료된 것으로 처리 |
| 아모라 선택/취소/복귀 | 고른 본인 근거만 초안, 전송 전 수정·취소 | 상대 답 포함·예산/일정/보드 자동 변경 |
| 모바일/키보드/확대 | 모든 보기 읽힘, 포커스·터치·가로폭·본문 순서 유지 | 별도 응답 잘림·가린 버튼·포커스 유실 |

## 기존 SDK 실패의 정확한 범위

E: 이전 `.verification/production-wedding-code-outbound.mjs`의 SHA256은
`00c02c38f05ff6ea17b23ae5179df6a4e81d2110af344082c484e0673c52b4e3`이고, 보존된
`production-outbound-strict-result.json`은 `status: failed`다. ordinary PostHog
양성대조 네 개가 모두 미성립했다. 보호 데이터가 관측되지 않은 Sentry 요청 5개는
이 active PostHog coverage를 대신하지 않는다. 기존 `releaseApproval:false`와 실패
원본을 유지한다. 이번 읽기는 실제 SDK 실행이 아니다.

E: 별도 봇 진단은 `navigator.webdriver=true`, `HeadlessChrome` UA=true,
headless brand=false와 동일 공개 asset 두 개를 관측한 기록이다. 실제 private SDK
instance/config/capture 분기를 읽지 않았으므로 bot 필터가 누락 원인이라는 것은
강한 I다. 단일 진단 exit0로 strict FAIL을 PASS로 바꾸지 않는다.

E: 현 `analyticsPrivacy.ts`와 `clientErrorReport.ts`는 `/wedding-code` 및 모든 하위
경로를 보호한다. 따라서 `/wedding-code/preferences21`은 소스의 기존 보호 prefix
안에 있다. 직접 접근의 초기화 차단뿐 아니라 일반 화면에서 들어온 이미 활성 SDK,
지연 요청, Back/Forward 복귀를 실제 artifact에서 따로 관측해야 한다.

## 지원되는 새 개인정보 검증 후보

S: [PostHog 공식 troubleshooting](https://posthog.com/docs/product-analytics/troubleshooting)은
자동화 신호로 이벤트가 폐기될 수 있다고 설명한다. 그 문서의 UA/navigator override
예시는 이번 사용자 경계를 벗어나므로 적용하지 않는다.

S: [Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype)는
`headless:false`와 기존 Chromium 인스턴스에 `connectOverCDP`로 연결하는 방식을
지원한다. CDP는 lower fidelity라는 한계가 있다. `ignoreDefaultArgs`나 navigator
변경 없이 실제 자연 신호와 이벤트 발생 여부를 먼저 관측해야 한다.

E: 설치 Playwright-core1.61.0 `coreBundle.js:34433`의 기본 switches에는
`--enable-automation`이 없고 `:42532`는 headless일 때만 `--headless`를 더한다.
따라서 별도 headed 환경의 자연 신호·ordinary 이벤트 관측을 제안할 수 있지만
`webdriver=false`나 active PostHog를 실행 전에 보장하지 않는다. 기존 headless 검사,
소스·SDK 기본 설정·sampling·판정은 유지한다.

이미 사용자가 열어 둔 정상 브라우저에 기존 CDP endpoint가 있으면 공식 연결을
검토할 수 있다. endpoint가 없는 환경에서는 새 권한·launch flags·사용자 프로필
복사로 연결을 만들어 내지 않는다. CUA 화면만으로 네트워크 본문을 검증했다고
말하지 않는다. 해당 공식 surface에 network interception이 없으면 coverage를 대기한다.

새 helper는 기존 원본을 수정하지 않고 별도 파일·SHA·소스 SHA·artifact ID를 기록한다.
새 21판의 직접/공유/질문/결과/수정/취소/이력 cases와 기존30 회귀를 포함한다. 모든
fresh 문맥·실제 SDK ordinary PostHog pageview/Sentry 오류 양성대조·전송 경계 AND를
유지한다. 같은 origin GET/HEAD 이외 외부/API/write/WS/redirect는 차단하고 원답·token·
cookie/header 본문은 기록하지 않는다. 실제 필수 양성대조가 없으면 FAIL 또는 해당
coverage NOT_VERIFIED다. 합성 SDK 단위 검사는 보조이며 운영 active SDK 증거와 다르다.

## 다음 검수와 개선 사이클

작성자가 최종 소스 경로·hash·테스트 영수증을 주면 최종 바이트와 독립 감사의 바이트를
연결한다. 첫 운영 배포 뒤 실제 관측에서 발견된 문제를 근거·수정 가설·종료 조건과
함께 다음 사이클 대상으로 고른다. 아래 출시 전 결함 수정을 출시 후 개선 사이클로
세지 않는다. 실제 화면에서 문제 없는 문장을 임의로 다시 쓰거나 사람 검증 수를
만들지 않는다.

현재 사람 이해도 검증은 **미실행**이다. 인지면접에서는 각 문항을 자기 말로 설명,
떠올린 장면, 어려운 단어, 답을 고른 이유, 도움 결과와 원답 연결 이해를 묻는다.
실제 참여자가 없으면 참여 인원·신뢰도·타당도 결과를 보고하지 않는다.

## 독립 실행 증거: 2026-10-10

검수자가 직접 만든 검사이며 제품 작성자의 테스트 실행을 독립 검사로 합산하지 않았다.
아래 JSON에는 각 검사 결과, 실행 시각, helper SHA256, 읽은 소스 SHA256이 있다.
파일별 소스는 검사 전후 동일함을 확인했다. 최종 후보·배포와 동일하다는 판정은 아직 아니다.

| 산출물 | 실제 실행 결과 | 범위와 한계 |
|---|---|---|
| `.verification/preferences21-20261010/independent-bank-audit.json` | 11/11 PASS, 13:22:24Z | 사용자 원문 문자·순서·상황·척도·별도 응답·판·ID 전수 대조; UI 실행 아님 |
| `.verification/preferences21-20261010/independent-runtime-audit.json` | 113/113 PASS, 13:20:25Z | 합성 응답으로 실제 모델·공유·비교·초안·in-memory 저장 실행; 운영 SDK·실제 저장·배포 아님 |
| `.verification/preferences21-20261010/independent-report-render-audit.json` | 10/10 PASS, 13:20:27Z | 실제 Report React server render를 DOM으로 읽음; 레이아웃·브라우저 초점·스크롤 검증 아님 |

bank SHA256은 `f42cd68f27049fe05ecebb62d136d2869b630d549fed7c5123460482f299e78f`,
사용자 attachment SHA256은 `b06e5dbd24708c15a7337809bb83892a44a0cfc412ae012f0fea211d55b851ba`다.
새 문항판 `preferences21-20261010-r1`, 해석판 `preferences21-reading-alpha.1`, 표시판
`preferences21-report-alpha.1`을 실제 export에서 확인했다. null과 세 별도 응답을
숫자로 변환하지 않는다. 실제 답의 item ID·상황과 읽기가 결정적으로 연결된다.

합성 계약 검사는 모두 1~5·모름·비해당·건너뜀·null의 정확한 count와 원상태,
21개 각각의 3→4 수정 시 무관한 해석 보존, 가족 비해당에서 가족 추론 없음,
함께/혼자 휴식 모두 높음, 정확한 판 비교·구판 거부, 공개 명시 동의,
초대/반환의 각 원답 보존·30일 경계, 친구 요약의 가족·원답·상대 답 제외,
직접 선택한 본인 초안만 사용, 읽기·위치 이동의 TTL 비연장과 stale 탭 두 종류의
덮어쓰기 거부를 포함한다. localStorage에는 원자적 거래가 없으므로 이 stale 검사와
storage-event UI 대응으로 모든 경쟁 시점의 무손실을 보장했다고 말하지 않는다.

## 찾아낸 결함과 수정 확인

| 실제 발견 내용 | 작성자 수정 / 독립 재확인 | 남은 확인 |
|---|---|---|
| 비교가 본인 결과의 부탁 문구를 재사용해 Q08 본인5·상대1에도 상대의 마지막 선택을 가정 | 21개 공동 질문·합의 행동으로 교체. 반대답 양쪽 순서를 바꿔도 동일한 공동 질문·행동이며 Q08 둘 다 편한 선택 절차를 확인: 독립 PASS | 실제 비교 링크 흐름 |
| 전부 모름·비해당·건너뜀·null이면 결과에 구체적 질문·행동이 없음 | 상태별 다음 질문·행동 추가. 네 상태의 정적 Report에 실제 노출: 독립 PASS | 실제 작은 화면 가독성 |
| Report가 Q05/Q06을 주제 A에 넣어 두 문항에 구체적 읽기·조건·질문·부탁이 누락 | bank TOPICS로 연결. A4/B8/C4/D5 및 모든 21 수치 답의 네 설명 영역: 독립 PASS | 최종 후보 같은 바이트 |
| 자동 저장 off 기본 흐름에서 중단 후 답을 이어볼 버튼이 없어 새 답으로 지워짐 | Client에 현재 탭 답 이어보기와 새 답 시작 확인 추가: 직접 소스 확인 | 실제 중단·이어보기·취소 |
| 오래된 두 탭이 조용히 서로의 답을 덮어씀 | expectedRaw 충돌 거부와 storage-event 저장 중단 추가. stale empty/resumed 원본 보존: 독립 PASS | 실제 탭 이벤트·off 동시 처리 |
| core.highlights를 생성해도 첫 결과 패널에 표시하지 않아 실제 선호 핵심이 숨겨짐 | 첫 패널에 근거 문항과 개인 highlights 추가. 모두1/3/5에서 펼치기 전 노출: 독립 PASS | 실제 첫 결과 화면 |
| 편집 문항 버튼은 ‘다음 문항’이라 표시하고 실제로 결과로 돌아감 | Client가 editing prop를 전달하는 최신 소스 확인 | 실제 버튼 재확인 |
| 자동 저장 off 시 삭제 실패 안내는 있지만 saved를 지워 재시도 삭제 버튼이 사라짐 | off 선택 보존은 계약에 구현됨. 최신 Client는 off unavailable이면 blockedSave를 유지해 삭제 재시도 버튼 노출: 직접 소스 확인 | 삭제 실패 UI 재확인 |
| 조작 가능한 로컬 링크도 ‘보낸 분/각자가 동의한 실제 답’이라고 단정 | 받은 링크 안내에 링크 신원·각 답 작성자·동의를 앱이 인증하지 않으며 당사자 확인 필요 문구 추가: 직접 소스 확인 | 실제 받은 링크 화면 |

이 결함들은 최초 작성 과정에서 독립 검수가 발견한 출시 전 항목이다. 실제 사람 검증,
첫 운영 배포, 배포 후 개선, 기존30 운영 회귀와 개인정보 SDK 관문이 완료됐다는 뜻이 아니다.

## pnpm 자동 실행 부수 효과의 한계

순수 모델 검사에 쓴 한 번의 `corepack pnpm exec tsx`가 `Scope: all 5 workspace
projects`, lockfile policy verified, lockfile up to date / resolution skipped, Already up
to date와 `prepare: node ./scripts/install-git-hooks.mjs` 실행을 출력했다. 즉시 통합
담당에게 알렸으며 이후 검사는 설치 경로를 거치지 않는 기존
`node node_modules/tsx/dist/cli.mjs ...`로 실행했다. 제품·package·lock 파일을 직접 수정하지 않았다.

그 직후 tracked diff는 없었지만, 실행 전 의존성·hook snapshot이 없어서 전체 바이트와
링크 대상이 전후 동일했다고 주장할 수 없다. 현재 `core.hooksPath=.githooks`이며 설치
스크립트는 이미 이 값이면 바로 종료한다. 해당 출력에는 hook 활성화 메시지가 없었다.
이 관측으로 실행 전 hook 상태의 동일성을 단정하지 않는다.

`.verification/preferences21-20261010/independent-dependency-after-audit.json`은
사후 snapshot이다. 현재 nodeLinker `isolated`, pnpm `11.7.0`, 로컬 `.pnpm`
virtualStoreDir와 다섯 workspace의 direct/scoped junction107개를 기록한다.
root19+web31=50개는 이전 공유50 링크의 대상과 같다는 증거가 아니다.
실행 전 동일 worktree의 snapshot이 없으므로 공유50 복구나 환경 무변경을 보고하지 않는다.

## 실제 인지면접에서 사용할 질문 다섯 개

질문 문구는 참여자가 실제 화면에서 답한 다음, 해석이나 정답을 먼저 설명하지 않고
아래 순서로 묻는다. 참여자의 허락한 범위에서 관측한 말과 화면만 기록한다. 이름·가족
사정·예산 금액을 추가로 요구하지 않는다. AI가 대신 답한 자료를 참여자 관측으로 세지 않는다.

1. 이 문장을 자기 말로 설명하면 어떤 뜻인가요?
2. 어떤 장면을 떠올렸고, 왜 그 답을 골랐나요?
3. 헷갈린 말이나 고르기 어려운 보기가 있었나요?
4. 결과에서 내 답을 잘 읽은 문장과 잘못 읽은 문장은 어디인가요?
5. 지금 공유·아모라 단계를 마치면 무엇이 누구에게 전달된다고 생각하나요?

같은 질문을 모두 반복할 필요는 없다. 문항 이해는 우선 Q05/Q06, Q13/Q14,
Q18/Q19, Q20/Q21의 두 문장을 각각 읽게 한다. 두 문장에 같은 답을 골랐다고
오답·모순으로 설명하지 않는다. 답을 정한 뒤 3과 모름·비해당·답하지 않음의 구별을
자기 말로 설명하는지 관측한다. 가족 주제를 비해당으로 골랐으면 가족 사정을
설명하도록 추가 질문하지 않는다.

결과 이해는 본인이 고른 한 문항과 핵심 요약의 연결을 찾는 행동을 관측한다.
공유 이해는 미리보기에서 친구 요약과 파트너 원답의 차이를 찾고, 동의 취소 후
공개가 발생했다고 생각하는지 확인한다. 아모라 이해는 선택한 본인 근거만 메모에
있는지, 아직 미전송인지, 직접 붙여 넣고 보내야 하는지를 자기 말로 설명하는지 본다.
정답을 알려준 뒤 이해를 회복한 경우 처음부터 이해했다고 기록하지 않는다.

첫 운영 배포 후의 실제 관측은 `문항/화면 → 참여자의 말 또는 행동 → 문제 가설 →
수정 → 같은 과업의 재확인`으로 연결한다. 이해 문제와 기술 오류, 개인 선호 차이를
구분한다. 참여자가 없으면 이 양식은 준비 자료이며 인지면접 결과는 미실행이다.

## 다음 캐릭터 설계에서 먼저 확인할 제약

첫21판의 캐릭터 pending 표시는 제거하지 않는다. 캐릭터 연결은 현재 질문이 실제로
측정한 차이와 근거 충분성이 별도 검토됐을 때만 새 해석·표시판으로 제안한다.

| 문항/응답 패턴 | 현재 확인 가능한 범위 | 캐릭터 연결 전에 필요한 설계 |
|---|---|---|
| Q05/Q06 모두 높음 | 처음 함께 보고, 개인 후보도 먼저 찾아 이야기하고 싶을 수 있음 | 두 선호의 장면·순서를 분리; 양극 한쪽으로 강제하지 않는 표시 |
| Q13/Q14 모두 높음 | 가족 의견을 초기와 초안 후 모두 듣고 싶을 수 있음 | 참여 시점과 최종 결정 권한을 서로 다른 근거로 추적 |
| Q20/Q21 모두 높음 또는 모두 낮음 | 원하는 처음 휴식 방식의 조건·순서는 이 두 답만으로 미확정 | 혼합·유보 상태와 조건 확인; 동점에 임의 동물 선택 금지 |
| Q02/Q03 답이 다름 | 집중 투자와 전체 예산 내 재배분이 다른 선호 | 같은 돈 축의 중복 문항으로 합산하지 않는 근거 지도 |
| Q18/Q19 모두 높음 | 대신 연락과 함께 밀린 준비라는 다른 장면의 도움을 원할 수 있음 | 무조건 역채점하지 않고 도움 장면·실행 범위 구분 |
| 가족 비해당·모름·건너뜀·소수 수치 | 해당 상태와 실제 수치 근거만 확인 가능 | 부모 관계·독립성·능력 추론 없이 부족/혼합 표시 |
| 문항 의미나 연결 변경 | 이전 응답의 당시 의미는 유지해야 함 | 문항→해석→표시판 변경 기록, 구판 결과 유지, 직접 비교 차단 |

이 표는 새 네 축·캐릭터 규칙이 검증됐다는 주장이 아니다. 새 글자의 의미와 실제
문항 근거를 먼저 제안하고, 양쪽 동의·양쪽 낮음·누락 경계에서 설명 가능한지 독립
검수한 뒤 사람 이해도 증거와 함께 다음 사이클의 채택 여부를 결정한다.

## 별도 SDK helper 사전 읽기 감사

`.verification/preferences21-20261010/independent-outbound-helper-read-audit.json`은
새 helper `e71a594c0f373ceb83b91e9ff14526312f07c935a1bc066d049ecd1dc1e685b3`와
generator·case fragment를 직접 읽은 감사다. 이 감사에서 브라우저·SDK는 실행하지 않았다.

원본00c02와 strict 실패7fbc의 동일 SHA를 확인했다. 새 helper는 공식 `headless:false`
옵션 외의 launch defaults, UA, navigator, SDK 설정·sampling을 바꾸지 않는다.
fresh context에서 외부/API/write/WS를 막고 모든 redirect를 읽기 전에 차단한다.
실제 ordinary PostHog pageview UUID·시각과 Sentry event-id 봉투를 요구하며,
full 판정은 기존 네 대조와 새21 전후 두 대조를 포함한 여섯 대조의 AND다.
소스·build 전후 고정과 실제 공개 SDK asset·destination도 요구한다.

`ordinary-baseline`의 성공은 정상 headed 환경의 두 ordinary SDK 전송 시도 양성대조다.
WeddingCode scope나 새21 출시 개인정보 통과가 아니다. 원본에서 이어받은 별칭
history.replaceState/popstate case는 합성 경로 경계 보조 검사임을 명시하며 실제
별칭 이동으로 세지 않는다. 새21 실제 공개 링크·Back/Forward 검사는 별도로 존재한다.

현재 helper의 새21 active SDK 흐름은 시작·받은 비교 fragment·닫기·이력이다.
질문·결과·수정·중단/이어보기·저장·아모라 선택 초안까지 실제 실행했다고 말하려면
그 동작을 같은 활성 SDK 문맥에 추가하고 각 단계의 transport·보호 관측을 AND해야
한다는 검수 의견을 통합 담당에게 전달했다. 현재 제한된 scope나 baseline의 성공을
전체 개인정보 PASS로 바꾸지 않는다.


## 최종 후보 ac98: 독립 현재 판정

이 절은 위의 구현 중·SDK 후보 검토 이력 이후의 판정이다. 제품 소스 HEAD는 `ac98ba1b0fa412c4097daaca47a09cc383560418`다. 검수자는 제품·문항·점수·화면·SDK helper 작성에 참여하지 않았다. 직접 작성한 읽기 감사와 순수 반례를 실행했으며, 통합 담당자가 실행한 브라우저·패키지·SDK 결과는 원본 영수증과 현재 파일 SHA를 대조했다. 이를 검수자 자신의 브라우저 실행이나 사람 참여로 합산하지 않는다.

### 확인한 관문

| 범위 | 이번에 확인한 결과 | 증거의 한계 |
| --- | --- | --- |
| 사용자 정본·결정적 설명 | 독립 정본 11개, 모델·계약 113개, 실제 Report 정적 render 10개 PASS. 해당 소스 바이트가 현재 후보와 같음 | 합성·정적 검사이며 사람 이해도 검증 아님 |
| 실제 UI | 통합 담당자의 21문항·결과·원답 비교·편집 동의 초기화·새로고침 저장 중단·off 상태 이어보기·공유·미전송 아모라 캡처와 실제 DOM을 읽음. 375/390/768/1280/320px 폭 기록 및 native 교차 판 이동 수정 확인 | 물리 기기·200% native zoom 미검증. 대비 계산은 기록된 표본만의 확인 |
| 의미 있는 guard | 최초 7개 AssertionError RED·복원 이력과 현재 모델·계약 소스 일치. Client의 native 경계 이동 수정 뒤 정상16 PASS → 저장 충돌 반례 RED → 정확 복원 | 현재 Client 반례는 root session26690 실행 결과의 독립 읽기이며, 새 7개 전체 재실행으로 세지 않음 |
| 정상 전체 관문 | 실제 root exit0: Turbo9/9,8cache; fresh웹1,256파일·22,466검사, 모바일1,397검사. 저장소1,572검사 PASS | 캐시8개·fresh웹·별도 저장소 명령을 구분. 이전 ENOENT FAIL과 백업 보존 이동은 별도 이력 유지 |
| production-mode build | 15:10:55.763 UTC exit0, 소스·build4개 바이트 고정 | 공개 SDK 값과 합성 환경을 사용하는 로컬 build이며 hosted 배포 증거 아님 |
| 실제 SDK 양성 대조 및 전체 경계 | immutable44fd의 baseline1/1, 진단2controls/4cases, full6controls/54cases 모두 PASS. 전 대조에서 실제 PostHog·Sentry 전송 시도를 관측. 전체 본문·provider·원답/보호 위치 차단·awaited abort·pending0·interception0·owned Chrome 정리·전후 source/build/SDK 바인딩 조건 확인 | 모든 수집 시도는 전송 전에 차단. provider ingestion·운영 서버/edge 로그 검증 아님 |

SDK full 원본: `official-chrome-ordinary-settled-bounded-outbound-full-2026-10-10T16-28-22.043Z-e338cdc9f009/result.json`, SHA256 `26fb83576cc8638e1c9d239b19a0e0f1fe139d0f62b0c8ac62a3f9e093e46e3d`. helper SHA256은 `44fdf4dff918f10b42eb370e1c88f86e94f7bc0646f07ca7a8cca0ede3e55e38`다. 실제 root session72151의 tools.write_stdin 종료 코드0 확인과 파일 판정 PASS를 구분해 확인했다. 51개 기록의 final queue 판정과 보호 case별 Sentry0/허용 PostHog 수, delayed Sentry0, 본문 및 전송 완료 조건을 독립 감사에서 다시 계산했다. 12개 핵심 판정 구간·기존 네 합성 지연 주입·Sentry zero는 이전 helper와 byte 동일함을 확인했다. 작성자 순수 회귀30개를 검수자가 실제 재실행했고, 독립 반례10개도 PASS했다. 31초 수동 관찰 +2초 요청 quiet/pending0 +45초 전체 제한 안의 최종 문서 witness와 동기 current-version 검사를 모두 AND한다. 늦은 평가 성공·timeout 후 reject·새 handler/version·잘못된 문서·오류는 주입 전에 실패한다. 늦게 도착한 일반 요청도 global 판정에 남으며 후속 delayed Sentry 요청을 면제하지 않는다.

### 원 실패와 주장 범위

원00c·349·571·58f·e09·830·6a62 및 자연 재현의 실패를 새 PASS로 소급하지 않는다. frozen CTA 판정은 이벤트 이름만으로 예외를 만들지 않고 실제 trusted capture/bubble, 정확한 출처 DOM·source·문서·origin, 원 payload의 UUID·시각, 현재 판/phase, configured provider/token 및 깨끗한 본문과 abort 완료를 요구한다. 이전 true도 이 AND를 통과해야 한다. 실제 관측한 초기 protectedStarted snapshot race를 최종 고정 증거로 검증하며 원 hook false는 그대로 남긴다.

자연 반복의 id53은 일반 /landing navigation에서 생성됐다는 실제 SDK start·경로·origin 증거가 있다. trim된 envelope end는 물리적인 span 종료 시점을 입증하지 않는다. 이전 id317의 귀속은 UNVERIFIED로 유지한다. 31+2/45 관측은 모든 미래 SDK queue가 비었다는 보장이 아니다. SDK sampling·defaults·UA·navigator·인증·보호 설정은 바꾸지 않았고, 원 zero·provider·본문·전송 경계 조건은 유지하고 고정 증거 AND를 강화했다. 공식 설치 Chrome의 전용 합성 profile·loopback CDP·소유 PID만 사용한 root 실행이며 사람의 로그인 profile·쿠키를 읽지 않았다.

실제 사람·전문가 검증 참여자는0명이다. 새21 네 글자·16캐릭터·가중치·절단점은 미확정이고, 기존30의 판·캐릭터·응답을 재해석하지 않는다. 공유 fragment는 암호화/신원 인증/회수 보장이 아니며, 아모라는 선택한 본인 근거만 있는 편집 가능한 미전송 메모다.

### 진행 가능한 범위와 아직 남은 단계

현재 제품 바이트의 로컬 출시 전 관문은 독립 검수에서 통과했다. 이 후보와 제품 바이트가 같은 문서 전용 최종 커밋은 새 manifest·delta 바인딩을 확인한 뒤 정상 push·PR·필수 원격 CI·정상 merge·배포 흐름을 진행할 수 있다. 필수 원격 검사, Vercel Production Ready/별칭, 첫 운영 흐름은 아직 완료로 판정하지 않는다. 기존 hook·보호·검사 우회를 허용하는 판정이 아니다.

첫 운영의 비교 접근 문제는 아직 로컬 관측이다. 실제 운영390px에서 재현한 뒤 상단 명시 버튼→기존 비교 제목 focus라는 최소 개선 후보를 판단한다. ignored 준비안은 제품 적용·회귀·guard·native Enter·두 번째 배포 모두 미실행이다. 원답·동의·저장·fragment/history가 유지되는 실제 증거로 다음 사이클을 닫아야 한다.

독립 읽기 증거는 모두 `.verification/preferences21-20261010/`에 있다. 이 문서 적용 후 source manifest를 마지막에 다시 고정한다. 아래는 적용 전 ac98 증거 SHA이며 자기 자신을 포함한 최종 manifest의 SHA로 재사용하지 않는다.

- `independent-ac98-source-binding-audit.json`: `1a6317f30b0aa5ce6af325b591ba06a0dafb8e37eebc23754a40aef2f32544e7`.
- `independent-ordinary-settled-bounded-audit.json`: `03db49c54d0c69ca3b18b1d86b3d808952170c5a8598f204a133cc40145522e7`.
- `independent-44fd-ordinary-baseline-result-audit.json`: `215742bc94e2c763ca4b15785ede1443e1ddd6541ae268dcad1794e90ec0387c`.
- `independent-44fd-same-document-diagnostic-result-audit.json`: `e3653c74e97598058164f01a5d27caa2bde78835ce77bab3c870419f0fe4969c`.
- `independent-44fd-full-result-audit.json`: `2c18bb769b304fc77a21d58020b25f5a15fadfa018c52a907712ce28ecbd3430`.
- `final-owned-normal-gates-receipt.json`: `190b6ee114da1b26bd3c7b68c4c9e6bee42e7d3370f0204290ff738abde80de9`.


### 2026-10-11 KST · 첫 운영 완료와 비교 접근 개선의 로컬 검증

앞의 준비·미실행·실패 기록은 각 시점의 이력으로 보존한다. 이 절은 첫 운영 완료 뒤 실제 문제를 재현하고 검증한 두 번째 후보의 **문서 고정 시점** 상태다. 이후 hook·CI·merge·운영 상태는 최종 후보의 별도 영수증/PR에서 확인한다.

첫 배포는 PR #494의 정상 필수 CI(8개 작업과 필수 aggregate), Preview 흐름 확인, 정상 merge를 거쳤다. 운영 merge는 `143449c84fd4c7910a7883348301c2377a8e502e`, Vercel 배포는 `dpl_2a92cBvUncC3kVeQFYSf4P7pSdrE`다. 실제 UI에서 READY/Production/main/hanbang.ai 결속을 확인했고, [새 21문항](https://hanbang.ai/wedding-code/preferences21)과 [기존 30문항](https://hanbang.ai/wedding-code)의 원래 진입을 운영에서 확인했다. 전체 Git tree가 검증 후보34683과 동일하며 CI run은 `38070008675`다. workflow_dispatch 전용 production-readiness/quality-gate는 정상 SKIPPED였으며 PASS로 세지 않았다.

첫 운영에서 합성 A/B로 21개 원문·척도, 중단5→새로고침→문항6재개, Q18수정/복원과 Q19불변, 1–5/모름/비해당/건너뜀 구분, 본인 자동 저장, 원답 초대와 반환, 두 사람14같음/2다름, 기존30→새21복귀를 실제 확인했다. 최초 clipboard 읽기714와 생성 반환주소1662의 불일치는 원인 UNVERIFIED로 보존했다. 별도 실제 native paste가1662로 생성 field와 동일함을 확인한 후 올바른 반환주소-r1을 열어 A/B 방향과 원답을 검증한 흐름만 PASS다. OS 메신저 실제 발송·실제 사람 두 기기 테스트는 실행하지 않았다.

첫 운영의 actual 44fd SDK full은 root session19567 exit0, 54/54흐름·6/6 실제 PostHog/Sentry 양성 대조·49전송 기록·32asset·오류0·pending0·abort/소유 browser정리 PASS다. raw SHA는 `dbb064e1d18b037525bc8f5cbf657f91f41638d76b93c8950ef9737366e0e3bc`이며 독립 r2 영수증은 `36be11cdea88d1db20a564733587774b6ae2ec5db98e262202092c77de17b57c`다. 첫 r1 reader의 옛 public 파일 핀 오류만 FAIL로 보존하고, 새 공개 파일 df7163의 실제 값3개 재hash·SDK initializer 자산·시각·외부 배포 결속을 엄격 검증한 r2로 닫았다. 이 유한 application-context 전송 시도 검사에서 보호 데이터는 없었다. provider ingestion, 서버/edge 내부, Chrome background traffic, 모든 미래 queue 소진 또는 remote/local asset byte동일성의 증거가 아니다.

실제 첫 운영390×844/doc375/scrollY0에서 비교 제목 top7482.171875이고 상단 이동 버튼이 없는 문제를 JSON/JPG로 재현했다. 가설은 유효한 비교가 있을 때 상단 ‘두 사람 답 비교하기’ native Button에서 기존 h2로 focus를 이동하면 탐색 부담을 줄일 수 있다는 것이다. Client와 검사만 수정했고, h2 id/tabIndex를 추가했다. 문항·순서·상황·척도·해석·레터/캐릭터·세 버전·원답·동의·소유·저장·공유 fragment/history 계약 변경0이다. 결과 사용성 개선이며 응답 해석이나 검증된 성향축 추가가 아니다.

| 두 번째 후보의 실제 로컬 범위 | 결과와 출처 |
| --- | --- |
| Client 정상/반례 | 최종 검사24 PASS → 저장충돌1 AssertionError RED → focus누락2 AssertionError RED → source/test SHA 정확 복원. 표준 canonical의 다른22항목·원7/ac98 ledger 불변. `cycle2-client-guard-r1-receipt.json` |
| 영향 회귀 | 8파일/107검사 PASS, root 즉시 완료 chunk9b8dce/exit0. `cycle2-related-tests-r1.log` |
| 타입 | 초기 TS7024 FAIL을 보존. 새6개 factory의 반환형 `(): string`만 명시한 최종 바이트로 root chunk e24e72/exit0 PASS. `cycle2-typecheck-r2.log` |
| 린트 | root session34706/exit0, 오류0·기존 경고23. `cycle2-lint.log` |
| 정상 production build | default Turbopack/기존 build명령, root session95057/exit0, 2026-10-10T17:50:24.155Z 종료, build산출물4 SHA 확인. `cycle2-real-sdk-owned-build-process-receipt.json` |
| 저장소 검사 | root session46362/exit0, 1572 PASS/fail0/570200.792ms. `cycle2-test-repo.log`. 합성 PG 및 고객/원격 데이터 변경0 |
| 실제 native UI | 390×844에서 상단 link→Tab→비교button→Enter→h2focus→다음Tab Q01 summary 확인. 기존 smooth-scroll 중 즉시 offscreen1074관찰은 보존하고 종료 뒤 top410–434로 viewport안 제목을 확인했다. 본인B+초대A에서도 top409–433/본인 report·양쪽21·동의2/autosave checkbox·저장UI·URL/hash 동일. 구30 native복귀/새21저장21재개/비교link없을때button0 확인 |
| 직접 관측/자동 계약 구분 | 브라우저 DOM 범위에서 raw localStorage와 history.length/state를 읽지 않았다. 직접 관측은 UNVERIFIED이며 native UI·URL/hash·표시답·checkbox만 PASS다. raw 저장/소유/동의/history 계약은 최종24개 DOM 검사와2개 실제 반례의 별도 PASS. `cycle2-local-browser-and-contract-receipt.json` |
| 독립 검수 | 적용후 최종 두SHA/원문·판·구30불변/정상24·2반례·복원·다른22 canonical, native 이동/양쪽21원답/own UI/동의·저장표시 보존을 읽기검수. `independent-cycle2-local-source-review-r1.json`, `independent-cycle2-local-native-evidence-review.json`, `independent-cycle2-local-own-native-appendix.json` |

최종 Client SHA는 `08d7a2e9399075b13c0cbe7e39b3b83bad851542661376b436129f0b4eee0828`, 검사 SHA는 `2bff818dfb23703149c9db8ad205b2da1c1b4e67f834ac0893add84616a5dc15`다. 실제 결과 입력 `cycle2-release-required-fields.ACTUAL-r2.json`은 final read-only reader에서 READY를 확인했다. 원 PREPARED/r1과 초기 실패를 유지하고 최종 r2 reader SHA `6a06eb206a0c9d506a0fb5acd8212161af23586e74ffa0c52f7ce7bcff46c4b0`로 실제 읽기 exit0 재확인했다.

이 문서 고정 시점에는 **두 번째 정상 pre-push 전체 workspace·원격 CI·Preview·merge·운영 SDK/배포가 아직 미실행**이다. 첫 운영/옛 local full을 두 번째 운영 PASS로 재사용하지 않는다. 이번25 inventory의 역사 base6be를 유지해 실제 파일 SHA를 다시 발급하고, 새 candidate/manifest/build/SDK/merge/배포 결속은 별도 실제 영수증/PR에 고정한다. 즉시 rollback 기준은 첫 정상 운영143449/dpl2a92이며 그 이전6be/dpl6nmm도 보존한다. DB/migration/기존답 재배치/데이터 삭제/권한 변경0이다.

사람·전문가 참여0명, 타당도 미검증, 새21의 네 글자/16캐릭터/가중치/절단점 미확정, native200%zoom·물리 기기 테스트 미검증은 유지한다. 다음 사이클은 준비한 팀 이해도 질문지로 문항을 자기 말로 설명하고 장면·응답이유·결과가 도움이 되는 대화인지 확인하는 것이다. 실제 사람 응답이 없으므로 문항 의미를 임의 변경하거나 캐릭터를 확정하지 않는다. 공유 환경의 과거50연결 완전복구도 UNVERIFIED이며 전용 checkout 복구와 구분한다.
