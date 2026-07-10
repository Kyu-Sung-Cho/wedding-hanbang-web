# 2026-07-09 WeddingCode Worklog & Handoff

- Date: 2026-07-09
- Truth refresh: 2026-07-10
- Branch to publish: `agent/wedding-code-plain-language`
- Repository root: `wedding/` in this checkout (`wedding-hanbang-web` on GitHub)
- Main URL checked locally: `http://localhost:3000/wedding-code`

> 이 문서는 2026-07-09 작업과 2026-07-10 초반의 진실성 갱신 스냅샷이다. 이후 보안·DB·UI 보강과 49 files / 410 tests, production build 재검증은 [`../AUDIT_2026-07-10_CONSERVATIVE_FULL_REVIEW.md`](../AUDIT_2026-07-10_CONSERVATIVE_FULL_REVIEW.md)가 이어받는다. 아래 로컬/PR/main/production 표는 당시 상태 기록으로 유지한다.

## Local, PR, Main, and Production Status

These are separate states. A local commit or PR update is not proof that production changed.

| Surface | Git/source snapshot on 2026-07-10 | WeddingCode version | Meaning |
|---|---|---|---|
| Local branch | `d6ff8e88` on `agent/wedding-code-plain-language` | `v0.5-candidate.9` | Candidate.9 exists locally. |
| Remote PR branch | `91cbad68` on `origin/agent/wedding-code-plain-language` | `v0.5-candidate.8` | Draft [PR #37](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/37) had not received local candidate.9 yet. |
| `origin/main` | `8d8933e1` | `v0.5-candidate.4` | Main-branch source, not by itself deployment proof. |
| Live `https://hanbang.ai/wedding-code` | Production chunk checked directly on 2026-07-10 | `v0.5-candidate.4` | Live deployment was still candidate.4 at verification time. |

Repository: `Kyu-Sung-Cho/wedding-hanbang-web`; PR base: `main`; initial work commit: `83314418`. Re-check Git and the live URL after any push, merge, or deploy because this table is a dated snapshot.

## Why This Work Happened

WeddingCode 문항이 문법적으로는 맞아도 사용자가 바로 이해하기 어려운 표현이 남아 있었다.

대표 문제:

- `완성된 모습이 우리가 원하는 느낌인지`
- `전체 비용이 우리가 정한 돈 안에 들어오는지`
- `스드메`, `본식`, `예식장`, `하객`, `식대`, `양가`, `예물`, `폐백`, `견적`, `추가금`
- `우리 느낌`, `사진 느낌`, `장소 느낌`, `모험`, `비슷한 느낌`

이번 작업의 기준은 "웨딩 업계 용어를 모르는 사람이 봐도, 상황과 선택지가 바로 이해되는가"였다.

## Candidate Copy State

이 문서 작성 당시 작업 브랜치는 candidate.8까지 원격에 있었고, 이후 보수적 카피 패스로 candidate.9가 로컬에 추가되었다. 위 표처럼 candidate.9는 이 진실성 갱신 시점에 PR 또는 프로덕션 버전이 아니었다.

핵심 원칙:

- 사람을 평가하거나 관계를 판정하지 않는다.
- 검증된 심리검사처럼 말하지 않는다.
- 결혼 준비 상황에서 먼저 보는 기준과 대화 지점을 정리하는 참고 도구로만 말한다.
- 문항은 중학생이 읽어도 의미를 유추하지 않게 쓴다.

## What Changed

### Candidate.9 16 Questions (local source)

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

The conservative audit rerun used the repository root and `corepack pnpm` against local candidate.9 commit `d6ff8e88`.

```bash
corepack pnpm --filter @hanbang/web test -- --reporter=dot
corepack pnpm --filter @hanbang/web exec vitest run src/lib/weddingCode src/app/api/wedding-code --reporter=dot
corepack pnpm --filter @hanbang/web typecheck
corepack pnpm --filter @hanbang/web lint
```

Result:

- Full `@hanbang/web` suite: 44 files passed, 365 tests passed.
- Focused WeddingCode/API suite: 8 files passed, 49 tests passed.
- Typecheck: passed
- Lint: passed

Not independently rerun in the 2026-07-10 audit:

- Production build
- Browser/mobile-viewport flow
- Live deployment flow after candidate.9

The earlier 2026-07-09 work session recorded build, browser-flow, and term-search checks. Treat those as historical evidence, not as a fresh verification of later local changes.

## How To Continue On Another Computer

Do not assume local, remote PR, and production contain the same commit. Fetch and inspect first.

```bash
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
cd wedding-hanbang-web
git fetch origin
git switch agent/wedding-code-plain-language
git rev-parse HEAD
corepack pnpm install
corepack pnpm --filter @hanbang/web dev
```

At the 2026-07-10 snapshot, the remote branch above resolved to candidate.8. Candidate.9 becomes available on another computer only after commit `d6ff8e88` is pushed to that branch (or merged elsewhere).

Then open:

```text
http://localhost:3000/wedding-code
```

If the branch is merged into `main`, use:

```bash
git switch main
git pull origin main
corepack pnpm install
corepack pnpm --filter @hanbang/web dev
```

## Remaining Truth Boundary

This is a copy, clarity, and internal verification pass. It is not human-response validation. The source still marks the set as `candidate_pending_human_validation`, and no evidence in this handoff shows the required human gates were completed.

Before calling the set final or validated:

1. Run n=5 cognitive interviews using the execution kit.
2. Confirm each option is understood without facilitator explanation, with special attention to B3/B4 and C2/C3.
3. Record and fix repeated hesitation or misinterpretation.
4. Only after the interview gate passes, run the n=20 mini test.
5. Keep claims limited to a wedding-preparation conversation aid; do not describe it as a validated psychological test, compatibility score, or relationship predictor.
