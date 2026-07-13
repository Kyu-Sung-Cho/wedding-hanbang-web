# WeddingCode Evidence Backbone & Item Taxonomy v0.1

> **HISTORICAL / SUPERSEDED (2026-07-11):** 이 문서의 다중 구성개념·유형 설계는 현재 실행 계약이 아니다. 현재 문항, 단일축 계산, 근거 한계는 [`63_candidate10_evidence_based_rebuild_2026-07-11.md`](./63_candidate10_evidence_based_rebuild_2026-07-11.md)를 따른다.

작성일: 2026-07-07

목표: 웨딩코드를 "재미있는 공유 테스트"로 만들되, 근거 없는 성격검사나 궁합 장사로 보이지 않게 한다.  
핵심 원칙은 단순하다. **재미는 표현층, 근거는 문항과 리포트의 뼈대**다.

제품 정의:

> 웨딩코드는 결혼 준비 중 드러나는 나의 준비 성향을 이해하고, 그 결과를 상대와 공유해 더 잘 이야기하고 더 행복하게 준비하도록 돕는 대화형 도구다.

웨딩코드가 팔아야 하는 것은 "너희 궁합은 몇 점"이 아니라 "이 얘기를 오늘 더 편하게 시작할 수 있음"이다.

---

## 0. 결론

현재 웨딩코드는 근거 없이 만든 테스트가 아니다. 다만 근거의 강도가 영역마다 다르다.

| 영역 | 현재 근거 강도 | 결론 |
|---|---:|---|
| 비용·견적·추가금·계약 리스크 | 강함 | 구조 근거와 현재 가격 근거를 분리해 말할 수 있다. |
| 커플 공동 의사결정·분업 | 중간~강함 | 학술 근거를 붙일 수 있으나 "좋고 나쁨"으로 해석하면 안 된다. |
| 스트레스 상황의 공감·실행 지원 | 중간~강함 | 갈등 예방 가이드 근거로 쓸 수 있다. 성격 라벨로 쓰면 위험하다. |
| 가족·양가·전통 절차 조율 | 중간 이하 | 한국 웨딩 맥락에서는 중요하지만, human interview와 전문가 검토가 더 필요하다. |
| 16유형·동물명·희귀도 | 아직 약함 | 재미·기억 장치로만 가능. 신뢰는 문항/대화 가이드가 만든다. |
| 커플 적합도/궁합 퍼센트 | 금지에 가까움 | "적합도"가 아니라 "준비 방식 겹침도" 또는 "대화 우선순위"로 바꿔야 한다. |

---

## 1. Evidence Firewall

웨딩코드의 모든 문장에는 아래 중 하나의 상태를 붙인다.

| 상태 | 의미 | 제품에서 허용되는 표현 |
|---|---|---|
| confirmed | 공식 통계·원문 수치·검증된 제품 데이터로 확인 | "2024년 조사 기준..." |
| research-supported | 학술 문헌에서 반복적으로 다뤄진 관계/의사결정 패턴 | "연구에서는 ...와 관련이 있다고 봅니다" |
| product-hypothesis | 한방 제품 경험상 유용할 것으로 보는 가설 | "이 답변은 다음 대화 카드에 활용됩니다" |
| user-validated | 실제 응답/인터뷰에서 이해도·공감도 통과 | "응답자 중 비슷한 패턴" |
| prohibited | 현재 근거로 말하면 과장 | "결혼 성공률", "이혼 가능성", "진짜 궁합" |

표현 가드레일:

- "MBTI"는 내부 비유로도 조심한다. 제품명·카피·공유 카드에 쓰지 않는다.
- "성격", "심리 진단", "궁합", "운명", "정답" 금지.
- "커플 적합도 %" 대신 "준비 방식 겹침도", "대화가 쉬운 지점", "먼저 맞춰볼 지점" 사용.
- 희귀도는 n이 충분할 때만 표시한다. n<30은 퍼센트 금지, n>=30은 원수+비율 병기, n>=100부터 안정적인 분포처럼 보일 수 있다.
- 어떤 동물/유형도 더 성숙함, 더 합리적임, 더 결혼에 적합함을 뜻하지 않는다.

