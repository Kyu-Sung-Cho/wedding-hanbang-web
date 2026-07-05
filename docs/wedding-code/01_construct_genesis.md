# WeddingCode Construct Genesis v0.2

WeddingCode starts from internal constructs, not from final 4-letter labels. B/D, C/O, P/M, and F/U are provisional public labels only. They may later become a presentation shorthand, but they are not the source of truth.

Internal constructs are continuous scores. Each construct should be treated as a 0-100 signal with confidence, evidence, and validation status rather than a binary type assignment.

> v0.2 (2026-07-05): v0.1의 TBD 전체를 `05_question_domain_map.md`(사실상의 작업 정의),
> `06_question_bank_v0.1.md`, `14_ai_red_team_review_v0.1.md`에서 역주입해 채움.
> 모든 Definition의 주장 상태는 **interpretation**(도메인 맵 기반 작업 정의),
> 모든 Validation Hypothesis는 **hypothesis**다. Evidence Direction은 "수집할 증거의
> 방향"이며 특정 문헌 인용이 아니다 — 실제 인용은 02 close-reading을 통과한 것만 허용.

## Provisional Public Axis Map (presentation only, not scoring)

| 축 | 구성개념 쌍 | 상태 |
|---|---|---|
| B/D | costRisk ↔ experienceMeaning | 후보 표현층 |
| C/O | coPreparation ↔ roleOwnership | 후보 표현층 |
| P/M | evidenceDecision ↔ aestheticMood | 후보 표현층 |
| F/U | familyIntegration ↔ coupleAutonomy | 후보 표현층 (5장 규칙: 데이터 확인 전 단순 이분 금지) |
| (내부 전용) | emotionalSupport, executionSupport, decisionPaceRisk, guidanceNeed | 공개 정체성 라벨 금지 — UX/리스크 신호 |

축 쌍은 "반대 극"이 아니라 "서로 다른 우선 기준"이다. 두 구성개념이 동시에 높을 수 있으며,
Phase 5 데이터가 상관을 확인하기 전까지 어떤 쌍도 단일 이분 척도로 합치지 않는다.

## Constructs

- costRisk
- experienceMeaning
- coPreparation
- roleOwnership
- evidenceDecision
- aestheticMood
- familyIntegration
- coupleAutonomy
- emotionalSupport
- executionSupport
- decisionPaceRisk
- guidanceNeed

## costRisk — 비용·리스크 민감도

### Definition
결정 전에 총비용·숨은 추가금·환불/취소 조건·보증인원·식대·계약 리스크가 명확해지기를 원하는 정도. (interpretation)

### Real Wedding Problem
스드메 계약금 외 추가 지불이 관행화된 시장에서, 견적서에 원본·보정·헬퍼·얼리스타트 같은 항목이 불명확한 채 계약이 이뤄지고 분쟁으로 이어진다.

### Evidence Direction
`KOREAN_WEDDING_RISK`(A급: 소비자원 결혼서비스 실태조사의 추가금·분쟁 통계, 참가격 가격 데이터 — 제품이 이미 인용 중) / `HANBANG_ASSET`(숨은비용 체크리스트) / `COUPLE_ASSESSMENT`(문헌 수집 예정).

### Product Connection
`quote_check`(1순위 라우팅), `amora`(계약 전 질문 스크립트), `checklist`.

### Example Question Domains
예산 초과 식장, 당일 한정 할인, 보증인원 초과, 견적서 불명확 항목, 입금 전 환불 조건. (05 §costRisk 1~10)

### Possible Later Public Letter
B (표현층 후보 — 채점 근거 아님)

### Validation Hypothesis
높은 costRisk 신호는 /check 사용률·계약 전 질문 발송률과 정적 상관을 보일 것이다(Phase 6). 스모크에서 해당 문항 self-recognition ≥ 4.0/5.

### What It Does Not Mean
쩨쩨함·돈 집착·낭만 부족·만족을 못 누리는 사람이라는 뜻이 아니다. "결정 준비성"이지 인색함이 아니다.

