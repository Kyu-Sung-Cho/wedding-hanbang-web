# 웨딩한방 2차 심층 감사 — "웨딩플래너를 대체할 수 있는가"

> **2026-08-10 · 운영 `origin/main` 기준 · 코드 변경 없음**
> 17개 에이전트(정찰 4 · 매트릭스 5 · 심층 5 · 반증 3), 도구 호출 1,197회, 65분.
> 상세: `PLANNER_AUDIT_MATRIX_2026-08-10.md`(105셀) · `PLANNER_AUDIT_DETAIL_2026-08-10.md`(시뮬·발화·관계·데이터·모바일)

## ⚠ 감사 대상을 바꿨다

1차 감사(`JOURNEY_CAPABILITY_AUDIT`)와 `CONTRADICTION_FORENSICS`는 `feat/ux-polish-journey-audit` 기준이었는데,
그 브랜치는 **`origin/main`보다 332커밋 뒤처져 있고 AI 제공자도 다르다**(Anthropic vs OpenAI).

```
git rev-list --left-right --count origin/main...HEAD  →  332  6
git show origin/main:apps/web/src/app/api/chat/route.ts | wc -l  →  3879   (구 브랜치 1,144)
```

"플래너를 대체할 수 있는가"는 제품 질문이므로 **운영 코드**를 봤다.
`.codex-integration-20260806` 이 `origin/main` 과 0/0 동기·워킹트리 clean이라 이 워킹 카피를 대상으로 삼았다.
화면 72개 · API 154개 · 모바일 44개 · `conflict-detector.ts` 626줄 — 1차가 본 것과 규모가 다르다.

---

# PART 7. 종합 판정

## 7-1. 105셀 분포

| 판정 | 개수 | 비율 |
|---|---|---|
| **A 완결** | **2** | 1.9% |
| B 부분 | 64 | 61% |
| C 표시 | 17 | 16% |
| D 부재 | 17 | 16% |
| E 봉인 | 4 | 3.8% |
| N/A | 1 | — |

**A는 2개다.** 그리고 그 2개조차 조건부다 — 8단계 ①(보증인원 마감 D-31 자동 알림)과
9단계 ①(신혼여행 출발 전날 체크리스트)이고, 둘 다 `care-moments` 배달 경로에 의존하는데
그 경로가 **env 플래그 3종 뒤에 있고 전부 기본값 false**다(`.env.example:120,124,141`). 운영 실값은 [미확인].

**30발화 중 A는 0개다** (B 13 / C 17).

## 7-2. 축별 점수 (플래너 대체 = 100점, 보수적)

| 축 | 점수 | 한 줄 |
|---|---|---|
| ③ 비용 통제 | **45** | 7축 최고. 그러나 추가금 경고가 studio·dress·makeup·common 41건뿐이고 **venue가 0건** — 가장 큰 돈이 나가는 곳 |
| ⑥ 정보 비대칭 | **38** | 보유 자산과 전달 채널의 격차가 가장 크다. `/price` 공시 실데이터가 있는데 **채팅이 읽을 도구가 없다** |
| ⑤ 관계 조율 | **33** | 엔진은 실재. `payer`(양가 분담)를 `lib/ai` 전체에서 grep한 결과 **프로덕션 히트 0건** |
| ① 시점 관리 | **32** | 자산은 많은데 '먼저 연락한다'가 기본 0. 켤수록 내용이 사라지는 플래그 조합이 코드에 박혀 있다 |
| ⑦ 정서 지지 | **30** | 문안 품질은 제품 최고. 그런데 `prompts.ts:837,850-856`이 감정 추정을 금지해 **먼저 알아채는 경로 자체가 닫혀 있다** |
| ④ 업체 조율 | **25** | 보내는 쪽은 품질 높음. **받는 쪽이 통째로 부재** |
| ② 의사결정 | **22** | 가장 중요한데 가장 비어 있다 |

**가중 평균 약 32%.**

## 7-3. 가장 큰 구멍 5개

### 1. 결론을 내주는 경로가 구조적으로 0에 가깝다 — 판정 금지가 판정 아닌 것까지 막았다

사람들이 플래너를 부르는 첫 번째 이유다. "이 견적 800만원 괜찮아?"에 제품이 줄 수 있는 게
"업체에 물어볼 질문 6개"뿐이면 사용자는 카페로 나간다.

