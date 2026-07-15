# 보안 감사 2.5 — Supabase RLS 정책 점검 (2026-07-03)

> **폐기된 역사 문서 — 현재 구현·로드맵·마케팅·세일즈 근거로 사용 금지.** 당시 migration 정적 대조의 “견고·라이브 홀 0” 판정은 현재 원격 권한, 최신 migration 적용이나 출시 안전을 증명하지 않는다. 현재 제공 범위는 [`WEDDINGHANBANG_SERVICE_DOC.md`](../WEDDINGHANBANG_SERVICE_DOC.md), 현재 상태는 [`PROJECT_STATUS.md`](../PROJECT_STATUS.md), 제품 판단 원칙은 [`CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md`](./CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md)만 따른다.

> 대상: `supabase/migrations`의 RLS 정책 ↔ 코드 실제 테이블 접근 패턴 대조.
> 방법: **인라인(Fable, subagent 없음)** — 전 마이그레이션 RLS 지형 수집(70개 테이블 RLS enable) →
> 핵심 하드닝 마이그레이션(`lock_sensitive_anon_access`) + 민감 테이블(chat/ai_log/visibility) 정책 전문 Read →
> 과permissive 패턴(`USING(true)`/`CHECK(true)`/`TO anon`) grep 전수.
> 한계: CLI 링크 없어 **정적 마이그레이션 리뷰**(라이브 PostgREST 프로빙 아님) — 2.5 계획의 의도된 방법.

## 종합 등급: ✅ 견고 (핵심 민감 테이블 모범적 · 죽은 테이블 정리 1건 권고)

민감 데이터(대화·결정·커플·저널·AI로그·돈)의 RLS는 **모범적 수준**. 유일한 실제 RLS↔현실 불일치는 삭제된 청첩장/방명록 기능이 남긴 죽은 테이블의 과permissive 정책(저심각·정리 권고). 라이브 보안 홀 0건.

---

## 핵심 민감 테이블 — ✅ 모범적

| 테이블 | 스코프 | 근거 |
|---|---|---|
| `profiles`·`couples`·`wedding_journeys` | 잠금 | `20260614110000`: anon+authenticated 권한 REVOKE → 필요 op만 재GRANT, service_role만 ALL. `is_couple_member`/`can_read_profile` SECURITY DEFINER 헬퍼(재귀 회피). **컬럼 가드 트리거**로 `couple_id`/`role`/`is_admin`/`bride_id`/`groom_id` 직접 UPDATE 잠금 — 멤버십 변경은 `join_couple` RPC(세션 플래그)만. 커플 탈취·is_admin 승격 차단. **(사후 보정 2026-07-04: `join_couple`은 `20260615092000`에서 원자적 슬롯 클레임(`UPDATE … WHERE slot IS NULL RETURNING`)+초대코드 정규식+anon REVOKE로 추가 하드닝됨 — 슬롯 클레임 TOCTOU까지 차단, 결론 강화.)** |
| `amora_actions` | 커플 | `20260615100000`(사후 보정): anon+authenticated REVOKE, authenticated는 SELECT만, service만 ALL. `amora_actions_select_couple` USING `is_couple_member(couple_id)`. 라우트(`api/amora/actions`)는 auth 401 + coupleId 서버파생 + 리포지토리 write가 `.eq("couple_id").eq("id")` 이중 스코프 → IDOR 없음. |
| `chat_messages` | 커플 + **visibility 격리** | `chat_select_with_privacy`(`20260427000001`): 커플 스코프 AND bride/groom_private는 본인만 SELECT. **파트너가 상대 개인채팅 못 봄.** 옛 광범위 정책은 OR-우회 방지 위해 DROP. INSERT 커플 스코프. |
| `decision_nodes` | 커플 + visibility 격리 | chat과 동일 패턴 — private 메모 파트너 격리. |
| `ai_interactions_log` | 소유자만 | `ai_log_owner_select`: `user_id = auth.uid()`만 SELECT(커플 스코프보다 더 좁음 — 파트너도 못 봄), 쓰기 service_role만. user_input/ai_output 원문 PII를 소유자 외 노출 안 함. |
| `cohort_members`·`cohort_messages`·`cohort_member_reports` | 룸 멤버 | `is_cohort_member` 헬퍼, insert는 self+활성룸, report는 자기신고 금지. round-2 하드닝. |
| `congratulatory_money`·`vendor_bookings`·`amora_quote_checks`·`vendor_leads` | 커플/소유/admin | 2.2에서 확인 — money_owner FOR ALL, vendor_bookings 커플, quote owner_select, vendor_leads admin/service. |

