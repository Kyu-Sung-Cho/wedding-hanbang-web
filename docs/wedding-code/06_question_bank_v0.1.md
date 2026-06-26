# WeddingCode Question Bank v0.1

## 0. Scope

- This file contains draft question candidates only.
- This file does not define final assessment questions, scoring logic, public codes, final types, characters, UI, routes, DB schema, or Amora prompt behavior.
- Public labels remain provisional presentation ideas and are not used as source-of-truth scoring.

## 1. Global Rules

- Questions are Korean, situational, and wedding-specific.
- Questions avoid abstract trait prompts.
- Response options avoid good-person versus bad-person framing.
- Questions avoid gender assumptions about bride, groom, partner, or task ownership.
- Questions avoid stigmatizing labels and describe support needs, decision patterns, or product routing.
- Every item has a primary target construct, journey stage tags, product mappings, and `Validation status: draft`.

## 2. Question Bank Summary

| Construct | Count |
|---|---:|
| costRisk | 6 |
| experienceMeaning | 6 |
| coPreparation | 6 |
| roleOwnership | 6 |
| evidenceDecision | 6 |
| aestheticMood | 6 |
| familyIntegration | 6 |
| coupleAutonomy | 6 |
| emotionalSupport | 6 |
| executionSupport | 6 |
| decisionPaceRisk | 6 |
| guidanceNeed | 6 |
| Total | 72 |

## 3. Draft Questions by Construct

### 3.1 costRisk

#### WC-Q-costRisk-001

Question ID: WC-Q-costRisk-001  
Target construct: costRisk  
Secondary constructs: experienceMeaning  
Journey stage tags: venue_search, contract_pending  
Scenario domain: 마음에 드는 예식장이 계획 예산보다 높음  
Question text in Korean: 마음에 드는 예식장이 예상보다 300만 원 비쌉니다. 상담 직후 가장 먼저 확인하고 싶은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 총액, 포함 항목, 추가금 가능성을 표로 정리한다.  
- B. 날짜와 홀 분위기가 우리에게 얼마나 맞는지 다시 떠올린다.  
- C. 양가 이동과 식사 만족도를 먼저 확인한다.  
- D. 상대와 이 장소가 남길 기억에 대해 이야기한다.  
High score meaning: 비용 구조와 추가 위험을 먼저 확인해야 결정 준비가 되는 경향을 시사한다.  
Low score meaning: 비용보다 경험, 가족 동선, 의미를 먼저 확인할 수 있음을 시사한다.  
Bias/stigma risk: 비용 확인을 사람의 가치나 애정 수준 평가로 연결하지 않는다.  
Gender stereotype risk: 예산 확인 역할을 특정 성별에게 배정하지 않는다.  
Report mapping: 예산 초과 상황에서 확인해야 할 비용 항목과 대화 순서를 제안한다.  
Amora mapping: 추가금 질문 목록과 상담 후 정리 메시지를 생성한다.  
/check mapping if relevant: 견적 포함 항목, 추가금, 환불 조건 체크로 연결한다.  
Etiquette/checklist mapping if relevant: 예산 재조정 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-costRisk-002

Question ID: WC-Q-costRisk-002  
Target construct: costRisk  
Secondary constructs: aestheticMood  
Journey stage tags: sdm_search, contract_pending  
Scenario domain: 드레스 업그레이드 또는 추가 피팅 비용 발생  
Question text in Korean: 드레스 투어 중 마음에 드는 드레스가 기본 패키지보다 추가 비용이 있습니다. 다음 행동으로 가장 가까운 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 추가 비용, 피팅비, 헬퍼비가 전체 견적에 어떻게 반영되는지 확인한다.  
- B. 드레스 실루엣과 사진에 남을 느낌을 먼저 비교한다.  
- C. 상대에게 사진을 보여주고 함께 고를지 정한다.  
- D. 비슷한 분위기의 다른 후보가 있는지 추천을 받는다.  
High score meaning: 선택 전 비용 변동과 포함 조건을 먼저 확인하려는 경향을 시사한다.  
Low score meaning: 시각적 만족, 공동 선택, 대안 탐색을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 비용 확인을 취향 부족이나 절약 평가로 해석하지 않는다.  
Gender stereotype risk: 드레스 선택과 비용 확인을 특정 성별의 책임으로 쓰지 않는다.  
Report mapping: 추가 옵션이 생기는 순간의 확인 순서를 제안한다.  
Amora mapping: 드레스 추가 비용 비교 질문을 정리한다.  
/check mapping if relevant: 드레스 추가금 체크 항목으로 연결한다.  
Etiquette/checklist mapping if relevant: SDM 계약 전 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-costRisk-003

Question ID: WC-Q-costRisk-003  
Target construct: costRisk  
Secondary constructs: decisionPaceRisk  
Journey stage tags: contract_pending  
Scenario domain: 박람회 또는 상담 당일 할인 제안  
Question text in Korean: 박람회 부스에서 오늘 계약하면 큰 할인을 준다고 합니다. 가장 먼저 하고 싶은 확인은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 할인 전후 총액과 취소·환불 조건을 문서로 확인한다.  
- B. 혜택이 끝나기 전에 필요한 일정부터 잡는다.  
- C. 상대와 이 선택이 우리 일정에 맞는지 이야기한다.  
- D. 같은 조건의 다른 업체 후기를 찾아본다.  
High score meaning: 할인보다 계약 위험과 총액 조건을 먼저 확인하려는 경향을 시사한다.  
Low score meaning: 일정 확정, 공동 논의, 후기 확인을 먼저 할 수 있음을 시사한다.  
Bias/stigma risk: 빠른 확인 욕구를 불안이나 성격 평가로 연결하지 않는다.  
Gender stereotype risk: 계약 판단 책임을 특정 성별에게 두지 않는다.  
Report mapping: 당일 할인 상황에서 보류·확인해야 할 항목을 제안한다.  
Amora mapping: 상담장에서 물어볼 계약 조건 질문을 생성한다.  
/check mapping if relevant: 당일 계약 전 위험 체크로 연결한다.  
Etiquette/checklist mapping if relevant: 계약 보류 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-costRisk-004

Question ID: WC-Q-costRisk-004  
Target construct: costRisk  
Secondary constructs: familyIntegration  
Journey stage tags: venue_search, contract_pending  
Scenario domain: 최소 보증 인원이 예상보다 높음  
Question text in Korean: 마음에 드는 홀이 있지만 최소 보증 인원이 예상보다 높습니다. 무엇을 먼저 확인하고 싶나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 보증 인원 미달 시 비용과 식대 총액 변화를 계산한다.  
- B. 실제 초대할 수 있는 하객 범위를 양가와 맞춰본다.  
- C. 홀 분위기와 동선이 하객 경험에 맞는지 본다.  
- D. 다른 날짜나 시간대에 조건이 달라지는지 문의한다.  
High score meaning: 보증 인원과 식대가 만드는 비용 위험을 먼저 확인하려는 경향을 시사한다.  
Low score meaning: 가족 조율, 하객 경험, 일정 대안을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 하객 규모 판단을 가족 배려 수준 평가로 연결하지 않는다.  
Gender stereotype risk: 하객 조율을 특정 가족 또는 성별의 역할로 두지 않는다.  
Report mapping: 보증 인원 결정 전에 계산해야 할 비용 시나리오를 제안한다.  
Amora mapping: 보증 인원별 총액 비교표를 요청하도록 돕는다.  
/check mapping if relevant: 보증 인원, 식대, 미달 비용 체크로 연결한다.  
Etiquette/checklist mapping if relevant: 양가 하객수 조율 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-costRisk-005

Question ID: WC-Q-costRisk-005  
Target construct: costRisk  
Secondary constructs: evidenceDecision  
Journey stage tags: sdm_search, contract_pending  
Scenario domain: 스튜디오 패키지 포함 항목이 불명확함  
Question text in Korean: 스튜디오 패키지가 좋아 보이지만 원본, 보정, 헬퍼, 얼리스타트 비용이 분명하지 않습니다. 가장 먼저 할 일은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 포함·불포함 항목과 추가 비용을 항목별로 요청한다.  
- B. 포트폴리오 분위기가 원하는 무드와 맞는지 더 본다.  
- C. 비슷한 패키지를 이용한 실제 후기를 찾는다.  
- D. 상대와 촬영에 꼭 필요한 항목을 먼저 정한다.  
High score meaning: 패키지의 숨은 비용과 조건을 먼저 확인하려는 경향을 시사한다.  
Low score meaning: 무드, 후기, 공동 기준을 먼저 확인할 수 있음을 시사한다.  
Bias/stigma risk: 비용 세부 확인을 과도한 의심으로 표현하지 않는다.  
Gender stereotype risk: 촬영 준비를 특정 성별의 관심사로 쓰지 않는다.  
Report mapping: SDM 견적의 불명확한 항목을 정리할 필요를 보여준다.  
Amora mapping: 스튜디오 견적 질문 리스트를 생성한다.  
/check mapping if relevant: 원본·보정·헬퍼·추가 촬영비 체크로 연결한다.  
Etiquette/checklist mapping if relevant: 촬영 계약 전 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-costRisk-006

Question ID: WC-Q-costRisk-006  
Target construct: costRisk  
Secondary constructs: evidenceDecision  
Journey stage tags: contract_pending, contracted  
Scenario domain: 계약금, 환불, 취소 조건이 불명확함  
Question text in Korean: 업체가 계약금을 안내했지만 환불과 일정 변경 조건은 자세히 설명하지 않았습니다. 다음 중 가장 먼저 필요한 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 환불, 취소, 일정 변경 조건을 계약서 문구로 확인한다.  
- B. 상담자가 말한 내용을 메시지로 다시 정리해 달라고 한다.  
- C. 다른 예비부부가 비슷한 상황을 어떻게 처리했는지 찾아본다.  
- D. 상대와 이 업체를 계속 후보로 둘지 먼저 이야기한다.  
High score meaning: 계약 전 법적·비용 조건을 명확히 해야 안정감을 느끼는 경향을 시사한다.  
Low score meaning: 구두 확인, 후기 탐색, 관계적 논의를 먼저 할 수 있음을 시사한다.  
Bias/stigma risk: 계약 확인을 불신이나 부정적 성향으로 표현하지 않는다.  
Gender stereotype risk: 계약 검토를 특정 성별의 책임으로 정하지 않는다.  
Report mapping: 계약서 확인 우선순위와 보류 기준을 제안한다.  
Amora mapping: 계약 문구 확인 질문과 메시지 초안을 생성한다.  
/check mapping if relevant: 환불·취소·변경 조건 체크로 연결한다.  
Etiquette/checklist mapping if relevant: 계약 전 최종 확인 체크리스트로 연결한다.  
Validation status: draft

### 3.2 experienceMeaning

#### WC-Q-experienceMeaning-001

Question ID: WC-Q-experienceMeaning-001  
Target construct: experienceMeaning  
Secondary constructs: costRisk  
Journey stage tags: sdm_search  
Scenario domain: 마음에 드는 드레스가 기본 패키지를 초과함  
Question text in Korean: 입어본 드레스 중 하나가 사진에 오래 남을 것 같지만 추가 비용이 있습니다. 무엇을 먼저 생각하나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 사진으로 남았을 때의 만족감과 의미가 어느 정도인지 본다.  
- B. 추가 비용이 전체 예산 안에서 가능한지 계산한다.  
- C. 비슷한 느낌의 다른 드레스를 더 찾아본다.  
- D. 상대와 어떤 장면을 남기고 싶은지 이야기한다.  
High score meaning: 오래 남는 경험과 기억의 의미를 중요한 결정 입력으로 보는 경향을 시사한다.  
Low score meaning: 비용 안정성, 대안 탐색, 공동 논의를 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 의미를 중시하는 선택을 과장된 소비로 표현하지 않는다.  
Gender stereotype risk: 드레스나 사진 의미를 특정 성별의 관심으로 제한하지 않는다.  
Report mapping: 기억으로 남길 항목과 조정 가능한 항목을 분리하도록 제안한다.  
Amora mapping: 드레스 선택에서 의미와 예산을 함께 정리한다.  
/check mapping if relevant: 추가 비용 확인으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: SDM 우선순위 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-experienceMeaning-002

