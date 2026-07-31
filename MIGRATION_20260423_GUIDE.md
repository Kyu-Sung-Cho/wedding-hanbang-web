# Migration 20260423 — 누락 테이블 추가 실행 가이드

> [!CAUTION]
> **역사 기록 / 실행 금지**
>
> 이 문서는 2026-04 당시의 일회성 안내이며 현재 운영 절차가 아니다.
> `/customersurvey`는 종료됐고, 현재 저장소에서는 범위가 정해지지 않은
> `supabase db push`를 금지한다. 아래 프로젝트 식별자·테이블 수·기능 설명·실행
> 결과는 현재 상태를 증명하지 않는다. 운영 DB에는
> [`AGENTS.md`](./AGENTS.md)의 release manifest/controller 절차와 최신
> `docs/operations/` 문서만 사용한다.

## 목적
코드가 참조하지만 migrations에 정의 없던 5개 테이블을 추가합니다.

## 해결되는 기능
| 테이블 | 해결되는 기능 |
|--------|-------------|
| `chat_feedback` | AI 피드백 학습 시스템 (👍/👎 버튼, 자동 불만족 감지) |
| `chat_summaries` | AI 대화 장기 기억 (향후 요약 기능용, 현재 SELECT만) |
| `vendor_photo_likes` | 업체 상세 페이지 사진 좋아요 |
| `account_deletions` | 계정 탈퇴 사유 기록 (서비스 개선용) |
| `customer_survey_responses` | 고객 사전 설문 저장 (`/customersurvey`) |

## 실행 방법

### 옵션 A: Supabase Dashboard (권장, 가장 안전)
1. https://supabase.com/dashboard/project/slrtobkksjmxgzatjyqb 접속
2. 왼쪽 메뉴 **SQL Editor** 클릭
3. **New query** 클릭
4. `supabase/migrations/20260423000000_missing_tables.sql` 파일 전체 내용 복사/붙여넣기
5. **Run** 클릭

**기대 결과**:
- 5개 `CREATE TABLE` 실행 (이미 있으면 스킵)
- 5개 인덱스 추가
- 10개 RLS 정책 재적용 (DROP → CREATE)
- 에러 없이 Success

### 옵션 B: Supabase CLI (CLI 설치되어 있는 경우)
```bash
cd c:\Users\admin\Desktop\weddinghanbang_website\hanbang-web
supabase link --project-ref slrtobkksjmxgzatjyqb
supabase db push
```

## 검증 방법

실행 후 SQL Editor에서:

```sql
-- 1. 5개 테이블 존재 확인
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'chat_feedback', 'chat_summaries', 'vendor_photo_likes',
    'account_deletions', 'customer_survey_responses'
  );
-- → 5 rows 반환되어야 함

-- 2. RLS 활성화 확인
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'chat_feedback', 'chat_summaries', 'vendor_photo_likes',
    'account_deletions', 'customer_survey_responses'
  );
-- → 모든 row의 rowsecurity = true

-- 3. 실제 기능 테스트 (로그인 후)
-- /chat 페이지 접속 → AI 메시지에 👎 → 수정 의견 입력 → 전송
-- (500 에러 없이 성공해야 함)
```

## 프로덕션 영향

### 파괴적 작업 없음
- 모든 `CREATE TABLE`이 `IF NOT EXISTS`
- 모든 `CREATE POLICY`가 `DROP POLICY IF EXISTS` 선행
- 기존 데이터/컬럼/정책 변경 없음

### 재실행 안전성
동일 migration을 여러 번 실행해도 안전:
- 테이블 이미 있음 → CREATE TABLE 스킵
- 정책 이미 있음 → DROP 후 CREATE (동일 정책 재생성)

## Rollback

이 migration이 문제를 일으킬 경우:

```sql
-- 테이블 삭제 (데이터 손실 주의!)
DROP TABLE IF EXISTS chat_feedback CASCADE;
DROP TABLE IF EXISTS chat_summaries CASCADE;
DROP TABLE IF EXISTS vendor_photo_likes CASCADE;
DROP TABLE IF EXISTS account_deletions CASCADE;
DROP TABLE IF EXISTS customer_survey_responses CASCADE;
```

단 실제 데이터가 쌓이기 시작하면 rollback하지 말 것. 컬럼만 조정.

## 원본 Audit과의 차이

### Audit에서 잘못 식별한 부분 (정정)
- `messages` 테이블 — **실제로는 존재하지 않음**. `/api/messages/route.ts`는 `vendor_messages`만 사용 중. 추가 작업 불필요.
- `community_posts.search_vector` trigger — **이미 `20260325_community.sql:254`에 존재**. 추가 작업 불필요.

### Audit이 맞았던 부분
- `chat_feedback` ✓
- `chat_summaries` ✓
- `vendor_photo_likes` ✓
- 추가 발견:
  - `account_deletions` (audit에서 "미확인"으로 표시)
  - `customer_survey_responses` (audit에서 언급됨)

## Bucket A 진행 상황

| # | 작업 | 상태 |
|---|------|------|
| A1 | `chat_feedback` migration | ✅ 완료 (이 파일에 포함) |
| A2 | `chat_summaries` migration | ✅ 완료 (이 파일에 포함) |
| A3 | `messages` 테이블 재매핑 | ✅ 불필요 (audit 오류 정정) |
| A5 | `vendor_photo_likes` migration | ✅ 완료 (이 파일에 포함) |
| A6 | `search_vector` trigger | ✅ 이미 존재 (audit 오류 정정) |
| **추가** | `account_deletions` migration | ✅ 완료 (이 파일에 포함) |
| **추가** | `customer_survey_responses` migration | ✅ 완료 (이 파일에 포함) |
| A4 | Baseline schema 재생성 | ⏸ 팀 합류 전 별도 작업 |

## 다음 작업
- [ ] 이 migration을 Supabase Dashboard에서 실행
- [ ] 위 검증 SQL로 테이블 5개 생성 확인
- [ ] AI 피드백 버튼 실제 동작 테스트
- [ ] (이후) Bucket B: 18개 API try/catch wrapping
- [ ] (나중) D01: Baseline schema pg_dump
