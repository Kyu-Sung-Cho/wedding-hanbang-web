# WeddingCode Candidate 6.3 handoff — 2026-07-18

> [!IMPORTANT]
> 이 문서는 원본 stacked PR의 역사적 인수인계다. 현재 통합 브랜치, 최종 테스트, 운영 차단 상태는
> `docs/operations/CURRENT_WORKSPACE_HANDOFF_2026-07-19.md`를 먼저 확인한다.

## 현재 상태

- 작업 브랜치: `feat/wedding-code-next-20260717`
- 작업 시작 SHA: `6a5f20b6`
- 스택 기준 브랜치: `origin/feat/amora-engine-v2-20260716`
- 정확한 후보 버전: `wedding-code-candidate6-research.3`
- Candidate 6.3은 **M0 인지면접 후보**다. 실제 한국 예비부부 표본에서 신뢰도·타당도·분류 정확도를
  검증한 완성 검사가 아니며, 점수·유형·궁합·희귀도·정확도 결과를 만들지 않는다.
- 운영 WeddingCode의 안내 전용 화면, API `410 Gone`, 운영 DB write fence는 그대로 유지한다.
  별도 사람 연구와 안전 게이트 전에는 이 후보를 운영 설문이나 결과 상품으로 공개하지 않는다.

`origin/main`에는 이 스택 기준 이후 Amora 공개 문구 변경인 `eaabc223`가 있다. 이 브랜치에는 의도적으로
합치지 않았다. Candidate 6.3 PR은 Amora 엔진 브랜치 위에 쌓인 스택 PR로 열어 부모 변경과 섞이지 않게
검토한다.

## 이번에 만든 것

### 1. 근거 추적 가능한 21개 후보 장면

- 7개 가설 축: `DS4`, `JI3`, `OA3`, `CP3`, `ES3`, `AS3`, `SI2`
- 모든 문항에 source URI, 재현 가능한 locator, source population/context, 지원하는 주장, 지원하지 않는
  주장, 측정 한계를 연결했다.
- `DS1`, `DS3`만 직접 시나리오 범주 근거인 S1이고 나머지 19개는 개념 근거 또는 내부 가설인 S0다.
  S0는 타당화된 문항이라는 뜻이 아니다.
- 모든 문항은 `M0`, `scoreEligible: false`다.
- Form A/B는 끝점 방향만 반전하고, `ES_FIRST`/`AS_FIRST`는 지지 문항 묶음 순서를 별도로
  counterbalance한다.
- 핵심 장면 뒤에만 선택적 SI 장면을 붙여 핵심 응답에 대한 가족·지인 프라이밍을 줄였다.
- `상황에 따라 달라요`, `해당하지 않아요`, `경험이 없어요`, `넘길게요`를 서로 다른 값으로 보존하며
  점수 대입이나 보간을 하지 않는다.
- `CP3`, `ES1`, `DS3`, `DS4`는 정량 파일럿 전에 재작성·대체·문맥화 여부를 검토해야 하는 명시적
  review flag가 있다.

### 2. 안전한 로컬 소비자 UX 프로토타입

- 320px/390px 모바일, safe-area, `dvh`, 48px 이상 터치 영역, 키보드 focus-visible, 명시적 다음 단계,
  150ms 선택 피드백을 적용했다.
- 다섯 핵심 답을 한 화면에서 비교할 수 있고, 양극형 답에는 `첫째 많이/조금`, `나란히`,
  `둘째 조금/많이`처럼 강도를 직접 표시한다.
- 작은 화면에서는 답이 아래에 있음을 알리는 방향 안내를 제공한다.
- 응답이 맞지 않을 때의 네 escape 이유는 서로 다른 의미로 보존한다. 현재 UI에서는 기본으로 접힌
  `<details>` 안에 있어 발견 가능성과 응답 유도 여부를 사람 검증해야 한다.
- 마지막에는 알고리즘이 추론한 유형이 아니라 사용자가 직접 고른 중립적 대화 카드만 보여준다.
- 현재 로컬 전체 19/21장 흐름은 UI 스트레스 프리뷰다. 실제 인지면접은 패널당 8개 핵심 문항과
  해당되는 SI 1~2개, 총 8~10개만 시행한다.

### 3. 운영 격리와 유출 방지

- 연구 페이지는 저장소의 `app` 경로에 상시 존재하지 않는다. 전용 개발 래퍼가 실행 중에만 무시된
  로컬 route를 만들고 종료 시 제거한다.
- 연구 개발 서버와 운영 빌드는 공유 exclusive lock을 사용해 동시에 실행되지 않는다.
- 패키지 빌드, CI, 로컬 검증은 모두 안전 빌드 래퍼를 거친다.
- 빌드 전 route 검사와 빌드 후 산출물 문자열 스캔으로 연구 코드가 운영 bundle에 섞이지 않았는지
  확인한다.
- 연구 경로에서는 PostHog/Sentry 환경변수를 비우고, analytics/UTM 캡처를 건너뛰며, 브라우저 저장소를
  사용하지 않는다.

## 검증 결과

현재까지 확인한 결과:

- Candidate 5/6 데이터·불변식·컴포넌트 타깃 테스트 통과
- 최종 전체 웹 테스트 189개 파일, 1,717개 테스트 통과
- 전체 웹 ESLint와 TypeScript `tsc --noEmit` 통과
- 320/390 시각 QA: 가로 잘림 0, 겹침 0, 외부 요청 0, console error 0, failed request 0,
  브라우저 persistence 0
