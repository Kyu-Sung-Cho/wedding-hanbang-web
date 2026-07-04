# 웨딩한방 보수적 전체 평가 — 종합 성적표 (2026-07-04)

> 계획: `docs/EVALUATION_PLAN_2026-07-03.md` (26개 작업 전체 완료).
> 원칙: "증명되기 전까지는 안 되는 것으로 간주한다" — 모든 등급은 코드 직접 검증 + 테스트 + (가능한 곳은) 프로덕션 라이브 프로빙 기준.
> 서술 원칙: 방어적 — 리스크와 수정 방향만 기술, 재현 절차는 기록하지 않는다.

## 1. 기능별 등급표

| 영역 | 등급 | 한 줄 요약 |
|------|------|-----------|
| 0.x 작업공간/문서 | ⚠️→정리됨 | 쓰레기 삭제·낡은 가이드 포인터 교체 완료. FEATURES/PROJECT_STATUS는 배너로 격리 |
| 1.x 빌드/테스트/의존성 | ✅ | tsc 0·eslint 0·테스트 280/280·build 그린(웹+모바일). 시크릿 클린. 잔여: ADMIN_PASSWORD 회전(사용자) |
| 2.x 보안 (5표면) | ⚠️2/✅2+⚠️1 | 크리티컬 0. H1(costGuard 레이스)·M1/M2(quote-check)·죽은 테이블 **전부 수리 완료(7/4)**. 잔여: 2.1 medium 3건 |
| 3.1 랜딩+사전등록 | ✅ | 라이브 검증 포함. Turnstile 실배선 확인, Resend verified |
| 3.2 인증 플로우 | ✅ | 미들웨어+RLS+admin 이중검증(라이브 위조쿠키 차단). low 3 |
| 3.3 AI 아모라 채팅 | ✅ | 페르소나 컴플라이언스 프롬프트 명시 인코딩. 스트리밍/멱등저장/visibility 격리 견고 |
| 3.4 예산/축의금 | ⚠️ | 계산 전부 정확. **M-W1: 클라 progress 전체 덮어쓰기 13곳**(커플 동시편집 유실 표면) |
| 3.5 일정 관리 | ✅ | 멱등 upsert·원자 patch·임박 계산 정확. D-day UTC 파싱 low 1 |
| 3.6 업체+견적 진단 | ✅ | **판정 금지가 회귀 테스트로 잠김**(금지 필드 11종+평가어 5종). 유료 순위 제거 유지 |
| 3.7 커뮤니티 | ✅ | 최근 커밋(댓글 수정·격리) 실동작+테스트. 동기방(웹) 견고 |
| 3.8 예약 | ✅ | 이중 계상 방지 모범적(__booking_costs 원장+멱등 이벤트) |
| 3.9 관리자 | ✅ | verifyAdmin 16/16 위 정상 배선 |
| 3.10 정적+SEO | ✅ | robots/sitemap 비공개 격리 정상. 메타 폴리시 info 3 |
| 4.1 모바일 실행성 | ✅ | expo export android 번들 성공(에러 0) |
| 4.2 모바일 인증 | ⚠️ | **M-M1: signup/forgot 직접 SDK — 웹 하드닝(Turnstile·rate limit·enumeration) 우회.** OAuth 브릿지·apiFetch는 견고 |
| 4.3 모바일 탭 기능 | ⚠️ | 껍데기 0, 전 화면 실구현. **M-M2: 시세 화면 하드코딩+출처 라벨 부정확.** 단 budget은 원자 patch(웹보다 우수) |
| 4.4 웹뷰 의존도 | ✅ | 웹뷰 1곳(예절), https+hanbang.ai 허용목록 |
| 5.1 스키마-코드 정합성 | ⚠️ | **F-M3: 모바일 동기방 입장 깨짐**(클라 INSERT vs 6/15 서버전용 하드닝 충돌+유령 RPC). 재현성 갭(baseline 부재) |
| 5.2 라이브 스모크 | ✅ | 12개 표면 전부 정상 응답, SSR 타이틀 확인, 보호경로 307 |
| 5.3 공유 패키지 | 🚫/✅ | packages/shared 유령(임포트 0) / design-tokens 모바일 34파일 실사용 |

## 2. 리스크 랭킹

**치명 (출시 차단): 0건** / **높음: 0건** (H1 costGuard는 7/4 원자화로 종결)

**중간 (다음 스프린트 수리 권장):**

| ID | 내용 | 영향 | 수정 방향 |
|----|------|------|-----------|
| M-W1 | 웹 클라 progress 전체 덮어쓰기 13곳 (BudgetContent 8·ScheduleContent 2·CategoryChecklistModal·dashboard·EtiquetteClient) — journey Realtime 미구독이라 스테일 창=세션 전체. 커플 2인 동시 편집/AI 병행 시 상대 변경 통째 롤백 가능. 부수: __events 300개 초과 조용한 절단 | 데이터 유실(커플 코어 UX) | authStore.updateJourney를 diff→`progress_patch`/`progress_remove_keys`로 전환 — **API 이미 지원, 모바일 budget이 실증 사례.** 국소 수정 |
| F-M3 | 모바일 동기방 입장 깨짐 — cohort_members 클라 직접 INSERT가 6/15 하드닝(REVOKE+트리거)에 차단돼 무반응 실패 + 미정의 RPC(increment_cohort_member_count) 호출 | 모바일 기능 깨짐(출시 차단급, 웹은 정상) | 웹 auto-assign API 경유로 전환, 유령 RPC 제거 |
| M-M1 | 모바일 signup(`signup.tsx:117`)·forgot-password(`:124`) 직접 SDK — Turnstile·rate limit·enumeration 마스킹 우회 | 봇 가입 표면(모바일 출시 시) | 웹 하드닝 라우트 경유(anon 허용+모바일 Turnstile 키 배선) |
| M-M2 | 모바일 시세 화면 하드코딩 + 출처 라벨 "2024 기재부" 부정확 — 참가격 자동생성 데이터와 불일치·갱신 밖 | 신뢰/표시 원칙(6/12) 위반 소지 | 데이터 소스 공유(packages/shared 결정과 병합) 또는 웹뷰 전환, 최소 출처 정정 |
| C1~C3 | (2.1 기존) 시드 4종 환경게이트·멱등성 부재 / seed PUT 타임슬롯 개방 / onboarding 기존 커플 미검사 고아화 | 관리자 실수 표면 | 프로덕션 게이트+멱등성+소속 검사 |