Question ID: WC-Q-experienceMeaning-002  
Target construct: experienceMeaning  
Secondary constructs: aestheticMood  
Journey stage tags: sdm_search  
Scenario domain: 원하는 스튜디오 무드가 예상보다 비쌈  
Question text in Korean: 원하는 분위기의 스튜디오가 예상보다 비싸지만 사진을 오래 볼 것 같습니다. 가장 먼저 확인하고 싶은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 우리가 오래 보고 싶은 사진 분위기인지 다시 확인한다.  
- B. 원본, 보정, 앨범 구성까지 포함한 총액을 비교한다.  
- C. 같은 분위기의 더 현실적인 후보를 찾아본다.  
- D. 촬영보다 예식 당일 경험에 예산을 더 둘지 생각한다.  
High score meaning: 사진과 추억의 지속 가치를 먼저 판단하려는 경향을 시사한다.  
Low score meaning: 비용 구조, 대안, 예산 배분을 먼저 고려할 수 있음을 시사한다.  
Bias/stigma risk: 사진 의미를 외형 평가나 과시로 연결하지 않는다.  
Gender stereotype risk: 촬영 취향을 특정 성별의 역할로 표현하지 않는다.  
Report mapping: 사진·영상 예산의 의미 기준을 정리하도록 제안한다.  
Amora mapping: 스튜디오 무드와 예산 조정안을 함께 제시한다.  
/check mapping if relevant: 스튜디오 총액 확인에 연결한다.  
Etiquette/checklist mapping if relevant: 촬영 후보 비교 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-experienceMeaning-003

Question ID: WC-Q-experienceMeaning-003  
Target construct: experienceMeaning  
Secondary constructs: executionSupport  
Journey stage tags: contracted  
Scenario domain: 웨딩 영상이 선택 옵션이지만 의미 있게 느껴짐  
Question text in Korean: 웨딩 영상은 선택 옵션이지만, 나중에 가족과 함께 다시 보고 싶다는 생각이 듭니다. 다음 행동으로 가장 가까운 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 영상이 우리에게 어떤 기억으로 남을지 먼저 이야기한다.  
- B. 영상 상품별 구성과 가격 차이를 비교한다.  
- C. 촬영 없이도 남길 수 있는 다른 기록 방법을 찾는다.  
- D. 우선순위 표에 넣고 다른 지출과 함께 조정한다.  
High score meaning: 결혼식 이후에도 남는 정서적 기록을 중요하게 보는 경향을 시사한다.  
Low score meaning: 비용 비교, 대안 기록, 실행 계획을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 기록 욕구를 과한 욕심으로 쓰지 않는다.  
Gender stereotype risk: 영상 기록 의미를 특정 가족 역할과 연결하지 않는다.  
Report mapping: 기록성 항목의 우선순위를 대화할 수 있게 제안한다.  
Amora mapping: 영상 포함 여부를 결정하는 질문 목록을 만든다.  
/check mapping if relevant: 영상 옵션 비용 확인에 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 기록 항목 결정 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-experienceMeaning-004

Question ID: WC-Q-experienceMeaning-004  
Target construct: experienceMeaning  
Secondary constructs: aestheticMood  
Journey stage tags: contracted  
Scenario domain: 플라워 업그레이드가 예식 분위기를 크게 바꿈  
Question text in Korean: 플라워 구성을 조금 바꾸면 예식 분위기가 훨씬 우리답게 느껴질 것 같습니다. 무엇을 먼저 해보고 싶나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 그 변화가 예식 경험과 사진에 얼마나 의미 있는지 본다.  
- B. 변경 비용과 기본 구성의 차이를 확인한다.  
- C. 색감 참고 이미지를 모아 업체에 가능한 범위를 묻는다.  
- D. 하객 동선이나 식사 만족도에 더 중요한 예산이 있는지 본다.  
High score meaning: 예식 현장의 경험과 기억을 중요한 판단 기준으로 삼는 경향을 시사한다.  
Low score meaning: 비용, 시각 참고, 하객 경험을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 분위기 중시를 과한 장식 선호로 단정하지 않는다.  
Gender stereotype risk: 플라워나 장식을 특정 성별 취향으로 표현하지 않는다.  
Report mapping: 의미 있는 디테일과 조정 가능한 디테일을 나누도록 돕는다.  
Amora mapping: 플라워 변경안과 예산 조정 메시지를 만든다.  
/check mapping if relevant: 변경 비용 확인으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 예식 연출 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-experienceMeaning-005

Question ID: WC-Q-experienceMeaning-005  
Target construct: experienceMeaning  
Secondary constructs: familyIntegration  
Journey stage tags: venue_search  
Scenario domain: 예식장 분위기는 이상적이지만 가장 편한 선택은 아님  
Question text in Korean: 한 예식장은 분위기가 정말 마음에 들지만 교통은 다른 후보가 더 편합니다. 무엇을 먼저 비교하나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 우리가 기억하고 싶은 예식 경험에 어느 쪽이 가까운지 본다.  
- B. 하객 이동과 주차가 실제로 얼마나 불편할지 확인한다.  
- C. 식대와 대관 조건을 먼저 비교한다.  
- D. 양가가 중요하게 보는 기준을 들어본다.  
High score meaning: 예식 경험의 의미와 분위기를 강하게 고려하는 경향을 시사한다.  
Low score meaning: 하객 편의, 비용, 가족 기준을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 분위기 선택을 현실 조건과 분리된 선택으로 표현하지 않는다.  
Gender stereotype risk: 분위기와 동선 판단을 성별 역할로 나누지 않는다.  
Report mapping: 분위기와 하객 편의를 함께 비교하는 기준표를 제안한다.  
Amora mapping: 예식장 후보별 기억 가치와 실무 조건을 정리한다.  
/check mapping if relevant: 예식장 비용·조건 확인으로 연결한다.  
Etiquette/checklist mapping if relevant: 예식장 비교 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-experienceMeaning-006

Question ID: WC-Q-experienceMeaning-006  
Target construct: experienceMeaning  
Secondary constructs: coupleAutonomy  
Journey stage tags: contracted, wedding_week  
Scenario domain: 예식 메시지, 서약, 감사 표현의 의미  
Question text in Korean: 예식 순서 중 서약이나 부모님 감사 표현을 넣을지 정해야 합니다. 가장 먼저 떠오르는 기준은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 시간이 지나도 우리에게 의미 있게 남을 장면인지 본다.  
- B. 양가가 부담 없이 받아들일 수 있는 방식인지 본다.  
- C. 진행 시간과 사회자 동선을 먼저 확인한다.  
- D. 형식은 줄이고 우리다운 표현만 남길지 이야기한다.  
High score meaning: 예식의 정서적 메시지와 오래 남는 의미를 중요하게 보는 경향을 시사한다.  
Low score meaning: 가족 수용성, 진행 효율, 자율적 간소화를 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 의미 표현 방식을 관계의 깊이 평가로 쓰지 않는다.  
Gender stereotype risk: 감사 표현 책임을 특정 성별이나 가족에게 배정하지 않는다.  
Report mapping: 예식 메시지와 진행 현실을 함께 정리하도록 제안한다.  
Amora mapping: 서약·감사 표현 선택지를 부드럽게 제안한다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 예식 순서 체크리스트로 연결한다.  
Validation status: draft

### 3.3 coPreparation

#### WC-Q-coPreparation-001

Question ID: WC-Q-coPreparation-001  
Target construct: coPreparation  
Secondary constructs: roleOwnership  
Journey stage tags: preparing_without_date, venue_search  
Scenario domain: 상대가 사용자를 믿고 결정해도 된다고 함  
Question text in Korean: 상대가 "네가 더 잘 아니까 먼저 골라줘"라고 말했습니다. 이때 가장 필요한 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 최종 결정 전에는 같이 보고 이야기하는 시간을 정한다.  
- B. 내가 후보를 좁히고 상대는 마지막에 확인하는 방식으로 한다.  
- C. 필요한 기준만 공유받고 빠르게 진행한다.  
- D. 어떤 항목은 함께, 어떤 항목은 나눠서 할지 정한다.  
High score meaning: 준비 과정이 함께하는 경험으로 느껴지길 바라는 경향을 시사한다.  
Low score meaning: 위임, 역할 분담, 빠른 진행을 편하게 느낄 수 있음을 시사한다.  
Bias/stigma risk: 함께하고 싶은 기대를 부담이나 통제로 표현하지 않는다.  
Gender stereotype risk: 조사나 결정 책임을 특정 성별에게 두지 않는다.  
Report mapping: 함께 결정할 항목과 위임할 항목을 구분하도록 제안한다.  
Amora mapping: 상대에게 공유할 대화 문장을 만든다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 커플 준비 역할표로 연결한다.  
Validation status: draft

#### WC-Q-coPreparation-002

Question ID: WC-Q-coPreparation-002  
Target construct: coPreparation  
Secondary constructs: emotionalSupport  
Journey stage tags: venue_search, sdm_search  
Scenario domain: 며칠 동안 혼자 업체를 조사함  
Question text in Korean: 며칠 동안 혼자 업체를 찾아보다가 선택지가 너무 많아졌습니다. 다음 중 가장 가까운 반응은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 상대와 같이 보며 기준을 다시 맞추고 싶다.  
- B. 후보를 내가 줄인 뒤 상대에게 확인받고 싶다.  
- C. 아모라가 우선순위를 정리해주면 좋겠다.  
- D. 바로 상담 가능한 후보부터 진행하고 싶다.  
High score meaning: 조사 과정에서도 상대의 참여와 기준 공유를 원할 가능성을 시사한다.  
Low score meaning: 위임형 진행, 가이드 도움, 실행 중심 진행을 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 함께 보고 싶은 마음을 준비 능력 평가로 연결하지 않는다.  
Gender stereotype risk: 혼자 조사하는 상황을 특정 성별의 기본 역할로 두지 않는다.  
Report mapping: 준비 피로가 커지기 전 공동 리뷰 루틴을 제안한다.  
Amora mapping: 후보 압축과 커플 공유 요약을 생성한다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 후보 공유 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-coPreparation-003

Question ID: WC-Q-coPreparation-003  
Target construct: coPreparation  
Secondary constructs: evidenceDecision  
Journey stage tags: contract_pending  
Scenario domain: 중요한 결정을 상대와 충분히 논의하지 못함  
Question text in Korean: 상담 후 마음에 드는 업체가 생겼지만 상대는 아직 자세히 보지 못했습니다. 무엇이 먼저 필요하다고 느끼나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 결정 전에 같이 볼 핵심 자료와 시간을 마련한다.  
- B. 내가 본 장단점을 정리해 보내고 의견을 받는다.  
- C. 견적과 계약 조건부터 검토해 결정 가능성을 본다.  
- D. 일정이 촉박하면 우선 보류 가능 여부를 묻는다.  
High score meaning: 중요한 선택은 함께 검토해야 안정감을 느끼는 경향을 시사한다.  
Low score meaning: 요약 공유, 근거 검토, 일정 관리로도 진행할 수 있음을 시사한다.  
Bias/stigma risk: 공동 검토 욕구를 상대에 대한 평가로 쓰지 않는다.  
Gender stereotype risk: 최종 결정권을 특정 성별에게 부여하지 않는다.  
Report mapping: 결정 전 같이 봐야 할 자료를 제안한다.  
Amora mapping: 상대 공유용 상담 요약을 만든다.  
/check mapping if relevant: 계약 조건 검토로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 공동 결정 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-coPreparation-004

Question ID: WC-Q-coPreparation-004  
Target construct: coPreparation  
Secondary constructs: executionSupport  
Journey stage tags: preparing_without_date, contracted  
Scenario domain: 정기적인 결혼 준비 회의 필요  
Question text in Korean: 준비할 일이 늘어나면서 서로 알고 있는 정보가 달라졌습니다. 어떤 방식이 가장 편할 것 같나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 짧아도 정기적으로 같이 정리하는 시간을 둔다.  
- B. 담당자별로 진행하고 필요한 때만 공유한다.  
- C. 할 일과 마감일을 먼저 표로 정리한다.  
- D. 아모라가 오늘 함께 볼 항목만 골라주면 좋겠다.  
High score meaning: 결혼 준비를 공동 과정으로 유지하려는 기대가 높을 수 있음을 시사한다.  
Low score meaning: 역할 분담, 실행 정리, 압축 가이드를 선호할 수 있음을 시사한다.  
Bias/stigma risk: 정기 대화를 요구나 간섭으로 표현하지 않는다.  
Gender stereotype risk: 회의 주도자를 특정 성별로 가정하지 않는다.  
Report mapping: 커플 준비 회의 주기와 안건 예시를 제안한다.  
Amora mapping: 주간 준비 회의 안건을 생성한다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 주간 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-coPreparation-005

Question ID: WC-Q-coPreparation-005  
Target construct: coPreparation  
Secondary constructs: coupleAutonomy  
Journey stage tags: marriage_discussion, preparing_without_date  
Scenario domain: 어떤 항목을 함께 볼지 정해야 함  
Question text in Korean: 결혼 준비를 시작하며 어떤 결정은 함께 보고, 어떤 일은 나눠 맡을지 정하려고 합니다. 가장 먼저 정하고 싶은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 두 사람이 꼭 같이 결정해야 하는 항목을 먼저 고른다.  
- B. 각자 잘하는 영역과 담당할 일을 먼저 나눈다.  
- C. 양가와 상의해야 하는 항목을 먼저 구분한다.  
- D. 예산과 일정에 영향이 큰 항목부터 정한다.  
High score meaning: 준비 과정의 공동성을 명확히 설계하고 싶은 경향을 시사한다.  
Low score meaning: 역할 효율, 가족 조율, 비용·일정 기준을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 함께 결정하고 싶은 항목 수로 관계 수준을 판단하지 않는다.  
Gender stereotype risk: 취향·예산·가족 대응 역할을 성별로 나누지 않는다.  
Report mapping: 공동 결정 항목과 위임 가능 항목을 구분한다.  
Amora mapping: 커플 준비 규칙 초안을 만든다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 준비 시작 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-coPreparation-006