- 가짜 PostHog/Sentry sink 보안 QA: sink 요청 0, 외부 브라우저 요청 0, persistence 0,
  임시 route·lock 잔존 0
- 안전 Production build: 100개 정적 페이지, 산출물 1,713개 스캔, Candidate marker 0
- 실제 `next start`에서 `/internal/wedding-code-research`는 `404 + no-store + noindex + strict CSP`,
  `/wedding-code`는 `200`
- 연구 서버와 일반 웹 개발 서버 각각에서 동시 Production build가 exclusive lock으로 차단되고,
  종료 뒤 route·lock이 제거되는 것을 실제 확인
- 독립 보안·심리측정·모바일 UX·인프라 재감사에서 구현상 남은 P0/P1 없음. 실제 사람 연구인 M0
  게이트는 아직 통과하지 않았으며 별도 출시 차단 상태

다른 컴퓨터에서 같은 상태를 재현할 때의 핵심 명령:

```powershell
corepack pnpm --filter @hanbang/web test
corepack pnpm --filter @hanbang/web exec eslint .
corepack pnpm --filter @hanbang/web typecheck
corepack pnpm --filter @hanbang/web build
git diff --check
```

## 로컬 연구 화면 실행

이 명령은 연구 전용 임시 route를 만들고 종료할 때 제거한다.

```powershell
corepack pnpm --filter @hanbang/web dev:wedding-code-research
```

일반 `corepack pnpm --filter @hanbang/web dev`도 같은 exclusive lock을 사용한다. 일반 웹 개발 서버,
연구 서버, Production build를 동시에 실행하지 말고 패키지 명령을 통해 순서대로 실행한다. QA 스크립트는
Windows/macOS/Linux의 일반적인 Chrome·Chromium 경로를 자동 탐색하며, 탐색되지 않을 때만
`CHROME_PATH`에 실행 파일의 절대 경로를 지정한다.

브라우저에서 다음을 연다.

```text
http://localhost:3106/internal/wedding-code-research?form=A&supportOrder=ES_FIRST
http://localhost:3106/internal/wedding-code-research?form=B&supportOrder=AS_FIRST
```

강제 종료 후에는 다음 경로가 남지 않았는지 확인한다.

```powershell
corepack pnpm --filter @hanbang/web exec node ../../scripts/check-wedding-code-research-route.mjs
```

## 다른 컴퓨터에서 이어가기

통합 브랜치의 최신 상태와 운영 차단 항목은 먼저
`docs/operations/CURRENT_WORKSPACE_HANDOFF_2026-07-19.md`를 읽는다. 아래 stacked-PR
설명은 역사적 작업 순서를 보존하기 위한 것이며 현재 통합 브랜치보다 우선하지 않는다.

PR 브랜치가 원격에 올라간 뒤:

```powershell
git fetch origin --prune
git switch feat/wedding-code-next-20260717
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @hanbang/web test
corepack pnpm --filter @hanbang/web build
```

부모 Amora PR이 아직 병합되지 않았다면 Candidate 6.3 PR의 base를
`feat/amora-engine-v2-20260716`으로 유지한다. 부모가 먼저 병합된 뒤에만 base를 `main`으로 바꾸거나
충돌을 해소한다. `main`을 임의로 merge해 스택 diff를 섞지 않는다.

## 사람이 해야 하는 다음 게이트

1. 한국 예비부부 대상 인지면접과 전문가 내용타당도 검토
2. 녹화, 업체 이용, 파트너 협업, 가족·지인 관여에 대한 screener/eligibility 기록
3. 문항별 이해·회상·판단·응답매핑 실패율과 escape 이유 검토
4. 정량 파일럿 전 review flag 문항의 rewrite/drop 결정
5. 충분한 표본에서 factor structure, reliability, test-retest, partner non-independence, fairness 검증
6. 결과 문구와 공유 카드에 대해 오해·낙인·관계 압박·강제 상호공개 위험 검토

공유 기능을 만들 때는 답이나 파트너 상태를 노출하지 않는 초대 카드부터 시작한다. 상대방 결과를
보려면 각자 독립 동의가 필요하고, Amora에서 일정·예산에 적용하는 기능은 미리보기·차이 표시·확인·undo가
있는 별도 단계로 둔다. 가짜 희귀도, 강제 공유, 자동 커플 판정, 자동 일정/예산 쓰기는 허용하지 않는다.

## 핵심 파일

- 계약과 문항: `apps/web/src/lib/weddingCode/research/candidate6.ts`
- 로컬 UI: `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx`
- 근거 계약: `docs/wedding-code/58_candidate6_product_research_contract_2026-07-17.md`
- 문항 근거표: `docs/wedding-code/59_candidate6_item_evidence_matrix_2026-07-17.md`
- 연구 실행안: `docs/wedding-code/60_candidate6_validation_execution_kit_2026-07-17.md`
- 상품화 로드맵: `docs/wedding-code/61_candidate6_productization_roadmap_2026-07-18.md`
- 운영 빌드 경계: `scripts/build-web-safely.mjs`
- 시각 QA: `scripts/wedding-code-candidate6-visual-qa.mjs`
- 보안 QA: `scripts/wedding-code-candidate6-security-qa.mjs`