**결정적인 건 이게 원칙의 필연적 대가가 아니라는 점이다.**

```
quoteCheck.ts:112-124   getMarketMedian → void category; void region; void scope; → median: 0 고정
marketPrices.ts         데이터 전량 []
quoteMarketTools.ts:9-22  get_market_price → status:"migrated_to_published_disclosures" 스텁
        ↕ 그런데
price/publicListData.ts:143  loadPublicPriceCatalog  ← 공시 실데이터 존재
price/catalog.ts:1           PRICE_CATEGORIES = [studio, dress, makeup, hall]
```

같은 지역·같은 구성의 공시 분포에서 내 견적의 위치를 보여주는 것은 **판정이 아니라 대조**다.
데이터를 이미 갖고 있으면서 채팅에 연결하지 않았다.
게다가 `prompts.ts:1244`가 근거등급 D("흔한 경우"로 낮춰 말하기)를 정식 허용하는데
`:819`와 `stage-router.ts:109`가 그 경로를 봉인해 **자기 원칙이 허용하는 답까지 못 한다.** — M

### 2. 먼저 연락하는 기능 전부가 기본 off이고, 켜는 조합이 서로를 무력화한다

```
amoraCareFlags.ts   isAmoraProactiveChatEnabled = ... && !isAmoraTodayOneEnabled()
                    ← today-one을 켜면 proactive가 자동으로 꺼진다
todayOne.ts:243-257 whyNow/confirmed가 `일정: ${event.title}` 만 사용
                    ← cell.message / checklist / script 를 버린다
proactive/route.ts  p_content: nextCell.message   ← 이쪽은 본문을 쓴다
```

즉 **켤수록 내용이 사라지는 조합**이 코드에 박혀 있다.
남은 상시 경로인 D-day 카드도 `useNotifications.ts:346` `if (!weddingDate) return []` 이라
**날짜 미정 구간(= 가장 도움이 필요한 구간)에 빈 배열**이다. — S

### 3. 스코프 분류기가 가장 흔한 실사용 발화를 범위 밖으로 떨어뜨린다

30발화 중 절반 가까이가 여기서 죽는다. "지금 뭐부터 해야 해", "D-90인데 늦은 거야",
"이 견적 800만원인데 괜찮아", "예산 초과했는데 어디서 줄여", "남편은 무관심하고 나만 다 하고 있어"
— 전부 `W4_out_of_scope`로 떨어져 **도구 0개 + 저장 문맥 삭제 + 대화 기록 차단**을 받고
"이게 결혼 준비의 어떤 부분인가요?"라는 되묻기를 돌려준다.

감정을 털어놓은 사람에게 이 되묻기를 하는 것은 오답의 대가가 가장 크다.

**원인이 원칙이 아니라 어휘 목록이다.** `amoraQuestionScope.ts:86-87`의
`WEDDING_CORE_SIGNAL_PATTERN`에 견적·추가금·원본·보정본·호칭·시어머니·남편·늦었·뭐부터가 **전부 없다**
(신부·신랑은 있는데 남편·아내는 없다). 서버는 이미 그 커플의 결혼일·예산·진행률을 갖고 있는데
"현재 문장에 결혼 낱말이 있는가"만 본다. — S

### 4. 예절·관습 데이터가 0 — 무엇이 과한 요구인지 판단할 근거가 없다

이 감사의 기준 문장이 정확히 이 구멍이다. "어머니가 예단 500 얘기를 꺼내셨는데 어떡하죠"에 답하려면
(a) 그 요구가 어느 정도인지 위치를 알려주고 (b) 어머니께 전할 문장을 줘야 하는데,
**(a)의 재료가 코드에도 DB에도 없고 (b)는 예약 통보용 대본 1개뿐이다.**

```
lib/etiquette/   __tests__/publicEtiquetteSafety.test.ts 단 하나 — 부활을 테스트로 봉인
app/ 아래        etiquette 라우트 없음
prompts.ts:1379  [etiquette:번호] 태그 출력 금지
vendorAsymmetry.ts  16건 전부 업체 상대, 가족 관습 0건, source 필드 0/16 사용
```

근거 부실을 이유로 자진 삭제한 판단은 옳았으나 **대체 소스를 넣지 않았다.** E가 아니라 D인 이유는
외부 조건이 아니라 순수한 데이터 부재이기 때문이다. — L

