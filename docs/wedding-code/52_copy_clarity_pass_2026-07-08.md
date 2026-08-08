# WeddingCode v0.5 Copy Clarity Pass

> [!CAUTION]
> **HISTORICAL RECONSTRUCTION / SUPERSEDED / 출시 근거로 사용 금지**
>
> 이 파일의 기존 본문과 확인 가능한 초기 Git 기록(`8d8933e1`)은 이미 한글
> 인코딩이 손상돼 정확한 문장을 복구할 수 없었다. 아래는 손상된 기록에서
> 교차 확인할 수 있었던 변경 의도·파일·버전만 다시 정리한 요약이며 원문 인용이
> 아니다. 현재 문항이나 출시 판단으로 재사용하지 않는다. 현재 판단은
> [`README.md`](./README.md)와
> [`55_conservative_readiness_audit_2026-07-15.md`](./55_conservative_readiness_audit_2026-07-15.md)를
> 우선한다.

- 작성일: 2026-07-08
- 당시 상태: 사용자 피드백을 반영한 후보 문구 수정
- 연구 상태: 사람 대상 검증 전 후보안

## 확인된 피드백

- 문장은 더 짧고 직접적이어야 했다.
- 질문과 선택지에 여전히 모호한 표현이 있었다.
- `먼저 보는 기준`, `방향` 같은 추상어는 처음 결혼을 준비하는 사람이 바로
  행동으로 옮기기 어려웠다.
- 결과 문구는 평가처럼 들리지 않고 두 사람이 대화할 기준을 보여줘야 했다.

## 당시 수정 범위

채점 가중치와 16문항 구조는 유지하고 사용자에게 보이는 질문·선택지·결과 문구를
정리하는 작업이었다.

- 버전: `v0.5-candidate.1` -> `v0.5-candidate.2`
- 당시 변경 대상으로 기록된 파일:
  - `apps/web/src/constants/weddingCodeV05.ts`
  - `apps/web/src/constants/weddingCodeForm.ts`
  - `apps/web/src/app/wedding-code/WeddingCodeClient.tsx`
  - `apps/web/src/app/wedding-code/result/ResultClient.tsx`
  - `apps/web/src/lib/weddingCode/report.ts`
  - `apps/web/src/lib/weddingCode/coupleReport.ts`
  - `apps/web/src/lib/weddingCode/__tests__/coupleReport.test.ts`

위 경로는 당시 구조다. 현재 파일 존재 여부나 현재 런타임 사용 여부를 뜻하지 않는다.

## 당시 문구 원칙

1. 미완성 문장과 추상적인 `기준·방향` 표현을 줄인다.
2. 질문은 한 문장만 읽어도 어떤 상황인지 알 수 있게 쓴다.
3. 한 질문의 선택지는 서로 같은 층위의 행동이나 판단으로 맞춘다.
4. 결과에서는 `무엇을 중요하게 보는지`, `무엇을 먼저 맞출지`처럼 바로 대화할 수
   있는 말을 쓴다.
5. 궁합, 결혼 성공, 갈등 위험처럼 검증되지 않은 판정 표현은 쓰지 않는다.

## 복원 가능한 예시의 뜻

손상된 기록에는 견적을 볼 때 금액·포함 항목·사진 결과물을 함께 비교하는 장면이
있었다. candidate.2는 이를 자연스러운 질문으로 바꾸려 했지만, 선택지 사이 경계가
여전히 흐렸다는 후속 피드백을 받았다. 정확한 원문은 복구할 수 없으므로 재사용하지
않는다.

## 당시 남아 있던 검증

- 같은 선택지를 서로 다르게 이해하지 않는가
- 짧아진 선택지에서 필요한 상황 정보가 빠지지 않았는가
- 특정 답이 정답처럼 보이지 않는가
- 커플 결과 문구가 사람을 평가하는 말처럼 들리지 않는가
- 실제 초보 사용자 5명이 설명 없이 이해할 수 있는가

## 현재 해석

candidate.2는 최종판이 아니었고, 사람 대상 인지면접 전 후보였다. 점수 구조를
유지했다는 사실도 타당도나 신뢰도를 증명하지 않는다. 현재 WeddingCode의 공개
경계와 미완료 검증은 [`README.md`](./README.md)를 따른다.