Question ID: WC-Q-coPreparation-006  
Target construct: coPreparation  
Secondary constructs: emotionalSupport  
Journey stage tags: venue_search, contract_pending  
Scenario domain: 상담 후 함께 되짚는 습관  
Question text in Korean: 예식장 상담을 다녀온 뒤 서로 느낀 점이 다를 수 있습니다. 상담 직후 가장 하고 싶은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 좋았던 점과 걱정되는 점을 함께 이야기한다.  
- B. 견적과 계약 조건을 먼저 정리한다.  
- C. 다음 상담 예약과 비교 기준을 바로 정한다.  
- D. 각자 생각을 적어두고 나중에 한 번에 본다.  
High score meaning: 상담 경험을 함께 해석하고 결정하고 싶은 경향을 시사한다.  
Low score meaning: 조건 정리, 실행 계획, 개별 검토를 먼저 선호할 수 있음을 시사한다.  
Bias/stigma risk: 함께 되짚기 욕구를 결정 지연으로 표현하지 않는다.  
Gender stereotype risk: 상담 소감 공유를 특정 성별의 역할로 두지 않는다.  
Report mapping: 상담 후 커플 디브리프 질문을 제안한다.  
Amora mapping: 상담 후 같이 볼 요약 질문을 생성한다.  
/check mapping if relevant: 견적 비교로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 상담 후 체크리스트로 연결한다.  
Validation status: draft

### 3.4 roleOwnership

#### WC-Q-roleOwnership-001

Question ID: WC-Q-roleOwnership-001  
Target construct: roleOwnership  
Secondary constructs: guidanceNeed  
Journey stage tags: venue_search, sdm_search  
Scenario domain: 많은 업체 후보를 줄여야 함  
Question text in Korean: 예식장이나 스튜디오 후보가 너무 많아졌습니다. 어떤 방식이 가장 진행하기 편한가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 한 사람이 기준대로 후보를 줄이고 둘이 최종 후보를 본다.  
- B. 처음부터 둘이 모든 후보를 같이 본다.  
- C. 아모라가 상위 후보만 먼저 압축해준다.  
- D. 비용이나 일정 조건이 맞는 후보부터 자동으로 제외한다.  
High score meaning: 담당자가 후보를 정리하고 공동 결정으로 넘기는 방식을 선호할 수 있음을 시사한다.  
Low score meaning: 처음부터 공동 탐색이나 가이드 압축을 더 선호할 수 있음을 시사한다.  
Bias/stigma risk: 역할 주도를 관심의 크기 평가로 표현하지 않는다.  
Gender stereotype risk: 후보 조사 담당을 특정 성별로 가정하지 않는다.  
Report mapping: 후보 압축 담당과 최종 결정 방식을 제안한다.  
Amora mapping: 역할별 후보 정리 흐름을 제시한다.  
/check mapping if relevant: 조건 기반 제외 기준으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 후보 검토 역할표로 연결한다.  
Validation status: draft

#### WC-Q-roleOwnership-002

Question ID: WC-Q-roleOwnership-002  
Target construct: roleOwnership  
Secondary constructs: costRisk  
Journey stage tags: preparing_without_date, contracted  
Scenario domain: 예산 추적 담당을 정해야 함  
Question text in Korean: 결혼 예산표를 누가 관리할지 정해야 합니다. 가장 맞는 방식은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 한 사람이 예산표를 책임지고 변경 사항을 공유한다.  
- B. 모든 지출을 둘이 함께 입력하고 확인한다.  
- C. 큰 항목만 같이 보고 작은 항목은 담당자에게 맡긴다.  
- D. 아모라가 예산 변동을 요약해주면 좋겠다.  
High score meaning: 명확한 담당자와 공유 규칙을 선호할 가능성을 시사한다.  
Low score meaning: 공동 관리, 항목별 분담, 자동 요약을 선호할 수 있음을 시사한다.  
Bias/stigma risk: 예산 담당 선호를 통제나 회피로 표현하지 않는다.  
Gender stereotype risk: 돈 관리 담당을 성별로 정하지 않는다.  
Report mapping: 예산표 소유자와 공유 주기를 제안한다.  
Amora mapping: 예산 변경 요약과 공유 문장을 만든다.  
/check mapping if relevant: 예산 항목 확인으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 예산 관리 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-roleOwnership-003

Question ID: WC-Q-roleOwnership-003  
Target construct: roleOwnership  
Secondary constructs: coPreparation  
Journey stage tags: sdm_search  
Scenario domain: 서로 강점이 다른 영역이 있음  
Question text in Korean: 한 사람은 스타일 비교를 잘하고, 다른 한 사람은 조건 비교를 잘합니다. 준비 방식으로 가장 가까운 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 각자 강점이 있는 영역을 맡고 결과를 공유한다.  
- B. 모든 후보를 함께 보고 같은 기준으로 고른다.  
- C. 먼저 취향을 맞춘 뒤 조건 비교를 같이 한다.  
- D. 조건 비교 후 마음에 드는 후보만 같이 본다.  
High score meaning: 역할별 주도와 결과 공유가 편한 준비 방식일 수 있음을 시사한다.  
Low score meaning: 공동 검토나 단계별 합의를 더 선호할 수 있음을 시사한다.  
Bias/stigma risk: 강점 분담을 관심 차이나 능력 평가로 표현하지 않는다.  
Gender stereotype risk: 스타일과 조건 비교를 성별과 연결하지 않는다.  
Report mapping: 강점 기반 역할 분담과 공유 기준을 제안한다.  
Amora mapping: 둘의 강점을 반영한 업무 분담안을 만든다.  
/check mapping if relevant: 조건 비교 항목으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 역할 분담 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-roleOwnership-004

Question ID: WC-Q-roleOwnership-004  
Target construct: roleOwnership  
Secondary constructs: executionSupport  
Journey stage tags: contracted, wedding_week  
Scenario domain: 여러 작업에 담당자와 마감이 필요함  
Question text in Korean: 청첩장, 예복, 촬영 준비, 혼주 동선처럼 할 일이 동시에 생겼습니다. 어떤 정리가 가장 필요합니까?  
Response format: forced_choice  
Response options in Korean:  
- A. 일마다 담당자와 마감일을 정한다.  
- B. 둘이 매번 같이 확인하며 진행한다.  
- C. 급한 일부터 아모라가 순서를 잡아준다.  
- D. 가족에게 확인이 필요한 일부터 따로 묶는다.  
High score meaning: 업무별 소유자와 마감이 있어야 진행이 편한 경향을 시사한다.  
Low score meaning: 공동 확인, 우선순위 가이드, 가족 조율을 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 역할 명확화를 관계 거리감으로 표현하지 않는다.  
Gender stereotype risk: 특정 업무를 성별로 배정하지 않는다.  
Report mapping: 담당자·마감 기반 준비표를 제안한다.  
Amora mapping: 이번 주 담당자별 할 일을 생성한다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 실행 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-roleOwnership-005

Question ID: WC-Q-roleOwnership-005  
Target construct: roleOwnership  
Secondary constructs: coPreparation  
Journey stage tags: preparing_without_date, venue_search  
Scenario domain: 상대가 모든 디테일을 함께 보고 싶어함  
Question text in Korean: 상대는 모든 후보를 같이 보고 싶어하지만, 당신은 시간이 부족하다고 느낍니다. 어떤 방식이 가장 맞나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 담당자가 먼저 정리하고 핵심 후보만 함께 본다.  
- B. 시간이 걸려도 처음부터 같이 본다.  
- C. 같이 볼 기준을 먼저 정하고 후보 수를 줄인다.  
- D. 아모라가 둘 다 볼 필요가 큰 항목을 골라준다.  
High score meaning: 효율적인 역할 소유와 핵심 공유를 선호할 수 있음을 시사한다.  
Low score meaning: 공동 탐색이나 기준 합의를 더 중요하게 볼 수 있음을 시사한다.  
Bias/stigma risk: 효율 선호를 대화 회피로 표현하지 않는다.  
Gender stereotype risk: 함께 보기 선호와 정리 담당을 성별로 나누지 않는다.  
Report mapping: 공동 검토 범위와 위임 범위를 정리한다.  
Amora mapping: 같이 볼 후보만 압축하는 기준을 만든다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 의사결정 범위 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-roleOwnership-006

Question ID: WC-Q-roleOwnership-006  
Target construct: roleOwnership  
Secondary constructs: evidenceDecision  
Journey stage tags: contract_pending, contracted  
Scenario domain: 위임된 결정이 다시 공동 결정으로 올라와야 하는 순간  
Question text in Korean: 한 사람이 업체를 알아봤지만 계약 전에는 둘 다 확인해야 할 것 같습니다. 어떤 기준이 가장 필요합니까?  
Response format: forced_choice  
Response options in Korean:  
- A. 담당자가 정리한 자료를 바탕으로 최종 승인 기준을 정한다.  
- B. 처음부터 다시 같이 자료를 확인한다.  
- C. 계약서와 견적 조건만 같이 본다.  
- D. 마음에 걸리는 점만 각자 적어보고 결정한다.  
High score meaning: 위임과 최종 승인 경계를 명확히 하는 방식을 선호할 수 있음을 시사한다.  
Low score meaning: 완전 공동 검토, 핵심 조건 확인, 개별 우려 공유를 선호할 수 있음을 시사한다.  
Bias/stigma risk: 위임 방식을 책임 전가로 표현하지 않는다.  
Gender stereotype risk: 계약 최종 확인자를 성별로 정하지 않는다.  
Report mapping: 위임 후 최종 확인 프로토콜을 제안한다.  
Amora mapping: 담당자 요약과 공동 승인 체크를 만든다.  
/check mapping if relevant: 계약서와 견적 조건 확인으로 연결한다.  
Etiquette/checklist mapping if relevant: 최종 승인 체크리스트로 연결한다.  
Validation status: draft

### 3.5 evidenceDecision

#### WC-Q-evidenceDecision-001

Question ID: WC-Q-evidenceDecision-001  
Target construct: evidenceDecision  
Secondary constructs: aestheticMood  
Journey stage tags: sdm_search  
Scenario domain: 사진은 좋지만 후기가 적은 스튜디오  
Question text in Korean: 포트폴리오는 마음에 들지만 실제 이용 후기가 많지 않은 스튜디오가 있습니다. 무엇을 먼저 확인하나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 최근 후기, 실제 촬영본, 유사 조건 사례를 찾는다.  
- B. 포트폴리오의 색감과 분위기가 우리와 맞는지 본다.  
- C. 상담에서 원본과 보정 기준을 직접 묻는다.  
- D. 다른 후보와 가격·구성표를 비교한다.  
High score meaning: 시각적 매력보다 검증 가능한 근거를 먼저 보려는 경향을 시사한다.  
Low score meaning: 무드 적합성, 상담 확인, 가격 비교를 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 근거 확인을 더 나은 판단으로 서열화하지 않는다.  
Gender stereotype risk: 리뷰 확인 역할을 성별로 배정하지 않는다.  
Report mapping: 후기가 적은 후보를 판단할 검증 자료를 제안한다.  
Amora mapping: 실제 사례 요청 메시지와 확인 질문을 만든다.  
/check mapping if relevant: 구성·원본·보정 조건 확인으로 연결한다.  
Etiquette/checklist mapping if relevant: 스튜디오 검증 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-evidenceDecision-002

Question ID: WC-Q-evidenceDecision-002  
Target construct: evidenceDecision  
Secondary constructs: costRisk  
Journey stage tags: contract_pending  
Scenario domain: 견적서 포함 항목이 구체적이지 않음  
Question text in Korean: 받은 견적서에 포함 항목이 간단히만 적혀 있습니다. 다음 중 가장 먼저 하고 싶은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 항목별 포함·불포함과 추가 비용 가능성을 문서로 받는다.  
- B. 총액이 예산 범위 안에 들어오는지 먼저 본다.  
- C. 상담자가 추천한 이유와 장점을 다시 듣는다.  
- D. 커뮤니티에서 비슷한 견적 사례를 찾아본다.  
High score meaning: 명확한 문서와 비교 가능한 정보가 있어야 안심하는 경향을 시사한다.  
Low score meaning: 총액, 전문가 설명, 사례 탐색을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 문서 확인을 까다로움으로 표현하지 않는다.  
Gender stereotype risk: 견적 검토 담당을 특정 성별로 고정하지 않는다.  
Report mapping: 견적서의 빈칸과 확인 요청 항목을 제안한다.  
Amora mapping: 업체에 보낼 포함 항목 확인 문장을 만든다.  
/check mapping if relevant: 견적 상세 검증으로 연결한다.  
Etiquette/checklist mapping if relevant: 계약 전 확인 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-evidenceDecision-003