### 5. 왕복이 끊긴다 — 업체 답변을 남길 곳이 없고, 확인한 금액이 예산으로 흐르지 않는다

플래너 실무 가치의 절반이 "대신 기억하고 대신 옮겨 적는 것"이다.
제품은 보내는 문장(문의 5문항·증빙 목록·계약 조항)까지 잘 만들어 주고 **거기서 손을 뗀다.**

```
mutationTools.ts   MUTATING_TOOL_NAMES 에 analyze_contract_readiness·simulate_guest_guarantee 없음 = read-only
riskSupportTools.ts:74-75,82  contract_amount·deposit_amount·oral_promises 를 입력만 받고 저장 안 함
savedNoteSource.ts  message.visibility !== "shared" 거부 → AI 메시지 스냅샷만 저장 가능
tools.ts            ProgressItem.vendor·notes 에 쓰는 도구가 없음
```

세 업체를 돌고 오면 답을 담을 자리가 없어 **카톡을 뒤진다.** 계약서를 점검한 직후에도
같은 금액을 예산 화면에 손으로 다시 넣는다. 그릇(`ProgressItem.vendor/notes`, `PaymentLedger`)이
이미 있다는 점에서 특히 아깝다. — M

## 7-4. 가장 싼 승리 10개

| # | 작업 | 대상 (문자열 매칭) | 작업량 | 상승 |
|---|---|---|---|---|
| 1 | `WEDDING_CORE_SIGNAL_PATTERN`에 실사용 어휘 추가 (견적·추가금·원본·호칭·시어머니·남편·아내·늦었·뭐부터) | `amoraQuestionScope.ts` — `const WEDDING_CORE_SIGNAL_PATTERN =` | **XS** | C→B (발화 5·10·17·2·1) |
| 2 | 저장된 커플 문맥의 존재를 W0 신호로 인정 (weddingDate/progress 있으면 W4로 안 떨어뜨림) | `amoraQuestionScope.ts` — `return {\n scope: "W4_out_of_scope"` 직전 | **S** | C→**A** |
| 3 | `BUDGET_INTENT`에 보증인원·하객·식대·불참 추가 | `amoraToolPolicy.ts` — `const BUDGET_INTENT =` | **XS** | B→**A** (발화 7) |
| 4 | 없는 능력 약속 제거 — 중재 전략 A·B의 "(도구로 검색)"·"(도구로 시뮬레이션)" + `getMarketPriceContext`의 "검색 도구를 사용하고" | `prompts.ts` / `marketPrices.ts` | **XS** | 오작동 제거 |
| 5 | `update_task_status` enum에 `not_applicable` 추가 | `tools.ts` — `enum: ["not_started", "in_progress", "completed"]` | **XS** | C→B |
| 6 | `ALLOWED_CATEGORIES`·`COHORT_CONTRACT_CATEGORIES`에 yedan·houseware 추가 | `extract-decision.ts` / `communityCategories.ts` | **XS** | C→B |
| 7 | quote-check·budgetFinder에 `hall` 추가 | `quote-check/page.tsx` — `CATEGORY_OPTIONS` / `budgetFinder.ts` — `type BudgetCategory` | **S** | C→B |
| 8 | **`get_market_price`를 `/price` 공시 실데이터에 연결** | `quoteMarketTools.ts` — `status: "migrated_to_published_disclosures"` / `quoteCheck.ts` — `function getMarketMedian` | **M** | B→**A**, 상승폭 최대 |
| 9 | today-one 카드에 모멘트 본문 싣기 (`cell.message/checklist/script`) | `todayOne.ts` — `whyNow: whyNow(cell.cellKind, event.title)` | **S** | B→**A** |
| 10 | `contractShield` 카테고리에 `restaurant` 추가 (상견례 식당) | `contractShield.ts` — `\| "other";` 유니온 + 라벨 맵 + scopes | **S** | D→B |

**4번은 지금 당장 해야 한다.** `amoraPromptComposer.ts:311-316`의 비활성 도구 필터는
줄 안에 도구 *식별자*가 있을 때만 지우는데, 이 세 곳은 한국어 산문이라 통과한다.
즉 **제품이 "가장 나쁜 실패"로 규정한 "할 수 없는 일 약속"을 프롬프트 자신이 유발하고 있다.**

