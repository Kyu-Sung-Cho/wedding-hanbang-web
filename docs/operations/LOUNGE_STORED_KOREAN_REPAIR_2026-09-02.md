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

### 2026-09-02 QA 재검이 좁혀 준 것

- **한 계정에서만 보인다**(`퇴근후결혼준비`). 다른 계정의 일정 화면은 멀쩡했다.
- **라운지는 대체로 깨끗하고, 일정 화면과 채팅 기록에 남아 있다.**

두 사실이 원인을 좁힌다. 계정마다 다르다는 것은 **코드가 아니라 그 계정의 저장된
행**이 깨졌다는 뜻이다. 그리고 라운지가 깨끗한 이유는 라운지가 다가오는 일정
서너 개만 보여주기 때문이다 — 깨진 옛 기록은 전부를 보여주는 일정 화면과 채팅
기록에만 나온다. 화면이 서로 다른 것이 아니라 **보는 범위가 다르다.**

여기서 처음 수정이 놓친 것이 드러났다. 채팅 기록(`chat_messages`)은 되돌리기가
**한 번도 지나가지 않는 길**이었다. 일정과 아모라 기록만 고쳤다.

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
| **채팅 기록** | `apps/web/src/stores/chatStore.ts` (`dbRowToMessage`) | 웹 채팅 — 최초 적재·폴링·실시간 |
| **앱 채팅 기록** | `apps/mobile/app/(tabs)/chat.tsx` (`chatMessageFromRealtimeRow`) | 앱 채팅 — 적재·실시간 |
| **저장한 이야기** | `apps/web/src/app/api/amora/notes/route.ts` (GET) | 웹 `/saved` |
| 앱 일정 | `apps/mobile/app/schedule/index.tsx`, `apps/mobile/app/(tabs)/lounge.tsx` | 앱이 Supabase 에서 직접 읽는 경로 |

### 되돌리기는 검증보다 **앞**에 온다

처음에는 검증 뒤에 뒀는데, 그러면 고칠 수 있는 것을 못 고친다. 잘못 읽힌 한글에는
0x80~0x9F 자리 글자가 거의 반드시 들어가고 그 자리는 C1 제어문자다. 일정의 취소
사유·완료 기준·외부 담당자 이름은 `hasUnsafeDisplayCharacter` 를 지나므로, 그 셋 중
하나가 깨져 있으면 **그 일정 전체가 검증에서 탈락해 화면에서 아예 사라졌다.**

먼저 되돌리면 그 일정이 되살아나고, 검증은 되돌린 값에 대해 그대로 돈다. 되돌리기가
바이트 왕복이 맞을 때만 값을 바꾸므로 검증이 느슨해지지 않는다.

되돌리기 규칙은 `packages/shared/src/utils/textEncodingRepair.ts` 하나다. 세 조건이
**모두** 맞을 때만 바꾼다.

1. 문자열의 모든 글자가 한 바이트로 되돌아간다(Latin-1 또는 CP1252 범위).
2. 그 바이트열이 **엄격한** UTF-8 로 읽힌다 — 과잉 인코딩·잘린 시퀀스·서로게이트
   값은 전부 거절한다.
3. 읽어낸 결과에 한글이 있다.

한글이 한 글자라도 섞여 있으면 1번에서 자동으로 걸린다(한글은 한 바이트로 안
돌아간다). 그래서 멀쩡한 제목과 절반만 깨진 제목은 **건드리지 않는다.**

되살릴 수 없는 잔해(`?? ???`)는 **제목 자리**에서 물러나고 「제목을 읽지 못한
일정 / 기록」이라고 말한다. 라운지와 일정 화면이 같은 문구를 쓴다 — 한쪽만
정직하면 사용자는 같은 일정을 두 화면에서 다르게 본다. 물음표가 붙었다는 이유만으로
감추지는 않는다. 읽을 글자(`\p{L}`·`\p{N}`)가 하나도 안 남았을 때만 물러나므로
`D-DAY??` 는 그대로 나온다.

