# 보안 감사 2.2 — 돈 계열 API 인증 감사 (2026-07-03)

> 대상: `api/money`, `api/bookings`, `api/amora/quote-check` 계열.
> 방법: 4개 공격 각도(IDOR·service-role 오남용·비용/남용·데이터오염/유령/노출) 병렬 감사 →
> 발견별 반박 검증(어드버세리얼) → **확정 건은 감사자 직접 재검증**(2.1 교훈 반영).
> 등급: ✅견고 / ⚠️취약(동작하나 보안·품질·엣지 문제) / ❌깨짐 / 🚫유령.

## 종합 등급: ⚠️ 취약 (돈 코어는 견고 · 취약점은 견적 진단 부수 표면)

- **돈 코어(축의금 CRUD, 예약 생성/결과)는 IDOR·service-role 오남용에서 깨끗함.** IDOR 각도 감사는 발견 0건, 안전 확인 다수.
- 확정된 결함 2건은 모두 **`amora/quote-check` 견적 진단 라우트**에 있고, 커플/금전 데이터가 아니라 내부 운영 테이블·공용 rate limit 유틸에 국한.
- 크리티컬/하이 확정 0건. 확정 2건은 medium, 불확실 2건은 low.

---

## 라우트별 판정

| 라우트 | 등급 | 근거 |
|---|---|---|
| `money` GET/POST | ✅ 견고 | 인증 필수. GET은 query `coupleId`를 신뢰하지 않고 본인 `profiles.couple_id`와 대조(불일치 403). POST insert의 `couple_id`는 body가 아니라 서버 파생. amount 0~1억 정수 검증, 필드별 sanitize, rate limit. anon 클라 → `money_owner` RLS 백스톱. |
| `money/[id]` PATCH/DELETE | ✅ 견고 | `assertMoneyOwner`가 row.couple_id ↔ 본인 couple_id 대조. `PATCHABLE_FIELDS` 화이트리스트로 `couple_id` 등 변조 차단. amount 재검증. |
| `bookings` POST | ✅ 견고 | `couple_id` 서버 파생. `create_booking_atomic` RPC는 `authenticated`로부터 EXECUTE 회수(20260611150000) → service_role 전용. timeslot FOR UPDATE 락으로 TOCTOU 방어. product/staff의 vendor 소속 RPC 내 검증. |
| `bookings/[id]/outcome` PATCH | ✅ 견고 | admin 클라지만 `booking.couple_id !== profile.couple_id` 거부 + update에 `.eq("couple_id")` 이중 스코프. 교차 커플 거부 테스트 존재(route.test.ts). |
| `bookings/mine` GET | 🚫 유령(경미) | anon 클라 커플 스코프. **`contracts`·`payments` 조인은 죽은 코드** — 결제층 삭제(Week1 수술)로 두 테이블 0행, 코드 전체에서 이 라우트만 읽고 쓰는 곳 없음. 500 위험 없음(select 실패는 빈 배열). 정리 후보. |
| `amora/quote-check` POST | ⚠️ 취약 | 확정 결함 2건(아래 M1·M2). analysis 저장·공개는 설계상 안전(couple_id 서버 파생, PII 제외 요약만 공개). |
| `amora/quote-check/[id]/public` GET | ✅ 견고(설계 의도) | 익명 GET이나 PII·협상스크립트·점수/판정 제외한 사실 요약만 반환. UUID v4라 열거 불가. **카톡 공유용 capability-URL은 의도된 제품 설계**(canon v2 referral 루프) — 결함 아님. |

---

## 확정 결함 (medium × 2)

### M1. vendor_leads 데이터 오염 — 인증 사용자가 내부 리드 우선순위 조작
- **파일**: `apps/web/src/app/api/amora/quote-check/route.ts:154-221`
- **공격**: 로그인만 한 아무 사용자가 POST에 임의 `vendorName`(실존·소유 무관 자유 텍스트, 80자 sanitize만)을 넣어 반복 호출. 매 호출마다 `admin`(service_role) 클라가 `vendor_leads`를 `name+category`로 조회 → 있으면 `priority_score +4`, `mention_count/proof_count +1`, `source='user_mention'` 덮어씀 / 없으면 raw 리드 신규 생성. 시간당 40회 → 특정 업체 priority_score 시간당 +160, 또는 매번 이름 바꿔 raw 리드 40개/시간 양산.
- **왜 뚫림**: `vendor_leads` RLS(`20260511020000`)는 admin/service_role만 허용하지만 라우트가 **service_role 키로 의도적 RLS 우회** → 앱 계층이 유일 방어선인데 그 계층에 실존·소유·증빙·멱등 검증이 전무. `if (user)`만 통과하면 됨(is_admin 게이트 없음). `proof_count`(증빙 수)가 이름 언급만으로 증가 → 필드 의미 오염.
- **블ast 반경**: 내부 운영/공급 테이블에 국한. RLS로 공개 노출 없음 → PII·커플·금전 데이터 파급 없음. 현재 업체 기능은 공급 확보 전까지 숨김(전략)이라 실사용 영향은 잠재적. 운영 검토로 복구 가능.
- **수정 방향**: ①사용자 언급으로는 priority_score를 올리지 않음(0 가중), 임의 신규 이름은 status='raw'로만 기록. ②동일 user_id의 같은 (name,category)는 카운터 1회 멱등. ③`proof_count`는 실제 증빙 있을 때만. ④또는 저신뢰 스테이징 테이블에 원시 신호만 쌓고 관리자 집계 후 vendor_leads 반영.