**낮음 (백로그, 전부 기록됨):** 3.2 L1~L3(미서명 demo쿠키 심층방어·에러원문 노출·reset 리다이렉트 `//` 가드) / 3.4 L1~L2(moneyStore 조용한 localMode·저장실패 무통보) / 3.5 L1(D-day UTC 파싱) / 3.8 L1(booking 카테고리 원문 키) / 4.2 I1(딥링크 스킴 — App Links 검증 권장) / 사용자 작업: **ADMIN_PASSWORD 회전**·Turnstile 키 확인.

## 3. 지금 당장 고쳐야 할 것 Top 5 — ✅ 전부 수리 완료 (2026-07-04)

| # | 항목 | 상태 | 커밋 |
|---|------|------|------|
| 1 | **M-W1** 웹 progress diff→patch 전환 | ✅ updateJourney가 변경 키만 progress_patch/remove_keys 전송, no-op 생략, 회귀 테스트 4종(284 통과) | c0aa1674 |
| 2 | **F-M3** 모바일 동기방 입장 | ✅ 웹 POST /api/community/cohort 경유(service-role 배정), 유령 RPC 제거, 실패 Alert | 609c685b |
| 3 | **M-M1** 모바일 가입/비번찾기 | ✅ publicApiFetch로 웹 하드닝 라우트 경유, 서버는 모바일 헤더일 때만 Turnstile 생략(나머지 방어선 유지), 모바일 비번 정책 8자+복합 상향 | dad42bf0 |
| 4 | **M-M2** 모바일 시세 | ✅ 하드코딩 제거 → 웹뷰(참가격 SSR)로 위임, 단일 출처화 | ccbbb66a |
| 5 | **C1~C3** 관리자 시드/고아화 | ✅ seedGate() 프로덕션 게이트 5개 진입점, onboarding 소속 검사 409 | 0a3561be |

**검증:** 웹 tsc 0·lint 0·테스트 284/284·빌드 그린 / 모바일 tsc 0·lint 0·expo export android 번들 성공.

**남은 사용자 작업 (코드 아님):**
- **ADMIN_PASSWORD 회전** (4월 감사 권고 미이행 — Vercel 환경변수) — 코드로 해결 불가, 사용자 실행.
- **`MOBILE_APP_KEY` 미도입 결정**: M-M1 수리는 `x-hanbang-client: mobile` 헤더 기반(스푸핑 가능하나 rate limit+이메일 인증이 실방어). 더 강한 보증이 필요하면 모바일 앱 어테스테이션/Turnstile을 출시 전 검토(현 베타 단계는 비차단).
- 시드를 프로덕션에서 실행해야 하면 `ALLOW_SEED=true`를 명시 설정(기본은 차단).

## 4. 죽은 코드/유령 정리 목록

| 항목 | 상태 |
|------|------|
| packages/shared | 🚫 유령 확정(임포트 0) — 배선(시세 공유가 1순위 후보) or 삭제 결정 필요 |
| increment_cohort_member_count RPC 호출 | 유령(정의 없음) — F-M3 수리와 함께 제거 |
| etiquetteData 103KB 클라 번들 | 채팅 번들에 포함 — 분리 권고(성능, 비긴급) |
| 죽은 테이블 8종·bookings 조인·ServiceBanner·모바일 guestbook·mockVendors | ✅ 7/4 정리 완료(재확인: 코드 참조 0) |
| formatWon/formatWonFull 중복 등 마이너 | 기록만(무해) |

## 5. 종합 판정

**★ 2026-07-04 업데이트: Top 5 중간 결함 5건 전부 수리 완료.** 남은 것은 사용자 실행 항목(ADMIN_PASSWORD 회전)과 선택적 하드닝(모바일 어테스테이션)뿐. 중간 등급 코드 결함 0.

**웹 프로덕트: 출시 유지 가능 상태.** 크리티컬 0, 높음 0. 보안 경계(인증·RLS·admin 이중검증·비용 가드)는 라이브 검증 포함으로 견고하고, 전략 리스크(판정 금지·유료 순위 금지·AI 정체성)는 코드+회귀 테스트로 잠겨 있다. 유일한 중간 결함(M-W1)은 데이터 유실 표면이며 수리 경로가 이미 준비돼 있다.

**모바일 앱: 코드 품질은 충실하나 출시 전 3건(F-M3·M-M1·M-M2) 필수 수리.** 전부 "웹은 고쳤는데 모바일이 이전 패턴/복붙 데이터로 남은" 동기화 부채 — packages/shared 결정과 함께 묶어 처리하면 효율적.

수리 이력: H1(costGuard 원자화)·M1/M2(quote-check)·죽은 테이블 정리 — 전부 2026-07-04 Management API 적용+원격 검증 종결.
