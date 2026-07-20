# 예약 일정·예산 projection 운영 가이드

> **상태: 코드·migration 후보 구현 및 로컬 검증, 운영 migration·cron 배포 NOT RUN.**
> 아래 cron과 replay RPC는 1020 migration, fenced 배포, 운영 검증이 끝난 뒤의 계약이다.
> 현재 실행 중인 기능으로 해석하거나 운영에서 독립 실행하지 않는다. 현행 상태는
> `CURRENT_WORKSPACE_HANDOFF_2026-07-20.md`를 따른다.

예약 원장은 `vendor_bookings`이고, 일정·예산은 `wedding_journeys.progress`에 투영됩니다. 예약 생성·취소·실결제 금액 변경 트랜잭션의 trigger가 `booking_projection_jobs`에 원하는 최종 상태를 함께 기록하므로, 웹 요청이 중간에 종료되어도 반영 작업은 사라지지 않습니다. 완료 결과의 `actual_amount`가 있으면 견적 `amount`보다 우선하는 canonical 예산 기여액으로 사용합니다.

## 상태와 재시도 경계

- `pending`: 실행 대기 또는 backoff 중입니다.
- `processing`: 최대 300초 lease로 한 worker가 처리 중입니다. 같은 커플은 동시에 하나만 처리합니다.
- `completed`: 해당 booking의 최신 `generation`이 일정·예산에 반영됐습니다.
- `failed`: 8회 실패한 terminal 상태입니다. 자동 재시도하지 않으며 운영 확인 후 명시적으로 replay해야 합니다.

실패 backoff는 5초부터 지수 증가하고 최대 15분입니다. Vercel cron `/api/cron/booking-projections`가 5분마다 최대 40건을 처리합니다. terminal 실패가 하나라도 남아 있으면 cron은 HTTP 503과 `queue.failed`를 반환해 정상으로 숨기지 않습니다.

worker가 claim한 `generation`과 `claim_token`은 일정·예산을 쓰기 전에 DB에서 다시 검증합니다. 유효한 투영의 `wedding_journeys.progress` 변경과 job의 `completed` 전환은 같은 트랜잭션에서 커밋됩니다. 따라서 생성 작업을 처리하는 도중 취소가 들어와도 오래된 생성 투영이 나중에 일정을 되살릴 수 없습니다. `__booking_costs`는 `{ amount, categoryKey }`를 저장하며, 이전 숫자 형식도 읽습니다. 일정 이벤트가 누락된 상태에서 업체 카테고리가 바뀌어도 원래 카테고리의 금액을 정확히 되돌릴 수 있습니다.

## 사용자에게 보이는 계약

예약 원장 저장은 성공했지만 projection이 지연되면 생성 API는 HTTP 202와 `bookingAccepted: true`, 결과 API는 `outcomeAccepted: true`를 반환하며 둘 다 `fullyApplied: false`, `projection.status: "pending_retry"`를 명시합니다. 아모라 도구와 예약 카드도 “예약/취소 요청을 다시 보낼 필요가 없다”고 안내합니다. 완료 결과에서도 “결과를 다시 입력할 필요가 없다”고 안내합니다. 사용자가 같은 원장 변경을 반복하도록 유도하면 안 됩니다.

## 점검

서비스 역할로 다음 RPC를 사용합니다.

```sql
select public.get_booking_projection_queue_stats();
```

개별 실패 원인은 PII가 없는 `last_error_code`로만 보관합니다.

```sql
select booking_id, desired_state, generation, status,
       attempt_count, available_at, last_error_code, updated_at
from public.booking_projection_jobs
where status <> 'completed'
order by updated_at asc;
```

## terminal 실패 replay

원인을 해결하고 booking ID와 현재 원장 상태를 확인한 후에만 실행합니다.

```sql
select public.retry_booking_projection_job('00000000-0000-0000-0000-000000000000'::uuid);
```

`failed` 행만 `pending`으로 되돌리고 attempt를 0으로 초기화합니다. 이미 `completed`이거나 실행 중인 행은 건드리지 않습니다.

## 배포·롤백

1. `20260716102000_booking_projection_outbox.sql`을 먼저 적용합니다.
2. 그다음 웹 코드를 배포해 즉시 처리와 cron을 활성화합니다.
3. 배포 후 queue stats, cron 200 응답, `failed = 0`을 확인합니다.

웹 코드만 롤백할 때 migration과 outbox 행은 유지합니다. trigger가 계속 작업을 보존하므로 원인을 수정한 worker를 재배포할 수 있습니다. 원인 확인 없이 table/function/trigger를 삭제하면 복구 경계가 사라집니다.