---

## 2. Source Backbone

### A. 한국 결혼서비스 시장 리스크: 구조 근거

근거 상태: confirmed

주요 출처:

- 정부 결혼서비스 실태조사, 2024 (기획재정부 발표): 스드메 기본금, 추가금, 개별 가격 고지율 등. 기존 정독 문서 `02a`.
- 한국소비자원, 2024 소비자시장평가지표: 결혼서비스는 40개 시장 중 최하위권, 가격정보 탐색 어려움 85.4%, 예상 못 한 추가 비용 83.2%, 현금 결제 유도 78.1%.

제품에 연결되는 구인:

- `costRisk`
- `evidenceDecision`
- `decisionPaceRisk`
- `guidanceNeed`

허용 주장:

- "가격·추가금·현금 결제 유도는 개인의 예민함이 아니라 시장 구조 문제다."
- "계약 전 포함/별도/취소 조건을 확인하려는 반응은 합리적인 자기방어다."

금지 주장:

- "이 선택을 하면 피해를 예방할 수 있다"처럼 보장형 문장.
- "비용을 먼저 보는 사람이 더 합리적이다"라는 우열 프레임.

### A-2. 한국 결혼서비스 시장 리스크: 현재 가격 근거

근거 상태: confirmed, current

주요 출처:

- 한국소비자원 참가격 결혼서비스: 2025년부터 결혼서비스 가격정보 제공, 결혼식장·스드메·선택품목의 월별/지역별 가격정보와 예상견적 기능 제공.
- 한국소비자원, 2025년 4월 결혼서비스 가격조사: 전국 14개 지역, 결혼식장 370곳, 결혼준비대행업체 152곳 조사. 전국 평균 총 계약금액 2,101만 원, 지역별 편차 큼.
- 한국소비자원, 2026년 가격 동향 자료: 2026년 2월 기준 결혼서비스 전체비용 평균 2,139만 원 등 최신 월별 가격 흐름 확인 가능.
- 한국소비자원, 2026년 3월 정책연구보고서 `결혼서비스 시장 진단 및 개선방안 연구`: FGI, 소비자 설문, 사업자 인터뷰 기반으로 시장 구조와 개선방안 제시.
- 한국소비자원, 2026년 4월 소비자정책동향 `결혼서비스 시장의 소비자보호 법제화 동향 및 과제`: 결혼서비스 소비자보호 입법·정책 쟁점 정리.

제품에 연결되는 구인:

- `costRisk`
- `evidenceDecision`
- `guidanceNeed`

허용 주장:

- "현재 시세·지역 편차는 참가격 등 최신 자료를 기준으로 갱신한다."
- "2024년 자료는 구조 근거, 2025~2026 자료는 현재 가격 근거로 분리한다."

금지 주장:

- 2024년 수치를 2026년 현재 평균 가격처럼 쓰기.
- 최신 가격을 확인하지 않고 결과 카드에 구체 금액을 박기.

### B. 커플 스트레스와 공동 대처

근거 상태: research-supported

주요 출처:

- Falconier, Jackson, Hilpert, Bodenmann (2015), dyadic coping meta-analysis: 57개 보고서, 72개 독립 표본, 17,856명. 커플이 스트레스를 함께 다루는 방식은 관계 만족과 관련됨.
- Rusu et al. (2020), PLOS ONE longitudinal study: 240쌍을 5회 연간 추적. 파트너가 지지적으로 대처하고 둘이 함께 대처하는 경험은 관계 만족과 관련됨.
- Social support effectiveness / optimal matching 연구: 스트레스 상황에서 받는 사람이 필요로 하는 지원 종류와 실제 제공되는 지원이 맞는지가 중요하다는 관점. D축에서는 "공감 먼저"와 "정리 먼저"의 우열이 아니라 지원 순서의 맞춤 문제로만 사용한다.

