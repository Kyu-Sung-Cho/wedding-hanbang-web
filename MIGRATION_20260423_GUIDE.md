# Migration 20260423 — 누락 테이블 추가 실행 가이드

> [!WARNING]
> **폐기된 역사 운영 기록입니다.** 현재 원격 DB에 그대로 실행하거나 재실행하는 지침이 아닙니다. 원격 작업의 유일한 기준은 [`docs/SUPABASE_REMOTE_OPERATIONS.md`](docs/SUPABASE_REMOTE_OPERATIONS.md)와 [`docs/PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md`](docs/PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md)입니다.

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

## 실행·검증 방법 — 폐기

이 문서가 과거에 안내하던 Dashboard SQL Editor 복사 실행, 수동 project link, 원시 migration push와 임의 catalog query는 모두 폐기됐다. 현재 migration chain은 이 파일 하나보다 훨씬 뒤까지 진행됐고, 일부 정책은 후속 forward migration에서 다시 변경됐다. 이 파일만 재실행하면 현재 ledger와 catalog를 분리하거나 최신 보안 경계를 되돌릴 수 있다.

현재는 다음 원칙만 적용한다.

1. local migration 전체가 disposable project에서 blank fresh replay와 직전 승인 snapshot upgrade를 모두 통과한다.
2. 운영 자격 증명 회전, 암호화 백업·격리 복구, 전역 write-fence lease, exact target/role binding이 먼저 증명된다.
3. guarded ship이 remote history의 exact 연속 prefix와 reviewed pending suffix를 확인한다.
4. 동일 release lease 안에서 migration을 적용하고, post-contract와 black-box denial evidence가 통과한 뒤에만 fence를 해제한다.

현재 이 gate들은 모두 완료되지 않았으므로 이 migration을 운영에서 별도로 실행하거나 확인하지 않는다.

## 역사적 영향·rollback 메모 — 실행 금지

과거 문서는 이 파일을 재실행 가능하고 비파괴적이라고 설명했지만, 정책을 drop/recreate하는 작업과 현재 후속 migration의 결합은 그런 보장을 하지 않는다. 과거의 파괴적 table-cascade rollback 예시는 데이터·의존 객체를 삭제하므로 완전히 폐기했다. 현재 복구는 검증된 backup/restore 또는 별도 reviewed forward migration으로만 수행하며, 이 문서에는 실행 가능한 SQL을 남기지 않는다.

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

## 후속 상태

위 표와 audit 정정은 당시 개발 이력만 보존한다. 이 문서에는 Dashboard 실행, 수동 검증 SQL, ad-hoc dump 또는 rollback checklist가 없으며 새 운영 작업을 배정하지 않는다. 현재 할 일과 차단 조건은 canonical runbook 두 문서에서만 관리한다.
