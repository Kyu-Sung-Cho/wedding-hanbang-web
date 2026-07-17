# WeddingCode candidate.4 plain-language rewrite

> [!WARNING]
> **SUPERSEDED / 역사 보존용 구현 기록입니다.** 아래 테스트·빌드 PASS는 당시 카피와 기술 구현을
> 확인한 결과이며 문항 타당도나 현재 출시 준비도 승인이 아닙니다. candidate.4의 문항·가중치·커플
> 비교는 2026-07-15 재감사 이후 출시 불가 상태입니다. 현재 기준은
> [`55_conservative_readiness_audit_2026-07-15.md`](./55_conservative_readiness_audit_2026-07-15.md)이고,
> [`56_candidate5_research_spec_2026-07-17.md`](./56_candidate5_research_spec_2026-07-17.md)는 구현·수집을
> 허가하지 않는 미검증 연구 초안입니다.
> **문구·선택지·가중치·테스트 결과 재사용 금지.**

Date: 2026-07-08
Version: `v0.5-candidate.4`
Previous: `v0.5-candidate.3`

## Trigger

User feedback made it clear that candidate.3 was still too abstract in places.
The main issue was not test correctness, but user comprehension:

- A novice should immediately understand what each question is asking.
- Options in one question must answer the same prompt type.
- One option should not hide several different decisions.
- Wedding terms should be explained when they may be unfamiliar.
- Result-driving choices should feel like real couple conversation, not AI copy.

## Main changes

### A1 estimate question

Changed the first item to explicitly explain `스드메`:

- `스드메(스튜디오, 드레스, 메이크업) 견적서를 처음 받았다면 제일 먼저 확인할 것은?`

The four answers now separate cleanly:

- budget fit
- visual taste
- included contract items
- actual user reviews

This addresses the earlier confusion where several choices sounded like the same money answer.

### B collaboration items

Replaced abstract phrases such as `체크포인트`, `후보`, and vague comparison language with concrete words:

- `업체나 장소`
- `가격, 위치, 사진처럼 같이 볼 항목`
- `가격, 위치, 분위기를 한 표에 적어 비교한다`

### C family/ceremony items

Reworked parent and ceremony questions to be more direct:

- `부모님은 음식과 교통을 걱정하세요`
- `폐백, 주례, 예물처럼 예식 절차 몇 가지를 간단히 하고 싶어요`
- `친척, 친구, 직장 중 어디까지 초대할지`

The goal is to reduce unfamiliar abstraction while preserving the measured constructs.

## Compatibility

`WEDDING_CODE_V05_COMPATIBLE_VERSIONS` now accepts:

- `v0.5-candidate.4`
- `v0.5-candidate.3`
- `v0.5-candidate.2`
- `v0.5-candidate.1`

This keeps existing draft result rows usable while new submissions use candidate.4.

## Validation checklist

Completed after the rewrite:

- Source search found no remaining matches for the flagged old phrases:
  `둘이 꼭 할 것과 줄일 것`, `체크포인트`, `후보를`, `후보가`, `꼭 지킬`, `볼 기준`.
- WeddingCode tests passed: 44 files, 364 tests.
- Typecheck passed.
- Lint passed.
- Production build passed.
- Browser check passed on `http://localhost:3000/wedding-code`.

Browser-confirmed first item:

- Question: `스드메(스튜디오, 드레스, 메이크업) 견적서를 처음 받았다면 제일 먼저 확인할 것은?`
- Options:
  - `예산 안에서 가능한 금액인지`
  - `사진 분위기가 우리 취향과 맞는지`
  - `드레스, 메이크업, 원본 사진 같은 항목이 포함되는지`
  - `실제로 진행한 사람들의 후기가 좋은지`