제품에 연결되는 구인:

- `coPreparation`
- `emotionalSupport`
- `executionSupport`
- `couple_report`
- 대화 카드

허용 주장:

- "결혼 준비 스트레스는 한 사람의 문제가 아니라 커플이 함께 다루는 과제다."
- "공감 먼저/정리 먼저의 차이는 결함이 아니라 지원 순서의 차이다."
- "상대가 도우려는 방식과 내가 편한 방식이 다를 수 있으니, 먼저 맞춰볼 반응 순서를 정리할 수 있다."

금지 주장:

- "공감형이 더 좋은 배우자다."
- "실행형은 차갑다."
- "이 점수가 높으면 관계 만족도가 높다"처럼 개인 결과 예측.
- "이 문항이 관계 만족도나 갈등 감소를 예측한다."

### C. 갈등 대화 패턴

근거 상태: research-supported

주요 출처:

- Schrodt, Witt, Shimkowski (2014), demand/withdraw meta-analysis: 74개 연구, 14,255명. 한쪽은 문제를 밀어붙이고 한쪽은 회피하는 반복 패턴은 관계·커뮤니케이션 결과와 관련됨.
- Donato et al. (2014): demand-withdraw와 커플 불만족의 동시·종단 연관을 다룸.

제품에 연결되는 구인:

- `emotionalSupport`
- `executionSupport`
- `decisionPaceRisk`
- "오늘 해볼 대화" 카드

허용 주장:

- "갈등 자체보다, 갈등 때 서로가 기대하는 반응 순서가 어긋날 때 피로가 커질 수 있다."
- "웨딩코드는 누가 맞는지보다, 먼저 맞춰볼 대화 순서를 보여준다."

금지 주장:

- "이 커플은 위험하다."
- "이 대화 패턴이면 헤어진다."

### D. 함께 결정하기와 역할 분담

근거 상태: research-supported, 단 제품 적용은 hypothesis

주요 출처:

- Brick, Zhou, Chartrand, Fitzsimons, Journal of Consumer Psychology: 관계 안에서의 공유 소비 의사결정은 자기 영향감과 파트너 참여감이 함께 있을 때 긍정적으로 작동한다는 연구.
- Peetz et al., partner-satisfying decisions experience sampling: 일상적 의사결정 갈등에서 상대를 고려하는 결정과 관계 지표의 연관을 탐색.

제품에 연결되는 구인:

- `coPreparation`
- `roleOwnership`
- `coupleAutonomy`

허용 주장:

- "같이 보는 방식과 맡아서 정리하는 방식은 둘 다 유효하다."
- "문제는 분업 자체가 아니라, 한쪽은 참여로 느끼고 다른 쪽은 효율로 느낄 때 생기는 오해다."

금지 주장:

- "모든 결정은 같이 해야 더 좋다."
- "분업형은 무관심하다."

### E. 의사결정 스타일과 가치 기준

근거 상태: research-supported, 단 웨딩 적용은 hypothesis

주요 출처:

- Decision-making style / maximizing 연구: 사람의 결정 방식은 영역과 가치에 따라 달라질 수 있다.
- 한국 성인 대상 관계·커리어 maximization 연구: 중요한 생애 선택에서 더 많은 대안을 찾는 전략은 맥락과 의미 형성과 함께 봐야 한다.
- Experiential consumption 연구: 경험적 구매는 만족, 기억, 사회적 연결과 관련될 수 있다.
- Commemorative purchase 연구: 특별한 생애 사건에서는 물리적으로 남는 기념물도 시간이 지나 의미 연결을 유지하는 역할을 할 수 있다.
- Wedding consumer/pricing 연구: 웨딩 사진·영상은 추억을 남기는 수단인 동시에 완벽함 압박으로 작동할 수 있다.

