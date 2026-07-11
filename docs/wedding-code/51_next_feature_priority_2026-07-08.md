# WeddingCode Next Feature Priority

> [!WARNING]
> **역사 우선순위 스냅샷입니다.** 아래 “production two-person flow verified” 상태는 현재가 아닙니다. 응답 수집·파트너 초대·페어링·커플 리포트 API는 HTTP 410이며, 최신 기준은 `../CONSUMER_JOURNEY_AND_RELEASE_AUDIT_2026-07-11.md`를 따릅니다.

Date: 2026-07-08
State: production two-person flow technically verified
Current gate: user validation, not more distribution

## Decision

Do not add growth-heavy WeddingCode features before the 5-person cognitive interview and 20-person mini test.

The technical flow now works, but product language and couple-comparison usefulness are not yet validated with real couples. The next work should protect trust before increasing reach.

## Priority Order

### P0. Run 5 Cognitive Interviews

Source: `48_cognitive_interview_execution_kit_2026-07-08.md`

Output:

- 5 completed interview notes.
- List of blocking copy/item issues.
- Decision: proceed to 20-person mini test or revise first.

Why first:

- This is where right-answer bias, blame language, and partner weaponization risk will show up fastest.

### P1. Patch Blocking Copy Or Item Issues

Only patch issues that repeat or carry safety risk.

Patch types:

- wording that sounds diagnostic
- couple-report copy that sounds like compatibility scoring
- options that feel morally ranked
- items where participants say "my answer is missing"
- confusing terms such as "준비 방식 겹침도" if misunderstood

Do not rewrite the whole model after one anecdote.

### P2. Run 20-Person Mini Test

Source: `49_mini_test_20_ops_2026-07-08.md`

Output:

- metric table
- option distribution
- high-risk free-text review
- partner invite/couple report interest baseline
- decision: 100-person smoke / revise / stop

### P3. Add Internal Readout Support

If manual SQL becomes slow, add one small internal script or documented Supabase query pack that exports:

- response count by UTM
- feedback averages
- high-stigma/high-confusion rows
- option distribution by item
- pair completion counts

This is an operator feature, not a user-facing feature.

### P4. Share UX Polish

Only after P0/P2 language is safe.

Candidate work:

- Kakao share copy and fallback
- result image card polish
- cleaner partner invite affordance
- clearer waiting/ready copy

Do not make sharing more viral until the result language is safe.

### P5. Couple Report Depth

Only after at least a few partner-invite completions.

Candidate work:

- more useful first-talk prompts
- better handling when overlap is very low or very high
- per-axis explanation that avoids judgment
- saveable "one thing to align today" card

### P6. Route Into Hanbang Products

Only after CTA data supports it.

Candidate work:

- quote-check route based on answer pattern
- Amora conversation starter
- family coordination checklist
- vendor/contract checklist

Guardrail: routing must stay preference/support oriented. It must not say the result proves what the couple should buy.

## Explicitly Deferred

Do not build these yet:

- public type names or personality labels
- "compatibility" score wording
- ranking couples against each other
- predictive claims about marriage quality
- ad/vendor recommendations based on WeddingCode answers
- heavy gamification before item safety is known

## Immediate Next Actions

1. Recruit and schedule 5 interviews using the participant slots in document 48.
2. Run interviews with production links and anonymous notes.
3. Create a synthesis document after the fifth interview.
4. Patch only repeated or safety-critical issues.
5. Start the 20-person mini test only after the synthesis says go.
