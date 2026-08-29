# 연결 문맥 세그먼트 — 운영 적용 기록

2026-08-29 진단, **2026-08-30 운영 적용 완료.**

아모라의 **연결 문맥**(`amoraBoundedContinuity`)이 운영에서 한 번도 돈 적이 없었다.
원인은 코드가 아니라 마이그레이션 두 개가 운영에만 없는 것이었고, 그 두 개는
**빠뜨린 것이 아니라 2026-08-20 에 적용하려다 중단된 것**이었다.

## 무엇이 안 됐는가

팀 리포트(Major 3)의 증상이 배포 뒤에도 그대로 재현됐다. 2026-08-29 운영 실측:

```
직전: 우리는 예단이랑 폐백은 생략하고 싶어. 두 사람 의견은 같아.
현재: 그걸 부모님께 어떻게 말해야 덜 부딪힐까? 실제로 보낼 말까지 써줘.
아모라: 어떤 내용을 부모님께 말씀드리려는지 아직 제가 정확히 몰라서…
```

라우트의 관문(`route.ts`, `shouldAttemptBoundedContinuity`)이 현재 사용자 메시지
행의 `segment_id` 가 UUID 일 것을 요구한다. `segment_id` 를 채우는 것은 트리거이고,
그 트리거는 아래 마이그레이션이 만든다.

| 마이그레이션 | 적용 전 운영 |
|---|---|
| `20260801100000_amora_conversation_segments.sql` (테이블 + RPC) | 적용됨 |
| `20260802120000_..._dual_write.sql` | **없음** |
| `20260802210000_..._roster_repair.sql` | **없음** |

## 진짜 막고 있던 것 — 고아 42행

2026-08-20 릴리스에서 이 둘만 보류된 이유가 `AMORA_SEGMENT_BACKFILL_INCOMPLETE`
였다. 원인을 끝까지 파니 **커플 세 쌍의 42행**이었다.

| 커플 | 무엇 | 왜 세그먼트를 못 만드나 |
|---|---|---|
| `e350d8a3` | shared 메시지 16 + 요약 6 | `bride_id`·`groom_id` **둘 다 NULL** |
| `26b14505` | shared 메시지 6 | 둘 다 NULL |
| `bb275d85` | **groom_private 메시지 14** (4~5월) | `groom_id` NULL (2026-08-20 슬롯 분리 사고) |

만들 수 없는 이유는 스키마가 정한다.

```
conversation_segments.started_by            NOT NULL
conversation_segments_owner_shape_check     개인 레인은 owner_user_id IS NOT NULL
```

`shared` 세그먼트의 `started_by` 는 `COALESCE(bride_id, groom_id)` 인데 둘 다 NULL 이고,
`groom_private` 의 `owner_user_id` 는 `groom_id` 인데 NULL 이다. **넣을 사람이 없다.**

그리고 가드는 장식이 아니었다. 파일 677~680 줄이 백필 직후 `segment_id` 에
`SET NOT NULL` 을 건다. 가드를 건너뛰어도 같은 자리에서 죽는다.

### 그 42행은 아무도 읽을 수 없다

`chat_messages` 의 SELECT 정책은 `can_access_couple_visibility()` 를 거치고, 그 함수는
`couple.bride_id = profile.id` 또는 `couple.groom_id = profile.id` 를 요구한다. 세 경우
모두 그 값이 NULL 이므로 **열람 경로가 없다.** `bb275d85` 는 신랑 프로필 자체가 0개고
(`trg_seal_ownerless_couple_membership_epoch` 이 슬롯 재삽입을 영구 차단),
나머지 둘은 프로필이 아예 0개다.

의존 행도 없었다 — `chat_messages` 를 참조하는 FK 9개(CASCADE 4·SET NULL 5) 전부
그 42행을 가리키는 행이 **0건**이었다.

## 실제로 한 일 (2026-08-30)

파일을 고치는 길도 있었지만 택하지 않았다. 두 파일은
`supabase/release-manifests/vendor-disclosure-v2-20260718.json` 에 `sha256` 으로 박혀
있어 **한 글자만 바뀌어도 매니페스트 → 서명 핀 → Vercel 승인 env 세 개를 함께
갱신해야 하고, 하나만 어긋나면 운영 배포가 전부 죽는다.**

대신 **읽을 수 없는 42행을 노출되지 않는 스키마로 옮기고 파일은 그대로 적용**했다.

```
1. 적용 전 상태 기록:  세그먼트 0 · 메시지 1,677 (segment 0) · 요약 15 (segment 0) · 커플 58
2. 보관:  amora_archive.chat_messages_orphan_20260830   (36행)
          amora_archive.chat_summaries_orphan_20260830  (6행)
          -- amora_archive 스키마는 PostgREST 에 노출되지 않는다
3. 원본과 id 대조 후 제거 → 1,677→1,641 · 15→9
4. 20260802120000 적용   (sha256 12cd3386… = 매니페스트 핀과 일치)
5. 20260802210000 적용   (sha256 43324885… = 매니페스트 핀과 일치)
6. supabase_migrations.schema_migrations 에 두 버전 기록
```

두 번째 마이그레이션의 사후 가드(`AMORA_SEGMENT_ROSTER_REPAIR_ACTIVE_MISSING`)는
`bride_id IS NOT NULL` 처럼 **구성원이 있는 커플만** 요구하므로 죽은 커플은 애초에
대상이 아니다. 막은 것은 첫 번째 하나뿐이었다.