제품에 연결되는 구인:

- `evidenceDecision`
- `aestheticMood`
- `experienceMeaning`
- `costRisk`

허용 주장:

- "웨딩 결정은 가격만의 문제가 아니라, 오래 남을 의미와 후회 가능성을 함께 보는 고관여 결정이다."
- "근거 확인과 무드 판단은 반대가 아니라 서로 다른 입력값이다."
- "사진·영상·앨범처럼 오래 남는 항목은 의미와 압박을 동시에 만들 수 있으므로, 예산과 커플 기준을 함께 다뤄야 한다."
- "후기와 포트폴리오는 둘 다 중요한 의사결정 입력값이지만, 어느 하나만으로 업체 품질을 보장할 수는 없다."

금지 주장:

- "근거형은 이성적이고 무드형은 감성적이다."
- "빠르게 결정하는 사람은 충동적이다."
- "오래 남는 항목에는 돈을 더 쓰는 것이 좋다."
- "사진·영상·앨범을 하지 않으면 후회한다."
- "후기가 많은 곳은 안전하고 후기가 적은 곳은 위험하다."
- "포트폴리오를 먼저 보는 사람은 감으로 고른다."

### F. 가족·양가·전통 조율

근거 상태: product-hypothesis + partial research-supported

현재 상태:

- 한국 웨딩 맥락에서 가족·혼주·하객·예절은 실제 제품 도메인상 매우 중요하다.
- 다만 지금 문서 기준으로 한국 예비부부의 양가 조율을 직접 다룬 강한 실증 근거는 부족하다.
- family-of-origin, in-law relationship, cultural norm 관련 연구는 보강 가능하지만, 웨딩 준비 문항에 바로 강한 주장으로 연결하면 과장이다.

제품에 연결되는 구인:

- `familyIntegration`
- `coupleAutonomy`
- `etiquette_guide`

허용 주장:

- "가족 조율은 많은 커플이 실제로 맞닥뜨리는 준비 과제다."
- "가족을 고려하는 정도와 커플 기준을 먼저 세우는 정도는 둘 다 존중받아야 한다."

금지 주장:

- "가족 고려형이 더 효도한다."
- "커플자율형이 더 현대적이다."
- "가족 관여도가 높으면 갈등 커플이다."

---

## 3. v0.5 Public Axis Draft

현재 12개 구인은 유지하되, 사용자가 기억하는 공개 표현은 4축으로 축약한다. 단, 이 4축은 **점수 확정 전 표현층 후보**다.

| 공개 축 후보 | 왼쪽 표현 | 오른쪽 표현 | 내부 구인 |
|---|---|---|---|
| 결정 기준 | 조건을 먼저 확인 | 의미를 먼저 상상 | `costRisk`, `evidenceDecision` ↔ `experienceMeaning`, `aestheticMood` |
| 준비 방식 | 같이 보고 맞추기 | 맡고 모아 정하기 | `coPreparation` ↔ `roleOwnership` |
| 조율 범위 | 우리 기준 먼저 | 가족·하객까지 함께 | `coupleAutonomy` ↔ `familyIntegration` |
| 지원 순서 | 마음부터 듣기 | 할 일부터 정리 | `emotionalSupport` ↔ `executionSupport` |

내부 전용 신호:

- `decisionPaceRisk`: 공개 유형명 금지. 계약 전 "하루 숙려", "조건 확인" 가이드에만 사용.
- `guidanceNeed`: 공개 유형명 금지. 제품 추천/아모라 톤/요약 방식에만 사용.

---

## 4. 문항 카테고리 재배치

v0.5는 "16문항 = 4축 × 4문항"을 기본 구조로 한다. 각 축은 최소 3문항 이상이 있어야 결과로 보여줄 수 있다.

### Category 1. 돈·조건·계약 리스크