Question ID: WC-Q-evidenceDecision-003  
Target construct: evidenceDecision  
Secondary constructs: decisionPaceRisk  
Journey stage tags: contract_pending  
Scenario domain: 계약 조건이 이해하기 어려움  
Question text in Korean: 계약서 문구가 길고 일부 조건이 이해하기 어렵습니다. 가장 필요한 도움은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 취소, 변경, 추가 비용 조항을 쉬운 말로 풀어 확인한다.  
- B. 상담자에게 중요한 부분만 표시해 달라고 요청한다.  
- C. 상대와 불안한 조항을 같이 읽어본다.  
- D. 계약은 보류하고 다른 업체 조건과 비교한다.  
High score meaning: 이해 가능한 근거와 조항 확인이 결정 준비에 중요함을 시사한다.  
Low score meaning: 상담 설명, 공동 읽기, 비교 보류를 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 계약 이해 필요를 지식 수준 평가로 연결하지 않는다.  
Gender stereotype risk: 계약서 독해를 특정 성별의 역할로 정하지 않는다.  
Report mapping: 이해가 필요한 계약 조항을 보고서에 표시한다.  
Amora mapping: 계약서 질문 목록과 쉬운 설명을 만든다.  
/check mapping if relevant: 계약 조항 점검으로 연결한다.  
Etiquette/checklist mapping if relevant: 계약 전 읽기 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-evidenceDecision-004

Question ID: WC-Q-evidenceDecision-004  
Target construct: evidenceDecision  
Secondary constructs: costRisk  
Journey stage tags: venue_search, sdm_search  
Scenario domain: 상담 전 시세를 비교하고 싶음  
Question text in Korean: 상담 예약 전, 제안받은 가격이 적절한지 감이 오지 않습니다. 무엇을 먼저 해보고 싶나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 비슷한 지역·날짜·구성의 실제 가격대를 확인한다.  
- B. 마음에 드는 후보인지 먼저 보고 상담을 잡는다.  
- C. 아모라에게 내 조건에서 볼 만한 후보를 압축해 달라고 한다.  
- D. 상대와 예산 상한선을 먼저 정한다.  
High score meaning: 결정 전에 비교 가능한 시장 근거를 확보하려는 경향을 시사한다.  
Low score meaning: 후보 매력, 가이드 압축, 예산 합의를 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 시세 확인을 과도한 계산으로 표현하지 않는다.  
Gender stereotype risk: 가격 비교를 특정 성별의 기본 업무로 보지 않는다.  
Report mapping: 지역·날짜·구성 기준 시세 확인을 제안한다.  
Amora mapping: 상담 전 비교 기준과 질문을 생성한다.  
/check mapping if relevant: 시세·견적 비교로 연결한다.  
Etiquette/checklist mapping if relevant: 상담 준비 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-evidenceDecision-005

Question ID: WC-Q-evidenceDecision-005  
Target construct: evidenceDecision  
Secondary constructs: guidanceNeed  
Journey stage tags: venue_search, sdm_search  
Scenario domain: 비슷한 커플의 실제 결제 사례가 필요함  
Question text in Korean: 업체 설명은 좋지만 우리와 비슷한 조건의 실제 결제 사례가 궁금합니다. 가장 보고 싶은 정보는 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 같은 지역, 비슷한 날짜와 인원 조건의 실제 결제 사례를 본다.  
- B. 업체가 추천하는 대표 패키지 구성을 먼저 본다.  
- C. 포트폴리오나 공간 사진을 더 비교한다.  
- D. 상대와 우리가 꼭 필요한 항목만 정한다.  
High score meaning: 유사 조건의 실제 사례가 결정 신뢰에 중요함을 시사한다.  
Low score meaning: 업체 추천, 시각 자료, 필요 항목 합의를 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 사례 확인을 의심이나 우월한 방식으로 표현하지 않는다.  
Gender stereotype risk: 실제 사례 탐색을 성별 역할로 두지 않는다.  
Report mapping: 유사 조건 사례를 근거로 판단하도록 안내한다.  
Amora mapping: 커뮤니티 사례 탐색 질문을 제안한다.  
/check mapping if relevant: 실제 결제 사례 비교로 연결한다.  
Etiquette/checklist mapping if relevant: 후보 검증 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-evidenceDecision-006

Question ID: WC-Q-evidenceDecision-006  
Target construct: evidenceDecision  
Secondary constructs: decisionPaceRisk  
Journey stage tags: contract_pending  
Scenario domain: 구두 약속을 서면으로 확인하고 싶음  
Question text in Korean: 상담 중 서비스 추가를 약속받았지만 계약서에는 아직 없습니다. 다음 행동으로 가장 가까운 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 약속 내용을 계약서나 메시지로 남겨 달라고 요청한다.  
- B. 상담자가 신뢰가 가는지 전체 인상을 다시 본다.  
- C. 상대와 이 혜택이 결정에 얼마나 중요한지 이야기한다.  
- D. 오늘 계약하지 않고 확인 후 결정한다.  
High score meaning: 구두 설명보다 확인 가능한 기록을 중시하는 경향을 시사한다.  
Low score meaning: 신뢰 인상, 공동 논의, 보류 판단을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 서면 확인을 관계 불신으로 표현하지 않는다.  
Gender stereotype risk: 기록 요청을 특정 성별의 역할로 두지 않는다.  
Report mapping: 구두 약속의 기록 필요성을 표시한다.  
Amora mapping: 서면 확인 요청 메시지를 작성한다.  
/check mapping if relevant: 계약 전 약속 기록 체크로 연결한다.  
Etiquette/checklist mapping if relevant: 계약 전 확인 체크리스트로 연결한다.  
Validation status: draft

### 3.6 aestheticMood

#### WC-Q-aestheticMood-001

Question ID: WC-Q-aestheticMood-001  
Target construct: aestheticMood  
Secondary constructs: evidenceDecision  
Journey stage tags: sdm_search  
Scenario domain: 포트폴리오가 원하는 무드와 잘 맞음  
Question text in Korean: 한 스튜디오의 포트폴리오가 상상하던 분위기와 거의 맞습니다. 다음 중 가장 먼저 끌리는 행동은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 이 무드가 우리 취향과 계속 맞는지 사진을 더 본다.  
- B. 실제 후기와 촬영 조건을 확인한다.  
- C. 견적 포함 항목을 먼저 비교한다.  
- D. 상대에게 같은 느낌인지 물어본다.  
High score meaning: 시각적 무드와 취향 일치감을 강한 선택 신호로 보는 경향을 시사한다.  
Low score meaning: 후기, 견적, 공동 확인을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 무드 반응을 표면적 판단으로 표현하지 않는다.  
Gender stereotype risk: 시각 취향 판단을 성별과 연결하지 않는다.  
Report mapping: 취향 기준과 검증 기준을 함께 제안한다.  
Amora mapping: 비슷한 무드 후보를 더 찾아준다.  
/check mapping if relevant: 견적 조건 확인으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 스튜디오 무드 비교 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-aestheticMood-002

Question ID: WC-Q-aestheticMood-002  
Target construct: aestheticMood  
Secondary constructs: familyIntegration  
Journey stage tags: venue_search  
Scenario domain: 예식장 첫인상이 강하게 맞음  
Question text in Korean: 투어 중 한 홀에 들어갔을 때 분위기가 우리와 잘 맞는다고 느꼈습니다. 무엇을 먼저 확인하고 싶나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 공간감, 조명, 색감이 원하는 예식 이미지와 맞는지 본다.  
- B. 하객 동선과 식사 공간이 편한지 확인한다.  
- C. 식대와 보증 인원을 먼저 계산한다.  
- D. 부모님이 보셨을 때도 무리가 없을지 생각한다.  
High score meaning: 공간의 첫인상과 분위기를 중요한 결정 기준으로 보는 경향을 시사한다.  
Low score meaning: 하객 편의, 비용, 가족 수용성을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 첫인상 반응을 가벼운 판단으로 표현하지 않는다.  
Gender stereotype risk: 공간 분위기 판단을 특정 성별 관심으로 쓰지 않는다.  
Report mapping: 분위기 만족과 실무 조건을 함께 비교하도록 제안한다.  
Amora mapping: 홀 무드와 조건 비교표를 만든다.  
/check mapping if relevant: 식대·보증 인원 확인으로 연결한다.  
Etiquette/checklist mapping if relevant: 예식장 투어 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-aestheticMood-003

Question ID: WC-Q-aestheticMood-003  
Target construct: aestheticMood  
Secondary constructs: experienceMeaning  
Journey stage tags: sdm_search  
Scenario domain: 드레스 실루엣이 상상한 스타일과 잘 맞음  
Question text in Korean: 드레스 한 벌이 상상하던 실루엣과 잘 맞아 보입니다. 선택 전 가장 먼저 보고 싶은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 전체 스타일과 사진 분위기가 원하는 이미지와 맞는지 본다.  
- B. 추가 비용과 포함 서비스를 확인한다.  
- C. 예식장 분위기와 함께 어울릴지 본다.  
- D. 상대나 가까운 사람의 의견을 들어본다.  
High score meaning: 취향과 시각적 일치감을 먼저 읽는 경향을 시사한다.  
Low score meaning: 비용, 공간 조화, 의견 수렴을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 취향 판단을 외형 중심 평가로 표현하지 않는다.  
Gender stereotype risk: 드레스 판단을 특정 성별에게만 해당하는 관심으로 쓰지 않는다.  
Report mapping: 스타일 기준과 예식장 조화를 함께 정리한다.  
Amora mapping: 드레스 스타일 키워드와 후보 비교를 생성한다.  
/check mapping if relevant: 추가 비용 확인으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 드레스 선택 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-aestheticMood-004

Question ID: WC-Q-aestheticMood-004  
Target construct: aestheticMood  
Secondary constructs: experienceMeaning  
Journey stage tags: contracted  
Scenario domain: 플라워 색감이 예식 인상을 바꿈  
Question text in Korean: 플라워 색감을 바꾸면 예식장 분위기가 훨씬 부드럽게 느껴집니다. 어떤 기준이 가장 먼저 떠오르나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 색감과 조명이 전체 무드와 어울리는지 본다.  
- B. 변경 비용과 기본 구성 차이를 확인한다.  
- C. 사진에 남을 장면의 의미를 생각한다.  
- D. 부모님이나 하객에게도 자연스럽게 보일지 본다.  
High score meaning: 색감과 분위기 조화를 중요한 결정 신호로 보는 경향을 시사한다.  
Low score meaning: 비용, 기억 의미, 가족·하객 반응을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 색감 선호를 과한 장식 선호로 표현하지 않는다.  
Gender stereotype risk: 플라워 취향을 성별화하지 않는다.  
Report mapping: 색감 선택 기준과 예산 조정 포인트를 제안한다.  
Amora mapping: 플라워 무드 키워드와 업체 질문을 만든다.  
/check mapping if relevant: 변경 비용 확인으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 예식 연출 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-aestheticMood-005

Question ID: WC-Q-aestheticMood-005  
Target construct: aestheticMood  
Secondary constructs: evidenceDecision  
Journey stage tags: sdm_search  
Scenario domain: 스튜디오 색감이 패키지 편의보다 중요하게 느껴짐  
Question text in Korean: 한 스튜디오는 패키지가 편하지만 색감이 아쉽고, 다른 스튜디오는 색감이 마음에 듭니다. 무엇을 먼저 비교하나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 우리가 원하는 색감과 분위기를 얼마나 잘 구현하는지 본다.  
- B. 패키지 구성과 일정 편의성을 먼저 본다.  
- C. 실제 촬영 후기와 보정 결과를 확인한다.  
- D. 예산 안에서 조정 가능한 옵션을 찾는다.  
High score meaning: 시각적 완성도와 취향 적합성을 중요한 기준으로 보는 경향을 시사한다.  
Low score meaning: 편의, 후기, 예산 조정을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 무드 선택을 현실 조건을 모르는 선택으로 표현하지 않는다.  
Gender stereotype risk: 색감 민감도를 특정 성별 표현으로 쓰지 않는다.  
Report mapping: 무드 기준과 편의 조건을 함께 정리한다.  
Amora mapping: 스튜디오별 색감·조건 비교표를 만든다.  
/check mapping if relevant: 패키지 비용 확인으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 스튜디오 비교 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-aestheticMood-006