## 적용 후 검증 (전부 통과)

```sql
-- 1) 함수 3개
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in
   ('assign_amora_conversation_message_segment',
    'assign_amora_conversation_summary_segment',
    'ensure_amora_initial_conversation_segments');            -- 3

-- 2) 트리거 5개
select count(*) from pg_trigger where tgname like 'trg_zz_%segment%';  -- 5

-- 3) 기존 행이 전부 채워졌나
select count(segment_id), count(*) from public.chat_messages;   -- 1641 / 1641
select count(segment_id), count(*) from public.chat_summaries;  --    9 / 9

-- 4) 커플·레인당 활성 세그먼트가 정확히 하나인가
select couple_id, visibility from public.conversation_segments
 where status='active' group by 1,2 having count(*) <> 1;       -- 0행
```

세그먼트 54개가 생겼다 — shared 25 · bride_private 15 · groom_private 14, 전부
`start_reason='migration'`.

### 트리거가 새 메시지에 실제로 도는지 (핵심)

기존 행이 채워진 것만으로는 부족하다. 앞으로 들어오는 메시지에 붙어야 관문이 열린다.
`BEGIN … ROLLBACK` 안에서 확인했다.

```
shared 메시지        → 그 커플의 shared 활성 세그먼트에 배정      일치
bride_private 메시지 → bride_private 활성 세그먼트에 배정         일치
두 레인이 서로 다른 세그먼트                                      확인
```

`segment_id` 는 이제 **NOT NULL 인데 기본값이 없다.** 트리거가 안 채우면 INSERT 자체가
실패하므로, 삽입이 성공했다는 사실이 곧 트리거가 돌았다는 증거다.

**시험 입력은 운영 데이터에서 유도할 것.** 처음에 `sender_type='user'` 로 넣었다가
`AMORA_SEGMENT_MESSAGE_ACTOR_INVALID` 를 받았다. 운영이 쓰는 값은 `bride|groom|ai` 다.

## 남은 것 — 사람이 해야 하는 확인

DB 층은 끝났고 앱 코드는 이미 배포돼 있다(PR #253·#256). 마지막 판정은 로그인이
필요해 하지 못했다. 아모라에서 두 턴을 연달아 보내면 된다.

```
우리는 예단이랑 폐백은 생략하고 싶어. 두 사람 의견은 같아.
그걸 부모님께 어떻게 말해야 덜 부딪힐까? 실제로 보낼 말까지 써줘.
```

**주의**: 대화가 이어져 보인다고 연결 문맥이 도는 것이 아니다. W0/W1 로 판정되는 턴은
원래 이력 전체를 받는다. 위 두 번째 문장은 W4 라서 판정에 쓸 수 있다.

## 롤백

트리거만 떼면 읽는 쪽이 없어진다. 백필된 `segment_id` 는 남아도 무해하다.

```sql
drop trigger if exists trg_zz_assign_amora_conversation_message_segment on public.chat_messages;
drop trigger if exists trg_zz_guard_amora_message_segment_scope         on public.chat_messages;
drop trigger if exists trg_zz_assign_amora_conversation_summary_segment on public.chat_summaries;
drop trigger if exists trg_zz_guard_amora_summary_segment_scope         on public.chat_summaries;
drop trigger if exists trg_zz_ensure_amora_initial_conversation_segments on public.couples;
alter table public.chat_messages  alter column segment_id drop not null;
alter table public.chat_summaries alter column segment_id drop not null;
```

보관한 42행을 되돌리려면 `segment_id` 의 NOT NULL 을 먼저 푼 뒤 넣는다.

```sql
insert into public.chat_messages  select * from amora_archive.chat_messages_orphan_20260830;
insert into public.chat_summaries select * from amora_archive.chat_summaries_orphan_20260830;
```

연결 문맥 자체는 코드에서도 닫힌다 — 관문이 `segment_id` 유무를 보므로.

## 원장은 판정에 쓰지 말 것

`supabase_migrations.schema_migrations` 기준으로는 저장소 216개 중 14개가 미적용으로
보였지만 **그 대부분은 실제로 적용돼 있었다.** 릴리스 컨트롤러가 원장에 기록하지 않고
적용하기 때문이다.

```
20260824120000 (일정 취소)  원장 없음 · apply_amora_atomic_tool_execution_v1  있음
20260802120000 (세그먼트)    원장 없음 · assign_amora_conversation_message_segment  없음
```

**판정은 `pg_proc` / `pg_trigger` / 테이블 행 수로 한다.**

## 이 문서가 만들어진 이유

PR #253·#256 이 연결 문맥을 고쳤고 테스트 8,823건 초록 · 적대적 검토 2회 · 실제 모델
측정 0/10 → 9/10 을 통과했다. **그런데 운영에서는 아무 일도 하지 않았다.** 오프라인
검증에서 세 행을 손으로 만들 때 `segment_id` 를 채워 넣었고, 그 값이 운영에 있는지
확인하지 않았기 때문이다.

그리고 이 문서의 첫 판(2026-08-29)도 틀렸다. "스테이징이 이미 증거이므로 그냥 적용하면
된다"고 썼는데, **실제로는 8-20 에 한 번 실패했던 일이었고 그 사실을 담지 않았다.**
운영에 없는 마이그레이션을 만나면 "왜 없는가"를 먼저 물어야 한다.