목적: 한방의 신뢰 포지션을 만드는 핵심 카테고리.

살릴 문항:

- q01 견적서 추가금
- q05 구두 약속과 계약서 불일치
- q11 당일 혜택이 있는 상담 후 결정
- q13 예산보다 300만 원 비싼 식장

개정 방향:

- "조심하는 사람"이 아니라 "확인 방식"으로 표현.
- 빠른 결정도 나쁜 답처럼 보이지 않게 해야 한다.

### Category 2. 의미·무드·후회 방지

목적: 웨딩은 단순 절약 게임이 아니라 기억과 의미의 소비라는 점을 반영.

살릴 문항:

- q02 오래 기억에 남을 옵션
- q06 투어 중 우리 느낌
- q15 느낌은 좋은데 후기 적음

추가 필요:

- "사진·영상·드레스·꽃 중 무엇을 지킬지"처럼 실제 예산 갈등과 맞닿은 문항 1개.

개정 방향:

- "분위기"라는 단어가 반복되므로 사진/하객 경험/본식 장면 등으로 구체화.

### Category 3. 같이 준비 vs 역할 분담

목적: 커플 비교 리포트의 가장 강한 축.

살릴 문항:

- q03 마음에 드는 곳을 찾았는데 상대는 아직 못 봄
- q04 한 명이 주로 알아보고 최종 확인

재작성/통합:

- q14 스타일/조건 보는 눈은 q04와 중복된다. 둘 중 하나를 버리거나, "준비가 한쪽에게 쏠렸을 때" 문항으로 바꾼다.

개정 방향:

- "같이 보는 게 더 사랑"처럼 보이지 않게 한다.
- "맡아서 정리"도 애정과 책임의 방식으로 표현한다.

### Category 4. 가족·하객·전통 조율

목적: 한국 웨딩의 실제 갈등 지점.

살릴 문항:

- q07 부모님은 음식/교통, 우리는 분위기
- q08 부모님께 우리 기준 말하기
- q16 전통 절차 간소화

추가 필요:

- 하객 수/보증인원/축의금/지역 이동 등 가족이 실제로 관여하는 구체 문항 1개.

개정 방향:

- 가족을 "문제"로 만들지 않는다.
- 커플자율을 "반가족"으로 만들지 않는다.

### Category 5. 공감·실행·대화 순서

목적: 커플 갈등 예방 가이드의 핵심.

살릴 문항:

- q09 걱정을 말했는데 방법부터 나올 때
- q10 본식 직전 과업 폭주는 범용 상황으로 재작성

추가 필요:

- "준비 얘기만 하면 둘 다 피곤할 때"
- "준비 속도가 다르게 느껴질 때"

개정 방향:

- 공감형/실행형을 공개 유형명으로 쓰지 않는다.
- 결과에서는 "오늘 대화 순서"로만 보여준다.

### Category 6. 정보 압축·제품 도움 선호

목적: 제품 라우팅용. 유형 점수에는 넣지 않거나 낮은 가중치.

문항:

- q12 견적서가 낯선 항목투성이

개정 방향:

- 결과 유형 산출에는 직접 반영하지 않는다.
- 아모라/견적체크/체크리스트 추천에만 사용한다.

---

## 5. Result Language Rules

### 허용되는 결과 구성

1. 형용사+동물 카드
   - "당신은 OO입니다"가 아니라 "현재 답변으로는 OO에 가까워요."
   - 동물은 점수 계산의 근거가 아니라 기억 장치다.

2. 분포
   - "전체 인구 대비 희귀도" 금지.
   - "현재 웨딩코드 응답자 N명 중 X명"만 허용.

3. 커플 비교
   - "궁합/적합도" 금지.
   - "준비 방식 겹침도", "같이 쉬운 지점", "먼저 맞춰볼 지점" 사용.

4. 갈등 예방 가이드
   - 동물명에서 뽑지 않는다.
   - 실제 문항 답변 차이에서만 뽑는다.

