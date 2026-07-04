# 보안 감사 2.4 — 나머지 API 감사 (2026-07-03)

> 대상: community·vendors·preregister·events·favorites·messages·journey·couple·survey·demo.
> 방법: **인라인(Fable, subagent 없음)** — 전 라우트를 인증 게이트 유무로 트리아지 → 공개 쓰기 표면과 대표 인증 라우트를 직접 Read, 커뮤니티 쓰기 소유권 스팟체크.

## 종합 등급: ✅ 견고 (교차 이슈 1건은 기존 M2로 기록됨)

2.x 보안 단계에서 **첫 ✅ 견고**. 돈(2.2)·AI(2.3) 표면과 달리 "나머지"는 확립된 안전 패턴을 일관되게 따라 신규 확정 결함 0건. 유일한 교차 약점은 이미 2.2/2.3에서 기록한 XFF-최좌측 IP rate limit(M2)뿐이고, 해당 공개 엔드포인트는 Turnstile·이메일 dedup이 실질 게이트라 영향 제한적.

---

## 트리아지 결과 (전 라우트)

### 공개 쓰기 표면 (무인증) — ✅ 견고
| 라우트 | 게이트 |
|---|---|
| `preregister` POST | body 16KB cap → IP rate limit 10/hr → **Turnstile 봇체크** → 입력검증 → 이메일 dedup(409) + 이메일 rate limit 3/24hr(스푸핑 불가). service client insert. |
| `survey` POST | body 96KB cap → IP 5/hr → **Turnstile** → `sanitizeJsonObject`(depth/len/key caps) → service client insert. |
| `demo/start` POST | IP 20/hr → **서명된 demo 쿠키만 발급**(setDemoCookies). DB 쓰기·데이터 접근 0. demo 세션은 각 라우트에서 빈 데이터/demo 모드만 반환(favorites·bookings/mine에서 확인) — 실 커플 데이터 미노출. |

### 인증 커플-데이터 라우트 — ✅ 견고 (couple_id 서버 파생)
`journey` PATCH, `couple/code` GET·POST, `couple/link` POST, `couple/reset` POST, `events` POST, `favorites` POST·GET — 전부 `couple_id`를 body가 아니라 `profiles`에서 `.eq("id", user.id)`로 파생하고 모든 쿼리를 그 값으로 스코프. admin/service 클라를 써도 스코프가 서버 파생값이라 IDOR 불가. couple/link의 join은 round-2에서 기존소속 검사+초대코드 2^48로 하드닝됨(20260612130000).

### messages — ✅ 견고
GET: anon 클라(RLS), customerId 지정 시 vendor owner만 허용(403), 아니면 `customer_id=user.id` 스코프. POST: `senderType`·`customerId`를 **서버에서 vendor 소유권으로 결정**(클라 값 무시, route.ts:124), 비소유자는 `customer_id=user.id`로 강제. 자기 스레드에만 쓰기 가능.

### vendors/* — ✅ 견고
`vendors` GET(공개 카탈로그), `vendors/[id]` GET(공개 상세), `vendors/[id]/staff` GET(읽기), `vendors/[id]/photos` POST(**user.id 스코프 사진 좋아요 토글**, 업로드 아님). 공개 읽기 + 사용자 스코프 like만. vendor-owner 쓰기 표면 없음.

### community/* — ✅ 견고 (round-2 하드닝 + 스팟체크)
`comments/[id]` PATCH·DELETE, `posts/[id]` PATCH·DELETE: `author_id !== user.id && !isAdmin` → 403(comments:62·150, posts:228·410). 최근 커밋("support community comment edits", "isolate community comments by post")이 소유권 유지 확인. 동기방(cohort)·투표 멱등성·미디어 스토리지·member reports는 round-2(2026-06-12~15) 하드닝 완료(20260612130000·20260614·20260615). `ai-price-comment`는 Anthropic 미호출(LLM 비용 표면 아님).

---

## 교차 이슈 (신규 아님)
- **XFF-최좌측 IP rate limit(M2, 2.2/2.3 기록)**: `preregister`·`survey`·`demo/start`의 IP rate limit이 `x-forwarded-for.split(",")[0]`(조작가능)을 씀. 단 공개 쓰기 표면은 Turnstile(봇)·이메일 dedup이 실질 게이트라 rate limit 우회의 영향이 제한적. 근본 수정은 M2와 동일(신뢰 헤더 사용) — 한 번 고치면 전 표면 커버.

## 방법론 메모
- 인라인 Fable 감사(subagent 없음, 사용자 요청). 전 라우트 grep 트리아지 + 공개 쓰기·대표 인증 라우트 직접 Read + 커뮤니티 쓰기 소유권 스팟체크.
- 미deep-read: 일부 community 하위(cohort digest/timeline/polls vote/upload/search)는 round-2 하드닝 + 동일 안전 패턴이라 트리아지로 갈음. 신규 결함 신호 없음.
