# 탈퇴 접수를 켜는 순서 (2026-09-02)

**파운더 결정**: "탈퇴 제대로 끝내고 열자" · 웹 기준 출시.

이 문서는 **되돌리기 어려운 순서**를 다룬다. 켜는 순간부터 사용자가 자기 계정을
지울 수 있고, 그건 되돌릴 수 없다. 순서를 지키지 않으면 **계정은 지워지는데
기록이 안 남거나, 사진이 안 지워졌는데 지웠다고 말하게** 된다.

---

## 0. 켜기 전에 반드시 확인할 것

| 확인 | 방법 | 왜 |
|---|---|---|
| `RESEND_API_KEY` 가 운영에 살아 있는가 | 스테이징 수신 확인 또는 운영 env 확인 | 없으면 법이 요구하는 삭제 결과 통지가 **한 번도 안 나간다**. 코드는 그때 Sentry 로 알리지만, 켜기 전에 아는 편이 낫다 |
| 마이그레이션 4개가 운영에 적용됐는가 | 아래 1단계 후 SQL 확인 | 하나라도 빠지면 그 자리에서 탈퇴가 멈춘다 |
| 매니페스트 서명이 갱신됐는가 | 프로덕션 빌드 성공 | 안 하면 빌드가 `next build` 전에 죽는데 **직전 배포가 계속 서비스돼 안 보인다** |

값을 되읽을 수 없는 항목(`RESEND_API_KEY`, 서명)은 **동작으로만** 확인된다.

---

## 1. DB 마이그레이션 4개를 운영에 적용 (순서 중요)

스테이징에서 전부 리허설을 마쳤다. 운영 적용 순서는 파일명 순서와 같다.

| # | 파일 | 무엇을 고치나 | 안 하면 |
|---|---|---|---|
| 1 | `20260902120000_leaving_does_not_erase_the_partner_memory.sql` | 한쪽이 떠나도 배우자의 공유 기억이 남는다 | 첫 탈퇴에서 남은 배우자가 예산·갈등 케어를 **통보 없이** 잃는다 |
| 2 | `20260902130000_deletion_ledger_can_actually_be_written.sql` | `account_deletions.user_id` 를 nullable 로 | **원장 기록이 100% 실패**한다. 계정은 지워지는데 작업이 영원히 "처리 중" 이고 탈퇴자 UUID 가 DB 에 남는다 |
| 3 | `20260902140000_deletion_result_is_actually_told.sql` | 결과 통지 컬럼·함수 | 법이 요구하는 통지를 못 보낸다(개인정보 보호법 제36조 2항) |
| 4 | `20260902150000_own_chat_photos_are_deletable.sql` | 자기 사진 소유 증명 + 옛 2단 경로 | 사진 올린 계정이 **검토 대기에 갇히고**, 그걸 푸는 앱 경로가 없다 |

각 파일 상단에 왜 그렇게 했는지와 되돌리는 방법이 적혀 있다.
`docs/operations/PARTNER_MEMORY_SURVIVES_LEAVING_2026-09-02.md` 에 1번의 롤백 SQL 이 있다.

**적용 후 확인**:

```sql
SELECT
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_name='account_deletions' AND column_name='user_id') AS ledger_nullable,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='account_deletion_jobs'
      AND column_name IN ('notice_email','notice_sent_at','notice_attempts')) AS notice_cols,
  to_regprocedure('public.chat_photo_belongs_to_user(uuid,text)') IS NOT NULL AS proof_fn,
  (SELECT pg_get_functiondef(oid) LIKE '%v_bride_arrived%'
     FROM pg_proc WHERE proname='reset_amora_memory_after_membership_change') AS trigger_narrowed;
```

기대: `YES · 3 · true · true`

---

## 2. 릴리스 핀과 Vercel 서명

마이그레이션을 넣으면 릴리스 매니페스트가 바뀐다. **세 가지를 함께** 해야 한다.

1. `supabase/release-manifests/vendor-disclosure-v2-20260718.json` 에 새 파일 4개 등록
2. `scripts/tests/release-manifest-signature-pin.test.mjs` 의 `EXPECTED_SIGNATURE` 갱신
3. Vercel Production `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` 을 **같은 값**으로