### 금지되는 결과 구성

- "당신은 결혼 준비에 약한 타입"
- "커플 궁합 87%"
- "상위 3% 희귀 유형"
- "이 유형은 갈등이 많음"
- "논문으로 검증된 웨딩 성격 유형"

---

## 6. Validation Ladder

### Step 1. Desk Evidence Lock

이 문서와 소스 정독 문서를 기준으로 각 문항에 source grade와 claim status를 붙인다.

산출물:

- 문항별 source map
- 금지 표현 리스트
- v0.5 문항 후보

### Step 2. Cognitive Interview n=5

목적: 사용자가 문항을 어떻게 이해하는지 본다.

확인 질문:

- 이 질문이 실제 결혼 준비 상황처럼 느껴졌나?
- 선택지 중 정답처럼 보이는 게 있었나?
- 내 답이 없다고 느낀 문항은?
- 불편하거나 평가받는 느낌이 있었나?

통과 기준:

- 각 문항 clarity 평균 4.0/5 이상
- stigma 피드백 5% 미만
- "정답 같음" 지적 문항은 즉시 재작성

### Step 3. Mini Test n=20

목적: 문항 분포와 공유 욕구 확인.

통과 기준:

- 완주율 60% 이상
- feels_like_me 평균 4.0/5 이상
- 선택지 한쪽 쏠림 70% 이상 문항 재검토
- partner invite interest 20% 이상

### Step 4. Smoke Test n=100

목적: 공개 결과 카드, 분포 표시, 커플 초대 전환 검증.

통과 기준:

- 문항별 극단 쏠림 점검
- 4축 후보 간 상관 확인
- 유형명 회상률 확인
- 공유 생성률/초대 전환율 확인

### Step 5. Couple Pilot n=50 pairs

목적: 비교 리포트가 대화를 돕는지, 싸움 유발이 없는지 확인.

통과 기준:

- "대화에 도움 됨" 4.0/5 이상
- "불편/평가받음" 5% 미만
- 다름 카드에서 돈·가족 문항 자동 노출 금지 규칙 검증

### Step 6. Psychometric Pilot n=300+

목적: 4축 구조가 실제로 성립하는지 확인.

확인:

- 축별 내적 일관성
- 문항-축 적합도
- 재검사 안정성
- 12구인 → 4축 축약 가능 여부

이 단계 전에는 "검사 신뢰도"를 주장하지 않는다.

---

## 7. Immediate v0.5 Decision

현재 16문항을 그대로 유형화하지 않는다. v0.5는 아래 원칙으로 재작성한다.

1. 4축 × 4문항 구조로 다시 배치한다.
2. q12는 유형 산출이 아니라 제품 도움 선호로 분리한다.
3. q04/q14 중복을 해소한다.
4. q10은 본식 직전이 아니라 준비 전반의 피로/과업 상황으로 바꾼다.
5. 가족·양가 문항은 최소 1개 더 구체화한다.
6. 모든 선택지는 "책임감 있는 정답"처럼 보이지 않게 다시 쓴다.
7. 결과 표현은 "유형"보다 "대화 카드"가 먼저다.

다음 문서: `23_v0.5_item_blueprint.md`

---

## 8. External Source Links Checked

2026-07-07 기준으로 재확인한 외부 링크다. 링크는 근거 추적용이며, 제품 표면에 그대로 길게 노출하지 않는다.

### Official / Market Sources

- 한국소비자원, 2024 소비자시장평가지표 보도자료 PDF  
  https://www.kca.go.kr/home/board/download.do?bid=00000013&did=1003879832&fno=10047246&menukey=4002
- 한국소비자원, 2024 한국의 소비자시장평가지표 PDF  
  https://www.kca.go.kr/home/board/download.do?bid=00000154&did=1003899525&fno=10047695&menukey=6055