Question ID: WC-Q-aestheticMood-006  
Target construct: aestheticMood  
Secondary constructs: guidanceNeed  
Journey stage tags: preparing_without_date, sdm_search  
Scenario domain: 검색 전 무드 키워드가 필요함  
Question text in Korean: 업체를 찾기 전, 어떤 분위기를 원하는지 말로 정리하기 어렵습니다. 가장 도움이 될 방식은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 사진을 보며 우리에게 맞는 무드 키워드를 먼저 찾는다.  
- B. 예산과 일정에 맞는 후보부터 본다.  
- C. 아모라가 몇 가지 스타일 방향을 제안해준다.  
- D. 상대와 좋아하는 사진을 따로 골라 비교한다.  
High score meaning: 무드 언어와 시각 기준이 정해져야 탐색이 쉬운 경향을 시사한다.  
Low score meaning: 조건 필터, 가이드 제안, 공동 비교를 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 취향 정리를 어려워하는 상황을 능력 평가로 쓰지 않는다.  
Gender stereotype risk: 무드 키워드 정리를 특정 성별의 업무로 두지 않는다.  
Report mapping: 취향 키워드와 탐색 기준을 제안한다.  
Amora mapping: 무드 키워드 후보와 추천 방향을 생성한다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 웨딩 라운지 탐색 체크리스트로 연결한다.  
Validation status: draft

### 3.7 familyIntegration

#### WC-Q-familyIntegration-001

Question ID: WC-Q-familyIntegration-001  
Target construct: familyIntegration  
Secondary constructs: costRisk  
Journey stage tags: venue_search, marriage_discussion  
Scenario domain: 부모님이 하객 수를 늘리자고 함  
Question text in Korean: 부모님이 예상보다 더 많은 하객을 초대하고 싶다고 합니다. 가장 먼저 확인하고 싶은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 양가가 생각하는 초대 범위와 이유를 들어본다.  
- B. 늘어난 인원에 따른 식대와 보증 인원을 계산한다.  
- C. 우리 기준의 초대 원칙을 먼저 정리한다.  
- D. 예식장 수용 인원과 동선을 확인한다.  
High score meaning: 가족과 하객 관점을 의사결정에 적극 반영하려는 경향을 시사한다.  
Low score meaning: 비용, 커플 기준, 예식장 조건을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 가족 고려를 순응이나 자율성 평가로 표현하지 않는다.  
Gender stereotype risk: 부모님 대응을 특정 성별이나 특정 집안의 몫으로 두지 않는다.  
Report mapping: 양가 하객수 조율 대화 순서를 제안한다.  
Amora mapping: 부모님과 하객 범위를 이야기하는 문장을 만든다.  
/check mapping if relevant: 식대와 보증 인원 계산으로 연결한다.  
Etiquette/checklist mapping if relevant: 하객수 조율 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-familyIntegration-002

Question ID: WC-Q-familyIntegration-002  
Target construct: familyIntegration  
Secondary constructs: aestheticMood  
Journey stage tags: venue_search  
Scenario domain: 부모님은 음식·교통을 더 중시함  
Question text in Korean: 우리는 분위기가 좋은 예식장이 끌리지만 부모님은 음식과 교통을 더 중요하게 봅니다. 무엇을 먼저 해보고 싶나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 양가가 걱정하는 하객 경험을 구체적으로 들어본다.  
- B. 분위기와 음식·교통을 함께 점수화해 비교한다.  
- C. 비용 차이를 먼저 확인한다.  
- D. 우리에게 가장 남는 기준이 무엇인지 먼저 정한다.  
High score meaning: 가족과 하객 경험을 중요한 의사결정 기준으로 반영하려는 경향을 시사한다.  
Low score meaning: 복합 비교, 비용, 커플 기준을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 가족 의견 반영을 자기 기준 부재로 표현하지 않는다.  
Gender stereotype risk: 부모님 의견 조율을 특정 성별의 역할로 표현하지 않는다.  
Report mapping: 하객 경험과 커플 무드 기준을 조율하도록 제안한다.  
Amora mapping: 양가 설득용 비교표와 대화 문장을 만든다.  
/check mapping if relevant: 비용 비교로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 예식장 가족 조율 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-familyIntegration-003

Question ID: WC-Q-familyIntegration-003  
Target construct: familyIntegration  
Secondary constructs: coupleAutonomy  
Journey stage tags: marriage_discussion, preparing_without_date  
Scenario domain: 커플은 작은 결혼식을 원하지만 가족은 전통 형식을 기대함  
Question text in Korean: 우리는 작은 결혼식을 생각하지만 가족은 좀 더 전통적인 형식을 기대합니다. 어떤 접근이 가장 편한가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 가족이 중요하게 여기는 형식과 이유를 먼저 듣는다.  
- B. 우리가 지키고 싶은 기준을 먼저 정리한다.  
- C. 양쪽 모두 받아들일 수 있는 절충안을 찾는다.  
- D. 비용과 하객 규모를 기준으로 가능한 범위를 정한다.  
High score meaning: 가족 기대와 관계 조율을 의사결정에 반영하려는 경향을 시사한다.  
Low score meaning: 커플 기준, 절충 구조, 비용 범위를 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 가족 기준 반영과 커플 기준 반영을 우열로 나누지 않는다.  
Gender stereotype risk: 전통 형식 조율을 특정 성별의 가족 문제로 쓰지 않는다.  
Report mapping: 가족 기대와 커플 기준을 분리해 대화하도록 제안한다.  
Amora mapping: 작은 결혼식 설명 문장과 절충안을 만든다.  
/check mapping if relevant: 규모별 비용 확인으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 예절 가이드와 가족 대화 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-familyIntegration-004

Question ID: WC-Q-familyIntegration-004  
Target construct: familyIntegration  
Secondary constructs: guidanceNeed  
Journey stage tags: venue_search  
Scenario domain: 양가가 지역 또는 예식 형태를 다르게 기대함  
Question text in Korean: 양가가 원하는 지역이나 예식 형태가 다릅니다. 가장 먼저 정리하고 싶은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 각 가족이 중요하게 보는 이유와 양보 가능한 지점을 정리한다.  
- B. 우리 둘이 감당 가능한 이동과 예산 기준을 먼저 정한다.  
- C. 후보 지역별 장단점을 표로 비교한다.  
- D. 아모라가 대화 순서와 질문을 정리해준다.  
High score meaning: 양가의 기대와 조율 가능성을 먼저 살피려는 경향을 시사한다.  
Low score meaning: 커플 기준, 비교표, 가이드 도움을 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 가족 조율을 갈등 성향으로 표현하지 않는다.  
Gender stereotype risk: 지역 결정권을 특정 집안이나 성별에 두지 않는다.  
Report mapping: 양가 기대를 구조화해 조율하도록 제안한다.  
Amora mapping: 가족 대화 질문과 중립적 설명 문장을 만든다.  
/check mapping if relevant: 지역별 비용 비교로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 양가 조율 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-familyIntegration-005

Question ID: WC-Q-familyIntegration-005  
Target construct: familyIntegration  
Secondary constructs: executionSupport  
Journey stage tags: contracted, wedding_week  
Scenario domain: 혼주 동선, 주차, 대기 공간이 중요함  
Question text in Korean: 예식 당일 혼주 동선, 주차, 대기 공간을 점검해야 합니다. 가장 먼저 보고 싶은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 부모님과 주요 가족이 불편하지 않을 동선을 확인한다.  
- B. 당일 담당자와 체크리스트를 먼저 만든다.  
- C. 하객 전체 이동 흐름과 안내 문구를 확인한다.  
- D. 예식장에 실제 동선 안내를 요청한다.  
High score meaning: 가족과 하객의 당일 경험을 의사결정에 중요하게 반영하는 경향을 시사한다.  
Low score meaning: 실행 체크, 전체 동선, 업체 확인을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 가족 배려를 과한 부담으로 표현하지 않는다.  
Gender stereotype risk: 혼주 케어 담당을 성별로 배정하지 않는다.  
Report mapping: 당일 가족 동선 점검 항목을 제안한다.  
Amora mapping: 예식장에 확인할 동선 질문을 만든다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 웨딩 week 가족 동선 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-familyIntegration-006

Question ID: WC-Q-familyIntegration-006  
Target construct: familyIntegration  
Secondary constructs: evidenceDecision  
Journey stage tags: marriage_discussion, contracted  
Scenario domain: 예단, 선물, 비용 분담 예절을 논의해야 함  
Question text in Korean: 양가 선물이나 비용 분담 기준을 이야기해야 하는 상황입니다. 가장 먼저 필요한 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 양가가 편하게 받아들일 수 있는 관례와 기준을 확인한다.  
- B. 우리 둘이 가능한 예산 범위를 먼저 정한다.  
- C. 실제 사례와 지역별 차이를 찾아본다.  
- D. 민감한 표현을 피할 대화 문장을 준비한다.  
High score meaning: 양가 예절과 관계 조율을 중요한 판단 요소로 보는 경향을 시사한다.  
Low score meaning: 커플 예산, 사례 근거, 대화 문장 준비를 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 예절 고려를 체면 중심 평가로 단정하지 않는다.  
Gender stereotype risk: 선물·비용 논의를 특정 성별 가족의 책임으로 쓰지 않는다.  
Report mapping: 비용·선물 논의 전 확인할 기준을 제안한다.  
Amora mapping: 양가 대화용 중립 문장을 만든다.  
/check mapping if relevant: 비용 범위 확인으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 예절 가이드와 가족 논의 체크리스트로 연결한다.  
Validation status: draft

### 3.8 coupleAutonomy

#### WC-Q-coupleAutonomy-001

Question ID: WC-Q-coupleAutonomy-001  
Target construct: coupleAutonomy  
Secondary constructs: familyIntegration  
Journey stage tags: marriage_discussion, preparing_without_date  
Scenario domain: 커플은 작은 결혼식을 원하지만 가족은 더 큰 규모를 기대함  
Question text in Korean: 우리는 작은 결혼식을 원하지만 가족은 더 많은 하객 초대를 기대합니다. 가장 먼저 정하고 싶은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 우리 둘이 감당 가능한 규모와 기준을 먼저 정한다.  
- B. 가족이 원하는 초대 범위와 이유를 먼저 듣는다.  
- C. 양쪽 기준을 반영한 적정 인원을 계산한다.  
- D. 예산과 예식장 수용 인원을 먼저 확인한다.  
High score meaning: 커플의 기준과 생활 현실을 먼저 세우려는 경향을 시사한다.  
Low score meaning: 가족 기대, 절충 계산, 조건 확인을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 커플 기준을 가족 배제나 관계 평가로 표현하지 않는다.  
Gender stereotype risk: 하객 규모 조율을 특정 성별 가족의 문제로 쓰지 않는다.  
Report mapping: 커플 기준과 가족 기대를 함께 정리하도록 제안한다.  
Amora mapping: 가족에게 설명할 초대 기준 문장을 만든다.  
/check mapping if relevant: 규모별 비용 확인으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 하객수 조율 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-coupleAutonomy-002

Question ID: WC-Q-coupleAutonomy-002  
Target construct: coupleAutonomy  
Secondary constructs: familyIntegration  
Journey stage tags: marriage_discussion, contracted  
Scenario domain: 전통 예절을 일부 간소화하고 싶음  
Question text in Korean: 일부 전통 절차를 간소화하고 싶지만 가족이 어떻게 받아들일지 걱정됩니다. 무엇을 먼저 해보고 싶나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 우리에게 필요한 절차와 줄이고 싶은 절차를 먼저 정한다.  
- B. 가족이 중요하게 보는 의미를 먼저 확인한다.  
- C. 의미는 남기고 형식은 줄이는 대안을 찾는다.  
- D. 예절 가이드에서 가능한 표현을 찾아본다.  
High score meaning: 커플의 기준으로 절차를 재구성하려는 경향을 시사한다.  
Low score meaning: 가족 의미 확인, 절충, 가이드 활용을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 간소화를 예절 수준 평가로 표현하지 않는다.  
Gender stereotype risk: 예절 조율을 특정 성별의 책임으로 두지 않는다.  
Report mapping: 간소화 가능한 절차와 설명 방식을 제안한다.  
Amora mapping: 가족에게 설명할 부드러운 문장을 만든다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 예절 가이드와 절차 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-coupleAutonomy-003

Question ID: WC-Q-coupleAutonomy-003  
Target construct: coupleAutonomy  
Secondary constructs: familyIntegration  
Journey stage tags: venue_search  
Scenario domain: 관계 가까움 기준으로 하객을 정하고 싶음  
Question text in Korean: 하객 명단을 정할 때 가족은 넓게 초대하길 원하고, 우리는 가까운 관계 중심으로 하고 싶습니다. 무엇이 먼저 필요합니까?  
Response format: forced_choice  
Response options in Korean:  
- A. 우리가 생각하는 초대 기준을 먼저 문장으로 정한다.  
- B. 가족이 꼭 초대하고 싶은 범위를 들어본다.  
- C. 예산과 보증 인원을 기준으로 현실 범위를 계산한다.  
- D. 서로 다른 기준을 반영한 명단 버전을 만든다.  
High score meaning: 커플의 관계 기준을 명확히 세우려는 경향을 시사한다.  
Low score meaning: 가족 의견, 비용 조건, 복수안 작성을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 가까운 관계 중심 초대를 대인관계 평가로 연결하지 않는다.  
Gender stereotype risk: 명단 정리를 특정 성별이나 가족의 책임으로 두지 않는다.  
Report mapping: 하객 초대 기준 문장과 조율안을 제안한다.  
Amora mapping: 가족에게 설명할 초대 기준을 작성한다.  
/check mapping if relevant: 보증 인원·식대 계산으로 연결한다.  
Etiquette/checklist mapping if relevant: 하객 명단 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-coupleAutonomy-004