`node --test ./scripts/tests/release-manifest-signature-pin.test.mjs` 가 새 값을 알려준다.
**1·2 만 하고 3 을 빠뜨리면 프로덕션 빌드가 죽는데, 직전 배포가 계속 서비스돼서
사이트는 멀쩡해 보인다.** 이 저장소에서 실제로 겪은 사고다.

---

## 3. 병합과 배포

PR 을 `main` 에 병합하고 **프로덕션 빌드가 성공하는 것을 확인**한다.
프리뷰 빌드 통과는 아무것도 증명하지 않는다 — 서명 검사는 `VERCEL_ENV=production`
일 때만 돈다(`scripts/check-amora-build-env.mjs:6`).

---

## 4. 플래그 두 개를 **함께** 켜고 재배포

```
ACCOUNT_DELETION_INTAKE_ENABLED = true
ACCOUNT_DELETION_CRON_ENABLED   = true
```

**하나만 켜면 안 된다.** 접수만 켜면 요청은 쌓이는데 아무도 처리하지 않아
사용자가 "처리 중" 을 영원히 본다. 빌드 게이트가 그 조합을 막지만
(`check-amora-production-env.mjs` 의 `accountDeletionWorkerFollowsIntake`),
**env 만 바꾸고 재배포하지 않으면 이미 배포된 함수는 옛 값을 계속 읽는다.**

`vercel env ls` 의 타임스탬프는 생성 시각이라 갱신 판정에 쓸 수 없다.

켜는 순간 처리방침 제6조와 약관 제10조 문장이 **자동으로 바뀐다** —
두 문서가 앱과 같은 함수(`accountDeletionIntakeSentence`)에서 문장을 받는다.

---

## 5. 켠 직후 운영에서 확인

1. **직접 한 계정을 만들어 끝까지 지워 본다.** 초록불은 운영을 증명하지 않는다.
2. SQL 로 확인:

```sql
SELECT status, count(*) FROM public.account_deletion_jobs GROUP BY 1;
SELECT count(*) AS rows, count(user_id) AS with_id, count(email) AS with_email
FROM public.account_deletions;
```

기대: 작업이 `completed`, 원장에 한 줄이 늘고 **`with_id` 와 `with_email` 은 0**.

3. `/privacy` 와 `/terms` 를 **브라우저에서** 열어 탈퇴 문장이 "설정 페이지에서
   직접 신청" 으로 바뀌었는지 본다(프리렌더 HTML 이 아니라 실제 화면).
4. 결과 통지 메일이 실제로 도착하는지 본다.
5. 크론이 200 을 내는지, `manual_review` 가 0 인지 본다.

---

## 알고 넘어가는 것

- **참조 없는 옛 사진 1개**(2026-03-17)는 어떤 메시지도 안 가리켜 소유를 증명할 수
  없다. 그 커플이 탈퇴하면 `manual_review` 로 가고 사람이 봐야 한다. 주인을 알 수
  없는 파일을 자동으로 지우지 않는 것이 옳다.
- **살아 있는 옛 사진 5개**(2026-07-07)는 지금 대화에 보인다. 4번 마이그레이션이
  2단 경로를 받게 하므로 주인이 탈퇴할 때 정상적으로 지워진다. **손으로 지우면
  안 된다** — 지우면 그 대화에서 사진이 깨진다.
- **접수 후 취소가 없다.** 유예 기간도, 취소 API 도 없다. 오조작이면 그대로 끝이다.
  되돌릴 수 없는 행동에 재인증(비밀번호 재확인)도 없다 — 세션만 있으면 된다.
  둘 다 오늘 범위 밖이고, 켜기 전에 알고 있어야 할 사실이다.
- **모바일**은 확인 문구도 사유 선택도 없이 Alert 두 번이면 삭제 요청이 나간다.
  플래그는 서버 값이라 **이미 배포된 앱 빌드에도 즉시 적용된다** — 앱 업데이트를
  기다려 주지 않는다. 다만 앱이 두 스토어에 없어 오늘 사용자 영향은 0이다.