## 7-5. 제휴 없이 도달 가능한 최대치 — **70~75%**

현재 위치는 그 천장의 절반 아래(약 32%)다.

| 축 | 제휴 종속성 | 천장 |
|---|---|---|
| ③ 비용 · ⑤ 관계 · ⑦ 정서 | **완전 독립** — 재료가 이미 저장소 안에 있다 | 90%+ |
| ① 시점 | 사실상 독립 — 전부 자체 데이터, 막는 건 env 플래그 | 85% |
| ⑥ 정보 | 독립인데 가장 비쌈 — 시세는 `/price`로 자급, 공백은 예절·관습(응답자 공급 문제) | 80% |
| ② 결정 | 부분 종속 — 결정 4종 중 '어느 업체'만 종속. 총액·포함범위·배분·보증인원·생략은 독립 | 70% |
| ④ 업체 | 부분 종속 — 검색·예약은 봉인해도 **보내는 문장 + 받는 답 기록**의 왕복은 닫을 수 있다 | 65% |

**업체 제휴는 이 제품의 병목이 아니다.**
지금 막고 있는 것은 **스코프 분류기 · 기능 플래그 · 도구 게이트 · 스키마 연결** 네 가지이고 전부 자체 코드다.

남는 25~30%: (a) 업체를 골라 예약해 주기 — 영구 포기 시 회수 불가
(b) 업체와 통화해 대신 해결 — 원리상 불가 (c) 예절·관습 데이터 축적 — 시간 문제.

## 7-6. 순서

```
0. 거짓 약속 제거 (XS)        ← 다른 무엇과도 무관하게 지금
1. 스코프 분류기 (XS+S)       ← 반드시 첫 번째
2. 도구 게이트 (XS)
3. 데이터 채널 — /price 연결 (M)   ← 여기까지가 '결론 내기'의 최소 구성
4. 왕복 저장 (XS~M)
5. 배달 — 본문 먼저, 플래그는 그 다음 (S)
6. 예절·관습 축적 (L)         ← 착수는 4단계와 병행
7. 업체 제휴                  ← 안 해도 70~75%
```

**1단계가 첫 번째인 이유**: 아래 모든 개선이 채팅에 닿으려면 발화가 W0로 들어와야 한다.
견적 도구를 완벽히 고쳐도 "이 견적 800만원인데 괜찮아"가 W4에서 죽으면 아무 일도 일어나지 않는다.

**5단계 순서 주의**: 지금 플래그부터 켜면 today-one이 proactive를 끄면서
**내용 없는 "일정 열기" 카드만 나가 첫인상을 태운다.** 본문을 실은 뒤에 켜야 한다.

---

# 반증 교정 — 위 결과에서 이미 고친 것

반증 2개 에이전트가 판정을 바꾼 항목이다. **아래는 초안이 틀렸던 것이고, 본문에는 교정본이 반영돼 있다.**

## 낙관 방향 오류 (TOO_OPTIMISTIC 3건)

1. **커플 A의 "하객 보증인원 A"는 성립하지 않는다.**
   D-300 → `determineStage` = `planning_0` → 기본 전문가가 `sangkyeonrye_advisor`라
   `simulate_guest_guarantee`가 **모델에 전달조차 되지 않는다**(`BUDGET_INTENT`에 '보증인원'·'하객' 없음).
   이 도구가 붙는 건 `preparation_1`인 커플 B뿐이다.
2. **도구가 붙어도 A가 아니다.** 필수 입력이 3개가 아니라 4개이고, 그중 `noShowRatePercent`는
   `prompts.ts:1173`이 모델의 기본값 생성을 금지한다 — 계약서에서 가져올 수 있는 보증인원·식대와 달리
   **어디서도 구할 수 없는 값**인데 손실 계산 전체를 좌우한다.
3. **"견적 점검 A"는 채팅에서 닿지 않는다.** `analyze_quote`는 `CONTRACT_INTENT` 게이트 뒤라
   "이 견적 괜찮아?"는 W4로 떨어진다(정규식 직접 실행 확인). A에 가까운 건 채팅이 아니라 웹 `/community/quote-check`다.

## 비관 방향 오류 (TOO_PESSIMISTIC 1건)