Question ID: WC-Q-coupleAutonomy-004  
Target construct: coupleAutonomy  
Secondary constructs: emotionalSupport  
Journey stage tags: marriage_discussion, preparing_without_date  
Scenario domain: 부모님께 커플 기준을 설명해야 함  
Question text in Korean: 부모님께 우리의 결혼식 기준을 설명해야 합니다. 어떤 준비가 가장 먼저 필요하다고 느끼나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 우리 둘이 지키고 싶은 기준과 이유를 먼저 합의한다.  
- B. 부모님이 걱정할 부분을 예상해 답을 준비한다.  
- C. 감정이 상하지 않도록 말할 순서를 정한다.  
- D. 비용과 일정 자료를 함께 보여줄 준비를 한다.  
High score meaning: 커플의 기준을 먼저 합의하고 존중받고 싶어하는 경향을 시사한다.  
Low score meaning: 부모님 우려, 대화 순서, 근거 자료 준비를 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 커플 기준을 가족과의 거리감으로 표현하지 않는다.  
Gender stereotype risk: 부모님 설득을 특정 성별의 역할로 고정하지 않는다.  
Report mapping: 커플 기준 합의와 가족 설명 순서를 제안한다.  
Amora mapping: 부모님께 전할 설명 문장을 만든다.  
/check mapping if relevant: 비용 자료 준비로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 가족 대화 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-coupleAutonomy-005

Question ID: WC-Q-coupleAutonomy-005  
Target construct: coupleAutonomy  
Secondary constructs: costRisk  
Journey stage tags: marriage_discussion, preparing_without_date  
Scenario domain: 미래 생활과 결혼식 규모 사이의 예산 배분  
Question text in Korean: 결혼식 규모를 키우면 이후 주거·저축 계획이 줄어들 수 있습니다. 무엇을 먼저 정하고 싶나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 결혼식과 이후 생활 사이의 우리 기준을 먼저 정한다.  
- B. 가족과 하객에게 필요한 최소 규모를 먼저 본다.  
- C. 총예산과 항목별 상한선을 계산한다.  
- D. 꼭 남기고 싶은 경험 항목을 먼저 고른다.  
High score meaning: 커플의 장기 생활 기준을 결혼 준비에 강하게 반영하려는 경향을 시사한다.  
Low score meaning: 가족·하객 기준, 비용 계산, 경험 항목을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 실속 기준을 가족 관계 평가로 표현하지 않는다.  
Gender stereotype risk: 주거·저축 판단을 특정 성별의 책임으로 두지 않는다.  
Report mapping: 결혼식 예산과 이후 생활 기준을 함께 정리한다.  
Amora mapping: 예산 배분 대화 질문을 만든다.  
/check mapping if relevant: 총예산 상한 확인으로 연결한다.  
Etiquette/checklist mapping if relevant: 예산 합의 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-coupleAutonomy-006

Question ID: WC-Q-coupleAutonomy-006  
Target construct: coupleAutonomy  
Secondary constructs: aestheticMood  
Journey stage tags: venue_search, contracted  
Scenario domain: 비표준 장소나 형식을 고려함  
Question text in Korean: 일반적인 예식장보다 우리에게 맞는 다른 장소나 형식이 끌립니다. 무엇을 먼저 확인하고 싶나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 우리 둘에게 왜 그 형식이 맞는지 기준을 먼저 정한다.  
- B. 가족과 하객이 불편하지 않을지 먼저 본다.  
- C. 진행, 식사, 이동, 비용 조건을 확인한다.  
- D. 그 장소의 무드와 사진에 남을 느낌을 본다.  
High score meaning: 외부 기대보다 커플의 기준과 방식이 먼저인 경향을 시사한다.  
Low score meaning: 가족·하객 수용성, 실행 조건, 무드를 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 비표준 선택을 튀는 선택이나 가족 거절로 표현하지 않는다.  
Gender stereotype risk: 형식 선택을 성별 취향으로 쓰지 않는다.  
Report mapping: 커플 기준과 실무 조건을 함께 검토하도록 제안한다.  
Amora mapping: 대안 예식 형식의 장단점을 정리한다.  
/check mapping if relevant: 장소 비용·조건 확인으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 대안 예식 준비 체크리스트로 연결한다.  
Validation status: draft

### 3.9 emotionalSupport

#### WC-Q-emotionalSupport-001

Question ID: WC-Q-emotionalSupport-001  
Target construct: emotionalSupport  
Secondary constructs: guidanceNeed  
Journey stage tags: venue_search, sdm_search  
Scenario domain: 결혼 준비 검색으로 지침  
Question text in Korean: 며칠 동안 정보를 찾아보다가 지쳤습니다. 이때 가장 먼저 받고 싶은 반응은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. "많이 힘들었겠다"처럼 먼저 마음을 알아주는 말이다.  
- B. 지금 당장 할 일 세 가지만 정리해주는 것이다.  
- C. 후보를 줄여서 비교표로 보여주는 것이다.  
- D. 상대와 같이 볼 시간을 잡는 것이다.  
High score meaning: 해결책 전에 감정 인정을 받으면 안정감을 느끼는 경향을 시사한다.  
Low score meaning: 바로 실행, 정보 압축, 공동 검토를 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 감정 인정 필요를 개인의 견딤 정도 평가로 연결하지 않는다.  
Gender stereotype risk: 정서적 지지를 특정 성별의 역할로 두지 않는다.  
Report mapping: 스트레스 상황에서 필요한 첫 반응을 커플 리포트에 반영한다.  
Amora mapping: 먼저 공감한 뒤 다음 행동을 제안하는 응답 톤으로 조정한다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 정보 정리 체크리스트로 연결할 수 있다.  
Validation status: draft

#### WC-Q-emotionalSupport-002

Question ID: WC-Q-emotionalSupport-002  
Target construct: emotionalSupport  
Secondary constructs: executionSupport  
Journey stage tags: contract_pending  
Scenario domain: 상대가 바로 해결책부터 말함  
Question text in Korean: 상담 후 걱정된다고 말했는데 상대가 바로 "그럼 다른 데 알아보자"라고 답했습니다. 가장 가까운 느낌은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 해결책 전에 왜 걱정되는지 먼저 들어주면 좋겠다.  
- B. 바로 대안을 말해줘서 정리가 된다.  
- C. 걱정되는 항목과 다음 행동을 같이 나누고 싶다.  
- D. 잠시 생각한 뒤 다시 이야기하고 싶다.  
High score meaning: 문제 해결 전에 감정과 이유를 인정받고 싶어하는 경향을 시사한다.  
Low score meaning: 빠른 대안, 공동 정리, 시간차 대화를 선호할 수 있음을 시사한다.  
Bias/stigma risk: 감정 순서를 원하는 것을 대화 능력 평가로 쓰지 않는다.  
Gender stereotype risk: 공감 제공자를 특정 성별로 상정하지 않는다.  
Report mapping: 갈등 상황의 첫 반응 선호를 커플 대화 팁으로 반영한다.  
Amora mapping: 공감 후 선택지 제안 순서로 응답한다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 커플 대화 체크리스트로 연결할 수 있다.  
Validation status: draft

#### WC-Q-emotionalSupport-003

Question ID: WC-Q-emotionalSupport-003  
Target construct: emotionalSupport  
Secondary constructs: coPreparation  
Journey stage tags: venue_search, contract_pending  
Scenario domain: 힘든 상담 후 감정 정리가 필요함  
Question text in Korean: 상담에서 예상보다 큰 금액을 듣고 마음이 무거워졌습니다. 다음 중 가장 먼저 필요한 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 놀란 마음을 먼저 이야기하고 정리할 시간을 갖는다.  
- B. 총액과 추가금 항목을 바로 계산한다.  
- C. 상대와 걱정되는 부분을 같이 적어본다.  
- D. 다른 후보와 비교해 현실적인 대안을 찾는다.  
High score meaning: 부담 상황에서 감정 정리가 먼저 필요할 수 있음을 시사한다.  
Low score meaning: 계산, 공동 메모, 대안 비교를 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 부담감을 과장이나 판단 방식 평가로 표현하지 않는다.  
Gender stereotype risk: 비용 부담에 대한 반응을 성별화하지 않는다.  
Report mapping: 금액 충격 후 대화 순서와 회복 방식을 제안한다.  
Amora mapping: 먼저 마음을 반영하고 견적 정리로 이어진다.  
/check mapping if relevant: 견적 항목 정리로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 상담 후 정리 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-emotionalSupport-004

Question ID: WC-Q-emotionalSupport-004  
Target construct: emotionalSupport  
Secondary constructs: coPreparation  
Journey stage tags: contracted  
Scenario domain: 일은 진행되지만 혼자 준비하는 느낌  
Question text in Korean: 일정은 진행되고 있지만 마음으로는 혼자 준비하는 느낌이 듭니다. 무엇이 가장 도움이 될까요?  
Response format: forced_choice  
Response options in Korean:  
- A. 상대가 준비 과정에서 내 마음을 먼저 알아주는 것이다.  
- B. 할 일을 나누고 담당자를 분명히 정하는 것이다.  
- C. 같이 확인해야 할 항목만 정해 함께 보는 것이다.  
- D. 아모라가 상황을 요약해 상대에게 공유할 수 있게 해주는 것이다.  
High score meaning: 진행 상황보다 정서적 동행감이 중요할 수 있음을 시사한다.  
Low score meaning: 역할 분담, 공동 확인, 요약 공유를 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 동행감 필요를 관계 평가나 요구로 표현하지 않는다.  
Gender stereotype risk: 정서적 동행을 특정 성별의 책임으로 쓰지 않는다.  
Report mapping: 함께 준비한다고 느끼는 조건을 커플 리포트에 반영한다.  
Amora mapping: 마음 공유 메시지와 역할 정리안을 함께 제시한다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 커플 준비 회의 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-emotionalSupport-005

Question ID: WC-Q-emotionalSupport-005  
Target construct: emotionalSupport  
Secondary constructs: costRisk  
Journey stage tags: contracted  
Scenario domain: 예산을 줄이기 전 위로가 필요함  
Question text in Korean: 예산 때문에 마음에 두었던 항목을 줄여야 할 것 같습니다. 가장 먼저 필요한 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 아쉬운 마음을 먼저 인정받고 싶다.  
- B. 줄일 수 있는 항목을 바로 정리하고 싶다.  
- C. 꼭 남길 항목과 조정할 항목을 같이 나누고 싶다.  
- D. 비슷한 만족을 줄 수 있는 대안을 찾고 싶다.  
High score meaning: 조정 전 감정 인정이 있어야 다음 논의가 쉬운 경향을 시사한다.  
Low score meaning: 실행 정리, 공동 분류, 대안 탐색을 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 아쉬움을 표현하는 것을 소비 성향 평가로 연결하지 않는다.  
Gender stereotype risk: 예산 조정 감정을 성별화하지 않는다.  
Report mapping: 예산 조정 시 감정과 실행 순서를 함께 제안한다.  
Amora mapping: 공감 후 조정 후보를 제안한다.  
/check mapping if relevant: 예산 조정 항목 확인으로 연결한다.  
Etiquette/checklist mapping if relevant: 예산 재조정 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-emotionalSupport-006

Question ID: WC-Q-emotionalSupport-006  
Target construct: emotionalSupport  
Secondary constructs: guidanceNeed  
Journey stage tags: wedding_week  
Scenario domain: 아모라가 감정을 먼저 반영해주길 원함  
Question text in Korean: 예식이 가까워지며 신경 쓸 일이 많아졌습니다. 아모라가 먼저 어떻게 답하면 좋겠나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 지금 부담이 큰 상황임을 먼저 알아주고 다음을 말해준다.  
- B. 오늘 처리할 일만 바로 세 가지로 정리해준다.  
- C. 빠진 준비물이 있는지 먼저 확인해준다.  
- D. 상대와 나눠 맡을 일을 먼저 제안해준다.  
High score meaning: 정서적 반영 후 안내를 받을 때 안정감을 느끼는 경향을 시사한다.  
Low score meaning: 즉시 실행, 누락 확인, 역할 분담을 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 정서 반영 필요를 준비 역량 평가로 연결하지 않는다.  
Gender stereotype risk: 위로와 실행 지원 역할을 성별로 나누지 않는다.  
Report mapping: 예식 직전 지원 순서 선호를 반영한다.  
Amora mapping: 공감 우선 응답 템플릿으로 조정한다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 예식 week 체크리스트로 연결한다.  
Validation status: draft

