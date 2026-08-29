# 연결 문맥이 운영에서 안 도는 이유와 적용 절차

2026-08-29 실측. 아모라의 **연결 문맥**(`amoraBoundedContinuity`)이 운영에서
한 번도 돈 적이 없다. 원인은 코드가 아니라 **마이그레이션 두 개가 운영에만
없는 것**이다.

## 무엇이 안 되는가

팀 리포트(Major 3)의 증상이 배포 뒤에도 그대로 재현된다. 2026-08-29 운영
실측(테스트 계정):

```
직전: 우리는 예단이랑 폐백은 생략하고 싶어. 두 사람 의견은 같아.
현재: 그걸 부모님께 어떻게 말해야 덜 부딪힐까? 실제로 보낼 말까지 써줘.
아모라: 어떤 내용을 부모님께 말씀드리려는지 아직 제가 정확히 몰라서…
```

## 왜

라우트의 관문(`apps/web/src/app/api/chat/route.ts`, `shouldAttemptBoundedContinuity`)이
현재 사용자 메시지 행의 `segment_id` 가 UUID 일 것을 요구한다.

```
운영:      conversation_segments 0건 · segment_id 있는 메시지     0 / 1,675
스테이징:  conversation_segments 12건 · segment_id 있는 메시지  589 / 589
```

`segment_id` 를 채우는 것은 트리거이고, 그 트리거는 아래 마이그레이션이 만든다.

| 마이그레이션 | 운영 |
|---|---|
| `20260801100000_amora_conversation_segments.sql` (테이블 + RPC) | 적용됨 |
| `20260802120000_amora_conversation_segment_dual_write.sql` | **없음** |
| `20260802210000_amora_conversation_segment_roster_repair.sql` | **없음** |

`pg_proc`·`pg_trigger` 로 확인한 정확한 차이 — 운영에 넣어야 할 것:

```
FN  assign_amora_conversation_message_segment
FN  assign_amora_conversation_summary_segment
FN  ensure_amora_initial_conversation_segments
TRG trg_zz_assign_amora_conversation_message_segment
TRG trg_zz_assign_amora_conversation_summary_segment
TRG trg_zz_ensure_amora_initial_conversation_segments
TRG trg_zz_guard_amora_message_segment_scope
TRG trg_zz_guard_amora_summary_segment_scope
```

운영에만 있고 스테이징에 없는 것은 **없다**. 순수한 누락이다.

## 원장은 판정에 쓰지 말 것

`supabase_migrations.schema_migrations` 기준으로는 저장소 216개 중 14개가
미적용으로 보인다. **그 대부분은 실제로는 적용돼 있다** — 릴리스 컨트롤러가
원장에 기록하지 않고 적용하기 때문이다.

```
20260824120000 (일정 취소)  원장 없음 · apply_amora_atomic_tool_execution_v1  있음
20260802120000 (세그먼트)    원장 없음 · assign_amora_conversation_message_segment  없음
```

**판정은 `pg_proc` / `pg_trigger` / 테이블 행 수로 한다.** 원장만 보면 멀쩡한
것을 미적용이라고 오판한다.

## 스테이징이 이미 증거다

따로 리허설할 필요가 없다. 스테이징(`rgxdizztidbgwnsbadml`)에는 이미 적용돼
있고 기대한 대로 돈다.

```
세그먼트 12개
  shared/active/initial     3      <- 트리거가 신규 커플에 자동 생성
  groom_private/active/initial  3
  bride_private/active/initial  2
  shared/active/migration   2      <- 마이그레이션 백필
  bride_private/active/migration 2

메시지 589 / 589 에 segment_id 있음 (100%)
```

`start_reason` 이 두 종류라는 것이 중요하다 — `migration` 은 백필이고,
`initial` 은 그 뒤 **트리거가 새로 만든 것**이다. 즉 적용 후에는 신규 커플에게도
계속 생기며 **제품 코드 변경이 필요 없다.**

## 운영에서 일어날 일의 규모

```
커플            58
메시지 레인     28   (couple_id × visibility)
메시지        1,675   <- 전부 segment_id 가 채워진다
대화 요약        15
요약 레인         6
```

마이그레이션의 사전 가드(`AMORA_SEGMENT_BACKFILL_AMBIGUOUS`)는 레거시 행이
붙을 세그먼트가 이미 둘 이상일 때 중단한다. 운영은 기존 세그먼트가 **0건**이라
모호성이 없어 통과한다.

## 적용 절차

1. **적용 직전 상태를 남긴다** (롤백 판단 근거)

   ```sql
   select
     (select count(*) from conversation_segments) segments,
     (select count(*) from chat_messages) msgs,
     (select count(*) from chat_messages where segment_id is not null) msgs_with_seg,
     (select count(*) from chat_summaries where segment_id is not null) sums_with_seg;
   ```

   기대: `0 / 1675 / 0 / 0`