## experienceMeaning — 경험·의미 중시도

### Definition
사진·영상·드레스·꽃·공간 분위기·예식 경험이 오래 남을 정서적 의미로서 얼마나 중요한지의 정도. (interpretation)

### Real Wedding Problem
"남는 건 사진뿐"이라는 실감과 예산 사이에서, 의미 있는 항목을 줄일지 지킬지의 갈등이 커플 다툼과 후회의 단골 원인이 된다.

### Evidence Direction
`WEDDING_PLATFORM_SEGMENTATION`(B~C급: 업계 세그먼트 리포트) / `PRODUCT_DATA`(향후 카테고리별 예산 배분·지출 데이터) / `UI_IDENTITY`(표현층 전용).

### Product Connection
`amora`(예산 인터뷰에서 의미 항목 보존 전략), `checklist`, `wedding_lounge`.

### Example Question Domains
기본 패키지를 넘는 드레스, 분위기 좋은 비최저가 식장, 절약 vs 의미 항목 유지, 주례·혼인서약 등 예식 내용의 의미. (05 §experienceMeaning 1~11)

### Possible Later Public Letter
D (표현층 후보)

### Validation Hypothesis
높은 experienceMeaning은 스냅·영상·꽃 카테고리 예산 비중 및 관련 체크리스트 완료율과 정적 상관을 보일 것이다(Phase 6).

### What It Does Not Mean
비합리·낭비·허영·통제 불능 소비라는 뜻이 아니다. 의미 만족과 무절제 지출은 별개 개념이다.

## coPreparation — 함께준비 기대도

### Definition
결혼 준비가 커플의 공동 과정으로 느껴지기를 원하는 정도 — 위임받은 결정이라도 참여 없이 진행되면 외로움을 느끼는 성향. (interpretation)

### Real Wedding Problem
"네가 알아서 해, 난 다 좋아"가 신뢰의 표현인 동시에 한쪽에게 독박준비 감각을 만드는 이중성 — 준비 스트레스와 갈등의 최빈 원인 중 하나.

### Evidence Direction
`COUPLE_ASSESSMENT`·`DYADIC_COPING`(공동 대처 문헌 방향, 수집 예정) / `PRODUCT_DATA`(파트너 초대·공유 결정 비율).

### Product Connection
`couple_report`, `onboarding`(파트너 초대 시점), `amora`, `checklist`(공동 검토 항목 지정).

### Example Question Domains
파트너의 전면 위임, 며칠간 혼자 조사, 정기 준비 회의 욕구, 승인만 하는 파트너. (05 §coPreparation 1~10)

### Possible Later Public Letter
C (표현층 후보)

### Validation Hypothesis
높은 coPreparation은 파트너 초대 클릭·커플 리포트 관심과 정적 상관을 보일 것이다(Phase 4·6).

### What It Does Not Mean
집착·의존·통제욕·혼자 결정 못 하는 사람이라는 뜻이 아니다. 준비 "방식"에 대한 기대이지 능력 결핍이 아니다.

## roleOwnership — 역할주도 선호도

### Definition
결혼 준비 일을 담당자별로 나누고 맡은 사람이 주도하는 방식을 선호하는 정도 — 후보 압축은 한 명, 최종 결정은 함께 같은 분업 구조 선호. (interpretation)

### Real Wedding Problem
모든 것을 둘이 함께 보다가 결정이 무한 회의가 되거나, 반대로 분업이 무관심으로 오해받는 갈등 — 효율과 서운함 사이의 구조 문제.

### Evidence Direction
`COUPLE_ASSESSMENT`(역할 분담 문헌 방향) / `PRODUCT_DATA`(체크리스트 담당자 지정·완료 패턴).

### Product Connection
`couple_report`, `checklist`(담당자·마감 구조), `amora`.

### Example Question Domains
후보 다수의 압축, 예산 트래킹 담당 정하기, 강점별 검토 기준 분담, "누가 뭘 하나" 합의 욕구. (05 §roleOwnership 1~10)

