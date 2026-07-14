# WeddingCode 드라이런 킷 v1 (2026-07-05)

> [!CAUTION]
> **RETIRED — DO NOT RUN.** 아래 Production 링크를 배포하거나 모집·수집 SQL을 실행하지 않는다.
> 현재 웹/API/DB 수집 경계와 재개 금지 조건은
> [2026-07-14 containment handoff](../codex-tasks/SESSION_HANDOFF_2026-07-14_WEDDING_CODE_CONTAINMENT.md)를 따른다.

> 목표는 두 가지뿐: ①문항이 이해되는가 ②"정답처럼 보이는" 선택지가 있는가.
> 이 단계는 시장 수요 검증이 아니다. 유형·점수 기대를 만들지 않는다.

## 링크

- 기본: `https://hanbang.ai/wedding-code`
- 채널 태깅 (판독용 — 유통 테스트와 캠페인 분리):
  - 지인: `https://hanbang.ai/wedding-code?utm_source=friend&utm_medium=dm&utm_campaign=wc_dry1`
  - 동기방/커뮤니티: `https://hanbang.ai/wedding-code?utm_source=community&utm_medium=post&utm_campaign=wc_dry1`
  - (나중에 지식iN·카페에 섞을 땐 `utm_campaign=g1_w1` 유지 + `utm_content=wc01` 식으로)

## 모집 순서 (15번 §14 준수)

1. **내부 3회 + 모바일 1회** — 본인·파트너가 직접 완주 (오탈자·흐름 확인)
2. **내부 드라이런 5명** — 지인 DM
3. **미니 테스트 20명** — 동기방·커뮤니티
4. 20명 판독 통과 후에만 100명 스모크 고려

## 모집 문구 (정직글 원칙 — 사칭·후기위장 금지)

지인 DM용:

```
결혼 준비 서비스 만들면서 "결혼 준비 성향 질문"이 실제 상황처럼 느껴지는지
테스트 중이야. 3분짜리고, 유형 결과가 나오는 건 아니고(프로토타입) 질문이
이해되는지 봐주는 거야. 해주면 진짜 큰 도움!
https://hanbang.ai/wedding-code?utm_source=friend&utm_medium=dm&utm_campaign=wc_dry1
```

커뮤니티/동기방용:

```
[3분 테스트] 결혼 준비 상황 질문 16개, 실제처럼 느껴지는지 봐주실 분 계실까요?

직접 만들고 있는 결혼 준비 서비스의 질문을 다듬는 중입니다. 심리검사나 유형
테스트가 아니고(결과 안 나옴), 질문이 공감되는지·어색한 게 있는지 피드백을
모으는 프로토타입입니다. 로그인 없이 3분이면 끝나요.
https://hanbang.ai/wedding-code?utm_source=community&utm_medium=post&utm_campaign=wc_dry1

만든 사람이 직접 올리는 글입니다. 불편한 문항이 있었다면 그게 가장 값진 피드백이에요.
```

## 판독 (Claude에게 "웨딩코드 판독해줘" 한 마디면 아래 쿼리 실행)

기본 현황:

```sql
SELECT count(*) AS n,
       round(avg((feedback->>'feels_like_me')::numeric), 2)  AS feels_like_me,
       round(avg((feedback->>'scenario_realism')::numeric), 2) AS realism,
       round(avg((feedback->>'clarity')::numeric), 2) AS clarity,
       round(avg(duration_ms)/1000.0, 0) AS avg_sec
FROM wedding_code_responses WHERE form_version = 'v0.4.2';
-- 버전 간 상대 비교(v0.4 vs v0.4.1 vs v0.4.2)는 form_version 컬럼으로 분리 집계
```

정답 편향(good-answer bias) 감시 — 옵션 분포가 한쪽에 쏠린 문항:

```sql
SELECT key AS q, value AS opt, count(*) AS n
FROM wedding_code_responses, jsonb_each_text(answers)
GROUP BY 1, 2 ORDER BY 1, 3 DESC;
```

단계 적합성 — 게이팅 문항의 노출 상태별 응답:

```sql
SELECT key AS q, value AS shown_as, count(*)
FROM wedding_code_responses, jsonb_each_text(stage_flags)
GROUP BY 1, 2 ORDER BY 1, 2;
```