2. **두 마이그레이션을 순서대로 적용한다.** 승인된 release manifest/controller
   절차로만 한다 — 일반 `supabase db push` 나 임의 SQL write 는 쓰지 않는다.

   ```
   20260802120000_amora_conversation_segment_dual_write.sql
   20260802210000_amora_conversation_segment_roster_repair.sql
   ```

   두 파일 모두 `BEGIN; … COMMIT;` 로 감싸여 있고 `lock_timeout = 5s`,
   `statement_timeout = 60s` 를 스스로 건다.

3. **적용 직후 검증** — 세 가지가 모두 참이어야 한다.

   ```sql
   -- (1) 객체 8개가 생겼나
   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('assign_amora_conversation_message_segment',
                        'assign_amora_conversation_summary_segment',
                        'ensure_amora_initial_conversation_segments');
   -- 기대: 3

   select count(*) from pg_trigger where tgname like 'trg_zz_%segment%';
   -- 기대: 5

   -- (2) 기존 메시지가 전부 채워졌나
   select count(*) total, count(segment_id) with_seg from chat_messages;
   -- 기대: total = with_seg = 1675

   -- (3) 커플마다 활성 세그먼트가 정확히 하나인가
   select couple_id, visibility, count(*)
     from conversation_segments where status = 'active'
    group by 1, 2 having count(*) <> 1;
   -- 기대: 0행
   ```

4. **살아 있는 확인** — 아모라에서 아래 두 턴을 연달아 보낸다.

   ```
   우리는 예단이랑 폐백은 생략하고 싶어. 두 사람 의견은 같아.
   그걸 부모님께 어떻게 말해야 덜 부딪힐까? 실제로 보낼 말까지 써줘.
   ```

   적용 전에는 "어떤 내용을 말씀드리려는지 모르겠어요" 가 나온다. 적용 후에는
   예단·폐백을 가리키는 답이 나와야 한다.

   **주의**: 대화가 이어져 보인다고 연결 문맥이 도는 것이 아니다. W0/W1 로
   판정되는 턴은 원래 이력 전체를 받는다. 위 두 번째 문장은 W4 라서 판정에
   쓸 수 있다.

## 이 문서의 SQL 은 스테이징에서 돌려 확인했다

절차서가 틀리면 없느니만 못하므로, 3단계의 검증 SQL 네 개를 스테이징(적용된 상태)과
운영(미적용 상태)에서 각각 실행했다. 2026-08-29 실측:

| 검증 | 스테이징(적용됨) | 운영(미적용) |
|---|---|---|
| 함수 3개 | `3` | `0` |
| 트리거 5개 | `5` | `0` |
| 메시지 채움 | `589 / 589` | `0 / 1675` |
| 커플·레인당 활성 세그먼트 1개 | 0행 | 0행 (세그먼트가 없어서) |

1단계의 적용 전 상태 쿼리도 운영에서 그대로 `0 / 1675 / 0 / 0` 이 나온다.

## 롤백

되돌리려면 트리거만 떼면 된다. 백필된 `segment_id` 와 세그먼트 행은 남아도
읽는 쪽이 없으면 무해하다.

```sql
drop trigger if exists trg_zz_assign_amora_conversation_message_segment on public.chat_messages;
drop trigger if exists trg_zz_guard_amora_message_segment_scope on public.chat_messages;
drop trigger if exists trg_zz_assign_amora_conversation_summary_segment on public.chat_summaries;
drop trigger if exists trg_zz_guard_amora_summary_segment_scope on public.chat_summaries;
drop trigger if exists trg_zz_ensure_amora_initial_conversation_segments on public.couples;
```

연결 문맥 자체는 **코드에서도 끌 수 있다** — 관문이 `segment_id` 유무를 보므로
새 메시지에 segment_id 가 안 붙으면 자동으로 닫힌다.

## 위험

- **트리거가 `chat_messages` 쓰기 경로에 붙는다.** 스테이징에서 589건이
  문제없이 돌지만 운영은 1,675건이고 실사용 중이다. 백필은 트랜잭션 하나이고
  `statement_timeout = 60s` 가 걸려 있다.
- **적용 후 W4 턴이 직전 한 쌍을 provider 로 보낸다.** 그것이 이 변경의 목적이지만,
  결혼 밖 발화에도 붙는다는 점은 PR #256 에 적어 뒀다(20문장 중 12건). 도구는
  0개 그대로다.
- `AMORA_CONVERSATION_SEGMENT_READ_ENABLED` 는 **건드리지 않는다.** 그건 별개의
  읽기 플래그이고 빌드 펜스가 `false` 를 강제한다. 연결 문맥은 그 플래그와
  독립된 경로를 쓴다(`route.ts` 주석 참고).

## 이 문서가 만들어진 이유

PR #253·#256 이 연결 문맥을 고쳤고, 테스트 8,823건 초록 · 적대적 검토 2회 ·
실제 모델 측정 0/10 → 9/10 을 통과했다. **그런데 운영에서는 아무 일도 하지
않는다.** 오프라인 검증에서 세 행을 손으로 만들 때 `segment_id` 를 채워 넣었고,
그 값이 운영에 있는지 확인하지 않았기 때문이다.