### Possible Later Public Letter
O (표현층 후보)

### Validation Hypothesis
높은 roleOwnership은 체크리스트 담당자 지정 사용률과 정적 상관을 보일 것이다(Phase 6). 스모크에서 "분업=무관심"으로 읽히는 응답자 비율 < 5%.

### What It Does Not Mean
무관심·차가움·회피·책임 전가라는 뜻이 아니다. 효율적 분업과 애정 결핍은 별개다.

## evidenceDecision — 근거기반 결정성향

### Definition
후기·실지불가·계약서·가격표·견적 비교·환불 조건 같은 근거가 갖춰져야 결정할 준비가 됐다고 느끼는 정도. (interpretation)

### Real Wedding Problem
구두 약속과 불투명 패키지가 흔한 시장에서 서면 확인 없이 진행했다가 "말이 달라지는" 분쟁 — 근거 확보 습관이 실질적 자기방어가 되는 구조.

### Evidence Direction
`DECISION_STYLE`(의사결정 스타일 문헌 방향) / `KOREAN_WEDDING_RISK`(A급 실태조사·분쟁 사례) / `HANBANG_ASSET`(견적체크 항목 체계).

### Product Connection
`quote_check`, `community`(실지불 후기), `amora`(서면 확인 스크립트).

### Example Question Domains
사진은 예쁜데 후기 없는 스튜디오, 구두 약속의 서면화, 입금 전 취소/환불 확인, 견적 항목별 비교. (05 §evidenceDecision 1~10)

### Possible Later Public Letter
P (표현층 후보)

### Validation Hypothesis
높은 evidenceDecision은 /check 재사용·계약 전 질문 스크립트 복사율과 정적 상관을 보일 것이다(Phase 6).

### What It Does Not Mean
높다고 우월하거나 더 합리적인 것이 아니고, 낮다고 부주의하거나 순진한 것이 아니다. 결정 "방식"이지 지능이 아니다.

## aestheticMood — 무드·취향 결정성향

### Definition
비주얼 무드·색감·포트폴리오·첫인상·미적 적합성이 결정을 이끄는 정도 — 분위기를 빠르게 읽고 그 적합성이 기준이 되는 성향. (interpretation)

### Real Wedding Problem
"조건은 다 맞는데 우리 느낌이 아니야"가 정당한 판단 기준임에도 비합리로 치부되는 문제, 그리고 무드 우선 결정이 근거 확인을 건너뛸 때의 리스크가 공존.

### Evidence Direction
`DECISION_STYLE` / `WEDDING_PLATFORM_SEGMENTATION` / `UI_IDENTITY`(무드 키워드 표현층).

### Product Connection
`wedding_lounge`(무드 탐색), `amora`(무드 키워드 → 조건 병행 확인 유도), `checklist`.

### Example Question Domains
원하는 무드와 일치하는 포트폴리오, 즉각적 공간 느낌, 후기 부족 vs 비주얼 적합, 가격보다 먼저 레퍼런스 비교. (05 §aestheticMood 1~10)

### Possible Later Public Letter
M (표현층 후보)

### Validation Hypothesis
높은 aestheticMood는 라운지 탐색 깊이·무드 키워드 사용과 정적 상관을 보일 것이다(Phase 6). 스모크에서 "감성적=경솔" 오독 지표 < 5%.

### What It Does Not Mean
비합리·피상적·과잉감성·비실용이라는 뜻이 아니다. 무드 판단은 정당한 결정 입력이다.

## familyIntegration — 가족·양가 조율도

### Definition
부모·혼주·하객·식사 만족·동선·예절·양가 화합을 결혼 결정에 적극 반영하는 정도. (interpretation)

### Real Wedding Problem
하객 수·식사·지역·격식을 둘러싼 양가 기대와 커플 계획의 충돌 — 준비 중 가장 감정 소모가 큰 갈등 축이며 중립적 조율 언어가 부족하다.