**커플 C가 함·폐백·예단·한복을 "해당 없음"으로 끌 수 있다.** `CategoryChecklistModal.tsx:142,228`에
실제 토글이 있고, 그 값이 **진행률 분모·마감 가드레일·임박 알림 세 소비처 모두에서 존중된다.**
부재(D)가 아니라 **온보딩 미노출(발견성)** 문제다.

## 사실 오류 (REFUTED 6건)

| 오류 | 실제 |
|---|---|
| `prompts.ts`에 "예단 금액을 보편적 기준처럼…" 인용 | **`prompts.ts` 전체에 "예단"이라는 단어가 0건.** 실제 1377행은 "결혼 축하금·두 가족에게 드릴 선물 금액…" |
| 자동 중재가 발화한다 | `check-couple-conflict/route.ts:103` — `NODE_ENV==="production"`이면 **무조건 410**. 클라이언트 호출자도 0건. **운영에서 완전 사망 코드** |
| hiddenCosts 43개 | **41개** (studio 12·dress 11·makeup 11·common 7) |
| `weddingPlanning.ts` 주석 인용 | 두 주석을 하나로 합성 — 원문에 없는 문장 |
| `vendorAsymmetry.ts:47-53` = 계약금 선납 압박 | 47-53은 `neg_anchor_pricing`. 선납 압박은 55-62 |
| 줄번호 중대 오류 6건 | TopNav:62→138, today-one:18→474·642, comboStore:31→28, price/page:36→37, prompts:800→804, prompts:872-874→838 |

## 구조적 미검증 — 이 감사 전체에 걸린 가정

**출력단 강제 장치는 `amoraTrustClaims`의 삭제형 필터 7종뿐이고, 양성 행동을 강제·검사하는 장치는 0개다.
업체명 출력 필터는 아예 존재하지 않는다(grep 0건).**

따라서 105셀과 30발화의 "사용자가 손에 쥐는 것" 서술 전체가 **프롬프트 준수 가정 위에 있다.**
"업체 이름 0개"라는 낙관도, "기준 + 확인 질문을 준다"는 낙관도 양쪽 다 코드가 보증하지 않는다.
런타임 측정 없이는 알 수 없다.

---

# 미확인

| 항목 | 왜 |
|---|---|
| **운영 Vercel 환경변수 실값** | `AMORA_CARE_OUTBOUND_ENABLED` / `PROACTIVE` / `TODAY_ONE` / `WEDDING_PAYMENT_LEDGER_ENABLED` — 리포지토리에 없다. **A 판정 2개와 축① 점수가 여기에 달려 있다** |
| **모델의 프롬프트 준수율** | 런타임 미실행. 출력단 강제 장치가 삭제형 필터뿐이라 코드로는 보증되지 않는다 |
| **부산·대전 공시 데이터 실제 보유 여부** | 운영 DB 조회 필요. 코드로 확인되는 건 `PRICE_REGION_OPTIONS`에 busan이 있다는 것뿐 — 행이 있는지는 별개 |
| **모바일 스토어 등록 상태** | `app.json`/`eas.json`까지만 확인 |
| 커뮤니티 화면의 클라이언트측 로그인 가드 | `post/write` 외에는 미확인 — 각 화면이 얇은 래퍼라 컴포넌트까지 들어가야 한다 |
| 커플 B의 개별 `ddayDeadline` 수치 | 반증에서 다수 오류 확인(한복 60을 30으로 등). **집계 결론은 재계산해도 유지** |

## 감사 방법상 주의 — 다음 사람에게

- `(app)/dashboard/page.tsx`(902줄)는 **어떤 URL로도 못 연다**(리다이렉트 2중). 그런데 테스트 4곳이
  이 파일을 "제품 표면"으로 검사한다. **이 파일을 근거로 기능 존재를 판정하지 마라.**
- `/wedding/saved`는 `CUSTOMER_PATHS`에 없어 **미들웨어 미보호**다. `/market-prices`처럼 "의도적 공개" 주석도 없다.
- 리포 루트에서 `grep -r`을 돌리면 `.codex-*` 워킹 카피(다른 브랜치)가 섞인다. 범위를 반드시 제한할 것.
  (이번 감사에서 워킹 카피 오염은 0건, 1차 감사 오류 5종의 재인용도 0건으로 확인됨)