anon 클라(RLS 백스톱)로 접근하는 라이브 테이블은 전부 스코프된 정책 보유 — RLS enable + 정책 없음(=deny all → 기능 깨짐) 사례 없음.

---

## 발견

### L1. 죽은 청첩장/방명록 테이블의 과permissive RLS (low — 라이브 위험 아님, 정리 권고)
- **파일**: `20260302000000_phase3_invitation_ai_script.sql:205·228·237·238·253`
- **사실**: 삭제된 청첩장/방명록 기능(Week 1 수술, 코드 삭제·**테이블 보존**)이 남긴 정책 — `invitation_templates`·`invitation_guestbook` `SELECT USING(true)`(공개 읽기), `invitation_rsvp`·`invitation_guestbook`·`invitation_visits` `INSERT WITH CHECK(true)`(누구나 삽입). `lock_sensitive` 배치에 미포함이라 anon 권한 REVOKE 안 됨.
- **불일치**: 정책은 라이브-기능 시절 설계(하객 누구나 RSVP/방명록)인데 현재 기능이 죽어 접근 패턴과 어긋남. anon이 PostgREST로 죽은 테이블에 스팸 삽입 or 공개 방명록(테스트 ~2건) 조회 가능.
- **영향**: 죽은 테이블 대상이라 라이브 데이터 유출·손상 없음. 스토리지 스팸·테스트 데이터 노출 정도. low.
- **권고**: `invitation_*` 테이블 **DROP**(복구는 pre-surgery 태그) 또는 anon 권한 REVOKE + 정책 잠금. 죽은 코드 정리(0.2에서 발견한 유령 코드)와 함께 처리.

### I1. by-design 공개 읽기 (info — 수용)
- `community_profiles`·`community_achievements` `SELECT USING(true)`(닉네임·랭크·아바타·뱃지 공개 — 커뮤니티 작성자 표시용, 의도됨), `vendor_views` `INSERT(true)`(익명 조회수 분석). 기능상 수용 가능. 단 community_profiles가 wedding_year/month 등 준개인정보를 공개 노출할 수 있음은 인지 필요(round-2에서 cohort 익명성은 별도 확인됨).

---

## 방법론 메모
- 정적 마이그레이션 리뷰(70 테이블 RLS enable 목록화 + 핵심 정책 전문 Read + 과permissive grep). 라이브 PostgREST 프로빙은 CLI 링크 부재로 미수행 — 과거 라운드에서 원격 검증한 정책(cohort permission denied·초대코드 2^48·is_admin 잠금)은 그 결과를 원용.
- 신규 라이브 보안 결함 0. L1은 죽은 코드 정리(0.2 유령 코드)와 병합 처리 권고.

---

## Phase 2 (보안) 종료 요약
2.1 관리자·인증(⚠️ medium 3) → 2.2 돈(⚠️ medium 2, quote-check) → 2.3 AI(⚠️ high 1 costGuard TOCTOU) → 2.4 나머지(✅) → 2.5 RLS(✅). **크리티컬 0.** 인증·RLS 기반은 견고, 실질 리메디에이션 우선순위: **①H1 costGuard 원자화(2.3, 베타상한 확대 전) ②M1/M2 quote-check·XFF(2.2) ③죽은 테이블/코드 정리(L1·0.2).** 다음은 Phase 3(웹 기능별 감사).
