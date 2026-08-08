# 커뮤니티 런타임 비상정지 운영 절차

작성일: 2026-08-04
상태: 로컬 릴리스 후보. 원격 DB·Vercel에는 아직 적용하지 않음.

## 목적

개인정보 사고, 신고 처리 적체, 악성 콘텐츠 확산, 데이터 무결성 이상이 발생했을 때 커뮤니티를 전체 서비스와 분리해 즉시 축소한다. 비상정지는 사용자 데이터 삭제나 배포 롤백이 아니다.

## 두 제어면

하나만 바꾸면 충분하지 않다.

| 제어면 | 막는 대상 | 정본 |
|---|---|---|
| 웹 런타임 | 현재 웹 페이지와 `/api/community/**` 요청 | `COMMUNITY_RUNTIME_MODE` |
| 데이터베이스 | 이전 버전 앱의 직접 읽기와 일반 커뮤니티 쓰기 | `community_runtime_control` |

허용 모드는 정확히 세 개다.

- `normal`: 정상 읽기·쓰기
- `read_only`: 읽기는 유지하고 일반 쓰기 중단
- `disabled`: 일반 커뮤니티 읽기·쓰기 모두 중단

`community_reports`, `cohort_member_reports`, `community_moderation_appeals`는 비상정지 중에도 안전 접수 경로로 남는다. 검증된 관리자 제재 RPC도 감사 기록과 함께 계속 작동해야 한다.

## 발동

1. 사고 번호와 발동 사유를 먼저 정한다. 개인 이름·전화번호·원문 콘텐츠를 사유에 복사하지 않는다.
2. Vercel 런타임의 `COMMUNITY_RUNTIME_MODE`를 `read_only` 또는 `disabled`로 변경한다.
3. 같은 모드로 데이터베이스 제어를 기록한다.

```sql
select public.community_set_runtime_mode(
  'disabled',
  'INC-2026-0001 privacy containment',
  '<verified-admin-uuid>'::uuid
);
```

자동화된 사고 대응처럼 관리자 UUID를 제공할 수 없는 service-role 작업은 세 번째 인자를 `NULL`로 둘 수 있다. 사람 운영자가 수행한 변경에는 검증된 관리자 UUID를 남긴다.

4. 두 제어면이 같은 모드인지 확인한다.

```sql
select control_key, mode, reason, changed_at, changed_by, version
from public.community_runtime_control
where control_key = 'global';

select id, previous_mode, mode, reason, changed_at, changed_by, version
from public.community_runtime_control_events
order by changed_at desc, id desc
limit 10;
```

5. 실제 동작을 확인한다.

- `read_only`: 커뮤니티 GET은 성공하고 글·댓글·투표·북마크·동기방 메시지 쓰기는 `503` 또는 DB `55000`으로 거절된다.
- `disabled`: 커뮤니티 페이지와 API는 `503 community_disabled`, authenticated 직접 조회는 빈 결과가 된다.
- 신고·멤버 신고·이의제기 접수는 계속 가능하다.
- 관리자 신고 확정은 콘텐츠 숨김·신고 상태·감사 이벤트·작성자 알림을 한 트랜잭션으로 완료한다.
- 응답에 `Cache-Control: no-store`가 있는지 확인한다.

6. 사고 타임라인에 웹 모드, DB 모드, 검증 시각, 검증자, 실패한 점검을 기록한다.

## 복구

복구는 사고 원인 제거, 데이터 무결성 확인, 미처리 신고·이의제기 확인 이후에만 한다.

1. DB를 먼저 `normal`로 되돌리고 이벤트가 기록됐는지 확인한다.

```sql
select public.community_set_runtime_mode(
  'normal',
  'INC-2026-0001 containment verified',
  '<verified-admin-uuid>'::uuid
);
```

2. 쓰기·읽기 smoke test는 운영자 테스트 계정 한 개로 제한한다.
3. Vercel의 `COMMUNITY_RUNTIME_MODE`를 마지막에 `normal`로 바꾼다.
4. 일반 사용자 계정으로 읽기, 글 작성, 댓글, 신고를 각각 한 번 검증한다.
5. 복구 시각과 검증 결과를 사고 기록에 남긴다.

## 실패 시 원칙

- DB 제어 행이 없거나 모드가 유효하지 않으면 DB 함수는 `disabled`로 해석한다.
- 두 제어면이 불일치하면 더 강한 제한을 정상 상태로 간주하고 원인을 조사한다.
- 안전 제재가 실패하면 신고 상태만 성공으로 표시하지 않는다.
- 비상정지를 풀기 위해 RLS 정책, 트리거, 감사 이벤트를 삭제하지 않는다.
- 사용자 콘텐츠나 프로필 행을 비상정지 절차에서 삭제하지 않는다.

## 릴리스 전 필수 검증

- `20260804103000_community_report_resolution_atomic.sql`
- `20260804120000_community_profile_guestbook_p0_hardening.sql`
- `20260804130000_community_runtime_control.sql`

## 통제 베타 미디어 별도 잠금

커뮤니티 이미지 발행은 비상정지 모드와 별개의 출시 게이트다. 웹 런타임의
`COMMUNITY_MEDIA_PUBLISHING_ENABLED`가 정확히 `true`가 아니면 업로드 URL 발급,
업로드 완료 처리, 미디어가 포함된 새 글 발행을 모두 `503`으로 거절한다. UI 공개
플래그가 켜져 있어도 이 서버 플래그가 최종 권한이며, 두 값을 함께 승인하기 전에는
미디어 베타를 열지 않는다. 기존 Storage 직접 쓰기 정책 제거 여부도 별도 Storage
검증 절차로 확인한다.
- 원격 Supabase clone에서 migration 순서 적용
- 원격과 동일한 역할로 `normal → read_only → disabled → normal` 검증
- 실제 병렬 신고 확정/기각 경합 검증
- Vercel preview에서 런타임 환경변수 전환 검증

이 문서는 운영 절차이며 현재 프로덕션 적용 성공을 주장하지 않는다.