- 한국소비자원 소비자시대 웹진, 전국 결혼서비스 가격 첫 공개  
  https://www.kca.go.kr/webzine/board/view?div=kca_2507&linkId=868&menuId=MENU00307
- 한국소비자원, 결혼서비스 가격 첫 공개 보도자료 PDF  
  https://www.kca.go.kr/home/board/download.do?bid=00000013&did=1003876994&fno=10047193&menukey=4002

### Relationship / Communication Research

- Falconier, Jackson, Hilpert, Bodenmann (2015), Dyadic coping and relationship satisfaction: A meta-analysis  
  https://doi.org/10.1016/j.cpr.2015.07.002
- Rusu et al. (2020), Stress, dyadic coping, and relationship satisfaction: A longitudinal study  
  https://doi.org/10.1371/journal.pone.0231133
- Schrodt, Witt, Shimkowski (2014), Demand/withdraw meta-analysis  
  https://doi.org/10.1080/03637751.2013.813632
- Donato et al. (2014), Demand-withdraw, couple satisfaction and relationship duration  
  https://doi.org/10.1016/j.sbspro.2014.04.410

### Shared Decision / Decision Style Research

- Brick, Zhou, Chartrand, Fitzsimons (2022), Better to Decide Together  
  https://doi.org/10.1002/jcpy.1260
- Peetz et al. (2021), How partner-satisfying decisions benefit relationships  
  https://doi.org/10.1111/pere.12357
- Maximization strategies in relationship and career among South Korean adults  
  https://doi.org/10.1186/s40359-024-01672-2
- Domain specificity of maximizing decision-making style  
  https://www.cambridge.org/core/journals/judgment-and-decision-making/article/maximize-when-valuable-the-domain-specificity-of-maximizingdecisionmaking-style/AA39BFC53F3224D5D976DC9514D75598

### Experiential / Commemorative Consumption Research

- Gilovich, Kumar, Jampol (2015), A wonderful life: experiential consumption and the pursuit of happiness  
  https://static1.squarespace.com/static/5394dfa6e4b0d7fc44700a04/t/547d589ee4b04b0980670fee/1417500830665/Gilovich%2BKumar%2BJampol%2B%28in%2Bpress%29%2BA%2BWonderful%2BLife%2BJCP.pdf
- Kumar, Killingsworth, Gilovich (2020), Spending on doing promotes more moment-to-moment happiness than spending on having  
  https://www.sciencedirect.com/science/article/abs/pii/S0022103119305256
- Goodman, Malkoc, Stephenson (2016), Celebrate or Commemorate?  
  https://u.osu.edu/malkoc-5/files/2021/05/Goodman-Malkoc-and-Stephenson-JACR2016.pdf
- Consumer perceptions and pricing practices for weddings  
  https://link.springer.com/article/10.1007/s10603-021-09488-y

### Online Review / eWOM Research

- Qiu & Zhang (2023), How online reviews affect purchase intention: A meta-analysis  
  https://doi.org/10.1016/j.dim.2023.100058
- Purchasing in the digital age: a meta-analytical perspective on trust and eWOM  
  https://pmc.ncbi.nlm.nih.gov/articles/PMC11044045/
- The impact of online reviews on consumers' purchasing decisions: eye-tracking evidence  
  https://pmc.ncbi.nlm.nih.gov/articles/PMC9216200/
- Do review valence and review volume impact consumers' purchase intentions?  
  https://ideas.repec.org/a/eme/nbripp/v7y2016i2p231-257.html

### Relationship Education Boundary

- Halford/Bodenmann line of reviews summarized by Australian Institute of Family Studies  
  https://aifs.gov.au/all-research/family-matters/no-97/marriage-and-relationship-education
- Effects of relationship education on maintenance of couple relationship satisfaction  
  https://doi.org/10.1016/j.cpr.2013.02.001
- Systematic review/meta-analysis of marriage and relationship programs  
  https://doi.org/10.1186/s13643-021-01719-0
