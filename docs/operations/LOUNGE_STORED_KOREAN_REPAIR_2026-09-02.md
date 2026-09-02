# 라운지에 깨져 보이던 한글 — 무엇을 코드로 고쳤고 무엇이 데이터에 남았나 (2026-09-02)

> **상태: 코드 수정은 이 PR 에 있음. 저장된 값의 일괄 복구는 아직 하지 않았음(진단
> 먼저).**
>
> 운영 DB 에 이 문서만 보고 쓰기를 하지 않는다. `AGENTS.md` 의 운영 DB 규칙대로
> 승인된 릴리스 매니페스트·컨트롤러 경로로만 적용한다.

## 무엇이 보였나

로그인한 라운지에서 다가오는 일정 제목, 일정 관련 문구, 아모라 기록 제목이
`?? ???` 로 보였다. **새로 저장한 한글은 멀쩡했다.** 그러면 깨진 것은 읽는
방법이거나 이미 저장돼 있는 값이다.

## 깨짐은 두 종류이고 성질이 다르다

| 종류 | 어떻게 생기나 | 되살릴 수 있나 |
|---|---|---|
| **잘못 읽음** | UTF-8 로 저장된 바이트를 Latin-1/CP1252 로 읽음. 한글 한 글자가 라틴 글자 두세 개로 보인다 | **된다.** 글자가 하나도 사라지지 않았고 읽는 방법만 틀렸다 |
| **잃어버림** | 한글을 표현하지 못하는 문자집합으로 한 번 변환됨. 음절 하나가 `?` 하나로 뭉개진다. U+FFFD(``)도 같다 | **안 된다.** 원문 바이트가 이미 없다 |

`?? ???` 는 두 번째다. 첫 번째는 화면에서 되돌릴 수 있고, 두 번째는 어떤 코드도
되돌리지 못한다. 그래서 코드는 **되살릴 수 있는 것만 되살리고, 되살릴 수 없는
것은 되살린 척하지 않는다.**

## 저장소에서 찾지 못한 것 (UNVERIFIED)

현재 코드에서 **한글을 `?` 로 만드는 쓰기 경로는 찾지 못했다.** 확인한 범위:

- `supabase/migrations`·`supabase/platform-operations`·`scripts/sql` 에서
  `progress`·`__events`·`amora_actions.title` 을 만지는 모든 구문. `left()`·
  `char_length()` 는 **글자 단위**라 UTF-8 을 자르지 않고, `convert_to(...,'UTF8')`
  는 전부 해시 계산용이라 사용자 문자열로 되돌아가지 않는다.
- 웹의 쓰기 경계. `/api/chat`·`/api/journey` 는
  `new TextDecoder("utf-8", { fatal: true })` 로 읽으므로 깨진 UTF-8 은 400 으로
  **거절**된다 — 조용히 `?` 로 바뀌지 않는다.
- `btoa`/`atob`·바이트 단위 자르기·헤더에 한글 싣기: 제목 경로에 없음.

그래서 현재 가설은 **오늘의 코드가 아니라 과거에 저장된 값**이다. 이 가설은
아래 진단 질의로만 확정된다. 확정 전까지 이 문서의 원인 서술은 `UNVERIFIED` 다.

## 코드로 고친 것

되돌리기를 **읽는 자리 한 곳씩**에 뒀다.

| 자리 | 파일 | 무엇이 지나가나 |
|---|---|---|
| 일정 | `apps/web/src/utils/scheduleEvents.ts` (`inspectScheduleEvents`) | 웹 라운지·일정 화면·채팅 옆판 |
| 아모라 기록 | `apps/web/src/lib/amora/actions.ts` (`normalizeAmoraAction`) | 웹 라운지 + `/api/amora/actions` 를 지나는 앱 목록 |
| 앱 일정 | `apps/mobile/app/schedule/index.tsx`, `apps/mobile/app/(tabs)/lounge.tsx` | 앱이 Supabase 에서 직접 읽는 경로 |

되돌리기 규칙은 `packages/shared/src/utils/textEncodingRepair.ts` 하나다. 세 조건이
**모두** 맞을 때만 바꾼다.

1. 문자열의 모든 글자가 한 바이트로 되돌아간다(Latin-1 또는 CP1252 범위).
2. 그 바이트열이 **엄격한** UTF-8 로 읽힌다 — 과잉 인코딩·잘린 시퀀스·서로게이트
   값은 전부 거절한다.
3. 읽어낸 결과에 한글이 있다.

한글이 한 글자라도 섞여 있으면 1번에서 자동으로 걸린다(한글은 한 바이트로 안
돌아간다). 그래서 멀쩡한 제목과 절반만 깨진 제목은 **건드리지 않는다.**