낙인·혼란 신호 (4~5점이면 free_text 원문 확인):

```sql
SELECT id, feedback->>'stigma_feedback_score' AS stigma,
       feedback->>'confusing_question_score' AS confusing,
       free_text
FROM wedding_code_responses
WHERE (feedback->>'stigma_feedback_score')::int >= 4
   OR (feedback->>'confusing_question_score')::int >= 4;
```

## 판정 기준 (15번 §13 그대로 + 이 단계 보정)

> ⚠️ 지표의 인식론적 지위 (2026-07-06 명시): 아래 임계값은 **실증 벤치마크가 아니라
> 데이터를 보기 전에 고정해둔 운영 기준**이다(사후 합리화 방지가 목적 — 04번 "provisional"
> 표기와 동일 취지). 대외적으로 "검증 기준"처럼 말하지 않는다. 근거를 갖는 것은
> ①문항 속 사실 전제(18번 🅰 접지)와 ②자체 데이터의 상대 비교(v0.3 vs v0.4,
> form_version 컬럼으로 분리)다.

| 지표 | 기준 | 비고 |
|---|---|---|
| feels_like_me | ≥ 4.0 | |
| scenario_realism | ≥ 4.0 | |
| 낙인 피드백(4~5점 비율) | < 5% | 1건이라도 원문 필독 |
| 혼란 피드백(4~5점 비율) | < 10% | 특정 문항 반복 지목 시 그 문항만 v0.4 수정 |
| 특정 옵션 80%+ 쏠림 문항 | 0개 목표 | 쏠림 = 정답 편향 신호, 옵션 재설계 |
| partner_invite ≥20% | **이번엔 미적용** | 결과 화면 없는 프로토타입이라 낮게 나올 운명 — 수요 없음으로 오독 금지 |

## 사전 등록 예측 (2026-07-06 고정 — v0.4.2 발송 전, 데이터 보기 전)

> 목적: 사후 합리화 방지. 문항만 채점되는 게 아니라 예측자(Claude)의 판단력도 채점된다.
> n≥10에서 1차 채점, n≥20에서 확정. 적중 여부와 무관하게 문항 성적표는 v0.5 입력이 된다.

| # | 예측 (반증 가능 형태) | 근거 |
|---|---|---|
| P1 | q12 최빈 선택지 점유율 ≥50% (쏠림 후보 A "먼저 볼 3가지만") | 네 선택지가 전부 매력적 — 지원욕구 문항의 구조적 리스크 |
| P2 | q02-D("둘이 얘기한다") 선택률 ≥40% (4택 기대치 25%) | '좋은 커플' 모범답안 효과 |
| P3 | q14-B("중요한 후보는 둘 다 같이 본다") 선택률 ≥40% | 동일한 모범답안 효과 |
| P4 | q01·q05·q09는 최빈 선택지 ≤40%로 잘 갈림 | 선택지 간 성향 극이 뚜렷, 도덕적 우열 없음 |
| P5 | q11 최빈 ≤35%이나 변별 정보량 낮음 — 주관식에 "다 나 같다"류 언급 ≥1건 | 낙인 가드레일로 충동 극을 뺀 트레이드오프 |
| P6 | 주관식 '가장 공감' 최다 언급 = q09 또는 q11 / '가장 어색' = q16 | 감정 문항의 공감 우위, 전통 절차 문항의 세대 편차 |

## 다음 버전 트리거

- 20명 판독 통과 → `09_expert_review_pack_v0.2` 실제 전문가 발송 + 01 v0.2 정의 동봉
- 혼란/낙인 지목 문항 → 해당 문항만 v0.4 패치 (전면 재설계 금지 — 과수정 방지)
- 그 다음에야 결과 화면(공개 축 표현층) 설계 논의 시작 — 채점 설계는 Phase 5 데이터 전 금지
- 옵트인 계정 연결(파운더 방향 확정 2026-07-06): 결과 화면 "내 계정에 저장" 명시 동의 버튼 —
  결과화면 v1/커플 리포트 설계에 포함. 익명 기본 유지, 자동 연결 금지(현행 테이블에 user_id 없음)