### Evidence Direction
`COUPLE_ASSESSMENT`(원가족 관계 문헌 방향) / `HANBANG_ASSET`(예절 가이드 체계) / `PRODUCT_DATA`.

### Product Connection
`etiquette_guide`, `couple_report`, `amora`(양가 설명 스크립트), `checklist`.

### Example Question Domains
하객 증원 요청, 무드보다 식사·교통을 보는 부모, 스몰웨딩 vs 전통 격식, 혼주 동선·주차. (05 §familyIntegration 1~11)

### Possible Later Public Letter
F (표현층 후보 — U와의 단순 이분은 데이터 확인 전 금지)

### Validation Hypothesis
높은 familyIntegration은 예절 가이드 열람·가족 관련 체크리스트 완료와 정적 상관을 보일 것이다(Phase 6).

### What It Does Not Mean
높다고 맹목적 순종이 아니고, 낮다고 이기적·불효·반가족이 아니다. 조율 대상의 "범위" 선호일 뿐이다.

## coupleAutonomy — 커플자율 지향도

### Definition
커플 자신의 기준·라이프스타일·실용성·취향·예산이 결정을 이끌기를 원하는 정도 — 격식 축소와 "우리다운 결혼" 지향. (interpretation)

### Real Wedding Problem
전통 절차 간소화·비정형 식장·관계 기반 하객 기준을 원할 때, 가족 기대와 부딪히며 "설명하되 싸우지 않는" 언어가 필요해진다.

### Evidence Direction
`COUPLE_ASSESSMENT` / `PRODUCT_DATA`(간소화 선택·비정형 옵션 선호 데이터).

### Product Connection
`etiquette_guide`(생략 가능 절차 안내), `couple_report`, `checklist`.

### Example Question Domains
스몰웨딩 vs 가족 기대, 절차 간소화, 관계 기반 하객 기준, 부모님께 갈등 없이 설명하기. (05 §coupleAutonomy 1~10)

### Possible Later Public Letter
U (표현층 후보)

### Validation Hypothesis
높은 coupleAutonomy는 간소화 관련 예절 가이드 소비·비정형 선택과 정적 상관을 보일 것이다(Phase 6). 레드팀 지적대로 "설득"이 아닌 "설명/공유" 프레임 유지 시 낙인 피드백 < 5%.

### What It Does Not Mean
이기적·미성숙·무례·타협 불능이라는 뜻이 아니다. 자율은 가족 거부가 아니라 기준 설정이다.

## emotionalSupport — 공감먼저 필요도 (내부 전용)

### Definition
결혼 준비 스트레스 상황에서 문제 해결보다 감정 인정("왜 이게 중요한지 알아")이 먼저 필요한 정도. (interpretation)

### Real Wedding Problem
한쪽은 공감을 원하는데 상대가 해결책부터 내놓아 갈등이 증폭되는 패턴 — 지원 "순서"의 불일치 문제.

### Evidence Direction
`DYADIC_COPING`·`DEMAND_WITHDRAW`(요구-철회 패턴 문헌 방향, 수집 예정) / `PRODUCT_DATA`(채팅 반응 패턴).

### Product Connection
`amora`(응답 시퀀싱: 공감→과제), `couple_report`(커플 대화 스크립트). **공개 라벨 금지.**

### Example Question Domains
지친 상태에서의 파트너 반응, 상담 후 갈등, 진행은 되는데 외로운 느낌. (05 §emotionalSupport 1~10)

### Possible Later Public Letter
없음 — 내부 UX 신호 전용 (05 §1.1 규칙).

### Validation Hypothesis
높은 emotionalSupport 신호에 공감 선행 응답을 줄 때 채팅 지속·만족이 높아질 것이다(Phase 6, 아모라 톤 튜닝 A/B).

### What It Does Not Mean
약함·예민함·유난·까다로움이 아니다. 지원 순서 선호이지 감정적 결함이 아니다.

## executionSupport — 실행먼저 필요도 (내부 전용)

