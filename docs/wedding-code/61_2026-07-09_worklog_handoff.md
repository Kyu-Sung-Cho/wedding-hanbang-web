# 2026-07-09 WeddingCode Worklog & Handoff

Date: 2026-07-09  
Branch to publish: `agent/wedding-code-plain-language`  
Project path: `hanbang-web/`  
Main URL checked locally: `http://localhost:3000/wedding-code`

## GitHub Publish Status

- Repository: `Kyu-Sung-Cho/wedding-hanbang-web`
- Remote branch: `origin/agent/wedding-code-plain-language`
- Initial work commit: `83314418 refine wedding code plain language`
- Draft PR: `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/37`
- Base branch: `main`

## Why This Work Happened

WeddingCode 문항이 문법적으로는 맞아도 사용자가 바로 이해하기 어려운 표현이 남아 있었다.

대표 문제:

- `완성된 모습이 우리가 원하는 느낌인지`
- `전체 비용이 우리가 정한 돈 안에 들어오는지`
- `스드메`, `본식`, `예식장`, `하객`, `식대`, `양가`, `예물`, `폐백`, `견적`, `추가금`
- `우리 느낌`, `사진 느낌`, `장소 느낌`, `모험`, `비슷한 느낌`

이번 작업의 기준은 "웨딩 업계 용어를 모르는 사람이 봐도, 상황과 선택지가 바로 이해되는가"였다.

## Final Product State

이 문서 작성 당시 live WeddingCode 문항 버전은 `v0.5-candidate.8`이었다. 이후 보수적 카피 패스로 `v0.5-candidate.9`가 추가되었다.

핵심 원칙:

- 사람을 평가하거나 관계를 판정하지 않는다.
- 검증된 심리검사처럼 말하지 않는다.
- 결혼 준비 상황에서 먼저 보는 기준과 대화 지점을 정리하는 참고 도구로만 말한다.
- 문항은 중학생이 읽어도 의미를 유추하지 않게 쓴다.

## What Changed

### Live 16 Questions

`apps/web/src/constants/weddingCodeV05.ts`

- A1: 사진·드레스·메이크업 상담 문항을 상담 자리에서 실제로 묻는 말처럼 수정.
- A2: 영상·앨범 추가 비용을 "남길 장면"과 "추가로 내는 돈" 기준으로 풀어씀.
- A3: `밥값`, `생각한 돈` 대신 `식사 비용`, `처음 잡은 예산`으로 변경.
- A4: `사진 느낌` 대신 `예시 사진`, `최근 실제 촬영 사진`, `후기`로 명확화.
- B1-B4: 후보 공유, 역할 분담, 비교 방식, 선택지 과부하를 행동 단위로 수정.
- C1-C4: 가족 조율, 부모님 기준, 전통 행사/가족 선물, 식장 예약 인원을 쉬운 말로 수정.
- D1-D4: 마음 먼저/할 일 먼저, 피로, 속도 차이, 오늘 예약 혜택을 구체적 대화 상황으로 수정.

### Context & Result Surfaces

- `apps/web/src/app/wedding-code/WeddingCodeClient.tsx`
  - `업체 견적을 받아본 적이 있나요?` -> `업체 비용표를 받아본 적이 있나요?`
- `apps/web/src/app/wedding-code/result/ResultClient.tsx`
  - `내 견적 체크하러 가기` -> `내 비용표 체크하러 가기`
- `apps/web/src/constants/weddingCodeForm.ts`
  - legacy `WC_QUESTIONS` fixture도 같은 쉬운 말 기준으로 정리.
- `apps/web/src/constants/weddingCodeResult.ts`
  - 예전 공유 카드/결과 문구의 `스드메`, `추가금`, `하객`, `본식`, `양가`, `견적` 등을 정리.
- `apps/web/src/lib/weddingCode/report.ts`
  - 결과 리포트 문구를 live 문항 표현과 맞춤.
- `apps/web/src/lib/weddingCode/validate.ts`
  - 검증 에러 문구도 `비용표` 기준으로 수정.

### Tests Updated

- `apps/web/src/lib/weddingCode/__tests__/report.test.ts`
- `apps/web/src/lib/weddingCode/__tests__/score.test.ts`
- `apps/web/src/lib/weddingCode/__tests__/validate.test.ts`

기대 문구를 당시 candidate.8 표현에 맞췄다.

## Audit Documents Added

- `docs/wedding-code/55_candidate4_item_reaudit_2026-07-09.md`
- `docs/wedding-code/56_candidate5_middle_school_rewrite_2026-07-09.md`
- `docs/wedding-code/57_candidate6_a1_premise_repair_2026-07-09.md`
- `docs/wedding-code/58_candidate6_plain_language_reaudit_2026-07-09.md`
- `docs/wedding-code/59_candidate7_a1_plain_speech_fix_2026-07-09.md`
- `docs/wedding-code/60_candidate8_full_item_plain_language_audit_2026-07-09.md`
- `docs/wedding-code/61_2026-07-09_worklog_handoff.md`
- `docs/wedding-code/62_candidate9_conservative_copy_pass_2026-07-09.md`

`60_candidate8_full_item_plain_language_audit_2026-07-09.md`가 당시 16문항 전체 감사 문서이며, `62_candidate9_conservative_copy_pass_2026-07-09.md`가 이후 보수적 문장 다듬기 기록이다.

## Verification Done

All commands were run from `hanbang-web/`.

```bash
pnpm --filter @hanbang/web exec vitest run src/lib/weddingCode src/app/api/wedding-code --reporter=dot
pnpm --filter @hanbang/web typecheck
pnpm --filter @hanbang/web lint
pnpm --filter @hanbang/web build
```

Result:

- WeddingCode tests: 48 passed
- Typecheck: passed
- Lint: passed
- Production build: passed
- Chrome/Playwright mobile viewport flow: 16 live questions rendered and advanced successfully
- Old/unclear term search gate: 0 hits in checked WeddingCode app/result/constants/lib paths

## How To Continue On Another Computer

This work has been pushed to GitHub on `origin/agent/wedding-code-plain-language`.

```bash
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
cd wedding-hanbang-web
git fetch origin
git switch agent/wedding-code-plain-language
pnpm install
pnpm --filter @hanbang/web dev
```

Then open:

```text
http://localhost:3000/wedding-code
```

If the branch is merged into `main`, use:

```bash
git switch main
git pull origin main
pnpm install
pnpm --filter @hanbang/web dev
```

## Remaining Truth Boundary

This is a strong copy, clarity, and internal verification pass. It is not human-response validation. The next real quality step is a small cognitive interview with actual users to see whether any question still causes hesitation.