### 3.10 executionSupport

#### WC-Q-executionSupport-001

Question ID: WC-Q-executionSupport-001  
Target construct: executionSupport  
Secondary constructs: guidanceNeed  
Journey stage tags: contracted  
Scenario domain: 할 일 목록이 생기면 안정됨  
Question text in Korean: 준비할 일이 많아 머릿속이 복잡합니다. 가장 먼저 있으면 도움이 될 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 오늘 할 일, 이번 주 할 일, 나중에 할 일을 나눈 목록이다.  
- B. 지금 힘든 마음을 먼저 정리하는 대화다.  
- C. 상대와 같이 볼 항목만 따로 표시한 목록이다.  
- D. 중요한 비용 항목만 따로 정리한 표다.  
High score meaning: 구체적 행동 목록이 있을 때 안정감을 얻는 경향을 시사한다.  
Low score meaning: 정서 정리, 공동 확인, 비용 정리를 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 실행 중심 선호를 감정 배제나 관계 평가로 표현하지 않는다.  
Gender stereotype risk: 할 일 정리 담당을 특정 성별로 배정하지 않는다.  
Report mapping: 실행형 지원이 필요한 상황을 표시한다.  
Amora mapping: 단계별 할 일 목록을 먼저 제안한다.  
/check mapping if relevant: 비용 항목 정리로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 준비 단계별 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-executionSupport-002

Question ID: WC-Q-executionSupport-002  
Target construct: executionSupport  
Secondary constructs: roleOwnership  
Journey stage tags: contracted  
Scenario domain: 갈등 후 담당자와 다음 행동을 정하고 싶음  
Question text in Korean: 준비 과정에서 의견이 달라진 뒤, 다시 진행해야 합니다. 가장 먼저 정하고 싶은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 누가 무엇을 언제까지 할지 정한다.  
- B. 서로 어떤 점이 힘들었는지 먼저 듣는다.  
- C. 선택 기준을 다시 맞춘 뒤 움직인다.  
- D. 아모라가 중립적으로 다음 단계를 정리해준다.  
High score meaning: 갈등 후에도 다음 행동과 담당자가 정해져야 편한 경향을 시사한다.  
Low score meaning: 감정 공유, 기준 재정렬, 중립 가이드를 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 빠른 실행 선호를 대화 방식 평가로 표현하지 않는다.  
Gender stereotype risk: 담당자 배정을 성별에 기대지 않는다.  
Report mapping: 갈등 후 실행 재개 방식을 커플 리포트에 반영한다.  
Amora mapping: 담당자·마감 중심의 액션 카드를 생성한다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 역할 재정리 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-executionSupport-003

Question ID: WC-Q-executionSupport-003  
Target construct: executionSupport  
Secondary constructs: guidanceNeed  
Journey stage tags: wedding_week  
Scenario domain: 오늘의 핵심 작업만 필요함  
Question text in Korean: 예식이 가까워져 할 일이 많지만 시간이 부족합니다. 아모라가 무엇을 먼저 해주면 좋겠나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 오늘 꼭 처리할 상위 세 가지를 골라준다.  
- B. 마음이 급한 이유를 먼저 정리해준다.  
- C. 가족에게 확인할 항목을 먼저 알려준다.  
- D. 비용이나 계약상 빠진 조건을 먼저 점검한다.  
High score meaning: 우선순위가 압축된 실행 안내를 선호하는 경향을 시사한다.  
Low score meaning: 정서 정리, 가족 확인, 조건 점검을 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 실행 압축 선호를 여유 부족이나 성향 평가로 쓰지 않는다.  
Gender stereotype risk: 예식 직전 업무를 성별로 배정하지 않는다.  
Report mapping: 예식 직전 액션 우선순위가 필요한 유형으로 표시한다.  
Amora mapping: 오늘의 top-3 액션 카드를 먼저 보여준다.  
/check mapping if relevant: 조건 누락 점검으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: wedding week 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-executionSupport-004

Question ID: WC-Q-executionSupport-004  
Target construct: executionSupport  
Secondary constructs: evidenceDecision  
Journey stage tags: venue_search, sdm_search  
Scenario domain: 상담 후 정보가 많아 체크리스트가 필요함  
Question text in Korean: 상담에서 들은 정보가 많아 무엇을 해야 할지 흐려졌습니다. 가장 필요한 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 상담 후 확인할 질문과 다음 행동을 체크리스트로 받는다.  
- B. 상담에서 좋았던 점과 걱정된 점을 먼저 이야기한다.  
- C. 견적서와 계약 조건을 다시 확인한다.  
- D. 상대에게 공유할 요약본을 만든다.  
High score meaning: 상담 후 행동 목록이 명확할 때 진행이 쉬운 경향을 시사한다.  
Low score meaning: 감정 정리, 근거 확인, 공유 요약을 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 체크리스트 필요를 준비 역량 평가로 표현하지 않는다.  
Gender stereotype risk: 상담 정리 담당을 성별로 정하지 않는다.  
Report mapping: 상담 후 후속 액션이 필요한 상황을 표시한다.  
Amora mapping: 상담 후 체크리스트와 질문 목록을 생성한다.  
/check mapping if relevant: 견적·계약 조건 확인으로 연결한다.  
Etiquette/checklist mapping if relevant: 상담 후 실행 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-executionSupport-005

Question ID: WC-Q-executionSupport-005  
Target construct: executionSupport  
Secondary constructs: costRisk  
Journey stage tags: contracted  
Scenario domain: 예산 의견 차이를 구체적 표로 정리하고 싶음  
Question text in Korean: 예산을 어디서 줄일지 의견이 다릅니다. 가장 먼저 있으면 좋은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 항목별 금액과 조정 가능 여부를 정리한 표다.  
- B. 서로 아쉬운 항목을 먼저 들어보는 시간이다.  
- C. 꼭 남길 경험 항목을 먼저 고르는 것이다.  
- D. 가족에게 영향이 있는 항목을 먼저 구분하는 것이다.  
High score meaning: 구체적 자료와 결정 프레임이 있어야 논의가 쉬운 경향을 시사한다.  
Low score meaning: 감정 공유, 의미 항목, 가족 영향 구분을 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 표와 규칙 선호를 정서 고려 정도 평가로 표현하지 않는다.  
Gender stereotype risk: 예산 조정표 작성자를 성별로 가정하지 않는다.  
Report mapping: 예산 갈등 시 실행형 조정표를 제안한다.  
Amora mapping: 조정 가능 항목 표와 대화 순서를 만든다.  
/check mapping if relevant: 예산 항목별 점검으로 연결한다.  
Etiquette/checklist mapping if relevant: 예산 재조정 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-executionSupport-006

Question ID: WC-Q-executionSupport-006  
Target construct: executionSupport  
Secondary constructs: roleOwnership  
Journey stage tags: wedding_week  
Scenario domain: 예식 주간 업무 분배가 필요함  
Question text in Korean: 예식 주간에 업체 연락, 가족 안내, 준비물 확인이 한꺼번에 남았습니다. 가장 먼저 하고 싶은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 업무를 담당자별로 나누고 마감 시간을 정한다.  
- B. 서로 부담되는 부분을 먼저 이야기한다.  
- C. 가족과 업체에 보낼 안내 문장을 먼저 만든다.  
- D. 누락된 준비물이 있는지 전체 목록을 본다.  
High score meaning: 담당자와 마감이 명확해야 안정적으로 움직이는 경향을 시사한다.  
Low score meaning: 부담 공유, 안내 문장, 전체 점검을 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 빠른 역할 분배를 관계보다 업무만 보는 태도로 표현하지 않는다.  
Gender stereotype risk: 예식 주간 연락 업무를 성별로 배정하지 않는다.  
Report mapping: 예식 주간 역할 분담표를 제안한다.  
Amora mapping: 담당자별 week-of 액션 카드를 생성한다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: wedding week 실행 체크리스트로 연결한다.  
Validation status: draft

### 3.11 decisionPaceRisk

#### WC-Q-decisionPaceRisk-001

Question ID: WC-Q-decisionPaceRisk-001  
Target construct: decisionPaceRisk  
Secondary constructs: costRisk  
Journey stage tags: contract_pending  
Scenario domain: 오늘 계약 할인 제안  
Question text in Korean: 업체가 오늘 계약하면 할인 혜택을 준다고 합니다. 가장 가까운 행동은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 혜택은 좋지만 계약서와 총액을 확인한 뒤 결정한다.  
- B. 날짜가 마음에 들면 우선 계약 가능성을 본다.  
- C. 상대와 오늘 안에 결정해도 되는지 먼저 이야기한다.  
- D. 다른 후보와 비교할 시간을 요청한다.  
High score meaning: 시간 압박 상황에서 보류 장치와 확인 절차가 필요할 수 있음을 시사한다.  
Low score meaning: 일정 확정, 공동 결정, 비교 시간 요청을 다른 방식으로 사용할 수 있음을 시사한다.  
Bias/stigma risk: 빠른 결정을 성격 평가로 표현하지 않는다.  
Gender stereotype risk: 계약 보류나 확정 판단을 특정 성별의 역할로 두지 않는다.  
Report mapping: 당일 할인 상황에서 pause rule을 제안한다.  
Amora mapping: 계약 전 확인 질문과 보류 요청 문장을 만든다.  
/check mapping if relevant: 당일 계약 전 체크로 연결한다.  
Etiquette/checklist mapping if relevant: 계약 보류 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-decisionPaceRisk-002

Question ID: WC-Q-decisionPaceRisk-002  
Target construct: decisionPaceRisk  
Secondary constructs: experienceMeaning  
Journey stage tags: venue_search, contract_pending  
Scenario domain: 원하는 날짜가 곧 없어질 수 있음  
Question text in Korean: 예식장이 원하는 날짜가 곧 마감될 수 있다고 말합니다. 다음 중 가장 먼저 필요한 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 날짜를 잡기 전 취소·변경 조건과 총액을 확인한다.  
- B. 그 날짜가 우리에게 얼마나 의미 있는지 먼저 본다.  
- C. 비슷한 날짜의 다른 후보를 함께 확인한다.  
- D. 가족 일정과 하객 이동 가능성을 먼저 본다.  
High score meaning: 날짜 압박에서도 조건 확인과 보류 기준이 필요할 수 있음을 시사한다.  
Low score meaning: 날짜 의미, 대안, 가족 일정을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 빠르게 잡고 싶은 마음을 판단 방식 평가로 표현하지 않는다.  
Gender stereotype risk: 날짜 확정을 특정 성별의 책임으로 두지 않는다.  
Report mapping: 희소 날짜 상황의 확인 순서를 제안한다.  
Amora mapping: 날짜 보류 요청과 대안 비교를 돕는다.  
/check mapping if relevant: 취소·변경 조건 확인으로 연결한다.  
Etiquette/checklist mapping if relevant: 날짜 확정 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-decisionPaceRisk-003

Question ID: WC-Q-decisionPaceRisk-003  
Target construct: decisionPaceRisk  
Secondary constructs: evidenceDecision  
Journey stage tags: contract_pending  
Scenario domain: 견적 검토 전 계약금 요청  
Question text in Korean: 상담자가 자세한 견적 검토 전에 계약금을 먼저 걸어두자고 제안합니다. 가장 먼저 하고 싶은 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 계약금 환불과 견적 확정 조건을 확인한 뒤 결정한다.  
- B. 마음에 드는 업체라면 일정 확보를 먼저 고려한다.  
- C. 상대와 오늘 결정 가능한지 이야기한다.  
- D. 견적서를 받아 비교한 뒤 다시 연락하겠다고 한다.  
High score meaning: 선결제 상황에서 확인 절차와 비교 시간이 필요할 수 있음을 시사한다.  
Low score meaning: 일정 확보, 공동 논의, 비교 후 연락을 선택할 수 있음을 시사한다.  
Bias/stigma risk: 계약금 보류를 소극성이나 의심으로 표현하지 않는다.  
Gender stereotype risk: 계약금 판단을 성별 역할로 두지 않는다.  
Report mapping: 계약금 전 확인 항목을 제안한다.  
Amora mapping: 견적 검토 후 결정하겠다는 문장을 만든다.  
/check mapping if relevant: 계약금·환불 조건 체크로 연결한다.  
Etiquette/checklist mapping if relevant: 계약 전 확인 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-decisionPaceRisk-004