### M2. rate limit IP 키가 X-Forwarded-For 최좌측 신뢰 → 익명 rate limit 우회 + 버킷 테이블 블로트
- **파일**: `apps/web/src/utils/rateLimit.ts:117-118` (공용 유틸 — 블래스트 반경이 quote-check를 넘음)
- **공격**: `req.headers.get("x-forwarded-for")?.split(",")[0]` = 최좌측 토큰을 IP로 사용. Vercel은 진짜 IP를 XFF **우측**에 append하므로 최좌측은 클라이언트가 임의 조작 가능. 익명 호출(userId 없음)이 이 IP 키를 쓰는데(`rateLimitKey` line 116 `if(userId)` 우회), 매 요청 XFF 첫 토큰을 바꾸면 새 버킷 → quote-check 익명 12/hr 제한 무력화.
- **부가 피해**: 익명 quote-check는 `checkRateLimitPersistent` → 매 키가 `check_rate_limit` RPC로 `rate_limit_buckets`에 영구 행 INSERT. **만료 행 GC 없음**(`20260615103000`에 DELETE/pg_cron 부재) → 무한 스푸핑 키 = 테이블 무한 증식 + service_role RPC 트래픽.
- **완화/한계**: 익명 quote-check 경로는 `if (user)` 게이트로 DB insert(amora_quote_checks/vendor_leads) 안 함, `analyzeAmoraQuoteCheck`는 순수 로컬 함수 → **LLM 비용 0**. 인증우회·데이터유출·손상 없음. 순수 자원/비용 남용 + DB 블로트라 medium(주장 high에서 하향). **단, 같은 XFF 약점이 signup·forgot-password 등 모든 익명 rate limit에 공유됨**(그쪽은 Turnstile 2차 게이트 존재).
- **수정 방향**: 신뢰 헤더 사용 — Vercel `x-real-ip` 또는 `@vercel/functions` `ipAddress(request)`. XFF를 써야 하면 알려진 프록시 홉 수만큼 우측에서 취함(rightmost-trusted). 부수적으로 `check_rate_limit` RPC에 만료 행 GC 추가.

## 불확실 (low, 참고)
- **U1. money/bookings가 인메모리 `checkRateLimit` 사용 → 서버리스 다중 인스턴스에서 한도 배수 우회**. 메커니즘은 실재하나 전부 인증+본인 커플 스코프라 크로스테넌트 영향 없음, 외부 비용 0(순수 DB write), 피해는 자기 커플 행 팽창(self-DoS). low/info — 하드닝 갭.
- **U2. vendor_leads 오염의 다계정 증폭**. 계정당 40/hr 선형 증폭 가능하나 signup의 Turnstile+이메일 인증 게이트가 계정 생성 비용을 부과해 상당 부분 둔화. M1의 증폭 계수 관측.

## 반박된 발견 (기록)
- 공개 진단 공유 라우트 "강제 공개" → **REFUTED**: capability-URL은 카톡 공유용 의도된 설계(`quote/[id]/page.tsx` 주석·ShareButtons).
- quote-check가 couple_id를 무검증 신뢰 → **REFUTED**: user.id는 `auth.getUser()` JWT 재검증, couple_id는 본인 profiles 파생, body에서 안 옴.
- quote-check 본문 크기 상한 부재 → **REFUTED**: `isBodyTooLarge`는 Content-Length만 보는 약한 가드이고 대상이 로컬 연산이라 실 DoS 아님.
- rate_limit_buckets GC 부재(독립) → **REFUTED**: M2의 파생. M2에 병합.

---

## 감사 방법론 메모
- 워크플로 14 에이전트(Opus), 발견 10건 → 확정 3(중복 병합 시 실 2)·불확실 2·반박 5. 토큰 ~98만.
- **확정 2건 모두 감사자 직접 재검증 완료**(rateLimit.ts·quote-check/route.ts 원본 대조). 2.1의 "반박이 표현오류를 거른 것이지 결함 부재가 아님" 교훈대로, 반박된 5건도 근거를 확인해 오탐 아님을 검증.
- 확정 2건은 이 감사에서 **기록만**(2.1과 동일 정책). 수정은 별도 리메디에이션 패스 / Phase 6 "Top 5"에서.
