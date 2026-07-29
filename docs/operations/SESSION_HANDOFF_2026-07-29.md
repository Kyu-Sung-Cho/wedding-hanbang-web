# 세션 인계 — 2026-07-29 (웨딩코드 v0.6 · 오늘 한 마디)

다른 컴퓨터에서 이어받을 때 **이 문서를 먼저 읽는다.** 방향과 함정만 적었고, 판정 근거는
각 커밋 메시지와 PR에 있다.

## 1. 지금 `main`에 있는 것

| 표면 | 경로 | 상태 |
|---|---|---|
| 오늘 한 마디 | `apps/web/src/app/today/`, `apps/web/src/lib/todayOneLine/` | main 반영. 세 장 뽑기, 날짜 회전 |
| 웨딩코드 v0.6 | `apps/web/src/app/wedding-code/`, `apps/web/src/constants/weddingCodeV06.ts`, `apps/web/src/lib/weddingCode/v06/` | main 반영. 16문항 → 차이 지도 |

관련 PR: [#75](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/75) (오늘 한 마디),
[#76](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/76) (웨딩코드 v0.6).

## 2. 웨딩코드 v0.6 — 무엇을 바꿨고 왜 그렇게 했나

### 파운더가 원한 것

> "자신들의 웨딩성향을 파악하게 해서 서로 공유하고 조합도 봐주고 해서 여러가지 인사이트를
> 줄 수 있을거라 생각했는데"

### v0.5가 죽어 있던 지점 (실측)

- `/wedding-code`는 **안내 카드 한 장**이었다. 16문항을 렌더하는 `WeddingCodeClient.tsx`를
  아무도 import하지 않았고 `api/wedding-code/{pair,couple-report}`는 410이었다.
- 문항에 결혼이 없었다. D1은 결혼 단어 0개, B1·B3·B4는 「업체나 장소」 자리표시어.
- 16문항이 전부 「가장 먼저 확인할 것은?」 한 틀. 선택지 64개가 전부 옳은 행동.
- 개인 결과의 개인화가 하드코딩 12문장 중 1개 + 축 이름 1개뿐이고 **사용자가 고른 문구를
  한 번도 인용하지 않았다.**
- 커플 비교가 `firstAnswer === secondAnswer` 한 줄. 조언은 상대 답과 무관한 상수.
- 균등 무작위 응답에서 지원 순서가 우측 59.4%로 기울었다.

### v0.6의 핵심 결정

**성격을 주장하지 않는다.** 점수·유형·궁합·등급을 계산하지도 보여주지도 않는다. 두 사람이
실제로 고른 문장을 그대로 인용하고, 그 차이가 결혼 준비 일정에서 언제 또 나오는지만 말한다.
「너는 "삼백이면 신혼여행 한 번인데", 나는 "여기 아니면 두고두고 아쉬울 것 같았다"」는 심리
측정 결과가 아니라 두 사람이 방금 남긴 사실이다. **검증할 주장이 없으므로 R0~R4 인간 검증
게이트의 대상이 아니고, 그래서 화면을 열 수 있었다.** 이 논리가 무너지면 화면을 다시 닫아야
한다 — 유형·점수·궁합을 다시 넣는 변경은 그 판단을 되돌리는 것이다.

**로그인·저장·대기를 없앴다.** 답 16개를 URL에 싣는다(`/wedding-code?a=<16글자>&b=<16글자>`).
서버에 아무것도 저장하지 않는다.

### 이어서 할 때 깨면 안 되는 불변식

전부 테스트가 강제한다(`src/constants/__tests__/weddingCodeV06.test.ts`,
`src/lib/weddingCode/v06/__tests__/`). 테스트를 고쳐서 통과시키지 말 것 — 아래가 이유다.

1. **문항마다 좌 2 : 우 2, 같은 크기.** 안 지키면 축이 기운다.
2. **좌우 배치를 한 패턴으로 굳히지 않는다.** 첫 판은 16문항 전부 LLRR(왼쪽이 항상 A·B칸)
   이었다. 가중치가 완벽히 균형이어도 **상단 선택 편향**이 축 방향과 겹쳐 실제 응답이 쏠린다.
   지금은 축마다 LLRR/LRLR/RRLL/RLRL 4패턴으로 돌아간다.
3. **창피한 답을 마지막 칸에 몰지 않는다.** 첫 판은 8개 중 6개가 D칸(가장 안 눌리는 자리)이었다.
4. **장면에 결혼 고유어가 있어야 하고 자리표시어를 쓰지 않는다.**
5. **장면이 한쪽 시점으로 고정되면 안 된다.** 두 사람이 같은 문항에 답하므로
   「드레스는 내가, 예식장은 네가」는 상대가 답을 고를 수 없는 기능 결함이다.
6. **선택지는 혼자 떼어놔도 말이 되는 1인칭 문장.** 결과 화면이 그대로 인용한다.
7. **방향이 같으면 갈림으로 세지 않는다.** 같은 편 두 선택지를 갈등으로 보여주면 없는 싸움을 만든다.
8. **망가진 코드에 기본값을 채우지 않는다.** 고르지도 않은 답이 「상대는 이렇게 답했어요」로
   뜨는 것이 이 제품에서 제일 나쁜 버그다.
9. **결과 상위 N을 그냥 자르지 않는다.** 가장 많이 갈린 축이 화면을 독차지해 같은 문장이
   세 번 반복된다. `topGapsForDisplay`가 축마다 하나씩 집는다.

### 함정: 자동으로 통과하는 테스트

「균등 무작위 응답이 50:50」은 좌 2 : 우 2에서 **자동으로 따라 나오는 항등식**이라 아무것도
증명하지 못한다. 그래서 지웠다. 편향을 실제로 막는 건 위 2번(배치 다양성)이다.

## 3. 로컬에서 띄우는 법 (이게 제일 자주 막힌다)

`apps/web/.env.local`에 **실제 프로덕션 service_role 키**가 들어 있으면 destination fence가
부팅을 막는다(정상 동작). **핀을 프로덕션에 맞추지 말 것** — 로컬 dev가 운영 DB에
service_role로 붙는다. 대신 그 실행에만 자격증명 없는 가짜 값을 주입한다:

```
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co
SUPABASE_EXPECTED_URL=https://abcdefghijklmnopqrst.supabase.co
SUPABASE_EXPECTED_PROJECT_REF=abcdefghijklmnopqrst
SUPABASE_PRODUCTION_PROJECT_REF=zyxwvutsrqponmlkjihg
SUPABASE_PRODUCTION_WRITE_CONFIRM=
SUPABASE_SERVICE_ROLE_KEY=<ref가 abcdefghijklmnopqrst인 서명 없는 HS256 JWT>
```

`/today`와 `/wedding-code`는 Supabase를 건드리지 않으므로 이 상태로 충분하다.
`.claude/launch.json`의 `web` 구성이 이 값을 주입해서 띄운다. 자세한 내용은
`docs/wedding-code/63_today_one_line_design_plan_2026-07-28.md` §14-4.

**dev 서버를 강제 종료하면 락 파일이 남는다.** `apps/web/.wedding-code-research.lock`을
지워야 다음 빌드가 된다(자동 삭제는 의도적으로 꺼져 있다).

## 4. 아직 안 한 것

- **픽셀 검증 0건.** 웨딩코드 v0.6은 문구·구조를 서버 렌더로만 확인했고 실제 브라우저에서
  레이아웃을 본 적이 없다. **다음 세션이 제일 먼저 할 일이다.**
- **사람 테스트 0건.** 재미는 판단이지 실측이 아니다.
- 문항에 **혼수·신혼집·축의금** 축이 없다. 돈이 제일 크고 갈등이 제일 잦은 주제다.
- `/wedding-code`·`/today` 모두 **앱 안에 진입 링크가 없다.** 주소를 알아야 들어간다.
- 「오늘 한 마디」 덱 28장은 3장씩 뽑으면 **열흘이면 바닥난다.**

## 5. 사용자(파운더) 몫

- **GitHub Actions는 지금까지 한 번도 실행된 적이 없다.** 실측: 전체 이력 91회가 전부
  **스텝 0개로 1~9초 만에** 실패했고, 성공 7건은 Dependabot 잡뿐이다. 코드 문제가 아니라
  계정 수준에서 막혀 있는 것이고, 그래서 소모된 Actions 시간도 0분이다(무료 한도는 그대로 남아 있다).
  **켤지 말지는 파운더 결정이다.** 안 켜도 되지만, 그 경우 푸시되는 코드를 검사하는 것은
  `.githooks/pre-push` 하나뿐이라는 점을 알고 있어야 한다. 그 훅은 `pnpm install` 때
  `prepare` 스크립트가 자동으로 켜준다(`scripts/install-git-hooks.mjs`) — 이 배선이 빠지면
  새 컴퓨터에서 안전망이 **아무 경고 없이 0이 된다**(`scripts/tests/git-hooks-autoinstall.test.mjs`가 강제).
- 유통 글 게시, `SUPABASE_ACCESS_TOKEN`, Vercel 사업자 정보.