되살릴 수 없는 잔해(`?? ???`)는 제목 자리에서 물러나고 라운지가 「제목을 읽지
못한 일정 / 기록」이라고 말한다. 물음표가 붙었다는 이유만으로 감추지는 않는다 —
읽을 글자(`\p{L}`·`\p{N}`)가 하나도 안 남았을 때만 물러난다. `D-DAY??` 는 그대로
나온다.

**이 수정은 저장된 값을 바꾸지 않는다.** 다만 되돌린 목록을 그대로 다시 저장하는
경로(일정 편집 → `saveProgress`)를 지나면 되돌린 값이 함께 저장돼 그 행은 다음부터
깨끗해진다.

## 남은 일 — 저장된 값 진단

되돌릴 수 있는 것은 화면에서 이미 되돌아온다. 남은 질문은 **`?` 로 잃어버린 행이
실제로 몇 개인가**이고, 그것은 저장된 바이트를 봐야 안다.

### 1단계 — 읽기 전용 진단

읽기 전용이며 사용자 원문을 밖으로 내보내지 않는다. 결과는 문서·Git·채팅에
붙여넣지 않는다(개인정보 경계).

```sql
-- 잔해가 몇 행인가. 원문은 세지 않고 개수만 본다.
SELECT
  count(*) FILTER (WHERE evt ->> 'title' LIKE '%??%')      AS question_marks,
  count(*) FILTER (WHERE evt ->> 'title' LIKE '%' || U&'\FFFD' || '%') AS replacement_chars,
  count(*)                                                  AS total
FROM public.wedding_journeys,
     LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(progress -> '__events') = 'array'
            THEN progress -> '__events' ELSE '[]'::jsonb END
     ) AS evt;

SELECT
  count(*) FILTER (WHERE title LIKE '%??%')      AS question_marks,
  count(*) FILTER (WHERE title LIKE '%' || U&'\FFFD' || '%') AS replacement_chars,
  count(*)                                        AS total
FROM public.amora_actions;
```

### 2단계 — 어떤 종류인지 가른다

한 행의 바이트를 본다(사람이 읽을 수 있는 원문 대신 hex 로).

```sql
SELECT encode(convert_to(evt ->> 'title', 'UTF8'), 'hex') AS utf8_hex,
       length(evt ->> 'title')       AS char_len,
       octet_length(evt ->> 'title') AS byte_len
FROM public.wedding_journeys,
     LATERAL jsonb_array_elements(progress -> '__events') AS evt
WHERE evt ->> 'title' LIKE '%??%'
LIMIT 3;
```

| hex 모양 | 뜻 | 조치 |
|---|---|---|
| `3f` 가 반복 | 문자집합 변환으로 `?` 가 **저장됐다** | 되살릴 수 없다. 3단계 |
| `efbfbd` | U+FFFD 가 저장됐다 | 되살릴 수 없다. 3단계 |
| 정상 한글 UTF-8 인데 화면만 깨짐 | 표시·글꼴 문제 | 이 문서 밖의 문제 |
| 라틴 글자 UTF-8 인데 되읽으면 한글 | **잘못 읽음** | 코드가 이미 되돌린다. 조치 불필요 |

### 3단계 — 되살릴 수 없는 행을 어떻게 할 것인가

**지우지 않는다.** 값은 사용자의 기록이고, 지우면 그 사람은 무엇이 있었는지조차
알 수 없다. 화면은 이미 「제목을 읽지 못한 …」 이라고 말하므로 사용자는 그 줄을
열어 제목을 다시 적을 수 있다.

일괄 쓰기가 필요하다고 판단되면 다음을 **먼저** 갖춘다(`AGENTS.md` 운영 DB 규칙):

- 대상 Supabase URL·project ref 확인과 명시적 production confirmation
- DB 백업과 복구 검증
- 승인된 릴리스 매니페스트/컨트롤러 경로(`supabase:release:apply`)
- rollback artifact

`supabase db push` 나 임의 SQL write 로 진행하지 않는다.

## 되돌아오지 않게 막는 것

| 검사 | 무엇을 고정하나 |
|---|---|
| `packages/shared/src/utils/__tests__/textEncodingRepair.test.mjs` | 되살릴 수 있는 것만 정확히 되살리고, 멀쩡한 글·라틴 글자·사람이 쓴 물음표는 건드리지 않는다. 깨진 UTF-8 바이트열(잘림·과잉 인코딩·서로게이트)을 조용히 통과시키지 않는다 |
| `apps/web/src/utils/__tests__/storedKoreanSurvivesToTheLounge.test.ts` | 일정·아모라 기록의 읽는 길목이 유지되고, 라운지가 잔해를 제목인 척 그리지 않는다 |
