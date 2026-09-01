# 관리자 접속기록 — 운영 적용 (2026-09-01)

> **상태: 운영·스테이징에 적용됨. 저장소에는 마이그레이션 파일 미반영(드리프트 있음).**
>
> 마이그레이션을 `supabase/migrations/` 에 넣으면 successor 릴리스 핀이 어긋나고
> 매니페스트 sha256 이 바뀌어, Vercel `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION`
> 을 같이 갱신하지 않으면 **프로덕션 빌드가 통째로 죽는다**(이 저장소에 실제 이력이
> 있고, 직전 빌드가 계속 서비스돼 겉보기엔 멀쩡하다). 출시일이라 그 지뢰를 밟지
> 않았다. 같은 이유로 미뤄진 건이 하나 더 있다 —
> `PENDING_ACHIEVEMENTS_RLS_2026-08-28.md`. **다음 릴리스에서 둘을 함께 정식화한다.**

## 왜 만들었나

관리자 API 32개 라우트가 `apps/web/src/lib/utils/adminAuth.ts` 의 `verifyAdmin()`
하나를 거쳐 회원 정보를 연다(고객·예약·게시글·신고·업체·가격). 그런데 누가 언제
무엇을 열었는지 남는 곳이 하나도 없었다.

2026-09-01 운영 실측:

```
auth.audit_log_entries                    0 행
접속기록 전용 테이블                        없음
admin_access_log / adminAuditLog 참조      0 건
```

개인정보 처리방침 제3조는 접속·보안 기록 보유기간을 "출시 전에 확정하여
고지합니다" 로 비워 둔 상태였는데, 적을 대상 자체가 없었다.

## 적용한 SQL

`admin_access_log` 테이블(+ 인덱스 2개, RLS on·정책 0개, service_role 만 GRANT)과
`purge_admin_access_log(INTERVAL)` 함수. 전문은 이 커밋의
`docs/operations/` 히스토리 또는 아래 되돌리기와 짝을 이룬다.

핵심 결정:

- **정책을 하나도 만들지 않는다.** RLS 가 켜져 있고 정책이 없으면 anon·
  authenticated 는 아무것도 못 한다. 관리자 자신도 앱을 통해 자기 접속기록을
  지울 수 없어야 감사 기록으로서 뜻이 있다.
- 담는 것은 `admin_id` · `method` · `path` · `accessed_at` 넷뿐이다. 요청 본문·
  응답·조회된 회원 정보는 담지 않고, 경로도 `pathname` 만 쓴다(질의문자열에는
  검색어가 들어오고 그것은 종종 사람 이름이다).

## 리허설과 검증

스테이징(`rgxdizztidbgwnsbadml`)에서 먼저 적용하고 파기가 실제로 도는지 확인했다.

```
400일 된 행 1 · 10일 된 행 1 을 심고
purge_admin_access_log(interval '365 days')  ->  deleted = 1
남은 것: 10일 된 행만
```

그 뒤 운영(`slrtobkksjmxgzatjyqb`)에 적용했다.

```
적용 전:  table_exists=0  purge_fn=0
적용 후:  table_exists=1  policies=0  grantees=postgres,service_role  purge_fn=1
```

## 되돌리기

```sql
DROP FUNCTION IF EXISTS public.purge_admin_access_log(INTERVAL);
DROP TABLE IF EXISTS public.admin_access_log;
```

되돌리면 처방침 제3조의 "관리자가 회원 정보에 접근한 기록은 1년간 보관" 이
거짓이 되므로, **그 문장도 같이 되돌려야 한다.** 코드 쪽 검사
(`app/privacy/__tests__/retentionNoticeMatchesCode.test.ts`)가 문서와 크론이
어긋나면 빨개지지만, DB 를 지우는 것까지는 보지 못한다.

## 남은 것

- 마이그레이션 정식화(위 상태 참고).
- 접속기록을 **점검**하는 절차는 아직 없다. 안전성 확보조치 기준은 보관만이
  아니라 정기 점검도 요구한다. 지금은 기록만 쌓인다.
- 이 기간(1년)이 우리 서비스에 맞는 기준인지는 법률 확인이 필요하다.