Question ID: WC-Q-decisionPaceRisk-004  
Target construct: decisionPaceRisk  
Secondary constructs: emotionalSupport  
Journey stage tags: venue_search, contract_pending  
Scenario domain: 상담 직후 감정적으로 들뜸  
Question text in Korean: 상담을 다녀온 직후 매우 마음에 들어 바로 정하고 싶은 기분이 듭니다. 무엇이 가장 도움이 될까요?  
Response format: forced_choice  
Response options in Korean:  
- A. 하루 뒤에도 같은 마음인지 확인하는 시간을 둔다.  
- B. 좋았던 감정을 상대와 충분히 나눈다.  
- C. 견적과 계약 조건을 바로 정리한다.  
- D. 다른 후보와 비교할 기준을 만든다.  
High score meaning: 긍정적 흥분 상태에서 잠시 멈추는 장치가 필요할 수 있음을 시사한다.  
Low score meaning: 감정 공유, 조건 정리, 비교 기준을 먼저 사용할 수 있음을 시사한다.  
Bias/stigma risk: 들뜬 반응을 부정적 성격 평가로 표현하지 않는다.  
Gender stereotype risk: 감정적 반응을 성별과 연결하지 않는다.  
Report mapping: 상담 직후 냉각 시간과 확인 기준을 제안한다.  
Amora mapping: 24시간 뒤 재검토 질문을 생성한다.  
/check mapping if relevant: 계약 전 재확인 체크로 연결한다.  
Etiquette/checklist mapping if relevant: 상담 후 비교 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-decisionPaceRisk-005

Question ID: WC-Q-decisionPaceRisk-005  
Target construct: decisionPaceRisk  
Secondary constructs: evidenceDecision  
Journey stage tags: contract_pending  
Scenario domain: 구두 약속은 있지만 서면 기록이 없음  
Question text in Korean: 업체가 여러 혜택을 말로 약속했지만 문서에는 아직 적혀 있지 않습니다. 다음 행동으로 가장 가까운 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 기록으로 남긴 뒤 계약 여부를 판단한다.  
- B. 상담 분위기가 좋았으니 우선 긍정적으로 본다.  
- C. 상대에게 혜택이 충분한지 먼저 묻는다.  
- D. 비슷한 조건을 주는 다른 후보를 찾는다.  
High score meaning: 기록 없는 약속이 있을 때 계약 속도를 늦출 필요가 있음을 시사한다.  
Low score meaning: 상담 신뢰, 공동 판단, 대안 탐색을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 확인 요청을 사람에 대한 불신으로 표현하지 않는다.  
Gender stereotype risk: 기록 확인 담당을 성별로 정하지 않는다.  
Report mapping: 구두 약속의 서면화 필요를 표시한다.  
Amora mapping: 혜택 기록 요청 메시지를 만든다.  
/check mapping if relevant: 계약 전 약속 기록 체크로 연결한다.  
Etiquette/checklist mapping if relevant: 계약 조건 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-decisionPaceRisk-006

Question ID: WC-Q-decisionPaceRisk-006  
Target construct: decisionPaceRisk  
Secondary constructs: costRisk  
Journey stage tags: contract_pending  
Scenario domain: 번들 할인에 제외 항목이 불명확함  
Question text in Korean: 번들 할인이 크지만 일부 제외 항목이 분명하지 않습니다. 가장 먼저 필요한 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 제외 항목과 추가 비용을 확인한 뒤 계약한다.  
- B. 할인 폭이 크면 우선 후보 상위에 둔다.  
- C. 상대와 어떤 항목이 꼭 필요한지 정한다.  
- D. 비슷한 번들의 실제 후기를 찾아본다.  
High score meaning: 혜택이 커도 불명확한 조건이 있으면 속도를 조절해야 할 수 있음을 시사한다.  
Low score meaning: 할인 매력, 필요 항목 합의, 후기 탐색을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 보류를 망설임이나 판단 평가로 표현하지 않는다.  
Gender stereotype risk: 할인 판단을 성별 역할과 연결하지 않는다.  
Report mapping: 번들 계약 전 제외 항목 확인을 제안한다.  
Amora mapping: 제외 항목 확인 질문을 생성한다.  
/check mapping if relevant: 번들 포함·제외 항목 체크로 연결한다.  
Etiquette/checklist mapping if relevant: 계약 전 체크리스트로 연결한다.  
Validation status: draft

### 3.12 guidanceNeed

#### WC-Q-guidanceNeed-001

Question ID: WC-Q-guidanceNeed-001  
Target construct: guidanceNeed  
Secondary constructs: roleOwnership  
Journey stage tags: venue_search, sdm_search  
Scenario domain: 업체 선택지가 너무 많음  
Question text in Korean: 검색 결과와 추천 업체가 너무 많아 어디부터 볼지 어렵습니다. 가장 도움이 되는 방식은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 내 조건에 맞는 상위 후보 몇 개만 먼저 보여준다.  
- B. 모든 후보를 직접 보고 비교할 수 있게 해준다.  
- C. 상대와 나눠 볼 후보 목록을 만들어준다.  
- D. 비용이나 지역 조건으로 먼저 제외할 수 있게 해준다.  
High score meaning: 많은 정보를 압축해 우선순위를 제시받을 때 편한 경향을 시사한다.  
Low score meaning: 직접 탐색, 역할 분담, 조건 필터를 먼저 선호할 수 있음을 시사한다.  
Bias/stigma risk: 압축 가이드 필요를 준비 능력 평가로 연결하지 않는다.  
Gender stereotype risk: 정보 탐색 방식을 성별과 연결하지 않는다.  
Report mapping: 후보 압축 지원 필요를 표시한다.  
Amora mapping: 조건 기반 상위 후보를 먼저 제안한다.  
/check mapping if relevant: 비용 조건 필터로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 업체 탐색 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-guidanceNeed-002

Question ID: WC-Q-guidanceNeed-002  
Target construct: guidanceNeed  
Secondary constructs: executionSupport  
Journey stage tags: preparing_without_date  
Scenario domain: 무엇부터 해야 할지 모름  
Question text in Korean: 결혼 이야기는 시작했지만 아직 날짜나 장소가 정해지지 않았습니다. 무엇이 가장 도움이 될까요?  
Response format: forced_choice  
Response options in Korean:  
- A. 지금 단계에서 먼저 할 일 순서를 짧게 알려준다.  
- B. 우리가 원하는 결혼식 느낌부터 자유롭게 이야기한다.  
- C. 예산 범위와 가족 논의 필요 항목을 먼저 정한다.  
- D. 둘이 같이 결정할 항목과 나눠 할 항목을 구분한다.  
High score meaning: 현재 단계에 맞춘 압축된 다음 행동을 원할 가능성을 시사한다.  
Low score meaning: 자유 대화, 예산·가족 기준, 역할 구분을 먼저 볼 수 있음을 시사한다.  
Bias/stigma risk: 첫 단계 안내 필요를 경험 부족 평가로 표현하지 않는다.  
Gender stereotype risk: 초기 준비 주도자를 성별로 가정하지 않는다.  
Report mapping: 현재 단계의 첫 준비 순서를 제안한다.  
Amora mapping: stage-based next step 카드를 생성한다.  
/check mapping if relevant: 해당 없음.  
Etiquette/checklist mapping if relevant: 시작 단계 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-guidanceNeed-003

Question ID: WC-Q-guidanceNeed-003  
Target construct: guidanceNeed  
Secondary constructs: evidenceDecision  
Journey stage tags: venue_search  
Scenario domain: 긴 후보 목록보다 top 옵션이 필요함  
Question text in Korean: 예식장 후보가 20개 넘게 생겼습니다. 어떤 화면이나 안내가 가장 편할 것 같나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 내 조건에 맞는 상위 3개와 이유를 먼저 보여준다.  
- B. 전체 후보를 표로 보고 직접 정렬한다.  
- C. 후기와 실제 가격이 많은 후보부터 본다.  
- D. 상대와 같이 볼 후보만 따로 표시한다.  
High score meaning: 긴 목록보다 압축된 추천과 이유가 필요할 수 있음을 시사한다.  
Low score meaning: 전체 데이터 탐색, 근거 우선, 공동 후보 표시를 선호할 수 있음을 시사한다.  
Bias/stigma risk: 추천 활용을 수동성으로 표현하지 않는다.  
Gender stereotype risk: 후보 압축 요청을 성별화하지 않는다.  
Report mapping: 후보 압축형 안내 선호를 표시한다.  
Amora mapping: 상위 3개 추천과 제외 이유를 생성한다.  
/check mapping if relevant: 가격·후기 기준 필터로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 예식장 후보 비교 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-guidanceNeed-004

Question ID: WC-Q-guidanceNeed-004  
Target construct: guidanceNeed  
Secondary constructs: emotionalSupport  
Journey stage tags: sdm_search, venue_search  
Scenario domain: 커뮤니티 의견이 너무 많음  
Question text in Korean: 커뮤니티 후기를 많이 읽었더니 의견이 서로 달라 더 헷갈립니다. 무엇이 가장 필요합니까?  
Response format: forced_choice  
Response options in Korean:  
- A. 내 조건에 맞는 후기만 추려 핵심을 요약해준다.  
- B. 내가 직접 더 많은 후기를 비교할 수 있게 한다.  
- C. 지금 헷갈리는 마음을 먼저 정리해준다.  
- D. 상대와 같이 볼 후기 목록을 만든다.  
High score meaning: 많은 의견을 내 상황에 맞게 압축해주는 지원이 필요할 수 있음을 시사한다.  
Low score meaning: 직접 비교, 정서 정리, 공동 검토를 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 정보 압축 필요를 판단력 평가로 표현하지 않는다.  
Gender stereotype risk: 커뮤니티 탐색과 요약 역할을 성별로 정하지 않는다.  
Report mapping: 정보 과부하 상황에서 요약 지원을 제안한다.  
Amora mapping: 조건 기반 후기 요약을 생성한다.  
/check mapping if relevant: 후기 기반 견적 확인으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 후보 검토 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-guidanceNeed-005

Question ID: WC-Q-guidanceNeed-005  
Target construct: guidanceNeed  
Secondary constructs: costRisk  
Journey stage tags: contract_pending  
Scenario domain: 복잡한 견적서를 간단히 이해하고 싶음  
Question text in Korean: 견적서가 여러 장이고 항목명이 낯섭니다. 가장 도움이 되는 것은 무엇인가요?  
Response format: forced_choice  
Response options in Korean:  
- A. 꼭 확인해야 할 항목과 질문을 짧게 요약해준다.  
- B. 모든 항목을 직접 하나씩 읽어볼 수 있게 둔다.  
- C. 추가금 가능성이 큰 항목만 먼저 표시해준다.  
- D. 상대에게 공유할 쉬운 요약본을 만든다.  
High score meaning: 복잡한 정보를 핵심 질문으로 압축받을 때 편한 경향을 시사한다.  
Low score meaning: 직접 검토, 위험 항목 우선, 공유 요약을 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 견적 요약 필요를 이해력 평가로 연결하지 않는다.  
Gender stereotype risk: 견적 이해를 특정 성별의 책임으로 쓰지 않는다.  
Report mapping: 견적 요약과 질문 우선순위를 제안한다.  
Amora mapping: 견적서 핵심 질문 요약을 만든다.  
/check mapping if relevant: 견적서 항목 검증으로 연결한다.  
Etiquette/checklist mapping if relevant: 계약 전 체크리스트로 연결한다.  
Validation status: draft

#### WC-Q-guidanceNeed-006

Question ID: WC-Q-guidanceNeed-006  
Target construct: guidanceNeed  
Secondary constructs: familyIntegration  
Journey stage tags: venue_search, marriage_discussion  
Scenario domain: 상견례 또는 예식장 투어 전 준비할 것이 헷갈림  
Question text in Korean: 상견례나 예식장 투어 전 무엇을 준비해야 할지 헷갈립니다. 어떤 안내가 가장 좋나요?  
Response format: forced_choice  
Response options in Korean:  
- A. 지금 단계에서 준비할 질문과 순서를 짧게 알려준다.  
- B. 가족에게 먼저 확인할 항목을 정리한다.  
- C. 비용과 계약 조건 질문을 먼저 준비한다.  
- D. 둘이 원하는 분위기와 기준을 먼저 이야기한다.  
High score meaning: 단계별 준비물을 압축해 알려주는 지원을 원할 가능성을 시사한다.  
Low score meaning: 가족 확인, 비용 질문, 커플 기준 대화를 먼저 원할 수 있음을 시사한다.  
Bias/stigma risk: 준비 안내 필요를 미숙함으로 표현하지 않는다.  
Gender stereotype risk: 상견례나 투어 준비를 특정 성별의 역할로 두지 않는다.  
Report mapping: stage-specific 준비 가이드를 제안한다.  
Amora mapping: 상견례·투어 전 질문 카드와 준비 순서를 만든다.  
/check mapping if relevant: 예식장 견적 질문으로 연결할 수 있다.  
Etiquette/checklist mapping if relevant: 상견례·투어 준비 체크리스트로 연결한다.  
Validation status: draft