**수정 창은 저장된 원래 값을 연다.** 안내문이 입력칸에 미리 들어가면 사용자가
그것을 저장해 버린다. 지금 상태에서 사용자가 스스로 고치는 길은 이것이다 — 일정
화면에서 그 줄을 열어 제목을 다시 적으면 그 행은 깨끗해진다.

**대화 말풍선은 바꿔치지 않는다.** 되돌릴 수 있으면 되돌리고, 되돌릴 수 없으면 있는
그대로 둔다. 말풍선은 두 사람이 나눈 기록이고, 일부가 깨졌다고 통째로 안내문으로
갈아끼우면 남아 있는 정보까지 사라진다.

**이 수정은 저장된 값을 바꾸지 않는다.** 다만 되돌린 목록을 그대로 다시 저장하는
경로(일정 편집 → `saveProgress`)를 지나면 되돌린 값이 함께 저장돼 그 행은 다음부터
깨끗해진다.

## 남은 일 — 저장된 값 진단

되돌릴 수 있는 것은 화면에서 이미 되돌아온다. 남은 질문은 **`?` 로 잃어버린 행이
실제로 몇 개인가**이고, 그것은 저장된 바이트를 봐야 안다.

### 1단계 — 읽기 전용 진단

읽기 전용이며 사용자 원문을 밖으로 내보내지 않는다. 결과는 문서·Git·채팅에
붙여넣지 않는다(개인정보 경계).

QA 가 한 계정을 지목했으므로(`퇴근후결혼준비`) **그 커플부터** 센다. 전체를 먼저
세면 한 계정의 문제가 큰 수 안에 묻힌다.

```sql
-- 채팅 기록. QA 가 지목한 화면이므로 여기부터 본다.
SELECT
  count(*) FILTER (WHERE content LIKE '%??%')      AS question_marks,
  count(*) FILTER (WHERE content LIKE '%' || U&'\FFFD' || '%') AS replacement_chars,
  count(*)                                          AS total
FROM public.chat_messages
WHERE couple_id = '<couple>';
```

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
| `packages/shared/src/utils/__tests__/textEncodingRepair.test.mjs` | 되살릴 수 있는 것만 정확히 되살리고, 멀쩡한 글·라틴 글자·사람이 쓴 물음표는 건드리지 않는다. 깨진 UTF-8 바이트열(잘림·과잉 인코딩·서로게이트)을 조용히 통과시키지 않는다. 중첩된 값과 상한, ASCII 지름길도 함께 |
| `apps/web/src/utils/__tests__/storedKoreanSurvivesToTheLounge.test.ts` | 일정·아모라 기록의 읽는 길목이 유지되고, 깨진 필드 때문에 일정이 목록에서 사라지지 않으며, 라운지와 일정 화면이 같은 문구로 물러난다. 수정 창은 저장된 원래 값을 연다 |
| `apps/web/src/stores/__tests__/chatHistoryKeepsItsKorean.test.ts` | 채팅 기록을 읽어 오는 세 길이 모두 되돌리기를 지나고, 대화 본문은 안내문으로 바뀌지 않는다 |
| `apps/mobile/src/__tests__/chatStream.test.mjs` | 앱의 기록 적재·실시간 수신도 같은 길을 지난다(흉내가 아니라 진짜 구현을 주입해서 잰다) |

## 사용자가 지금 할 수 있는 것

되살릴 수 없는 행은 코드가 못 고친다. 다만 화면이 그것을 숨기지 않으므로 사용자는
어디가 깨졌는지 보고 **일정 화면에서 그 줄을 열어 제목을 다시 적을 수 있다.** 다시
적은 값은 정상으로 저장되고 그 행은 그것으로 끝난다.

채팅 기록은 지난 대화라 다시 적을 수 없다. 그 계정의 깨진 대화가 몇 줄인지는 위
1단계 질의로 세고, 일괄 처리 여부는 그 수를 보고 판단한다.
