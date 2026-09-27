# 웨딩한방 — 단일 완본 브리핑 (Single Source Brief)

> 상태: `SUPERSEDED 2026-07-29 SNAPSHOT — NOT A CURRENT SINGLE SOURCE`
>
> 이 문서는 2026-07-29 시점의 전체 서비스 스냅샷이다. 2026-07-30에 웹 MVP 범위가
> 아모라 중심으로 좁혀졌으므로 현재 제품 판단에 이 문서를 단독으로 사용하면 안 된다.
> 먼저 `AGENTS.md`와 `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`, 최신 CTO 인수인계인
> `docs/operations/CTO_TRUST_AND_WEDDINGCODE_HANDOFF_2026-07-30.md`를 읽는다.

**주의 한 줄**: 이 문서는 2026-07-29 **역사적 스냅샷**이다. 색상 hex, 환경변수 기본값,
DB 테이블 목록, 라우트 목록, 실측 숫자는 시간이 지나면 코드와 어긋날 수 있다.
값이 이 문서와 코드가 다르면 **코드가 맞다.** 그때는 이 문서를 고친다.

---

## 목차

1. [웨딩한방이 무엇인가](#1-웨딩한방이-무엇인가)
2. [운영원칙 6개 (전문)](#2-운영원칙-6개-전문)
3. [확정 결정과 절대 금지선](#3-확정-결정과-절대-금지선)
4. [지금 실제 상태](#4-지금-실제-상태-2026-07-29)
5. [제품 전체 지도 — 모든 화면과 API](#5-제품-전체-지도--모든-화면과-api)
6. [아모라 — AI 엔진 전체](#6-아모라--ai-엔진-전체)
7. [업체 공시 파이프라인](#7-업체-공시-파이프라인)
8. [커뮤니티](#8-커뮤니티)
9. [WeddingCode와 「오늘 한 마디」](#9-weddingcode와-오늘-한-마디)
10. [모바일 앱](#10-모바일-앱)
11. [디자인 시스템 (전문)](#11-디자인-시스템-전문)
12. [기술 — 스택·구조·명령·컨벤션](#12-기술--스택구조명령컨벤션)
13. [데이터 모델](#13-데이터-모델)
14. [환경변수 전체](#14-환경변수-전체)
15. [보안·운영·릴리스 게이트](#15-보안운영릴리스-게이트)
16. [지금 진행 중인 것](#16-지금-진행-중인-것)
17. [남은 일](#17-남은-일)
18. [역사 — 왜 지금 이 모양인가](#18-역사--왜-지금-이-모양인가)
19. [반복해서 밟은 함정](#19-반복해서-밟은-함정)
20. [사업·운영 컨텍스트와 일하는 방식](#20-사업운영-컨텍스트와-일하는-방식)
21. [부록 — 문서 인덱스](#21-부록--문서-인덱스-참고용)

---

# 1. 웨딩한방이 무엇인가

## 1.1 한 줄 정의

한국 예비부부가 **결혼 준비의 정보 비대칭에 당하지 않도록** 업체가 공시한
기본가·추가금·위약금 **원문 그대로**를 보여주고, 일정·예산·업체·커플 의사결정을
한곳에서 관리하게 하며, AI 동반자 **"아모라"**가 여정 내내 옆에 있는
소비자 편 웹·모바일 서비스.

| 항목 | 값 |
|---|---|
| 서비스명 | 웨딩한방 |
| 도메인 | **hanbang.ai** / www.hanbang.ai |
| 저장소 | `Kyu-Sung-Cho/wedding-hanbang-web` (GitHub, private) |
| 구조 | pnpm + Turborepo 모노레포 (`apps/web`, `apps/mobile`, `packages/*`) |
| 배포 | Vercel(웹, Root Directory = `apps/web`) / EAS Build(앱) |
| 백엔드 | Supabase (PostgreSQL · Auth · Realtime · Storage), Pro 플랜 |
| AI | OpenAI Responses API — GPT-5.6 **Luna**·**Terra** 전용 |
| 만드는 사람 | 솔로 파운더 조규성. 코드는 Claude Code로 작성 |

## 1.2 파운더 미션 — 모든 결정의 북극성

> "나는 웨딩 시장을 바꾸고 싶다. 이 시장은 플래너와 업체가 정하는 대로 모든 것을
> 하게끔 설계돼 있다. 소비자들이 더 자세히 알고, 눈탱이 안 맞고, 더 현명하게 결혼할
> 수 있게 하는 것. 플래너 없어도 자신들이 발품 팔아서 하는 것도 우리 서비스 안에서
> 쉽게 가능하게. 그리고 계속해서 옆에서 챙겨주는 동반자 — 청첩장 모임 같은 것도
> 미리 챙길 것 체크해주고, 나가기 전에 메시지 알림으로 한 번 더 체크해주는."
>
> — 2026-06-10, 파운더 본인 표현 그대로의 취지

**3대 축**

1. **눈탱이 방지** — 정보 비대칭 해소(공시가·추가금·위약금 투명성)
2. **셀프 준비** — 플래너 없이 발품 팔 수 있는 도구
3. **동반자** — 여정 내내 옆에 있음. **모멘트 루프**: D-3 챙김 / D-1 출발 전 대본 /
   D+1 안부

**적용법**: 기능 우선순위 논쟁이 생기면 "이 3축 중 무엇으로 환원되는가"로 판정한다.
수익 모델은 P1(Trust > 매출) 가드레일 안에서만 논의한다. 돈은 미션의 연료이지
목적이 아니다.

## 1.3 고객이 겪는 실제 문제

1. **"뭐부터 해야 할지 모르겠어요"** — 준비 항목만 50여 가지, 순서를 모르고 빠뜨린다.
2. **"어떤 업체가 좋은지 모르겠어요"** — 상당수 업체가 가격 미공개. 블로그 후기는
   광고인지 진짜인지 구분 불가. 발품 팔아도 비교 기준이 없다.
3. **"예산을 어떻게 짜야 할지 모르겠어요"** — 스드메 계약 후 추가금이 붙어 초기
   예산과 최종 금액이 크게 벌어진다.
4. **"같은 샵인데 계약 경로에 따라 위약금이 5배 차이"** — 실측 확인:
   - 페레스튜디오 15일 전 **70% vs 80%**
   - 유하하우스 60일 전 **100% vs 20%**
   - 멜린스튜디오 60일 전 **100% vs 50%**
   같은 샵, 같은 날짜인데 **어느 대행사로 계약했느냐**에 따라 갈린다.
5. **의견 조율·시간 부족** — 맞벌이 커플은 함께 방문할 시간이 없고 둘의 취향·예산이
   충돌한다.

> **숫자 사용 규칙**: 인용할 때는 반드시 출처(기관명+연도)를 인라인으로 붙인다.
> 검증 불가 숫자는 사용 금지. 과거 랜딩의 "후기 120만+" 같은 허수는 이미 제거됐다.

## 1.4 무엇으로 다른가

| 기존 서비스 | 웨딩한방 |
|---|---|
| 업체 광고 노출 중심 | **광고비가 추천을 흔들지 않음**(P1) |
| 요약·별점·등급으로 "판정" | **원문 그대로**. 요약도 판정도 하지 않음 |
| 단순 정보 나열 | 아모라가 승인받은 도구로 **실제 데이터를 읽고 수정** |
| 혼자서 준비 | 커플 연동 + 3자 상담 + 중재 |
| 웹 OR 앱 | 같은 Supabase 백엔드로 웹·앱 실시간 동기화 |

---

# 2. 운영원칙 6개 (전문)

> 이것이 웨딩한방의 모든 의사결정 기준이다. 기능 추가, 광고 수용, vendor 등록,
> 카피 결정 — 흔들릴 때마다 여기로 돌아온다. (작성 2026-04-22, 최종 수정 2026-04-23)

### Mission

**한국 결혼 시장의 unique winner — 최고이자 유일한 consumer-side AI 웨딩 플래너.**
결심부터 정착까지 0-1 전 과정을 옆에서 밀착 케어하는 AI "아모라"가 있는 곳.
**광고비가 추천을 흔들지 않는 유일한 플랫폼.**

### P1. 소비자 trust는 단기 매출보다 항상 우선한다

- 광고비 5배를 제안받아도 추천 알고리즘에 반영하지 않는다.
- 부정적 리뷰 삭제 요청은 vendor 등급·매출과 무관하게 거절한다.
- "이 vendor 추가금 평균보다 30% 높음" 정보는 vendor가 광고주여도 표시한다.

**Test**: 이 결정이 1년 뒤 reddit/디시/네이트판에 폭로되면 자랑스러운가?

### P2. Depth가 breadth를 이긴다

- "100개의 평범한 기능"이 아니라 "20개의 압도적 기능"을 목표한다.
- 신규 기능 제안 시 첫 질문: "기존 기능 중 아직 압도적이지 않은 게 있는데 이걸 먼저
  한 이유는?"
- 출시 전 모든 기능은 4-axis KPI(coverage·memory·trust·decision) 중 최소 1개에서
  측정 가능한 개선이 있어야 한다.

**Test**: 이 기능을 쓴 사용자가 "이건 다른 데서는 못 할 것 같다"고 말하는가?

### P3. Memory가 product의 중심이다

- 신규 기능 제안 시 두 번째 질문: "이 기능이 Memory에 어떤 노드/엣지를 추가하나?"
- Memory에 기여하지 않는 stand-alone 기능은 우선순위 후순위.
- 일회성 답변도 "왜 이걸 물었나"를 Memory에 기록 — 다음 nudge의 재료.

**Test**: 이 기능 없이도 다른 챗봇이 같은 답을 줄 수 있는가? → 차별화 0.
**구현**: `decision_nodes`, `decision_edges` (2026-04-23 완료)

### P4. Vendor는 모집하지 않고 자격으로 거른다

- vendor 등록 자격: **가격 공개 동의 + 추가금 명시 동의 + 공정위 표준약관 사용 동의.**
  셋 다 동의해야 등록.
- 등록 후 위반 시 즉시 삭제. 광고주여도 예외 없음.
- "Vendor 5,000개" 자랑하지 않는다. "Vendor 500개, 모두 가격 약속 동의" 자랑한다.

**Test**: 이 vendor를 등록하고 1년 뒤 사용자가 "추가금 폭탄 맞았다"라고 쓸 가능성?

### P5. 모든 차별화 주장은 숫자로 증명한다

- "추가금을 줄여드립니다" ❌ → "베타 50쌍 평균 추가금 174만원 → 89만원" ✅
- "AI가 정확합니다" ❌ → "추가금 예측 ±20% 이내 정확도 82%" ✅
- 모든 통계엔 출처(기관명+연도) 인라인 표기. 검증 불가 숫자는 사용 금지.

**Test**: "출처는?"이라고 물었을 때 30초 안에 답할 수 있는가?

### P6. AI 기본법 compliance를 처음부터 내장한다

- AI 기반 서비스임을 사이트에 사전 고지(`/ai-policy`).
- 아모라의 모든 답변에 "AI 생성" 표시.
- 위험관리방안 1페이지 문서 작성 및 5년 보관.
- 사람 관리·감독 책임자 지정(대표).
- `ai_interactions_log` 테이블로 모든 호출 기록.

**구현**: `ai_interactions_log` (2026-04-23 완료)

### 의사결정 체크리스트

새 기능·정책·거래 결정 시:

- [ ] **P1**: 사용자 trust를 훼손하지 않는가?
- [ ] **P2**: 기존 기능보다 우선할 만큼 중요한가?
- [ ] **P3**: Memory에 기여하는가?
- [ ] **P4**: Vendor 자격 기준에 부합하는가?
- [ ] **P5**: 측정 가능한가? 출처 있는가?
- [ ] **P6**: AI 기본법 compliance OK?

### 원칙 충돌 시 우선순위

**P1 (Trust) > P3 (Memory) > P2 (Depth) > P4 (Vendor) > P5 (숫자) > P6 (법)**

예시: "Memory에 데이터 더 쌓으려면 vendor 데이터 팔면 됨" → P3가 P1을 훼손 → 거절.

### 유일한 약속 3개 (절대 타협 불가)

1. **광고-추천 완전 분리**
2. **Vendor 자격 기준 공개**
3. **Couple Memory는 회사 자산이 아니라 커플 자산**

**이 3개가 깨지면 웨딩한방의 존재 이유가 사라진다.**

---

# 3. 확정 결정과 절대 금지선

아래는 이미 결정이 끝난 것이다. **재론하지 않는다.**

| 금지선 | 이유·경위 |
|---|---|
| **계약-법률 인접 서비스 금지** | 파운더가 법적 리스크 판단으로 거부. 법률 판단·승소 가능성·독소조항 "판정"을 하지 않는다. 계약 문서는 위험 문구 표시·확인 질문·쉬운 번역까지만 |
| **AI가 일반 유저로 위장 금지** | 과거 커뮤니티 AI 페르소나 18종이 일반 회원으로 위장 + 봇 좋아요 + 동기방 침투를 했다. 공정위 추천·보증 심사지침(AI 가상인물 표시 의무, 가상 체험담 금지)에 위법 소지 → 전량 해체. AI는 official 표시된 계정으로만 |
| **유료 순위·프리미엄 노출 영구 금지** | P1 정면 충돌 |
| **견적·시세에 판정 금지** (2026-06-12 확정) | 점수·등급·"안전/위험"·가격대 분류·추정액 합산은 **구성을 모르는 채 정확할 수 없다**. 노출하는 것은 **사실**(확인 안 된 항목 + 출처 있는 평균가 + 지역 중위가 참고)과 **절차**(계약 전 질문 스크립트)뿐 |
| **업체 상대 부정 문장 금지** | Contract Shield가 "{업체명} 계약은 진행하지 않는 편이 안전해요" 류를 생성하던 것을 발견해 제거. 업체명 제거 + 문서 확인 상태의 사실 서술로 교체. "진행 가능" 같은 보증성 라벨도 제거(분쟁 시 신뢰 리스크). AI 프롬프트에도 업체 상대 권고·단정 금지 지침 |
| **외부 사이트 자동 수집 금지** | 시세·공시 데이터는 **관리자 JSON 업로드 또는 승인된 로컬 원본 파이프라인**으로만 적재 |
| **거래 레일(결제·정산·전자계약) 부활 금지** | S1 게이트(업체 10곳 인터뷰) 통과 시에만 `pre-surgery` 태그에서 부활 |
| **업체 기능은 공급 확보 전 숨김 유지** | `/vendors` 사이드바 노출도 현재 숨김 |
| **견적 등기소 보류** | 파운더 결정. 나중에. 우선순위는 커뮤니티/동반자 경험 완성 |
| **WeddingCode를 "검사"라고 부르지 않음** | 사람 인지면접·전문가 검토·타당도 검증 전에는 정식 검사·과학적 유형·궁합·결혼 성공/이혼 예측이라고 말하지 않는다 |
| **`store:false`를 "Zero Data Retention"이라 표현 금지** | 사실과 다르다 |
| **"24시간 내 전문가 검토" 같은 SLA 금지** | 실제 사람이 대기하는 운영 조직이 없다. "24시간"은 AI 접속 가능성만 뜻한다 |
| **"6개월 기억" 같은 고정 기간 마케팅 문구 금지** | 기술·보존 정책과 일치하지 않는다. 기억은 사용자가 켠 범위와 삭제 선택에 따라 유지된다 |

---

# 4. 지금 실제 상태 (2026-07-29)

## 4.1 라이브에 올라가 있는 값

| 항목 | 값 |
|---|---|
| 업체 카드 | **842** (studio 297 · dress 205 · makeup 150 · hall 190) |
| 위약금·환불 원문 | **831행 / 업체 412곳** (공개 뷰 `v_public_vendor_policies`) |
| 공시 기준 시점 표기 | **2025년 11월** |
| 운영 DB 실데이터 | 시맨틱 895 · 가격 2,611 · 업체 1,300 · 채팅 650행 |
| 마이그레이션 | **147개** |
| 테스트 | 루트 계약 **1,089** · 웹 vitest **338 파일**, 실패 0 |
| **실사용자** | **사실상 0명** (유통 글 미게시, 저장본 0건, `messages` 0행) |

> ### 가장 중요한 사실
> 서비스는 **라이브인데 유입이 없다.** 지금 병목은 코드가 아니라 **사람을 데려오는
> 일**이다. 이걸 잊고 릴리스 인프라·백업 증거를 다듬는 것은 우선순위 오판이다
> (이전 세션이 실제로 그렇게 판단해 스스로 멈춘 기록이 있다).

## 4.2 브랜치·PR 상태

- 현재 체크아웃: **`feat/today-one-line`** (origin보다 1커밋 앞섬)
- **PR #75 OPEN** — WeddingCode 연구 프로토타입 + 「오늘 한 마디」 운영 표면
  (main 대비 14커밋 / 23파일 / +5,643 −124)
- `origin/main` — 직전까지 `feat/vendor-disclosure-pipeline-v2-20260718`과 동일 상태
- 태그 **`pre-surgery`** — 2026-06-11 대수술 이전 복구 지점
- **미커밋 작업 있음** (§16 참조)

## 4.3 CI 신호 읽는 법 (함정)

- **`Quality Gate` 잡은 설계상 항상 빨간불이다**(릴리스 차단 선언). 이걸 보고
  "깨졌다"고 판단하면 안 된다.
- 실제 파손 신호는 **`Code Quality (breakage signal only)`** 잡이다.
  이게 빨간불이면 뭔가 깼다는 뜻이다.
- 그래서 CI 결과만 보고는 판단할 수 없어, 로컬 `pre-push` 훅으로 한 번 막는다.
- **2026-09-27 갱신(파운더 승인):** 위 첫 줄은 더 이상 PR에 해당하지 않는다.
  `Production Readiness`와 `Quality Gate`는 수동 실행(workflow_dispatch)에서만 돌고,
  돌면 여전히 반드시 실패한다. PR에서는 코드 검사 다섯 잡과 필수 검사
  `Code Quality (breakage signal only — not a release authorization)`만 돈다.
  main push에서는 설치 캐시 잡 하나만 돈다. 초록불은 여전히 배포 허가가 아니다.

---

# 5. 제품 전체 지도 — 모든 화면과 API

라우트 정본은 `apps/web/src/app/` 디렉터리 자체다. 아래는 2026-07-29 전수 목록.

## 5.1 진입 구조 — `/wedding` 베이스패스 (중요)

```
/            → /wedding 으로 redirect (쿼리·UTM 전부 보존)
/wedding     → 커뮤니티 피드가 첫 화면 (내부 라우트는 /community)
/landing     → 옛 마케팅 랜딩. 미링크·미색인 보존 페이지
```

내부 App Router 경로(`/community`, `/dashboard`, `/chat`…)와 **사용자에게 보이는
주소(`/wedding/*`)가 다르다.** 매핑은 `apps/web/src/lib/weddingPaths.ts`의
`weddingPath()` / `weddingRoutePath()` / `weddingLinkProps()`가 담당하고,
실제 리라이트 목록은 `next.config.ts`의 `weddingAppRoutes`에 있다.

> ⚠️ **`weddingAppRoutes` 목록에 없는 경로는 `/wedding/*`에서 404가 난다.**
> `/wedding/saved` 전체 404 사고의 원인이었다(페이지·API·테이블 전부 정상인데
> **주소만 닿지 않았다**). 지금은 `(app)` 아래 페이지가 목록에 없으면 실패하는
> 회귀 테스트가 걸려 있다.

## 5.2 웹 페이지 전수 (63개)

### 공시가·위약금 — 이 서비스의 핵심 자산

| 경로 | 내용 |
|---|---|
| `/price` | 카테고리 허브 |
| `/price/[category]` | studio / dress / makeup / hall. **지역 먼저 선택** 후 목록 |
| `/price/vendor/[slug]` | 업체 상세 — 대행사별 기본가·추가금·**위약금 원문** |
| `/price/vendor-id/[id]` | 업체 상세(id 경로) |
| `/price/wishlist` | 찜·조합 |
| `/quote/[id]` | 견적 진단 결과 공유 뷰 |

### 커뮤니티 (첫 화면 포함)

| 경로 | 내용 |
|---|---|
| `/community` (= `/wedding`) | 피드 · Editor's Pick · 카테고리 탭 · 무한 스크롤 · 검색 |
| `/community/[category]` | 카테고리별 피드 |
| `/community/post/[id]` | 글 상세 — 투표·북마크·댓글/대댓글·신고 |
| `/community/post/write` | 글 작성 — 이미지/영상 업로드, 태그, 광고 표시, `cost_data` |
| `/community/cohort` | 동기방 목록/디스커버리 |
| `/community/cohort/[id]` | **동기방** — 채팅 / 정보판 / 타임라인 3탭 |
| `/community/quote-check` | 견적 진단 입구 (`/check` → 여기로 UTM 보존 리다이렉트) |
| `/community/quick-review` | 짧은 후기 |
| `/community/vendor/[name]` | 업체 태그 페이지 |
| `/community/budget`, `/schedule`, `/chat` | 커뮤니티 문맥의 예산·일정·채팅 진입 |
| `/community/my`, `/my/posts`, `/my/bookmarks`, `/my/upvoted` | 내 활동 |
| `/community/about` | 커뮤니티 소개 |
| `/market-prices` | 시세 (SSR 프리렌더 — SEO 입구) |
| `/start-here` | 처음 오는 사람 안내 |

### 로그인 후 앱 기능 (`(app)` 그룹 → 실제 주소는 `/wedding/*`)

| 경로 | 내용 |
|---|---|
| `/dashboard` | D-day, 진행률, 카테고리 현황, 커플 연동, 긴급 태스크 |
| `/chat` | **아모라 채팅** — 스트리밍(SSE) + 도구 호출 + 업체 카드 |
| `/budget` | 20개 카테고리 예산/지출 인라인 편집, 숨은 비용 경고, 분담 추적 |
| `/schedule` | 체크리스트 + 타임라인 뷰 + 캘린더 뷰, 임박 알림 |
| `/bookings` | 방문·상담 예약 (거래 레일 아님) |
| `/money` | 축의금 관리 (신랑측/신부측 분리, 관계별, CSV) |
| `/saved` | **아모라 저장 공간** — 아모라 메시지를 스냅샷으로 보관 + 메모 |
| `/lounge` | 라운지 |
| `/settings` | 프로필, 커플 연동, 알림, 비밀번호, 계정 삭제 |
| `/settings/amora-memory` | 아모라 기억 열람·수정·개별 삭제·전체 삭제·동의 제어 |
| `/favorites`, `/vendors`, `/vendors/[id]`, `/vendors/favorites` | 업체(현재 메인 동선에서 숨김) |

### 인증·온보딩

`/login` · `/onboarding` · `/reset-password` · `/auth/mobile-callback` · `/demo` · `/demo/login`

온보딩 4단계: ①역할(신부/신랑) ②커플 연동(혼자 / 초대코드 `WH-XXXXXX`)
③웨딩 정보(예식일·장소·총예산·**상견례 날짜**) ④진행 체크리스트.
③의 상견례 날짜는 `progress.__events`에 `momentType:"sanggyeonrye"`로 저장돼
**가입 즉시 첫 모멘트(D-3/D-1/D+1)가 살아난다.**

### 공개·법무·마케팅

`/about` · `/privacy` · `/terms` · `/ai-policy`(AI 기본법 고지) · `/beta` ·
`/customer` · `/customersurvey` · `/landing`

### 관리자

`/admin` · `/admin/login` · `/admin/price`(가격 검수) ·
`/admin/enrich`, `/admin/enrich/[id]`(업체 보강)

### 잠긴 표면

| 경로 | 상태 |
|---|---|
| `/wedding-code` | **운영 차단**. 안내 페이지만 |
| `/wedding-code/result` | redirect |
| `/today`, `/today/from` | **PR #75 브랜치에만 존재. 아직 main 아님** |

## 5.3 API 라우트 전수 (약 110개)

### 인증·프로필·커플
```
/api/auth/callback        OAuth 콜백
/api/auth/signup          가입 (rate limit + enumeration 차단 + Turnstile)
/api/auth/forgot-password 비밀번호 재설정 (Turnstile)
/api/auth/me              현재 사용자
/api/auth/delete          계정 삭제
/api/profile              PATCH
/api/onboarding           온보딩 완료
/api/journey              PATCH (wedding_journeys)
/api/couple/code          초대 코드 생성/조회
/api/couple/link          초대 코드로 연동
/api/couple/reset         커플 해제
/api/settings/wedding-profile
```

### 아모라·채팅
```
/api/chat                        스트리밍 AI 응답 + 도구 호출
/api/chat/messages               메시지 저장/조회
/api/chat/proactive              선제 발화(모멘트 루프)
/api/chat/feedback               👍/👎
/api/chat/check-couple-conflict  커플 갈등 감지 + 중재
/api/chat/clear-request          대화 초기화 요청
/api/chat/image-urls             채팅 이미지 서명 URL
/api/amora/actions               아모라 액션 목록
/api/amora/actions/[id]          액션 상태
/api/amora/memory                기억 조회·수정·삭제·동의
/api/amora/notes                 저장 공간
/api/amora/mediation/accept      중재안 수락(본인 의사만 기록)
/api/amora/quote-check           견적 진단
/api/amora/quote-check/[id]/public  진단 결과 공개 뷰
```

### 커뮤니티
```
/api/community/posts                     목록·작성
/api/community/posts/[id]                상세·수정·삭제
/api/community/posts/[id]/vote|bookmark|view|report
/api/community/posts/voted
/api/community/comments, /[id], /[id]/vote
/api/community/polls/[pollId]/vote
/api/community/search
/api/community/popular-tags
/api/community/upload, /upload/finalize
/api/community/profile, /profile/wedding-date, /profiles/[userId]
/api/community/vendor-tags, /vendor-tags/[name]
/api/community/ai-comment            (플래그로 잠김)
/api/community/ai-price-comment
/api/community/cohort                 동기방 배정
/api/community/cohort/auto-assign
/api/community/cohort/[id]/messages|contracts|timeline|digest
/api/community/cohort/[id]/members/[userId]/report
```

### 공시·가격·업체
```
/api/price/combos          조합
/api/price/vendor-options  옵션
/api/price/alerts          가격 알림
/api/vendors               목록/검색
/api/vendors/[id]          상세
/api/vendors/[id]/photos|staff|availability
/api/favorites             찜 토글
/api/internal/price/lookup            (X-Internal-Token 필요)
/api/internal/vendors/recommend       (아모라 추천)
/api/internal/vendors/[id]/profile
```

### 예약·일정·금전
```
/api/bookings, /bookings/mine, /bookings/[id]/outcome
/api/money, /money/[id]
/api/messages, /messages/threads
/api/events                이벤트 추적
```

### 크론 (전부 `CRON_SECRET` Bearer 필요)
```
/api/cron/amora-memory              장기기억 컴파일 (10분)
/api/cron/care-moments              선제 케어
/api/cron/booking-projections       예약 프로젝션 outbox
/api/cron/account-deletion          계정 삭제 saga
/api/cron/ai-log-retention          AI 원문 보존 정책
/api/cron/community-upload-cleanup  업로드 정리
```

### 관리자
```
/api/admin/auth|admins|customers|bookings|insights|registrations
/api/admin/vendors, /vendors/[id]
/api/admin/posts/[id]/moderate|pin
/api/admin/reports, /reports/[id]
/api/admin/enrich, /enrich/[id], /enrich/[id]/assign
/api/admin/price                     가격 검수
/api/admin/price/[id], /[id]/source
/api/admin/price/upload, /upload/confirmations, /confirmations/[id]
/api/admin/price/bulk-approval       자동 검증 통과분 일괄 승인 (현재 대상 0건, fail-closed)
/api/admin/price/auto-approve
/api/admin/price/dedupe, /dedupe/[id]
/api/admin/price/snapshots|export|demand
```

### 기타
```
/api/preregister        사전등록
/api/survey             고객 설문
/api/demo/start         데모 모드 시작
/api/release/write-fence-probe
/api/wedding-code/{response,pair,couple-report}   ← 전부 410 Gone 고정
```

**모바일 호환**: 대부분의 API가 `createClientFromRequest()`를 써서
**Bearer 토큰(모바일) + Cookie(웹)** 양쪽을 지원한다.

## 5.4 지금은 없는 것 (문서에는 남아 있음)

- **예절 가이드 전용 페이지 없음.** `/etiquette`는 웹·앱 모두 제거됐고
  아모라 채팅·일정 화면에 참조 흔적만 남아 있다. `lib/etiquette`는 사실상 빈 상태.
- 청첩장 · AI 대본 · B2B 벤더 포털 · 결제 · 전자계약 · 정산 · AI 드레스 피팅 —
  전부 2026-06-11에 **의도적으로 삭제**됐다(§18).

## 5.5 결혼 준비 카테고리 19개 + 예비비

`apps/web/src/constants/checklists.ts`가 정본. 각 카테고리에 5~8개 체크리스트 항목.

| key | 라벨 | 권장 시작 | 마감 |
|---|---|---|---|
| `meeting` | 상견례 | D-360 | D-300 |
| `venue` | 예식장 | D-360 | D-270 |
| `studio` | 스튜디오 | D-300 | D-150 |
| `dress` | 드레스/턱시도 | D-300 | D-120 |
| `makeup` | 메이크업 | D-240 | D-60 |
| `ring` | 예물(반지) | D-270 | D-120 |
| `hanbok` | 한복 | D-180 | D-60 |
| `yedan` | 예단 | D-180 | D-60 |
| `honeymoon` | 신혼여행 | D-180 | D-30 |
| `houseware` | 혼수(가전/가구) | D-180 | D-30 |
| `housing` | 신혼집 | D-180 | D-60 |
| `invitation` | 청첩장 | D-120 | D-45 |
| `snap` | 본식 스냅/영상 | D-120 | D-30 |
| `shoes` | 웨딩 구두 | D-90 | D-30 |
| `bouquet` | 부케/꽃장식 | D-90 | D-14 |
| `gift` | 답례품 | D-90 | D-14 |
| `mc` | 사회/축가 | D-90 | D-14 |
| `ham` | 함 | D-60 | D-7 |
| `pyebaek` | 폐백 | D-60 | D-7 |
| — | 예비비 | — | — |

---

# 6. 아모라 — AI 엔진 전체

## 6.1 제품 약속

아모라는 결혼 준비를 **대신 결정하는 챗봇이 아니다.** 사용자가 말한 조건과 선택을
정확히 기억하고, 근거를 구분해 설명하며, **승인받은 일만 실행하고**, 필요한 순간에
부담 없이 먼저 챙기며, 두 사람의 차이를 합의 가능한 문장으로 바꾸는 결혼 준비
동반자다.

"친언니 같은 느낌"은 과도한 친밀감이나 심리 추측이 아니라 **다음 행동**으로 만든다.

- 먼저 감정을 짧게 인정하고 바로 상황을 정리한다.
- 한 번에 질문 하나와 다음 행동 하나만 제안한다.
- 사용자가 이미 말한 내용을 다시 묻지 않는다.
- 모르는 사실, 가격, 계약 해석을 아는 척하지 않는다.
- 일정·예산 변경은 **실행 결과를 확인한 뒤에만** 완료라고 말한다.
- 갈등에서 한쪽 편을 들거나 **한 사람의 클릭을 공동 합의로 표현하지 않는다.**

## 6.2 다섯 축

### 1) 장기기억

- **기본값은 꺼짐.** 개인 상담 기억은 해당 사용자 한 명의 명시적 동의로 켜진다.
- **공유 대화 기억은 연결된 두 사람 모두 동의해야** 켜진다. 한 명이 철회하면 즉시
  꺼지고 대기 작업도 취소된다.
- 새 메시지 10개 이상이 모였을 때 **최대 40개를 Luna 1회 구조화 호출**로 정리한다.
  매 대화마다 여러 모델을 호출하지 않는다.
- 사용자 발화에 **직접 나타난** 확정 선택·선호·제약·관계 맥락·준비 사실만,
  **신뢰도 0.80 이상**일 때 저장한다.
- 성격·심리·성별·숨은 동기, 불필요한 민감정보, 일시적 감정은 기억하지 않는다.
- 같은 주제는 안정적인 `memory_key`로 식별한다. 값이 바뀌면 이전 기억을 삭제한 척
  덮어쓰지 않고 **폐기 이력과 새 값을 연결**한다.
- 설정 화면에서 보고·고치고·한 항목 또는 범위 전체를 지울 수 있다. 전체 삭제는
  기억·요약·프로필·동의·대기 작업을 **한 DB 트랜잭션**에서 처리하며, 삭제 시점 이전
  채팅에서 기억을 다시 만들지 않는다.
- **사용자가 직접 고친 기억은 자동 컴파일러가 덮어쓰지 않는다.** 개별 삭제는
  `memory_key`를 **숨김 tombstone**으로 남겨 같은 과거 대화에서 다시 생기지 않게 하고,
  전체 삭제 때 tombstone까지 제거한다.
- 동의를 처음 켜거나 껐다 다시 켠 시각을 **새 기준점**으로 쓴다. **동의 전 대화는
  소급 학습하지 않는다.** 큐·기억 노드·요약 RPC도 근거 메시지가 최신
  `memory_reset_at` 이후인지 검사해, 서비스 코드가 회귀해도 소급 저장을 거부한다.
- 겹쳐 실행된 크론의 작업 선점은 **짧은 전역 트랜잭션 잠금**으로 직렬화한다.
  재선점된 작업은 현재 `attempt_count`를 **임대 토큰처럼 일치시킨 워커만** 완료할 수 있다.
- 주민등록번호·휴대전화·이메일·계좌·카드·비밀번호·정확한 주소·건강/성 민감정보는
  프롬프트 금지와 **별개로 서버 결정 규칙에서도 제거**한다.
- 채팅 원문과 사용자가 일정·예산 기능에서 직접 저장한 정보는 **기억 전체 삭제의
  대상이 아니다.** 이 차이를 화면에 명시한다.

### 2) 근거와 신뢰

- 가격·통계·업체 정보는 **출처 / 기준 시점 / 확인 수준**을 분리한다.
- 확인 수준은 "공식·검증 데이터 / 참고 시세 / 추정 또는 추가 확인 필요"로 표현한다.
- 업체가 직접 확인하지 않은 가격을 **확정 견적처럼 쓰지 않는다.**
- 계약 문서는 위험 문구·확인 질문·쉬운 번역을 제공하되 **법률 판단이나 승소 가능성을
  말하지 않는다.**
- **모델 응답은 데이터베이스 권한이 아니다.** 사용자·커플·공유/개인 범위는 서버와
  RLS가 다시 검증한다.

### 3) 결정과 실행

- 일정·예산·비교·체크리스트 도구 호출은 사용자 의도를 확인한 뒤 실행한다.
- 실행 작업은 **요청 키와 작업 키로 중복 실행을 막고, DB의 실제 결과를 받은 뒤에만**
  성공이라고 말한다.
- 예약·취소·결제처럼 위험도가 높은 작업은 베타 안전 도구 목록에서 계속 막거나 추가
  확인을 요구한다.
- 모델 전환과 메모리 기능은 일정·예산 적용 경로를 대체하지 않는다. **실행은 도구
  계층, 기억은 상담 맥락 계층**으로 분리한다.
- 저장 도구가 없는 **체험 상담**에서는 모델 문구만 믿지 않는다. 날짜·예산·예약의
  확정형 발화를 서버가 감지해 "실제 기능에는 저장되지 않았다"는 고지를 보장한다.

### 4) 선제적 케어와 위험 감지

- 일정 기반 **D-3 준비 / D-1 짧은 대본 / D+1 안부** 흐름을 유지한다.
- 이메일 등 **외부 발송은 명시적 수신 동의 시각이 있는 사용자에게만.**
  과거 기본값 `true`는 동의 증거로 인정하지 않는다.
- 케어 메시지는 한 번에 한 가지 도움만 제안하며 **죄책감·불안·긴급성을 인위적으로
  만들지 않는다.**
- 연결된 커플의 공유 케어는 **두 사람 모두의 명시적 동의를 DB 함수가 발송 직전에
  다시 확인**한다. 크론이 앞서 읽은 동의 상태가 오래됐더라도 발송하지 않는다.
- 실제 사람이 대기하는 운영 조직이 없으므로 "24시간 내 전문가 검토" 같은 SLA를
  제품 약속으로 쓰지 않는다.

### 5) 관계와 중재

- **공감 → 서로의 표현을 중립적으로 번역 → 확인된 데이터 → 작은 합의안** 순서.
- **심리 진단이나 성별 고정관념을 사용하지 않는다.**
- 한 사람이 누른 동의는 그 사람의 의사만 저장한다. **두 사람 모두 같은 중재안에
  동의한 뒤에만** 공동 `decision_node`를 만든다.
- DB가 각 중재 카드에 **proposal version + 당시 커플 구성 fingerprint**를 발급한다.
  클라이언트는 사용자가 실제로 본 두 값을 확인 요청에 함께 보내며, DB의 최신 값과
  **정확히 일치하지 않으면 저장하지 않는다.**
- 선택안 문구뿐 아니라 카드의 공감·통역·확인 정보 중 **하나라도 바뀌면 새 proposal
  version**으로 취급하고 이전 대기 확인을 전부 무효화한다.
- 파트너가 연결되지 않은 계정에서는 중재안을 공동 결정으로 확인할 수 없다.
- 중재안은 **AI 메시지에 붙는 확인 카드**로만 보여 준다. 사용자 메시지 분기에는
  렌더링하지 않는다.

## 6.3 런타임 규칙 (어기면 안 됨)

- **OpenAI Responses API 전용**, `store:false`. **Anthropic 런타임 사용 안 함.**
- 허용 모델은 **`gpt-5.6-luna`와 `gpt-5.6-terra`뿐.** 다른 모델이나 Anthropic
  fallback으로 **조용히 우회하지 않는다.**
- 일반 상담은 **Luna**, 계약·위기·반복 수정처럼 오답 비용이 큰 경우에만 **Terra**.
- 모든 생성 호출은 Responses API, `store:false`, **출력 상한**,
  **자동 provider retry 0회**, **원문 비저장 감사 로그**를 유지한다.
- 모델 응답과 도구 실행을 분리한다. 일정·예산은 승인된 도구의 DB 결과를 받은 뒤에만
  성공이라고 말한다.
- 커플별 베타 상담 한도는 현재 release contract에서 해제하되,
  **전역 일일 턴과 USD 비용 상한은 원자적 장부로 유지**한다.

### 런타임 흐름

```text
사용자 메시지
  → 인증·커플·공유/개인 범위 확인
  → 기존 요약 / 명시적 결정 / 동의된 기억만 상담 문맥에 포함
  → GPT-5.6 Luna 또는 Terra 응답
  → 승인된 도구만 실행하고 DB 결과 확인
  → AI 메시지 영구 저장
  → DB가 동의·범위·대상 메시지를 다시 확인한 뒤 원문 없는 내구성 작업을 큐에 기록

10분 크론 (/api/cron/amora-memory)
  → 만료 작업 회수 및 커플/범위별 직렬 처리
  → 메시지 ID+시각 커서로 정확히 10~40개 선택
  → Luna 1회 구조화 컴파일
  → 근거 메시지 UUID와 신뢰도 검증
  → 의미 키 기준 멱등 저장 · 이전 값 폐기
  → 요약 커서 저장 후 작업 완료
```

## 6.4 아모라 도구 34개

`apps/web/src/lib/ai/tools.ts` + `tools/` 디렉터리. 실행기는 `toolExecutor.ts`.

| 그룹 | 도구 |
|---|---|
| **여정·진행** | `get_wedding_info` `update_wedding_date` `update_venue` `update_task_status` `toggle_checklist_item` `reset_category` `add_custom_category` `delete_category` `log_wedding_event` |
| **예산** | `get_budget_summary` `update_budget` `update_category_budget` `apply_budget_plan` |
| **일정** | `get_schedule_summary` `get_schedule_events` `add_schedule_event` `update_schedule_event` `delete_schedule_event` |
| **업체** | `search_vendors` `recommend_vendors` `get_vendor_detail` `check_vendor_availability` `get_available_slots` |
| **예약** | `create_booking` `get_my_bookings` `cancel_booking` |
| **가격·견적** | `analyze_quote` `get_market_price` `simulate_guest_guarantee` |
| **리스크·지원** | `analyze_contract_readiness` |
| **장소** | `search_nearby_places` (상견례 장소 등) |
| **아모라 액션** | `add_amora_action` `get_amora_actions` `update_amora_action` |

관련 파일: `amoraActionTools.ts` `bookingTools.ts` `placeSearchTools.ts`
`progressTools.ts` `quoteMarketTools.ts` `riskSupportTools.ts` `scheduleTools.ts`
`vendorTools.ts` `planningConstants.ts`

## 6.5 기능 플래그 — 무엇이 켜져 있고 무엇이 잠겨 있나

| 플래그 | 의미 | 상태 |
|---|---|---|
| `AMORA_OPENAI_ENABLED` | 주 상담 OpenAI 런타임 | `.env.example` false / **운영은 ON**(채팅 라이브, 650행) |
| `AMORA_PROACTIVE_CHAT_ENABLED` | 인앱 선제 케어(아모라가 먼저 말함) | `.env.example` false / **운영 ON으로 동작 확인됨** |
| `AMORA_AUXILIARY_MEMORY_ENABLED` | 장기기억 큐·크론 | **false** — 27-table 백업·검증·카나리 전까지 |
| `AMORA_CARE_OUTBOUND_ENABLED` | 케어 외부 이메일 | **false** |
| `AMORA_COMMUNITY_AI_COMMENT_ENABLED` | 커뮤니티 자동 댓글 | **false** — 모더레이션·비용·삭제 카나리 전까지 |
| `AI_LOG_RETENTION_CRON_ENABLED` | AI 원문 보존 크론(파괴적) | **false** |
| `ACCOUNT_DELETION_INTAKE_ENABLED` / `_CRON_` | 계정 삭제 saga | **false** — 운영 owner·수동 SLA 없으면 안 켬 |
| `PRODUCTION_WRITE_FENCE_ENABLED` | 릴리스용 쓰기 차단(503) | false (평시) |
| `AMORA_PROFILE_MEMORY_MODE` | off / conservative / full | **conservative** |

> **플래그 실제 상태는 문서가 아니라 동작으로 확인한다.** 과거 프로액티브를
> "미설정"으로 알고 있다가, 라우트가 플래그 OFF면 인증 전에
> `reason:"proactive_chat_disabled"`를 주는데 실제 응답은 이유 없는
> `{triggered:false}`인 것을 보고 ON임을 확인한 사례가 있다.

**기억 플래그를 켜도 사용자별 동의 기본값은 `false`다.** 전역 플래그가 꺼진 동안에도
**기존 데이터 열람·삭제와 동의 철회는 계속 가능해야 한다**(새 동의만 막는다).

## 6.6 비용 가드

| 값 | 현재 |
|---|---|
| `AMORA_COST_GUARD_ENABLED` | **true** (운영 승인 없이 끄지 않는다) |
| `AMORA_COUPLE_QUOTA_ENABLED` | false (베타에서 커플별 한도 해제) |
| `AMORA_FREE_MESSAGES_PER_COUPLE` | 100 (코드 기본값) |
| `AMORA_GLOBAL_DAILY_MESSAGE_CAP` | **300** |
| `AMORA_GLOBAL_DAILY_COST_CAP_USD` | **$20** |

- 기준은 `ai_interactions_log`의 `chat_turn` DB 카운트. `is_admin`만 면제
  (클라이언트가 보낸 값은 불신), fail-open.
- `check-couple-conflict`의 mediation LLM 호출도 **같은 장부에 편입**돼 있다.
- 한도 도달 시 사용자에게는 부드러운 문구:
  "오늘 아모라 상담이 많아 잠시 쉬어가고 있어요… (베타 기간 한도)"
- 코드: `lib/ai/costGuard.ts`, `amoraMemoryCostGate.ts`, `amoraProviderCallLedger.ts`
- 리포트: `corepack pnpm amora:costs`

## 6.7 냉정한 현재 한계 (문서에 명시된 것)

- 기억의 정확도는 구조·검증으로 높일 수 있지만 "완벽한 사람 이해"를 보장할 수 없다.
  **그래서 사용자 수정·삭제가 핵심 기능이다.**
- 공식 업체 제휴·실시간 재고·확정 견적·커미션 공개 체계는 **아직 별도 사업/데이터
  프로젝트**다.
- 사람 전문가 검토 큐, 법률 자문, 의료·심리 상담은 **제공하지 않는다.**
- HBAM2(백업 스냅샷)는 암호화된 논리 스냅샷과 무결성 검증 수단이지, 공급자 물리
  복구와 독립 논리 복원 훈련을 대체하지 않는다.

## 6.8 출시 성공 지표 (아모라)

- 기억 동의 전 자동 기억 생성 **0건**
- 공유 기억 한쪽 동의 상태에서 처리 **0건**
- 근거 메시지 없는 기억 저장 **0건**
- 같은 작업 재시도에 의한 중복 일정·예산 변경 **0건**
- 한쪽만 동의한 중재안의 공동 결정 저장 **0건**
- 케어 외부 발송 중 명시적 동의 시각 없는 발송 **0건**
- 상담 P95, 첫 토큰 시간, 도구 성공률, 모델별 비용을 릴리스 전후로 비교
- 기억 수정·삭제율과 "다시 물어봄" 불만율을 함께 관찰

## 6.9 아모라 코드 위치

```
apps/web/src/lib/ai/
├── toolExecutor.ts            도구 실행 (가장 큰 파일)
├── prompts.ts                 시스템 프롬프트
├── tools.ts, tools/           도구 정의 34개
├── openai.ts, auditedOpenAI.ts        provider 래퍼 + 감사 로그
├── modelConfig.ts             Luna/Terra 라우팅
├── amoraMemoryCompiler.ts     장기기억 컴파일
├── amoraMemoryQueue.ts        큐·임대·재시도
├── amoraMemoryCostGate.ts     기억 비용 게이트
├── amoraProviderCallLedger.ts 원자적 비용 장부
├── amoraAtomicToolOperation.ts 도구 원자성
├── amoraPendingAction.ts      승인 대기 액션
├── amoraCrisisSafety.ts       위기 상황 안전
├── mediation.ts               중재
├── conflict-detector.ts       커플 갈등 감지
├── costGuard.ts               전역 비용 가드
├── amoraPromptComposer.ts, amoraVoice.ts, amoraWeddingContext.ts
├── chatMessagePersistence.ts, chatRequestClaim.ts, chatSuggestions.ts
├── feedbackLessons.ts, automaticFeedback.ts, dissatisfaction.ts
└── placeSearchRouting.ts, safetyIdentifier.ts, summarize.ts
```

---

# 7. 업체 공시 파이프라인

**이 서비스가 유일하게 가진 진짜 자산.** 정부·기관이 공개한 웨딩 업체 공시 원본에서
기본가·추가금·위약금을 뽑아 사람이 검수해 발행한다.

## 7.1 흐름

```
공시 원본(HWP/PDF/DOCX/XLSX)
  → scan     원본 목록·해시 고정
  → convert  정규 텍스트로 변환
  → extract  local-deterministic-v1 (결정적 로컬 파서, 토큰·비용 0)
  → validate strict validator (근거 없는 행은 보수적으로 차단)
  → load     pending + needs_review 상태로만 적재
  → 사람 검수 → 개별/검증 가능한 일괄 승인
  → 발행 → snapshot 공개(별도 승인)
```

명령: `corepack pnpm ingest <sub>` (`scripts/ingest/index.ts`)

## 7.2 강한 안전 장치

- **유료 OpenAI 추출은 production에서 하드 비활성**
  (`paid_openai_extraction_hard_disabled`). `--plan`, `--paid-openai`,
  `--approved-plan-sha256`의 분리형·`=`형 모두 CLI에서 차단.
- 기본 `ingest extract`의 **정적 import graph에서 `openai` 패키지 자체가 제거**됐다.
- raw 원본·`.state`·변환물·후보/영수증·비용 ledger·비밀값은 **Git에 넣지 않는다.**
  코드·테스트·운영 계약만 Git으로 공유한다. 이게 들어오면 `test:ingest`가 실패한다.
- `disclosure_semantic_staging`은 **원자 적재 RPC로만** 쓸 수 있게 잠겨 있다
  (`guard_vendor_disclosure_atomic_protected_write`).
- 과거 유료 추출 ledger(입력 10,426,591 토큰 / 출력 3,737,302 토큰 / 누적 추정
  **$43.87**)는 **감사 이력이므로 삭제하거나 0으로 다시 쓰지 않는다.**

## 7.3 "검수된 것"을 무엇으로 볼 것인가 — 이 릴리스의 핵심 판단

위약금 원문을 공개할 때 `review_status`를 사후 승인해 주는 정식 경로가 **없었다.**
처음 쓴 승인 UPDATE 마이그레이션은 스테이징에서
`DISCLOSURE_ATOMIC_PROTECTED_WRITE_RPC_REQUIRED`로 막혔다.

대신 **정책 행은 전부 `official_price_id`로 가격 행에 묶여 들어온다**는 것을 확인했다
(895/895 연결, 업체 불일치 0). 그 가격 행은 사람이 검수해 발행한 바로 그 행이다.
그래서 **"승인·발행된 가격 행에 딸려 온 원문"만 공개**한다. 마이그레이션이 2개에서
뷰 1개로 줄었다.

## 7.4 공개 규칙

- **원문(`content_verbatim`)만 노출.** 요약·해석은 판정이므로 담지 않는다.
- `source_agency`는 JSONB이고 내부 원본 파일 경로를 품고 있어 **이름만** 꺼낸다.
- confidence < 0.9인 64행 제외.
- `document_section` 827행은 대행사 문서 전체에 걸린 항목이라 업체 확정 불가 →
  제외(원본 대조에서도 824건 전부 업체 매칭 실패).

## 7.5 대행사별 차이 안내 — 기각한 설계까지 기록

문구가 같은 공시는 로더가 이미 합치므로, **여러 장이 남았다는 건 곧 문구가 다르다는
사실**이다 — 해석이 아니라 관찰이다.

> "이 업체는 대행사 N곳이 서로 다른 문구로 공시했어요. 계약할 대행사의 조건을 직접
> 비교해 보세요."

**기각한 설계**: 원문에서 (기간, 비율)을 추출해 "조건이 같다/다르다"를 말하려 했으나
787행 실측에서 접었다.

| 결과 | 비율 |
|---|---|
| 깨끗하게 전부 추출 | 21.2% |
| 일부만(애매한 줄 존재) | 30.9% |
| 하나도 못 뽑음 | 47.9% |

대행사 2곳 이상인 업체 181곳 중 비교 가능한 건 **18곳(10%)**뿐.
**90%에서 안 나오는 기능은 소음이고, 애매한 31%가 계약 조건 숫자를 틀릴 자리다.**

## 7.6 지역 공급 불균형을 숨기지 않는다

실측(공시한 업체 수):

| 지역 | 업체 | 지역 | 업체 |
|---|---|---|---|
| 서울 강남권 | 509 | 경기 | 37 |
| 서울 기타 | 176 | 제주 | 9 |
| 전라 | 90 | 대구 | 6 |
| 충청 | 53 | 인천 | 5 |

10곳 이하일 때 "공시한 업체만 싣기 때문이라, 실제 업체 수와는 다릅니다" + 전체 지역
탈출구를 붙인다. **이걸 안 밝히면 우리가 그 지역 시장을 왜곡해 보여주는 셈이 된다.**

공시 0건 지역 6곳(강원·대전·광주·경상·부산·울산)은 **HWP 8건 수동 변환**이 커버리지를
가장 크게 올린다. **코드로는 못 넣는다.**

## 7.7 업체 신원 규칙 — 한 함수로 통일

`apps/web/src/lib/price/vendorIdentity.ts`의 `canonicalVendorName()`.

목록 카드는 (카테고리 + 정규화 이름)으로 묶는데 상세는 슬러그 하나만 보던 시절
**157그룹 · 형제 185행이 상세에서 통째로 누락**됐다(아르센은 카드에 대행사 4곳인데
눌러 보면 1곳). 지금은 목록·상세가 같은 함수를 쓴다.

정규화가 지우는 공백·구두점은 SQL로 흉내낼 수 없어, 글자 사이에 `%`를 끼운 ILIKE로
후보만 넓게 긁고 최종 판정은 같은 정규화 함수로 한다(과매칭 최대 151 — 이름이
"스튜디오"인 1곳).

## 7.8 현재 데이터 실측

- 원본 **253 files / 249 units**, 변환 가능 **241 units**, 사람 변환 대기 **HWP 8건**
- 업체 병합: 표기만 다른 같은 업체 **26쌍 병합 완료**(16 + 10), **미결 37쌍**
  - 미결은 일반 웹 검색으로 못 닫는다(1차 리서치가 `low_confidence`로 거절했고 사유가
    "2자 초단명 상호라 확정 불가"). **업체 직접 확인이나 다음 공시 라운드 필요.**
  - 근거: `docs/operations/evidence/vendor-merge-evidence-2026-07-28.json`(24KB)
- 로컬 후보 hard error 36 units / coverage gap 53 units / 이미지 hold 76 units는
  사람이 원본과 대조해 확정해야 한다.
- `load --apply`는 상태 인식형 25건 batch runner가 없어
  `load_apply_blocked_pending_state_aware_batch_runner`로 계속 닫혀 있다.

## 7.9 공시 변경 시 추가 게이트

```bash
corepack pnpm ingest:typecheck
corepack pnpm test:ingest
corepack pnpm supabase:release:test
corepack pnpm supabase:release:fence
```

---

# 8. 커뮤니티

## 8.1 위치

`/community` = 사용자에게는 **`/wedding`** = **첫 화면**. 로그인 없이 볼 수 있다.

## 8.2 카테고리 8종

`apps/web/src/constants/communityCategories.ts`

| key | 라벨 | 업체 태그 | 가격 폼 |
|---|---|---|---|
| `is_normal` | 이거 정상인가요? | ✅ | ✅ |
| `tour_review` | 투어/이용 후기 | ✅ | — |
| `tips_v2` | 꿀팁 | — | — |
| `ama` | 결혼 선배 Q&A | — | — |
| `free` | 자유게시판 | — | — |
| `general` | 일반 글 | — | — |
| `sponsored` | 협찬 포함 | — | — |
| `ad` | 광고 | — | — |

`sponsored` / `ad`는 **광고 표시 의무** 때문에 별도 카테고리로 분리돼 있다.

## 8.3 기능

- 실시간 업데이트(Supabase Realtime), 정렬(최신/인기/추천), 무한 스크롤, 검색, 태그 필터
- 글: 이미지·영상 업로드(MP4/MOV/WebM), 자동 저장, 미리보기, **비용 공유 구조화
  데이터(`cost_data`)**
- 상세: 투표(업/다운), 북마크, 댓글·대댓글(Realtime), 신고, 작성자 랭크
- **Editor's Pick**: `is_weekly_best` 또는 `is_pinned` 글 배너 (관리자 수동 지정)
- 아바타: ①유저 업로드 → ②이모지 → ③**로컬 SVG 자동 생성**(닉네임 기반).
  과거 DiceBear API는 로컬 생성으로 교체됨
- 게이미피케이션(랭크/XP/업적): 마이그레이션·타입·라벨만 존재, **API 미구현 반쪽 상태**

## 8.4 동기방 (cohort)

**분기별 그룹**(예: 2026년 3분기). 3탭:

1. **채팅** — 실시간 메시지, 이미지 첨부, 커뮤니티 글 공유 카드, @멤버 멘션,
   주제 필터 pill
2. **정보판** — 계약 정보 등록 → 카테고리별 **동기 평균 가격**(5명 이상일 때만) →
   전국 평균과 비교
3. **타임라인** — 동기 활동 피드("OO님이 XX 완료!")

**익명성 계약**이 걸려 있다. 과거 contracts API의 `select("*")` 익명성 구멍은 수리됨.
`community_assign_cohort` RPC는 REVOKE 처리돼 강제 배정 IDOR을 차단한다.

## 8.5 커뮤니티 AI

- 아모라 자동 댓글은 **플래그로 잠겨 있다**(`AMORA_COMMUNITY_AI_COMMENT_ENABLED=false`).
- 켜더라도 **AI 표시가 붙은 official 계정**으로만 발화한다(§3 금지선).
- 과거 AI 페르소나 18종(`lib/community/agents/`)은 전량 해체됐다.

---

# 9. WeddingCode와 「오늘 한 마디」

## 9.1 WeddingCode — 운영 차단 중인 연구 프로젝트

결혼 준비 상황에서의 성향을 재는 **심리측정 도구**를 만들려는 연구다.

**현재 판정: Production 수집·결과·커플 비교 차단 유지.**

| 표면 | 상태 |
|---|---|
| `/wedding-code` | 안내 페이지만 (metadata·OG 포함) |
| `/wedding-code/result` | redirect |
| `/api/wedding-code/response` | **410 Gone** |
| `/api/wedding-code/pair` | **410 Gone** |
| `/api/wedding-code/couple-report` | **410 Gone** |
| DB | write fence |

### 격리 규칙

- 연구 코드는 `apps/web/src/lib/weddingCode/research/`에만 둘 수 있다.
- legacy score/report/answers/share/storage나 Candidate 4 상수를 **import 금지**.
- page module은 `localPreviewPage.tsx`이며 **전용 dev wrapper가 실행 중에만 무추적
  라우트를 생성**한다. 운영 빌드와 연구 실행은 같은 exclusive lock을 쓰고, build 뒤
  manifest/static/server 후보 문자열을 재검사한다.
- 연구 코드는 **React memory state만** 사용. storage·network·analytics·UTM 0건.
- `apps/web/src/constants/weddingCodeV05.ts`, `WeddingCodeClient.tsx`,
  `ResultClient.tsx`는 Candidate 4의 **휴면 legacy**다.

### 재개 전 필수 인간 게이트 (전부 미통과)

- 대상자 concept elicitation과 반복 **인지면접**
- simulation/power 계획에 따른 **파일럿과 구조 검증**
- **독립 동의한 실제 커플 최소 3쌍**의 비난·도구화 검증
- 측정/설문 또는 관계·소비자 연구 **전문가 검토**
- 개인정보·소비자 안전 담당자의 **서면 승인**
- 별도 **Production 재개 PR**과 운영 승인

이 게이트 전에는 "검증됨", "정확한 웨딩 성향", "궁합", "결혼 성공 예측"을 말하거나
containment를 해제하지 않는다.

### 절대 건드리면 안 되는 것

- 운영 차단(안내 페이지·410·write fence) 해제
- `candidate6.ts`(측정 계약) — 문항 텍스트·`CORE_ORDER`·`buildCandidate6Journey`·
  Form A/B orientation·`ES_FIRST/AS_FIRST`·escape 처리
- research 코드를 운영·프리뷰 라우트, API, DB, analytics, browser storage에 연결
- 점수·유형·궁합·overlap·규준·cutoff를 만드는 것
- WeddingCode 문항·장면·카드 생성에 **LLM 사용**(전부 하드코딩 결정적 상수)

## 9.2 「오늘 한 마디」 — PR #75의 새 운영 표면

### 왜 만들었나

연구 프로토타입 위에 재미를 얹어 봤더니, **문항이 교란변수를 피하려 일부러
추상적이라** 그 위에 쓴 카드도 결혼과 무관한 일반 협업 문장이 됐다 —
실측 결과 회수 문장 17개 중 결혼 고유어가 **1개**였다. 파운더가 직접 보고
"재미도 없고 이게 뭔가 싶다"고 판정했다.

→ **문항을 버리고** 실제 한국 결혼 준비 장면을 그대로 쓰는 **별도 운영 표면**을 만들었다.

### 무엇인가

- 코드: `apps/web/src/lib/todayOneLine/deck.ts` + `apps/web/src/app/today/*`
- **카드 29장 덱.** 각 카드 = 장면 한 줄 + 오늘 그대로 말할 반말 한 문장 +
  하루 속의 자리 + (돈·계약이 걸린 카드에만) 계약 전 확인할 것
- **매일 3장만 뽑고, 항상 마음 2 + 돈 1**로 고정
- 흐름: 세 장 중 내가 물어볼 한 장 고르기 → 상대가 나한테 물어줄 한 장 고르기 →
  링크 없는 초대
- 10분 ISR(seed가 KST 날짜에서 나옴). **로그인 불필요.**
- **점수·유형·궁합 없음. 응답 수집 없음. 연구 코드 import 안 함.**
  → 측정을 하지 않으므로 **연구 게이트(R1·R4)의 적용 대상이 아니다.**

### 설계 판단 (DESIGN.md Decisions Log에 등재됨)

- **2026-07-29**: 목록이 아니라 **세 장 뽑기**로, 세 장은 항상 마음 2 + 돈 1.
  이유 — 28행 목록으로 띄워보니 첫 화면 10장 중 9장이 돈·계약이라 첫인상이
  **청구서**였다. 구성을 seed 운에 맡기면 돈만 세 장인 날이 반드시 생긴다.
- **2026-07-29**: 공유 링크 원문(URL)은 결과 화면에 텍스트로 노출하지 않는다.
  주소에 카드 id가 들어 있어 캡처를 보내는 순간 **상대가 열기 전에 어느 장인지
  들킨다.** 주소는 복사 버튼이 들고 있는다.

### 저작 규칙 (전부 테스트가 강제)

- `scene` 20~34자. **과잉 구체 디테일 정확히 하나** — 여기서 "알아봄"이 터진다.
- `say` 30자 이내, 물음표로 끝나는 **반말 한 문장**. 그대로 소리 내 말할 수 있어야 한다.
  **상대가 답할 수 있는 질문만** — "추가금 얼마 붙어?"처럼 업체에 물을 말은 상대 앞에서
  아무것도 열지 못한다. 그런 사실은 `check`로 내린다.
- `when` 하루 속의 자리. 가사 성역할·운전은 쓰지 않는다.
- `check`는 돈·계약이 실제로 걸린 카드에만. **전체의 1/3을 넘지 않는다** — 넘으면
  잔소리가 된다.
- 판정 금지(점수·등급·유형·궁합·안전/위험·가격대 분류), 특정 업체명 금지,
  의무형(~해야 한다) 금지, 상대 평가·대리 개입 금지, 특정 가족 형태 전제 금지.

### 핵심 설계 철학

재미를 **측정 화면 앞과 뒤에만** 둔다. 문항 화면에는 우리 문장을 얹지 않는다 —
재미있는 지문이 문항의 기준점을 옮기기 때문이고, **잘 쓸수록 더 위험하다.**
재미는 4글자 코드가 아니라 **"야 이거 나잖아" 하는 순간**이고, 코드는 그 순간을
회수하는 봉투일 뿐이다.

---

# 10. 모바일 앱

## 10.1 기본 정보

| 항목 | 값 |
|---|---|
| 프레임워크 | Expo SDK ~54.0.36 + Expo Router ~6.0.24 + React Native 0.81.5 + React 19.1 |
| 앱 이름 | 웨딩한방 |
| Bundle ID (iOS) / Package (Android) | **`ai.hanbang.wedding`** |
| Scheme (딥링크) | `hanbang://` |
| 버전 | 1.0.0 |
| 빌드 | EAS Build (`mobile-eas-release-gate.mjs` 경유) |
| Apple Team ID | **6RSK726532** (Individual, 승인 완료 2026-04-14) |
| Apple Services ID | `ai.hanbang.wedding.web` |
| Google Play | 개발자 계정 완료 ($25 결제) |

## 10.2 화면

```
app/
├── index.tsx                     스플래시/라우팅
├── (auth)/login, signup, forgot-password
├── (tabs)/dashboard, chat, community, profile   ← 하단 4탭
├── onboarding/
├── budget/, schedule/, bookings/, market-prices/
├── vendors/index, vendors/[id]
├── community/post/[id], post/write, cohort/[id], cohort-discovery,
│              my-posts, my-bookmarks, quick-review
├── settings/index, settings/amora-memory
└── webview.tsx
```

## 10.3 모바일 고유 규칙 (중요)

- **NativeWind 쓰지 말 것.** pnpm 모노레포 + Expo SDK 54 조합에서 `className`이
  무시되는 버그가 있다. → **React Native StyleSheet + `@hanbang/design-tokens`
  직접 import.** (package.json에 nativewind가 남아 있지만 사용하지 않는다)
- **카카오 OAuth는 `account_email` scope를 반드시 제거**한다. 비즈앱이 아니라 이메일
  권한이 없다. Supabase "Allow users without email" ON.
  - 카카오 앱 ID 1381347
- OAuth는 **웹 콜백 브릿지 패턴**(`/auth/mobile-callback`).
- 폰트는 웹·모바일 모두 **Paperlogy**. 모바일에 남은 Noto/Cormorant 이름은 실제
  Paperlogy 파일에 매핑된 **호환 alias**일 수 있으니 로더를 확인한다.
- **첫 화면은 5초 안에 "오늘 무엇을 해야 하는지"** 보여야 한다.
- 고정 버튼은 safe-area·bottom navigation·다른 FAB와 겹치지 않게 **실제 320/375px
  화면에서 확인**한다.
- 앱은 웹 링크를 여는 곳이 있다 — 죽은 링크 방지를 위해
  `scripts/tests/mobile-web-link-targets.test.mjs` 계약이 걸려 있다.

## 10.4 검증·릴리스

```bash
corepack pnpm dev:mobile
corepack pnpm mobile:release-check
pnpm --filter @hanbang/mobile eas:build:ios      # 릴리스 게이트 경유
pnpm --filter @hanbang/mobile eas:submit:ios
```

**스토어 제출 전 남은 것**: **OSS 라이선스 고지 화면**(커밋 `7fe13493`이 죽은 링크를
지우면서 행이 사라졌다), signed EAS 빌드 + 실기기 검증.

---

# 11. 디자인 시스템 (전문)

## 11.1 제품 컨텍스트

- **무엇**: 함께 결혼을 준비하는 한국 커플을 위한 AI 웨딩 작전실
- **누구**: 결혼 6~12개월 전, 결정·예산·일정·업체·파트너 조율을 한곳에서 해야 하는 커플
- **형태**: 소비자 모바일 앱 + 웹 앱 + 커뮤니티 + 업체 마켓플레이스 + 마케팅 사이트
- **첫인상 목표**: "이 앱은 결혼 준비를 싸구려나 혼돈으로 만들지 않으면서
  **다음에 뭘 해야 하는지 알려준다**"

## 11.2 미감 방향

- **방향**: Quiet editorial utility (조용한 에디토리얼 실용성)
- **분위기**: 세련되고 따뜻하고 실용적. "웨딩 색을 칠한 범용 생산성 앱"이 아니라
  **결혼 디테일을 아는 차분한 플래너**처럼 느껴져야 한다
- **장식 수준**: 의도적. 타이포·여백·그림자와 소수의 프리미엄 악센트만 사용.
  장식적 소음 금지
- **모바일 자세**: 매일 쓰는 조종석. 첫 화면은 "오늘 중요한 게 뭐지?"에 먼저 답한다
- **웹 자세**: 더 에디토리얼하고 설명적. 긴 카피·풍부한 섹션·관리 워크플로 가능

## 11.3 타이포그래피

- **브랜드 폰트: Paperlogy** (웹·모바일 공통, display/body/UI/숫자 전부).
  자체 호스팅 — 웹 WOFF2 9종(Thin 100 ~ Black 900), 모바일 TTF
- **위계는 serif/sans/display 혼용이 아니라 Paperlogy의 weight·size·color·spacing으로**
- 숫자·display: Paperlogy + tabular number. D-day와 금액 총액은 더 큰 크기·굵기로,
  **다른 폰트 패밀리를 쓰지 않는다**
- **스케일**: xs 12 · sm 14 · base 16 · lg 18 · xl 20 · 2xl 24 · 3xl 30 · 4xl 36 · 5xl 48
- 규칙: 좁은 모바일 UI 안의 텍스트는 **스캔 우선**. 패밀리는 고정하고 weight/size만 바꾼다

> CSS에는 `--font-noto-serif-kr`, `--font-cormorant-garamond` 같은 **옛 변수명이 남아
> 있지만 전부 Paperlogy를 가리키는 alias**다(`globals.css`). 이름만 보고 다른 폰트가
> 로드된다고 오해하지 말 것.

## 11.4 색 (2026-07-29 기준 `globals.css` 실제 값)

접근: **절제된 따뜻한 럭셔리**, 웹/앱 브랜드 일치.

| 역할 | 토큰 | Hex |
|---|---|---|
| **Primary — Eucalyptus Ink** | `--noir-800` | `#36534E` |
| | `--noir-900` | `#243832` |
| | `--noir-soft` | `#4E6A62` |
| | `--charcoal` | `#5E665F` |
| **Accent — Dusty Mauve** | `--rose-500` | `#A77B74` |
| | `--rose-600` | `#8F6662` |
| | `--rose-light` | `#D2B4AA` |
| | `--rose-pale` | `#EADDD8` |
| **Background — Pearl Ivory** | `--ivory-50` | `#FBF8F2` |
| | `--ivory-100` | `#F7F1E8` |
| | `--ivory-200` | `#EFE4D7` |
| | `--ivory-warm` | `#F6EFE5` |
| | `--ivory-deep` | `#E8DCCB` |
| | `--surface-low` | `#F1E8DA` |
| | `--stone-900` | `#263832` |
| **Taupe** | `--taupe-400` / `--taupe-500` | `#B7AA9A` / `#635B51` |
| **Sage** (성공·검증·운영 상태) | `--sage-500` / `--sage-pale` | `#6D806E` / `#C7D1C2` |
| **Champagne Taupe** (희귀 하이라이트) | `--gold` / `--gold-light` | `#B89785` / `#E2D3C8` |
| **Danger** | `--danger-500` / `--danger-700` | `#D95F5F` / `#9F3535` |
| **Platinum** | `--platinum` | `#E6DDD2` |

**시맨틱**: success `#6D806E` · warning `#B89785` · danger `#D95F5F` · info `#36534E`

> **규칙: 앱을 핑크 앱으로 만들지 않는다.** Dusty Mauve는 주의를 유도할 뿐
> 모든 객체를 칠하지 않는다. 임의의 핑크·골드 팔레트를 새로 만들지 않는다.

## 11.5 여백

- 기본 단위 **4px**, 주로 **8px 스텝**으로 조합
- 모바일 밀도: 편안하되 성기지 않게. 결혼 준비는 정보량이 많다 —
  **앱 안에 마케팅용 과대 여백을 쓰지 않는다**
- 흔한 모바일 값: 화면 패딩 20 · 카드 패딩 16~24 · 섹션 갭 16~24 · 행 갭 8~12
- 규칙: **빽빽한 목록에 필요한 건 더 많은 보더가 아니라 리듬**

## 11.6 레이아웃

- 접근: **하이브리드**
  - 마케팅 = 에디토리얼 구성, 감성적인 첫 뷰포트, 풍부한 이미지
  - 앱 = 그리드 규율, 하단 탭 우선, 명확한 작업 위계
- **대시보드 우선순위 스택**: 오늘 → D-day → 진행률 → 급한 일 → 바로가기
- 채팅: 대화가 주인공. 컨트롤은 조용하고 한 손으로
- 커뮤니티: 스캔 우선 피드 + 강한 신뢰 신호(태그·카운트·명확한 글쓰기 액션)
- **Border radius**: sm 6 · md 8 · lg 12 · xl 16 · 2xl 20 · 3xl 28 · full 9999
- **규칙: 카드 안에 카드를 중첩하지 않는다.** 가능하면 전체 섹션과 행으로 만든다

## 11.7 모션

- 접근: 의도적
- **지속시간**: micro 80ms · short 160~220ms · medium 300~450ms
- 쓰는 곳: press 피드백, 진행률 노출, 단계 전환, 로딩 상태 명료화
- **안 쓰는 곳**: 핵심 워크플로 안의 장식적 스크롤 연출

## 11.8 모바일 UI 규칙

- 첫 화면은 **오늘 무엇을 챙겨야 하는지** 말해야 한다
- 버튼: 명령이 익숙하면 아이콘, 확신이 필요하면 텍스트
- 빈 상태는 **다음에 할 유용한 행동**을 제안한다
- 오류 상태는 신뢰를 지키고 **재시도**를 제공한다
- 폼은 불안을 줄인다 — **보이는 블록 하나당 결정 하나**
- **AI 추천과 검증된 업체 사실을 반드시 분리**한다. 광고·협찬 상태도 시각·문구로 분리
- 커플의 모든 결정은 `decision_nodes`에, 모든 AI 호출은 `ai_interactions_log`에 기록

## 11.9 감수할 만한 제품 리스크 (명시적 선택)

- **보통의 웨딩 앱보다 조용하게 만든다.** 덜 화려해 보이지만 예산·업체 결정에서
  신뢰를 만든다
- **AI를 마스코트가 아니라 운영자로 다룬다.** 장난스러운 매력을 잃지만 아모라가
  유능해 보인다
- **대시보드를 작업 우선으로 둔다.** 순수한 브랜드 히어로를 포기하지만 사용자는
  즉각적인 안도를 얻는다

## 11.10 Decisions Log

| 날짜 | 결정 | 근거 |
|---|---|---|
| 2026-06-30 | 초기 디자인 시스템 작성 | 기존 문서·토큰·모바일 방향을 하나의 source of truth로 통합 |
| 2026-07-02 | 모바일 토큰을 웹 eucalyptus 팔레트에 정렬 | 웹이 Eucalyptus Ink/Dusty Mauve/Pearl Ivory로 이동했으므로 공유 토큰도 일치 |
| 2026-07-02 | 웹·모바일 타이포를 Paperlogy로 표준화 | 파운더가 눈누에서 Paperlogy 선택. 웹 WOFF2·모바일 TTF 자체 호스팅 |
| 2026-07-28 | WeddingCode 로컬 연구 프로토타입은 화법에서 마케팅 예외를 받는다 | 측정 도구라 문구가 응답에 영향을 준다. 운영자 어조(해요체)는 유지, **마스코트 화법은 계속 금지**. 대상은 `lib/weddingCode/research/**`뿐 |
| 2026-07-28 | 같은 프로토타입의 off-scale 타입 값(13·15·17·28)과 `rounded-[24px]`·`rounded-[14px]` 잠정 유지 | 문항 화면의 세로 배분이 연구 가설2("다섯 답 동시 비교")에 직접 걸려 있어, 스케일 정렬이 접힘선을 움직인다. R1-UX 실기기 관찰 뒤 일괄 정렬 |
| 2026-07-29 | `/today`는 목록이 아니라 **세 장 뽑기**, 세 장은 항상 마음 2 + 돈 1 | 28행 목록으로 띄워보니 첫 화면 10장 중 9장이 돈·계약이라 첫인상이 청구서였다 |
| 2026-07-29 | 공유 링크 원문(URL)은 결과 화면에 텍스트로 노출하지 않는다 | 주소에 카드 id가 들어 있어 캡처를 보내는 순간 상대가 열기 전에 들킨다 |

## 11.11 React 19 + framer-motion 주의

framer-motion이 React 19에서 하이드레이션 문제를 일으킨다.
→ plain `div` + CSS 클래스 `animate-fade-in`으로 대체한다.
(`framer-motion`은 여전히 의존성에 있으나 신규 사용은 피한다)

---

# 12. 기술 — 스택·구조·명령·컨벤션

## 12.1 저장소 구조

```
<repo-root>/                     ← git 레포 루트 (= hanbang-web/)
├── apps/
│   ├── web/                     Next.js 16 웹·API·Vercel 배포 대상
│   │   ├── src/app/             App Router (= 라우트 정본)
│   │   ├── src/components/      admin analytics app auth common community
│   │   │                        customer-landing demo landing onboarding
│   │   │                        price quote ui vendor-price
│   │   ├── src/lib/             ai amora price community chat couples care
│   │   │                        memory legal compliance marketPrice quoteCheck
│   │   │                        todayOneLine weddingCode vendors supabase …
│   │   ├── src/constants/       checklists communityCategories hiddenCosts
│   │   │                        marketPrices moments notifications
│   │   │                        vendorAsymmetry weddingSeasonality …
│   │   └── .env.example         ← 환경변수 정본
│   └── mobile/                  Expo/React Native·EAS 빌드 대상
├── packages/
│   ├── shared/                  웹·모바일 공유 로직·타입 (constants types utils)
│   └── design-tokens/           공통 색상·간격 토큰
├── supabase/
│   ├── migrations/              순서 고정 DB 마이그레이션 (147개)
│   ├── contract-migrations/     계약 검증용
│   ├── platform-operations/     Dashboard에서 별도 수행하는 Storage 작업
│   ├── release-checks/          read-only 사후 검증
│   ├── release-contracts/       릴리스 계약
│   └── release-manifests/       파일 hash·릴리스 순서 고정 manifest
├── scripts/
│   ├── ingest/                  공시 파이프라인 CLI
│   ├── tests/                   루트 계약 테스트 (node --test)
│   ├── audit/                   production-readiness-audit, vendor-merge-review
│   └── verify-local.mjs, build-web-safely.mjs, supabase-*.mjs …
├── docs/                        제품·연구·운영 문서와 검증 증거
├── .githooks/                   pre-push 게이트
├── AGENTS.md PRINCIPLES.md DESIGN.md CLAUDE.md README.md
├── package.json  pnpm-workspace.yaml  turbo.json
└── work/                        ← gitignore. 원본·스테이징 자격증명 (다른 PC엔 없음)
```

> 최상위 `weddinghanbang_website/` 폴더는 **껍데기**다.
> **새 파일은 반드시 `hanbang-web/` 안에** 만든다.

## 12.2 스택

| 영역 | 버전·기준 |
|---|---|
| 웹 | Next.js **16.2.6** App Router, React **19.2.3**, TypeScript **5.9.3**, Tailwind CSS **4** |
| 모바일 | Expo SDK **~54**, Expo Router **~6**, React Native **0.81.5**, TS strict |
| 상태 | **Zustand 5** + 서버/API 기반 상태 |
| 데이터 | Supabase (`@supabase/supabase-js` ^2.95, `@supabase/ssr` ^0.8) |
| AI | `openai` **6.46.0** — Responses API |
| 검증 | **zod 4.3.6**, ajv 8.20 |
| UI | lucide-react, framer-motion(신규 사용 자제), date-fns |
| 이메일 | Resend ^6.9 |
| 관측 | `@sentry/nextjs` ^10.66, `posthog-js` ^1.386 |
| 테스트 | **vitest 4** (웹) · `node --test` (루트 계약) · PGlite(마이그레이션) |
| 문서 파싱 | mammoth(docx), pdf-parse, xlsx, jszip, saxes |
| 패키지 | **pnpm 11.7.0** + **Turborepo 2.9.18**, Node **≥22.13** |

> **pnpm 버전 함정**: 반드시 `corepack pnpm` 또는 `npx pnpm@11.7.0`을 쓴다.
> **전역 pnpm 9.15는 lockfile override를 날려먹는다.**

## 12.3 개발 환경 세팅

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm hooks:install
Copy-Item apps/web/.env.example apps/web/.env.local
```

- `hooks:install`은 `core.hooksPath`를 `.githooks`로 지정한다(**체크아웃마다 한 번**).
  `pre-push`가 typecheck·lint·test를 돌려 깨진 상태의 push를 막는다.
  turbo가 캐시하므로 이미 돌려 본 상태면 수 초다.
  정말 필요할 때만 `HANBANG_SKIP_PREPUSH=1 git push`.
- `.env.local`은 예시값이라 그대로는 운영 점검이 안 된다. 실제로 필요한 최소:
  - `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    → Supabase Dashboard → Project Settings → API
  - `SUPABASE_ACCESS_TOKEN` → Supabase Dashboard → Account → Access Tokens.
    **`audit:production`이 이것 없이는 못 돈다.**

## 12.4 명령

```bash
# 개발
corepack pnpm dev:web
corepack pnpm dev:mobile

# 검증
corepack pnpm qa:local            # 웹·모바일 typecheck/lint/vitest/production build
corepack pnpm test                # 루트 계약 테스트 + turbo test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm mobile:release-check

# 감사
corepack pnpm audit:production    # 운영 DB 읽기 점검 (SUPABASE_ACCESS_TOKEN 필요)
corepack pnpm audit:vendor-merge  # 업체 병합 후보 (비밀값 불필요)
corepack pnpm amora:costs         # 아모라 비용 리포트
corepack pnpm amora:eval          # 아모라 대화 평가
corepack pnpm qa:live             # 라이브 스모크

# 공시 파이프라인
corepack pnpm ingest <sub>
corepack pnpm ingest:typecheck
corepack pnpm test:ingest

# 릴리스 (엄격)
corepack pnpm supabase:release:fence
corepack pnpm supabase:release:test
corepack pnpm supabase:release:apply
```

로컬 연구 프로토타입:

```bash
npx pnpm@11.7.0 -C hanbang-web --filter @hanbang/web dev:wedding-code-research
# → http://127.0.0.1:3106/internal/wedding-code-research?form=A
```

### 명령 관련 함정

> ⚠️ **`qa:local`은 루트 계약 테스트를 돌리지 않는다.** 그건 `pnpm test`에만 있다.
> qa:local 그린만 보고 "전부 통과"로 읽지 말 것.

> ⚠️ **`npx next build`로 `scripts/build-web-safely.mjs`를 우회하지 않는다.**

> ⚠️ **`supabase db push`를 직접 실행하지 않는다.**
> `supabase:push` 등은 전부 `--refuse-direct-push` fence로 연결돼 있다.

## 12.5 코딩 컨벤션

- **함수형 컴포넌트만** (`export default function`)
- 스타일은 **Tailwind만**. **인라인 `style` 금지** (필요하면 `globals.css`에 유틸 추가)
- 서버 데이터는 Supabase Realtime, 로컬 상태는 Zustand
- **`any` 금지**, 무검증 type assertion 금지,
  **클라이언트가 보낸 권한·소유권 값을 신뢰하지 않는다**
- props 타입 필수
- 네이밍: 컴포넌트 PascalCase · 함수/변수 camelCase ·
  파일은 컴포넌트 PascalCase, 유틸 camelCase
- 에러는 try-catch + 사용자 친화 메시지.
  **내부 SDK/DB 원문·비밀값 노출 금지**
- 입력은 **시스템 경계에서 검증**
- 비밀값·`.env`는 절대 커밋 금지
- 주석은 한국어로 핵심 로직에만. 단 **"왜 이렇게 됐는지"(실측 수치·기각한 대안·
  밟은 함정)는 적극적으로 남긴다** — 이 저장소는 그 문화가 매우 강하다
- UI는 한 화면의 우선 행동을 명확히 하고 **로딩·빈 상태·오류·재시도를 모두 제공**

## 12.6 커밋·Git 규칙

**접두사**: `feat:` `fix:` `refactor:` `test:` `docs:` `chore:` `style:`

- 작업 시작: `git status --short --branch`, `git fetch --prune origin`, PR/원격 HEAD 확인
- **dirty worktree를 `reset --hard`·`checkout --`·`clean`으로 지우지 않는다**
- **의도한 파일만 stage.** `git add -A`로 범위를 숨기지 않는다
- 공유 전에는 현재 HEAD, 원격 HEAD, 테스트 결과, 남은 운영 게이트를 문서화
- 원격 변경은 clean integration branch 또는 명시적 merge/rebase 계획으로 합친다
- **강제 push 금지**
- 기존 사용자 변경을 보존한다. **범위 밖 파일을 되돌리지 않는다**

## 12.7 테스트 규칙

1. 변경한 함수·route·migration에 **가장 가까운 테스트를 먼저 RED**로 만든다
2. 수정 후 그 테스트를 GREEN으로 만든다
3. 영향 범위에 따라 typecheck → lint → 전체 테스트 → production build로 확장
4. UI는 실제 브라우저·실기기에서 **작은 모바일(320) · 일반 모바일(375) · 데스크톱**
   확인
5. 운영 전에는 preview/hosted clone 증거와 **production-safe read-only probe**를 구분
6. **마이그레이션 SQL은 정적 문자열 테스트만으로 완료하지 않는다.**
   PGlite와 hosted PostgreSQL 사후조건도 확인한다

---

# 13. 데이터 모델

정본은 `supabase/migrations/` (시간순 147개). 아래는 마이그레이션에 등장하는 전체 목록.

> ⚠️ **테이블이 존재한다고 기능이 살아 있는 것은 아니다.**
> 2026-06-11 수술 때 코드는 지웠지만 **DB 테이블은 보존**했다.
> `invitations*`, `payments`, `settlements`, `contracts`, `ai_scripts`,
> `community_agent_*`는 그런 유물이다.

## 13.1 테이블

**커플·여정**
`couples` · `wedding_journeys` · `decision_nodes` · `decision_edges` · `events` · `tags`

**채팅·아모라**
`chat_messages` · `chat_summaries` · `chat_feedback` · `amora_saved_notes` ·
`amora_actions` · `amora_couple_profiles` · `amora_memory_settings` ·
`amora_memory_consents` · `amora_memory_jobs` · `amora_care_jobs` ·
`amora_care_deliveries` · `amora_care_scan_states` · `amora_mediation_acceptances` ·
`amora_quote_checks` · `amora_tool_executions` · `amora_turn_counters` ·
`amora_turn_requests` · `amora_chat_request_claims` · `amora_conflict_check_claims` ·
`ai_interactions_log`

**커뮤니티**
`community_posts` · `community_comments` · `community_votes` · `community_bookmarks` ·
`community_reports` · `community_profiles` · `community_polls` ·
`community_poll_options` · `community_poll_votes` · `community_vendor_tags` ·
`community_upload_sessions` · `community_xp_log` · `community_streaks` ·
`community_achievements` · `community_agent_*`(유물)

**동기방**
`cohort_rooms` · `cohort_members` · `cohort_messages` · `cohort_contracts` ·
`cohort_timeline_events` · `cohort_member_reports`

**공시·가격**
`official_prices` · `official_price_options` · `official_agency_packages` ·
`official_review_events` · `price_snapshots` · `price_alerts` ·
`price_upload_confirmations` · `price_upload_confirmation_events` ·
`disclosure_semantic_staging` · `agencies` · `agency_dedupe_candidates` ·
`combos` · `wishlists` · `standard_contract_clauses`

**공시 적재 감사(ingest)**
`vendor_disclosure_ingest_runs` · `_batches` · `_owned_rows` · `_owned_identities` ·
`_owned_ledger_rows` · `_identity_links` · `_dedupe_links` · `_storage_links` ·
`_record_bindings` · `_unit_provider_lineage` ·
`vendor_disclosure_paid_extraction_attestations` ·
`vendor_disclosure_bulk_approval_audits`

**업체**
`vendor_alias_proposals` · `vendor_dedupe_candidates` · `vendor_enrichment_private` ·
`vendor_leads` · `vendor_messages` · `vendor_reviews` · `vendor_staff` ·
`vendor_tags` · `vendor_timeslots` · `vendor_photo_likes` · `vendor_views` ·
`vendor_daily_stats` · `vendor_demand_daily` · `vendor_contract_templates` ·
`product_timeslots` · `staff_timeslots`

**금전·기타**
`congratulatory_money` · `preregistrations` · `customer_events` ·
`customer_survey_responses` · `search_logs` · `rate_limit_buckets` ·
`booking_projection_jobs` · `wedding_code_responses`(차단됨)

**계정 삭제 saga**
`account_deletions` · `account_deletion_jobs` · `account_deletion_media_manifest`

**수술로 코드가 삭제된 유물 테이블**
`invitations` · `invitation_photos` · `invitation_guestbook` · `invitation_rsvp` ·
`invitation_accounts` · `invitation_templates` · `invitation_visits` ·
`guestbooks` · `guestbook_messages` · `guestbook_photos` ·
`guestbook_message_reactions` · `payments` · `settlements` · `contracts` ·
`contract_templates` · `ai_scripts`

## 13.2 뷰

`v_public_vendor_policies`(**위약금 공개 뷰 — 831행/412업체**) ·
`v_public_vendors` · `public_vendors` · `v_public_prices` · `v_public_price_options` ·
`v_public_official_prices` · `v_public_official_price_options` ·
`v_public_agency_packages` · `v_public_vendor_enrichment` ·
`v_private_admin_official_prices` · `v_private_admin_official_price_options` ·
`v_private_admin_agency_packages` · `admin_pending_vendors` · `vendor_today_bookings` ·
`cohort_stats` · `couple_profile_directory` · `my_profile_chat_state` ·
`v_events_canonical` · `community_human_posts` · `community_human_comments` ·
`community_human_votes` · `community_agent_daily_metrics` · `community_agent_daily_overview`

## 13.3 반드시 알아야 할 스키마 디테일

**`chat_messages`**
- `sender_type`: `'bride' | 'groom' | 'ai'`
- `role`: `'user' | 'assistant' | 'system'`
- 두 컬럼을 혼동하지 말 것.

**`wedding_journeys.progress` (JSONB)**
- `progress.__preferences` — 온보딩 선호도
- `progress.__events` — 이벤트(각 이벤트에 `momentType` 태깅 가능. 예: `sanggyeonrye`)
- `progress.__amora_actions` — 아모라 액션
- `progress.{category}` — 카테고리별 예산/지출/체크리스트

> ⚠️ **전체 덮어쓰기 금지.** 커플 동시 수정 유실(감사 critical)을 막기 위해
> **`apply_journey_progress_patch` RPC**(변경 키만 DB에서 원자 병합, service_role 전용)를
> 쓴다. 클라이언트 스냅샷을 통째로 쓰면 **상대방 변경이 사라진다.**
> 코드에서는 `patchJourneyProgress`를 쓴다.
>
> 남은 좁은 경합: `__events`/`__amora_actions` 같은 **배열 키의 동시수정**.
> 완전 해소는 일정/액션 테이블 분리가 필요하다(백로그).

**`is_my_couple(uuid)`**
- RLS 정책에서 쓰는 함수. 기존 `is_current_couple_member`는 `authenticated`에
  EXECUTE가 없어 **정책 평가 자체가 실패**(전 요청 403)했다.
  그렇다고 열면 "임의의 사용자 X가 커플 Y 소속인가"를 물을 수 있게 되므로,
  `auth.uid()`로 고정해 **자기 자신에 대해서만 답하는** 함수를 새로 만들었다.

---

# 14. 환경변수 전체

정본: `apps/web/.env.example`. `NEXT_PUBLIC_*`만 브라우저에 노출된다.

## Supabase (필수)
| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | 공유 Supabase (모바일과 동일) |
| `SUPABASE_SERVICE_ROLE_KEY` | RLS 우회. **브라우저 노출 금지** |
| `SUPABASE_ACCESS_TOKEN` | Management API PAT. 앱 런타임이 아니라 **운영 점검·릴리스 스크립트**가 쓴다. 없으면 `audit:production`이 죽는다 |
| `SUPABASE_EXPECTED_URL` / `_EXPECTED_PROJECT_REF` | service-role destination fence (singleton allowlist) |
| `SUPABASE_PRODUCTION_PROJECT_REF` | |
| `SUPABASE_PRODUCTION_WRITE_CONFIRM` | 운영 런타임 쓰기 시 정확히 `RUNTIME_WRITE:<ref>` |

## 공시 배포 게이트
| 변수 | 용도 |
|---|---|
| `PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_COUNT` | 승인 업체 수 정확값 (릴리스 증거) |
| `PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_SLUGS_SHA256` | 정렬된 slug 목록의 SHA-256 |
| `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` | **소유자가 직접 핀하는 release manifest SHA-256.** `VERCEL_ENV=production`에서만 검사. 없으면 빌드 fail-closed |

## 비밀·보안
`CRON_SECRET`(모든 `/api/cron/*` 필수, Vercel이 `Authorization: Bearer`로 전송) ·
`RATE_LIMIT_KEY_SECRET`(32자 이상, 회전 시 rate-limit 창 초기화) ·
`AMORA_COST_REPORT_PSEUDONYM_KEY` · `DEMO_SESSION_SECRET`(32바이트 이상) ·
`INTERNAL_API_TOKEN`(`X-Internal-Token`으로만 전송, 브라우저 노출 금지) ·
`VENDOR_INTERNAL_TOKEN`(레거시 호환. 둘 다 있으면 반드시 동일해야 함) ·
`ADMIN_PASSWORD` · `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
(**둘 다 넣어야 활성**, 미설정 시 자동 no-op)

## 아모라·AI
`AMORA_OPENAI_ENABLED` · `AMORA_AUXILIARY_MEMORY_ENABLED` ·
`AMORA_CARE_OUTBOUND_ENABLED` · `AMORA_PROACTIVE_CHAT_ENABLED` ·
`AMORA_COMMUNITY_AI_COMMENT_ENABLED` · `AI_LOG_RETENTION_CRON_ENABLED` ·
`ACCOUNT_DELETION_INTAKE_ENABLED` · `ACCOUNT_DELETION_CRON_ENABLED` ·
`PRODUCTION_WRITE_FENCE_ENABLED` ·
`OPENAI_API_KEY` · `OPENAI_AMORA_PRIMARY_MODEL`(=`gpt-5.6-terra`) ·
`OPENAI_AMORA_FAST_MODEL`(=`gpt-5.6-luna`) ·
`OPENAI_AMORA_PRIMARY_REASONING_EFFORT` / `_FAST_`(=`none`) ·
`AMORA_PROFILE_MEMORY_MODE`(off / **conservative**(현재) / full) ·
`AMORA_COST_GUARD_ENABLED`(true) · `AMORA_COUPLE_QUOTA_ENABLED`(false) ·
`AMORA_FREE_MESSAGES_PER_COUPLE`(100) · `AMORA_GLOBAL_DAILY_MESSAGE_CAP`(300) ·
`AMORA_GLOBAL_DAILY_COST_CAP_USD`(20) ·
`AMORA_SERVICE_USER_ID` / `NEXT_PUBLIC_AMORA_USER_ID`

## 외부 서비스
`RESEND_API_KEY`(없어도 앱 동작, 메일만 skip) ·
`NAVER_API_HUB_CLIENT_ID` / `_SECRET`(장소·사진 검색, 서버 전용) ·
`NEXT_PUBLIC_TOSS_CLIENT_KEY` / `TOSS_SECRET_KEY`(현재 미사용) ·
`NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` ·
`NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`(=`https://us.i.posthog.com`)
— **미설정 시 둘 다 자동 no-op**

## 사이트·모드
`NEXT_PUBLIC_SITE_URL`(=`https://hanbang.ai`) ·
`NEXT_PUBLIC_LAUNCH_MODE`(`coming_soon`이면 랜딩만) ·
`NEXT_PUBLIC_PREVIEW_STUB_MODE`(**Vercel Preview 전용** fail-closed —
랜딩 Supabase 효과 차단 + 모든 `/api/*` 503. **Production에서 절대 켜지 말 것**) ·
`WEDDING_CODE_RESEARCH_PREVIEW`(로컬 개발 전용, `NODE_ENV=development` 필요,
Preview/Production에서는 404)

## 사업자 식별 정보 (개인정보처리방침 하단)
`NEXT_PUBLIC_BUSINESS_NAME` · `_REGISTRATION_NUMBER` · `_REPRESENTATIVE` ·
`_MAIL_ORDER_NUMBER` · `_ADDRESS` · `_CONTACT_EMAIL` · `_CONTACT_PHONE`

> **상호와 사업자등록번호가 모두 채워져야** 화면에 나타난다. 비어 있으면 섹션 자체가
> 렌더되지 않는다 — **없는 값을 자리표시자로 띄우면 그게 곧 허위 표시**이기 때문.

---

# 15. 보안·운영·릴리스 게이트

## 15.1 코드 변경 시 보안 규칙

- **RLS 전 테이블 적용.** 사용자·커플·공유/개인 범위는 **서버와 RLS에서 다시 확인**
- service-role 쓰기는 대상 Supabase URL·project ref·**명시적 production confirmation**을
  검증한 뒤에만
- `NEXT_PUBLIC_*` 이외의 키는 브라우저 번들에 넣지 않는다
- OpenAI 키·service-role 키·사용자 원문·백업 payload·receipt 원문을
  **로그·문서·Git에 남기지 않는다**
- 복수 테이블 또는 비용 예약과 사용자 결과가 하나의 의미 단위면
  **DB 함수 + 트랜잭션으로 원자화**
- 비동기 재시도는 **안정적인 idempotency key, 획득 토큰, 최대 시도 수, 실패 종료
  상태**를 갖는다
- 오류 응답은 사용자가 복구할 수 있는 문구를 주되 **내부 SDK/DB 원문·비밀값 미노출**
- Rate limit: 가입, 채팅 피드백 등. 익명 버킷은 HMAC 의사식별자로

## 15.2 과거에 실제로 닫은 구멍 (참고)

| 구멍 | 조치 |
|---|---|
| `is_admin` 자기 승격 | 트리거 잠금 (부정 승격 피해 0 확인) |
| `profiles.couple_id`/`role`, `couples` 슬롯 자가변경 = **커플 탈취** | 잠금 |
| `join_couple`이 기존 소속 검사 없음 = **고아화** | 검사 추가 |
| `community_assign_cohort` 강제 배정 **IDOR** | REVOKE |
| 초대코드 엔트로피 | 2^48 |
| chat-image RLS가 커플 스코프 아님 | 마이그레이션 |
| **PII 뷰 8개** | DROP |
| 버려진 `public.messages`가 anon `arwdDxtm` + 정책 `USING/CHECK true` = **누구나 읽고 쓰고 지울 수 있었다** | 테이블은 남기고 접근만 차단(0행이라 유출 없음) |
| RLS 정책 함수 EXECUTE 권한 누락 → 전 요청 403 | `is_my_couple(uuid)` 신설 |
| 가입 enumeration | rate limit + 차단 |
| 데모 시드 | 제거 |
| booking RPC | service_role 전용으로 회수 |

**별도 판단으로 남긴 것(제품 결정)**: `under_review` 자동 숨김(역 grief),
comment-vote race, `select(*)` 과다 노출 일부.

## 15.3 운영 DB·Storage·배포 규칙

- **`supabase db push`를 직접 실행하지 않는다.**
- 현재 릴리스 manifest와 컨트롤러가 허용한 **`supabase:release:apply` 경로만** 사용한다.
- **Management API `database/query` 직접 write 금지.**
- 운영 변경 전에 확보할 것: 전역 web/API/Auth/public DB/Storage **write fence**,
  **DB 백업**, **Storage 원본 백업**, **복구 검증**, **rollback artifact**
- **Supabase DB 백업은 Storage 원본 bytes를 포함하지 않는다.** 둘은 별개이고
  **둘 다 복구 검증이 필요하다.**
- **Storage signed URL은 RLS 정책 변경과 별개로 만료 전까지 유효**하다. freeze 검증은
  정책 수뿐 아니라 **토큰 만료 대기와 객체 수 안정성**까지 포함한다.
- 운영 실패 시 **fence와 release lock을 유지**한다. 약한 과거 정책을 자동 복원하지
  않는다. **실패를 성공으로 재분류하지 않는다.**
- PR 병합·Vercel production deploy·카나리는 **모든 사전 게이트 통과 시에만.**

## 15.4 릴리스 게이트의 현재 상태 (알아두면 시간 아낌)

`pnpm supabase:release:apply`는 후속 릴리스를 **구조적으로 거부**한다.

```
deployment_blocked   증거 5종 전부 "missing"                    → 차단 (동작 불변)
evidence_pinned      증거 5종이 같은 릴리스 커밋에 고정
                     + 파일 실존 + sha256 일치 + backupContract  → 본체 배선 전까지 차단
그 외 / 섞인 상태                                                → 거부
```

원인은 **구조적 모순**이었다 — 정적 계약 검증기는 `status=deployment_blocked` +
증거 5종 전부 `missing`이어야 통과하는데, 컨트롤러는 허용 키 목록(8개)에 **없는**
`backupContract`를 요구했다. 두 조건을 동시에 만족할 매니페스트가 존재할 수 없었다.

계약 계층은 구현됐지만(`84d84c0d`) **컨트롤러 본체(2,890줄)의 대상 전환이 미완**이라
`SUCCESSOR_RELEASE_CONTROLLER_NOT_IMPLEMENTED`로 구분해 막고 테스트로 고정했다.
(증거가 갖춰져도 지금 열면 **엉뚱한 릴리스를 배포**한다 — 이 컨트롤러의 본체는
**선임** 매니페스트를 대상으로 하기 때문.)

> **백업 영수증을 아무리 잘 만들어도 열리지 않는다 — 영수증이 병목이 아니다.**

증거는 형태만 보지 않고 **파일을 읽어 해시까지 대조**한다.
해시만 적어 두고 파일이 없으면 증거가 아니라 **증거의 흉내**다.

### 백업은 정상이다 (혼동 금지)

물리 백업 7개 보관, 최근 COMPLETED, walg 활성.
매니페스트의 `backup: missing`은 **증거 아티팩트 부재**이지 **실제 백업 부재가 아니다.**
**이 둘을 혼동하지 말 것.** PITR만 비활성(최악 24h 유실) — 사용자 붙은 뒤 켜면 된다.

## 15.5 매니페스트 ↔ Vercel 인증값 (같은 함정을 두 번 밟았다)

마이그레이션을 release manifest에 등록하면 sha256이 바뀌고, Vercel의
`VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION`과 어긋나 **프로덕션 빌드가 fail-closed로
막힌다.** 사이트는 이전 배포가 계속 서비스되므로 **다운이 아니라 알아채기 어렵다.**

**규칙**:
① 새 sha256 계산 → ② **소유자가 Vercel에 재핀** → ③ push. 이 순서를 지킨다.
그리고 **환경변수만 바꾸면 실패한 빌드가 자동 재시도되지 않는다** —
**빈 커밋으로 새 빌드를 걸어야 한다.**

## 15.6 증거 기반 작업 프로토콜 (이 저장소의 보고 규칙)

| 태그 | 의미 |
|---|---|
| **E** | 이번 작업에서 파일·명령·테스트·화면으로 **직접 확인한 사실** |
| **S** | 공식 문서나 1차 자료에서 확인한 사실 |
| **I** | E/S에서 나온 추론 |
| **M** | 기억 기반. **최신 상태·숫자·비용·배포/테스트 성공 판정에는 사용 금지** |

- 숫자·가격·법·API 사양·버전·URL·운영 상태는 변할 수 있으므로 직접 확인한다
- 작업을 시작할 때 **목표·위험·완료 조건**을 나누고, 위험한 변경은
  **실패 시나리오와 rollback을 먼저 적는다**
- 확인하지 못한 항목은 **`UNVERIFIED`** 또는 **남은 게이트**로 남긴다
- **테스트·빌드·DB 적용·배포·백업·복구는 실제 증거가 있을 때만 완료로 보고한다**
- **모델의 문장만으로 저장 성공을 간주하지 않는다**

---

# 16. 지금 진행 중인 것

## 16.1 PR #75 — 「오늘 한 마디」 + WeddingCode 연구 프로토타입

- 브랜치 `feat/today-one-line`, main 대비 **14커밋 / 23파일 / +5,643 −124**
- 로컬 연구 프로토타입에 「오늘 한 마디」 경험 구현 +
  그 학습으로 만든 **운영 표면 `/today`**
- **운영 차단은 하나도 해제하지 않았다.**

### 검증된 것 (코드로 확인)

- `pnpm qa:local` 전 단계 통과(웹 typecheck·lint·test·production build,
  모바일 5종, shared·design-tokens) · 루트 `pnpm test` exit 0
- **격리 4종**: `candidate6.ts` 0줄 변경 / `apps/web/src/app/` 0줄 변경 /
  research 코드에 storage·network·analytics 0건 / 운영 라우트가 research를 import 안 함
- 응답에서 계산되는 값 **0개**

### 감사 이력

- **1차 독립 적대 감사**(에이전트 52, 발견 46 → 반증 통과 21).
  결론: **격리는 진짜인데 그것을 지키는 테스트가 비어 있었다.**
  변이 3종이 114/114 통과했다 = 가드가 공허했다.
- M1~M4 + 주요 shouldFix 9건 **전부 닫힘**. 변이로 각각 검출 확인.
- **2차 독립 적대 감사**(에이전트 96, 2라운드, 렌즈 10종 전부 1차와 다름).
  발견 71 → 3인 적대 검증 생존 17건.

  가장 무거운 것은 코드 버그가 아니라 **계약 위반**이었다 — 상위 계약이
  clipboard/native share/OG answer metadata를 **평문 금지**하는데 초대 화면이
  `navigator.clipboard.writeText`를 신설했다. 기능의 기획서가 README **권위 순서에
  없어서** "충돌하면 사용하지 않음"이 적용된다 — **기획서가 상위 계약을 이길 수 없다.**
  → clipboard 경로 제거 + 소스 스캔 계약 테스트로 재발 고정.

  그리고 **1차 감사의 수정이 2차 감사에서 새 결함을 만들었다** — 시트 제목의
  인라인 콜백 ref가 리렌더마다 재실행돼 시트 안에서 라벨을 누를 때마다 포커스를
  제목으로 되빼앗았다. **수정 자체도 검증 대상이다.**

### 아직 안 닫은 것

- **카피 2건** — 목차 시트 하단 문구와 다시 하기 문구
- **off-scale 타입 값**(13·15·17·28)과 `rounded-[24px]`·`rounded-[14px]` —
  **의도적 보류.** 정렬이 접힘선을 움직이는데 그 접힘선이 연구 가설2에 직접 걸려 있다.
  DESIGN.md Decisions Log에 등재됨
- **재미 자체** — 여전히 아무도 클릭해 보지 않았다. **이것만은 코드로 못 닫는다.**

### 다음 사람이 착각하기 쉬운 것

- **연구 프로토타입은 사용자에게 가지 않는다.** 운영에서 도달 경로가 없다.
- 미션 3축 중 **눈탱이 방지 기여는 0**이다(21장면에 금액·계약·위약금·부모 지원이
  없다 — 안전 속성이자 한계). 기여 축은 '동반자' 하나.
- S8 넘겨주기는 **의도적 미구현** — 동의하지 않은 제2인에게 화면을 투여하는 것이라
  R4(독립 동의 커플 3쌍) 통과 뒤로 미뤘다.
- 리뷰 플래그 4항목(CP3·DS3·DS4·ES1)에 카드·회수문장이 없는 것도 **의도**다.

## 16.2 미커밋 작업 — 첫 화면에 "대행사 간 공시가 차이" 숫자 세우기

```
 M apps/web/src/app/(community)/community/page.tsx
 M apps/web/src/components/community/CommunityLandingClient.tsx
 M apps/web/src/components/community/__tests__/landingFunnelInstrumentation.test.ts
?? apps/web/src/lib/price/agencySpread.ts        (+ agencySpread.test.ts)
?? apps/web/src/lib/price/landingAgencySpread.ts
```

**문제 의식**: 첫 화면이 우리만 가진 사실을 **설명만** 하고 있었다
("같은 업체인데 대행사마다 달라요"). 읽는 사람에게 그건 **주장**이고, 주장은 3초 안에
검증되지 않는다. → 주장 대신 **계산된 숫자**를 세운다.

**묶음 규칙을 실측으로 뒤집은 과정**:

- 처음엔 "같은 상품명끼리만 비교한다"로 짰다.
- 그런데 **스드메 공시의 `item_name`은 상품명이 아니라 샵 이름**이었다
  (studio 650/718, dress 485/525, makeup 274/285가 `vendor_name`과 글자까지 동일).
  상품명인 줄 알고 묶으면 아무 일도 안 하는 게 아니라 **틀리게 쪼갠다** —
  아이웨딩만 "가을스튜디오", 나머지는 "가을"로 적어서 최저가 109만 행이 비교에서
  통째로 빠졌다.
- 반대로 **예식장의 `item_name`은 진짜 상품**이다(1,081행 중 `vendor_name`과 같은 것
  0건. "비스타홀 식대"·"펠리시타홀 식대"처럼 한 예식장 안의 홀·항목별 행).
  여기서 묶지 않으면 **식대와 대관료를 맞대게 된다.**
- → 상품명 여부를 **`canonicalVendorName`으로 판정**한다. 사람이 검수한 표기 병합
  표를 그대로 재사용하므로 "가을 = 가을스튜디오"는 한 묶음이 되고 "비스타홀 식대"는
  상품으로 남는다. **목록·상세와 같은 함수를 쓰는 게 핵심이다.**

**하지 않는 주장**: 대행사끼리 **구성까지 같다고는 말하지 않는다.**
`base_spec` 문구가 글자까지 같은 경우는 16곳뿐이고 그중 값이 다른 건 1곳이라 그
기준으로는 화면에 세울 게 없다. 비교 대상은 "그 대행사로 계약할 때의 **최저 기본가**"
이고, 구성이 함께 다를 수 있다는 사실을 화면에서 **먼저 밝힌다.**
**어느 쪽이 낫다는 판정은 하지 않는다.**

**안정성**: `loadLandingAgencySpread()`는 **절대 던지지 않는다.** 첫 화면은 커뮤니티
피드가 본문이고 이 숫자는 그 위에 얹는 증거다. 공시 조회가 흔들린다고 랜딩이 500으로
죽으면 잃는 게 훨씬 크다 — 실패하면 빈 요약을 돌려주고 숫자 블록만 빠진다.
**조용히 사라지는 것이 유일한 위험**이므로 로그 접두어(`[landing-agency-spread]`)를
남겨 Vercel 함수 로그에서 바로 잡을 수 있게 한다.

**성능**: 피드와 공시 요약을 `Promise.all`로 병렬화(직렬이면 첫 화면 대기가 합쳐진다),
공시 요약은 1일 `unstable_cache`(`price-catalog` 태그), 옵션 원문은 0건으로 받는다.

---

# 17. 남은 일

## 17.1 사용자(파운더)만 할 수 있는 것 — 우선순위 순

1. **⭐ 유통 테스트 글 게시 — 최우선**
   - 완성본: `docs/DISTRIBUTION_POSTS_READY_2026-06-12.md`
     (카페 글 2종 복붙용 + 지식iN 8종 완성본, UTM 사전 기입,
     2026-07-26 위약금 공개 반영해 `c` 계열 UTM 신설)
   - 기록표: `docs/DISTRIBUTION_TEST_KIT_2026-06-12.md` §5
   - 추가 답변 은행: `docs/KIN_ANSWER_BANK_2026-06-12.md` (유형별 8종)
   - **이 저장소를 클론할 필요도 없다** — GitHub 웹에서 파일 열어 복붙.
     비밀값·설치 과정이 하나도 필요 없다.
   - 판정 기준: 30일차 G1 — **채널 전환 ≥ 3%**

2. **Vercel 사업자 정보 입력** — `NEXT_PUBLIC_BUSINESS_NAME` /
   `_REGISTRATION_NUMBER` / `_ADDRESS`.
   상호와 등록번호가 **둘 다** 채워질 때만 개인정보처리방침 하단에 나타난다.
   대표자(조규성)·이메일(ceo@hanbang.ai)은 이미 방침에 있다.

3. **아모라 일일 상한 유지/변경 결정** (현재 전역 300건 / $20)

4. **Cloudflare Turnstile 사이트키·시크릿 발급 + Vercel 입력**
   (코드 배선 완료, 키만 넣으면 활성)

5. **`Code Quality (breakage signal only)`을 GitHub 필수 상태 검사로 지정**
   (저장소 설정)

6. **공시 0건 지역 6곳의 HWP 8건 수동 변환** — 커버리지를 가장 크게 올린다.
   같은 stem의 PDF로 변환하면 파이프라인이 받는다.

7. **출시 후**: PITR 활성화, 업체 클레임 응대 창구

## 17.2 코드로 할 수 있는 것

- PR #75 남은 카피 2건 정리 후 머지 판단
- 미커밋 agencySpread 작업 마무리·커밋
- 업체 병합 **미결 37쌍** (업체 직접 확인 또는 다음 공시 라운드 필요)
- **앱 OSS 라이선스 고지 화면** (스토어 제출 전 필수)
- 릴리스 게이트 Slice 3(컨트롤러 본체 배선) + PITR + 호스티드 증거 5종
  — **상호 합의로 미뤄둔 항목**
- JSONB 후속: 일정/액션 테이블 분리(배열 키 동시수정 경합 완전 해소)
- `create/cancel_booking` 예산 동기화 2곳(`toolExecutor.ts` — fresh-read라 위험 작음)
- SEO 후속(선택): 지역별 시세 랜딩 양산, JSON-LD 구조화 데이터 확장
- 게이미피케이션 반쪽 상태 정리 (마이그레이션·타입만 있고 API 없음)
- 백로그: `docs/BACKLOG.md`, `docs/KNOWN_ISSUES_2026-06-10.md`(마이너 15건)

---

# 18. 역사 — 왜 지금 이 모양인가

## 18.1 2026-06-11 "Week 1 대수술"

**약 2.5만 줄 삭제. 라우트 213 → 127.** 커밋 3개.
실데이터 확인 후 진행(payments·settlements·contracts **0행**, 청첩장·방명록 각 2건
테스트 데이터). **DB 테이블은 보존**, 복구 지점은 **`pre-surgery` 태그**.

**삭제된 것**
페르소나 자동화 · AI 대본(`/scripts`) · 드레스 피팅 스텁(`/fitting`) ·
B2B 벤더 포털 전체(페이지 + API 9종 + `vendorStore`) · B2B 랜딩 4종 ·
청첩장 전체(`/invitations`, `/i/[slug]`, API 6종) · 방명록 ·
결제(토스페이먼츠) · 정산 · 전자계약/서명

**남긴 것**
예약(bookings)은 **방문·상담 예약**으로 단순화(취소는 아모라 채팅의 `cancel_booking`).
축의금은 `moneyStore`/`money.types`로 분리해 유지.

> **그래서 `FEATURES.md`·`PROJECT_STATUS.md`를 읽고 "이 기능 어디 있지?" 하면 안 된다.**
> 대조 감사 결과(`docs/DOC_VS_CODE_AUDIT_2026-07-03.md`, 주장 119건 전수 검증):
> EXISTS 47(39%) / PARTIAL 43(36%) / **GONE_INTENTIONAL 25(21%)** / GHOST 2 / UNCLEAR 2.

## 18.2 같은 시기 함께 한 것 (2026-06-11~12)

- **보안 핫픽스**: signup rate limit + enumeration 차단, chat-image RLS 커플 스코프,
  proactive 배선(모멘트 루프 활성화)
- **감사 critical 4건 종결**: JSONB 원자 병합 RPC, PII 뷰 8개 DROP,
  booking RPC 회수, 데모 시드 제거 — 전부 원격 검증 완료
- **관측 도입**: Sentry + PostHog(퍼널 이벤트 `signup_started` /
  `chat_message_sent` / `quote_check_submitted`, UTM은 `$pageview` 자동)
- **SEO 공백 해소**: 예절·시세 페이지가 클라이언트 렌더라 서버 HTML 본문이 0이던
  문제 → 서버 `page.tsx`가 SEO 콘텐츠 + 클라이언트 UI를 함께 렌더하는 구조로 전환
- **견적 진단 정밀화**: 2분법 → **지역별 중위가 비교**(서울 350 vs 경기/인천 230).
  경기 정상 견적을 미끼가격으로 오판하던 버그 제거. 죽은 중복 엔진 218줄 삭제
- **법적 리스크 전수 감사**: 업체명 노출·표시광고·개인정보 확인.
  Contract Shield의 등급/점수/보증성 라벨 제거
- **테스트 인프라 복구**: 떠돌던 미커밋 테스트 5종(145개) 수리·커밋 + vitest/jsdom 설치

## 18.3 AI 런타임 전환

**Claude(Anthropic) → OpenAI Responses API(GPT-5.6 Luna·Terra) 전용.**
과거 문서의 Claude / 심리학 / 자동학습 / "3명+ 전역 학습" 설명은 **현재 사양이 아니다.**

## 18.4 디자인 전환

Atelier Hub(Dusty Rose `#795252` + Noto Serif KR + Cormorant Garamond)
→ **Quiet editorial utility**(Eucalyptus Ink + Dusty Mauve + Pearl Ivory + Sage,
웹·모바일 공통 **Paperlogy**). 2026-06-30 ~ 07-02.

## 18.5 전략 계보 (핵심 결론만)

- **`MASTER_BLUEPRINT_2026-06-10.md`** — 최상위 청사진.
  포지셔닝 "웨딩의 '웨'자를 몰라도, 추가금에 안 당하고, 결혼식까지 — AI 친언니 아모라".
  **3층 구조**: 유입=커뮤니티 시세 / 관계=친언니 OS / 거래=보증료(S1 통과 후)
- **`EONNI_OS_MASTERPLAN`** — 핵심 통찰: **"친언니는 콘텐츠가 아니라 타이밍,
  타이밍은 코드로 8할 완성"**. 모멘트 루프가 30일 골격
- **`COMMUNITY_ENGINE_MASTERPLAN`** — 커뮤니티 = give-to-get 시세 엔진
- **`WINWINWIN_MODEL_VERDICT`** — 수수료 모델 검증. "5%+ 수수료" **전례 0건**
  (The Knot도 광고 후퇴). 진짜 마진은 **추가금 평균 174만 = 기본금의 50%**
- **`CONSERVATIVE_VIABILITY_2026-06-10.md`** — **보수적 시장성 판정**:
  - 벤처 게임 **No** / 1인 강소사업 **조건부 Yes**
  - 중개·수수료 플랫폼 흑자 전례 **0건**
    (웨딩북 투자 158억 → 매출 43억·영업손실 -19억(2023), 아이웨딩 20년차 적자)
  - **돈 번 곳은 직접판매 둘뿐** — 다이렉트컴즈(카페→대행, 매출 624억/영업이익 142억,
    **무투자**), 듀오(회비, 454억/110억)
  - 시장: 1분기 +6.1% 9분기 연속 증가. **2026~28이 마지막 순풍**,
    2031+ 인구절벽 확정(-31% by 2035)
  - 1인 현실 시나리오: 하한 0~50만(확률 최고) / 중간 100~300만(트래픽→업체 커미션,
    18~36개월) / 상한 500~1,000만(1인 CS 한계와 겹침)
  - **2028년 말 수익화 데드라인**
- **`MOMENT_CATALOG_2026-06-10.md`** — 여정 전체 **36개 모멘트** 전수 목록 +
  v1 우선 12개의 D-3/D-1/D+1 실제 문안(청첩장 모임 포함 — 파운더 지명)
- **경쟁**: 웨딩북(158억 투자, AI 출시)이 최대 위협.
  **"업체 돈 안 받는 중립 진단" 포지션은 빈자리**
- **규제 타이밍**: 가격표시 의무화 계도기간 2026-05-12 종료 → 마케팅·포지셔닝 윈도우.
  결혼서비스법은 아직 미제정. 가격공개 의무화 준수율 0%(2026-01) →
  "법정 가격공개 대행 무료 도구"가 업체 입점 명분이 될 수 있음

---

# 19. 반복해서 밟은 함정

## 19.1 "통과했지만 아무것도 증명하지 않는 검사" — 최소 12건 적발

| 정체 | 실제 사례 |
|---|---|
| **항상 참인 조건** | `Number(counts.users) === 0 \|\| true` → "21/22 통과"로 보고했다 |
| **살아 있는 페이지를 기대값에 못 박음** | `/wedding/saved` 재발방지 테스트의 orphan 기대값 → 가입 퍼널이 사라져도 통과 |
| **만들고 등록을 안 함** | 계약 테스트 14건을 만들고 **어느 스크립트에도 등록하지 않아** 한 번도 안 돌았다 |
| **셋이 사이좋게 틀림** | `disclosure-count-consistency`가 세 표면이 **같은 숫자**인지만 봐서, 셋이 함께 틀린 값(502)을 고정했다 |
| **주석을 코드로 오판** | 새 CI 가드가 주석을 코드로 읽고 통과. `if…fi` 밖의 `exit 1`도 못 잡았다 |
| **자기참조 스냅샷** | `data-recap-body`를 자기 자신과 비교 → 콘텐츠 **전면 소실**을 못 잡는다 |
| **워크스루가 항상 첫 라디오만 누름** | escape/neutral 경로에 **한 번도 도달 안 함** |
| **`hidden`을 붙여도 `querySelector`가 "있다"고 판정** | 라벨 존재 검사 |
| **속성 문자열만 봄** | 실제 화면에서는 60px 띠였는데 통과 |
| **인접 검사의 off-by-one** | `index < total - 1`이라 마지막 **직전**을 통과시킴 |
| **공허한 통과** | 대상이 없어서 빈 배열·빈 문자열을 비교 |
| **이름과 본문 불일치** | 테스트 이름은 "장면 제목도 없다"인데 본문은 제목을 미검사 |

> ### 처방
> **새 가드는 반드시 변이 테스트로 확인한다.** 수정을 되돌리거나 조건을 깨뜨렸을 때
> **그 테스트만** 실패하는지 본다. **그 단정을 거짓으로 만드는 코드 변경을 상상할 수
> 없으면 그 단정은 공허하다.**
>
> 그리고 **자기 코드는 자기가 검증하면 같은 맹점이 남는다** — 독립 감사가 필요하다.
> (실제로 세션 중 작성자 본인이 4개, 독립 감사가 3개를 더 찾았다.)

## 19.2 배포·검증 함정

- **배포 확인에 `/wedding`의 `Age` 헤더를 쓰지 말 것.** `force-dynamic`이라 늘 0이라
  **배포 안 됐는데 됐다고 오판**한다. → **정적 경로(`/price/studio`)의 ETag 변화**로 본다.
- **테스트가 실사용자 경로를 밟는지 확인할 것.** "RLS 9/9 통과"는 사실이었지만
  `message_id=null`로만 돌려 **기능이 죽은 걸 못 봤다**
  (`amora_saved_notes.message_id`가 `public.messages`를 참조하는데 채팅 메시지는
  `public.chat_messages`에 있어 외래키 위반으로 저장이 전부 실패하고 있었다).
- **검사 도구를 먼저 의심할 것.** `innerText`가 빈 값을 주거나 JSX 보간으로 문자열이
  쪼개져 **정상 동작을 "실패"로 두 번 오판**했다.
- **글의 약속과 도착 화면을 나란히 볼 것.** 유통 글 `c` 계열이 "위약금 원문 831건을
  모아뒀다"고 약속하고 `/price`로 보내는데, **그 페이지에 '위약금'이라는 단어가 한 번도
  안 나왔다**(라이브 실측 0회). 약속하고 데려와 다른 걸 보여준 셈.
  **이런 결함은 코드 리뷰로 안 잡힌다.**
- **확인 전에 위험을 말하지 말 것.** 백업·비용 캡을 두 번 과경보했다.
  **CTO가 확인 없이 겁을 주면 신뢰를 잃는다.**
- **사용자 0명일 때 릴리스 인프라를 다듬는 건 우선순위가 아니다.**

## 19.3 로컬 개발 함정 (연구 프로토타입 실행 시)

1. **빈 화면은 버그가 아니다.** 브라우저 탭이 화면에 표시되지 않으면 본문이 통째로
   안 보이고 아무것도 안 눌린다. Next 스트리밍이 본문을 `<div hidden id="S:0">`에 담고
   `$RC("B:0","S:0")`가 옮기는데, `$RC`는 공개를 **`requestAnimationFrame`으로 예약**한다.
   `document.hidden === true`면 프레임이 안 생겨 **영원히 대기**한다.
   콘솔 에러 0, 청크 전부 200, 서버 로그 정상이라 하이드레이션 실패로 보인다.
   → **탭을 실제로 표시하면 즉시 해소.**
   판별: `document.hidden`과 `$RB.length`(2면 대기 중).
2. **강제 종료하면 빌드가 두 번 막힌다.** Ctrl+C로 정상 종료할 것.
   강제 종료 시 생성 라우트 `apps/web/src/app/internal/wedding-code-research/`와
   lock `apps/web/.wedding-code-research.lock`이 **각각** 남고, 하나만 지우면 다른
   하나에서 또 막힌다. lock은 **자동 삭제가 꺼져 있어** PID 생존 확인 후 수동 제거.
3. **라우트를 지운 직후 typecheck가 깨진다** — `.next/dev/types/validator.ts`가
   삭제된 페이지를 계속 참조한다. → `apps/web/.next`·`.turbo` 삭제 후 재실행.
   (**PC 간 동기화 후 typecheck 실패도 같은 원인**이다 — 코드가 아니라 낡은 `.next`
   생성 타입.)

## 19.4 저장소 밖에 있는 것 (다른 컴퓨터에 없다)

`work/`는 gitignore다.

- `work/logo-hunt/results-*.json` (1.5MB) — 로고·URL 리서치 원본.
  게시되지 않은 후보와 근거·확신도가 남아 있어 **업체 병합 2차 판정 10쌍이 전부
  여기서 나왔다.** 판정에 쓴 부분만
  `docs/operations/evidence/vendor-merge-evidence-2026-07-28.json`(24KB)에 커밋.
- `work/extracted/*.json` (19MB, 242유닛) — 공시 원본 추출물. 업체 이름 색인에 썼다.
  `data/raw` + ingest 파이프라인으로 재생성 가능.
- `work/.env.staging` — 스테이징 자격증명.

운영 감사는 `apps/web/.env.local`(또는 형제 체크아웃)의 `SUPABASE_ACCESS_TOKEN`이
필요하다. 감사 스크립트는 **키가 든 파일을 고른다** — 존재만 보고 첫 파일을 잡지 않는다.

---

# 20. 사업·운영 컨텍스트와 일하는 방식

## 20.1 기본 정보

| 항목 | 값 |
|---|---|
| 대표 | 조규성 · ceo@hanbang.ai |
| 관리자 계정 | kcho11289@gmail.com |
| 팀 | **솔로**. 코드는 직접 짜지 않고 Claude Code로 개발 |
| 예산 | 월 $500 목표 (Supabase Pro $25 + OpenAI + Vercel) |
| 인증 제공자 | 카카오(앱 ID 1381347, **비즈앱 아님 → 이메일 권한 없음**) / 구글 / Apple(Team 6RSK726532) / 이메일 |
| 관측 | Sentry / PostHog(프로젝트 hanbang, ID 465762, US Cloud, Free, **Session Replay 비활성** — 채팅 민감정보) |
| 수익 모델 | **미정·미구현.** 거래 레일은 S1 게이트 통과 후에만 |
| 기기 | iPhone만 보유 (Android는 빌릴 수 있음) |

## 20.2 파운더가 원하는 작업 방식 (반드시 지킬 것)

- **결함 목록만 주고 묻지 말 것.** 심각도 순으로 **직접 고치고 브랜치에 커밋**한다.
  **푸시만 별도 승인.**
- **파이널만 보고.** 중간 상태·결정 목록 금지. **검증까지 끝난 것만** 올린다.
  **모르는 것만 묻는다.**
- **보고는 짧게.** 상태 1줄 + 고친 것 3~5줄 + 할 일 3개.
  근거는 커밋·PR에 남기고 채팅에서는 뺀다.
- **기존 흐름을 깨지 말 것.** 잘 작동하는 부분은 건드리지 않는다. **격리된 변경만.**
- 설명이 길면 짜증낸다. **한국어로, 간결하게.**
- 카카오·Vercel 등 콘솔 UI 안내 시 **메뉴 이름을 추측하지 말고 스크린샷을 요청**한다.
- 복잡한 선택지 대신 **"이것만 하세요"** 식으로 안내한다.
- 안전장치에 걸릴 작업은 **모델 전환·우회 없이 스킵**하고 다음으로 넘어간다.

---

# 21. 부록 — 문서 인덱스 (참고용)

> **이 절은 안 읽어도 된다.** 위 §1~§20에 내용이 이미 녹아 있다.
> 원본 증거·전문이 필요할 때만 찾아본다.

## 현재 기준 문서

| 문서 | 용도 |
|---|---|
| `AGENTS.md` | 작업 규칙 정본 |
| `PRINCIPLES.md` | 6원칙 정본 |
| `DESIGN.md` | 디자인 시스템 정본 |
| `README.md` | 저장소 개요 |
| `docs/AMORA_ENGINE_V2_2026-07-16.md` | 아모라 제품·기술 기준 |
| `docs/operations/AMORA_ENGINE_V2_PRODUCTION_RELEASE_2026-07-16.md` | 현행 운영 릴리스 |
| `docs/operations/SESSION_HANDOFF_2026-07-28.md` | 최신 인계 |
| `docs/operations/WORK_LOG_2026-07-27_28.md` | 상세 작업 기록 |
| `docs/operations/LAUNCH_PREP_SESSION_2026-07-26.md` | 출시 준비·결함·오판 기록 |
| `docs/operations/WEDDINGCODE_SESSION_HANDOFF_2026-07-28.md` | PR #75 인계 |
| `docs/operations/CURRENT_WORKSPACE_HANDOFF_2026-07-20.md` | 공시 파이프라인 인계 |
| `docs/operations/VENDOR_MERGE_REVIEW_2026-07-27.md` | 업체 병합 79쌍 전건 판정 |
| `docs/operations/DISCLOSURE_SOURCE_PROVENANCE.md` | 공시 원본 출처·기준 시점 |
| `docs/operations/VENDOR_DISCLOSURE_*` (수용 매트릭스·RLS probe·빌드 fence·전수 감사) | 공시 게이트 |
| `docs/wedding-code/README.md` | WeddingCode 권위 순서·상태표 |
| `docs/wedding-code/62_..._master_design_and_current_state_2026-07-18.md` | WeddingCode 통합 진입점 |
| `docs/wedding-code/63_today_one_line_design_plan_2026-07-28.md` | 「오늘 한 마디」 기획서·실측 |
| `docs/wedding-code/64_adversarial_audit_2026-07-28.md` | 그 구현의 적대 감사 |
| `scripts/ingest/README.md` | 공시 실행 기준 |
| `docs/MOBILE_APP_MASTERPLAN_2026-06-30.md`, `docs/MOBILE_SETUP.md` | 모바일 |
| `supabase/platform-operations/storage/README.md` | Storage 운영 |

## 유통·마케팅 실행 자산

`docs/DISTRIBUTION_POSTS_READY_2026-06-12.md`(복붙용 완성본) ·
`docs/DISTRIBUTION_TEST_KIT_2026-06-12.md`(UTM·운영 수칙·기록표) ·
`docs/KIN_ANSWER_BANK_2026-06-12.md`(지식iN 답변 8종)

## 전략 문서

`docs/MASTER_BLUEPRINT_2026-06-10.md` · `STRATEGY_REVIEW_2026-06-10.md` ·
`EONNI_OS_MASTERPLAN_2026-06-10.md` · `COMMUNITY_ENGINE_MASTERPLAN_2026-06-10.md` ·
`WINWINWIN_MODEL_VERDICT_2026-06-10.md` · `CONSERVATIVE_VIABILITY_2026-06-10.md` ·
`MOMENT_CATALOG_2026-06-10.md` · `QUOTE_LEDGER_MASTERPLAN_2026-06-10.md` ·
`HANBANG_POSITIONING_2026.md` · `TRUST_MOAT_ROADMAP.md` ·
`CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md`

## 역사 문서 (현재형으로 읽으면 안 됨)

`FEATURES.md` · `PROJECT_STATUS.md` · `FEATURE_AUDIT.md` · `WEDDINGHANBANG_FULL.md` ·
`WEDDINGHANBANG_SERVICE_DOC.md` · `UPDATE_LOG.md` · `AUDIT_2026-04-28.md` ·
`CLAUDE.md`의 2026-06-11 snapshot 섹션 · `docs/AMORA_LIFECYCLE_PARTNER_DESIGN.md` ·
`docs/AMORA_WEDDING_OS_PLAYBOOK.md` · `docs/operations/AMORA_PRODUCTION_RELEASE.md` ·
`docs/DOC_VS_CODE_AUDIT_2026-07-03.md`(대조 결과 자체는 유용)

---

# 22. 한 문단 요약

웨딩한방은 **한국 웨딩 시장의 정보 비대칭을 소비자 편에서 깨려는 서비스**다.
지금 유일하게 가진 진짜 자산은 **공시 원본에서 뽑아 사람이 검수한 업체 842곳의
기본가·추가금과 위약금 원문 831건(412개 업체)**이고, 제품의 모든 규칙은
**"요약도 판정도 하지 않고 사실과 절차만 준다"**는 한 줄에서 파생된다.
AI 아모라는 마스코트가 아니라 **승인받은 일만 실행하고 DB 결과를 확인한 뒤에만
완료라고 말하는 운영자**이며, 기억·케어·중재는 전부 **명시적 동의 기반 fail-closed**로
설계돼 있다. 코드베이스는 검증을 극단적으로 의심하는 문화(변이 테스트 · 독립 적대 감사 ·
fail-closed 릴리스 게이트 · 증거 태그 E/S/I/M)로 쓰여 있고, 문서는 **날짜 붙은 역사
증거**와 **현재 기준**이 엄격히 구분된다. 서비스는 라이브지만 **실사용자는 사실상 0명**
이고, **지금 병목은 코드가 아니라 유통 글을 게시해 사람을 데려오는 일**이다.