### Definition
감정 정리보다 구체적 행동·담당·마감·결정이 먼저 있어야 안정을 찾는 정도. (interpretation)

### Real Wedding Problem
결론 없는 긴 대화가 오히려 스트레스인 사람에게 필요한 건 "오늘 할 일 3개" — 그러나 이 성향이 차가움으로 오해받는다.

### Evidence Direction
`DYADIC_COPING` / `PRODUCT_DATA`(액션 카드 사용 패턴).

### Product Connection
`amora`(행동 요약 선행), `checklist`, `couple_report`. **공개 라벨 금지.**

### Example Question Domains
과제 목록화 후 안정, 갈등 후 빠른 역할 지정, 본식 주간의 태스크 우선 대응. (05 §executionSupport 1~10)

### Possible Later Public Letter
없음 — 내부 UX 신호 전용.

### Validation Hypothesis
높은 executionSupport 신호에 액션 우선 응답을 줄 때 체크리스트 전환이 높아질 것이다(Phase 6).

### What It Does Not Mean
차가움·공감 결핍·조급함이 아니다. 회복 경로가 "명료함"일 뿐이다.

## decisionPaceRisk — 빠른계약 위험도 (내부 전용)

### Definition
"오늘만 할인"·박람회 부스·상담 흥분·날짜 소멸 압박 아래에서 조건 확인 전에 계약해버릴 위험의 정도. (interpretation)

### Real Wedding Problem
소액 계약금의 심리적 문턱이 낮아 조건 미확인 계약→취소 분쟁으로 이어지는, 소비자원 분쟁 사례의 전형 패턴.

### Evidence Direction
`DECISION_STYLE` / `KOREAN_WEDDING_RISK`(A급: 방문판매·계약 분쟁 통계) / `HANBANG_ASSET`(계약 전 체크).

### Product Connection
`quote_check`(계약 전 개입), `amora`(일시정지 룰 제안), `checklist`. **공개 라벨 금지 — 리스크 예방 신호.**

### Example Question Domains
당일 한정 할인, 선호 날짜 소멸 압박, 구두 약속만 있는 업체, 상담 직후의 흥분. (05 §decisionPaceRisk 1~11)

### Possible Later Public Letter
없음 — 내부 리스크 신호 전용.

### Validation Hypothesis
높은 decisionPaceRisk 신호에 "하루 숙려+서면 확인" 개입을 제공하면 계약 후 이의/후회 표현이 감소할 것이다(Phase 6).

### What It Does Not Mean
충동적·어리석음·잘 속는 사람이 아니다. 시장의 압박 설계에 대한 노출도이지 판단력 결함이 아니다.

## guidanceNeed — 정보압축 필요도 (내부 전용)

### Definition
정보 과부하 상태에서 제품이 선택지를 압축하고 "지금 할 일"로 정리해주기를 원하는 정도. (interpretation)

### Real Wedding Problem
업체 수백 곳·커뮤니티 의견 홍수 속에서 "뭐부터 해야 할지 모르겠다"가 준비 초기의 지배적 감각 — 압축 안내가 곧 진입 장벽 해소다.

### Evidence Direction
`DECISION_STYLE` / `HANBANG_ASSET`(체크리스트·단계 안내 체계) / `PRODUCT_DATA`(안내 카드 클릭 패턴).

### Product Connection
`amora`(우선순위 압축), `onboarding`, `wedding_lounge`, `checklist`. **공개 라벨 금지.**

### Example Question Domains
너무 많은 후보, 뭐부터 할지 모름, 긴 목록 대신 톱 옵션, 상견례/투어 전에 뭘 준비할지. (05 §guidanceNeed 1~11)

### Possible Later Public Letter
없음 — 내부 UX 신호 전용.

### Validation Hypothesis
높은 guidanceNeed 신호에 압축 안내를 제공하면 온보딩 완주·초기 리텐션이 높아질 것이다(Phase 6).

### What It Does Not Mean
의존적·무능·수동적·준비 부족이 아니다. 정보 소비 "방식" 선호이지 능력이 아니다.
