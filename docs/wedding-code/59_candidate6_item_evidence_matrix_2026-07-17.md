# WeddingCode Candidate 6.3 문항 근거·편향 행렬

상태: **AUTHORITATIVE RESEARCH COMPANION / 전 문항 M0 / PASS 없음**
최초 작성: 2026-07-17 / 최종 개정: 2026-07-18
exact-version: `wedding-code-candidate6-research.3`

`S0/S1`은 장면 또는 개념 소재의 근거 수준일 뿐, 문항이 개인 특성을 측정한다는 뜻이 아니다.
모든 문항은 `M0`, `COGNITIVE_INTERVIEW_REQUIRED`, `scoreEligible:false`다. exact 문구는
`apps/web/src/lib/weddingCode/research/candidate6.ts`가 source of truth다.

## 문항별 ledger

| ID | theme | applicability | 장면 | 측정 | source ID | item별 locator / 지지 맥락 | 주요 대안 해석 | 현재 판정 |
|---|---|---|---:|---:|---|---|---|---|
| `C6-DS1` | `DS` | universal | `S1` | `M0` | `SRC-KCA-WEDDING-PRICE-2025-06`, `SRC-PRODUCT-SCENARIO-LOG` | KCA 가격·옵션 차이; domain map `costRisk` 4-9 / `experienceMeaning` 5-6 | 예산 압박, 이동 제약, 예식 형태 | INTERVIEW |
| `C6-DS2` | `DS` | recording | `S0` | `M0` | `SRC-PRODUCT-SCENARIO-LOG` | domain map `experienceMeaning` 2-3, 9의 기록 장면 | 기록 관심, 개인정보 우려, 매체 경험 | CONDITIONAL INTERVIEW |
| `C6-DS3` | `DS` | vendor-assisted | `S1` | `M0` | `SRC-KCA-WEDDING-PRICE-2025-06`, `SRC-PRODUCT-SCENARIO-LOG` | KCA 업체 옵션; domain map `costRisk` 6-9 / `evidenceDecision` | 업체 신뢰, 피해 경험, 과정/결과 facet | FACET REVIEW + CONDITIONAL INTERVIEW |
| `C6-DS4` | `DS` | universal | `S0` | `M0` | `SRC-PRODUCT-SCENARIO-LOG` | domain map `experienceMeaning` 6,11 / `aestheticMood` 2,10. 상상한 예식·예식 내용·장소 분위기·커플 적합 장면만 제안하며 알림/축하 wording이나 DS construct는 지지하지 않음 | 행사 규모, 알림/축하 해석 분기, 준비 단계 | COMPREHENSION REVIEW |
| `C6-JI1` | `JI` | partner-collaboration | `S0` | `M0` | `SRC-DYADIC-COPING-REVIEW-2019`, `SRC-PRODUCT-SCENARIO-LOG` | common dyadic coping; domain map `coPreparation` 2,4,6 | 검색 숙련, 함께 가능한 시간, 모범답안 | INTERVIEW |
| `C6-JI2` | `JI` | partner-collaboration | `S0` | `M0` | `SRC-DYADIC-COPING-REVIEW-2019`, `SRC-PRODUCT-SCENARIO-LOG` | common dyadic coping; domain map `coPreparation` 3,6,8 | 결정 중요도, 관심 차이, 책임 부담 | INTERVIEW |
| `C6-JI3` | `JI` | partner-collaboration | `S0` | `M0` | `SRC-DYADIC-COPING-REVIEW-2019`, `SRC-PRODUCT-SCENARIO-LOG` | common dyadic coping; `coPreparation` 5-6 / `roleOwnership` 5,8 | 집중 방식, 피로, 일의 종류 | INTERVIEW |
| `C6-OA1` | `OA` | partner-collaboration | `S0` | `M0` | `SRC-PRODUCT-SCENARIO-LOG` | domain map `roleOwnership` 1,4,10 | 신뢰, 검색 숙련, 실수 비용 | INTERVIEW |
| `C6-OA2` | `OA` | partner-collaboration | `S0` | `M0` | `SRC-PRODUCT-SCENARIO-LOG` | domain map `roleOwnership` 2,5,8 | 정보 문해력, 정리 도구, 공유 기대 | INTERVIEW |
| `C6-OA3` | `OA` | partner-collaboration | `S0` | `M0` | `SRC-PRODUCT-SCENARIO-LOG` | domain map `roleOwnership` 5,7,8 | 업무 난이도, 마감 위험, 작업 습관 | INTERVIEW |
| `C6-CP1` | `CP` | partner-collaboration | `S0` | `M0` | `SRC-PRODUCT-SCENARIO-LOG` | `coPreparation` 5 / `roleOwnership` 5,8의 합의된 확인 | 불안, 업무 가시성, 마감 위험 | INTERVIEW |
| `C6-CP2` | `CP` | partner-collaboration | `S0` | `M0` | `SRC-PRODUCT-SCENARIO-LOG` | domain map `roleOwnership` 4,10의 최종 검토 | 결정 중요도, 수정 가능성, 책임 기대 | INTERVIEW |
| `C6-CP3` | `CP` | partner-collaboration | `S0` | `M0` | `SRC-PRODUCT-SCENARIO-LOG` | `roleOwnership` 5,8에서 막힘 확인 장면만 도출 | 문제 심각도, 지원 가능성, exception/escalation | QUANT PILOT 전 REWRITE/DROP/CONTEXTUAL REVIEW |
| `C6-ES1` | `ES` | partner-collaboration | `S0` | `M0` | `SRC-DYADIC-COPING-REVIEW-2019`, `SRC-PRODUCT-SCENARIO-LOG` | emotion-focused support 개념; domain map `emotionalSupport` | 감정 강도, stress communication/정보수집, 모범답안 | ALTERNATIVE INTERPRETATION REVIEW |
| `C6-AS1` | `AS` | partner-collaboration | `S0` | `M0` | `SRC-DYADIC-COPING-REVIEW-2019`, `SRC-PRODUCT-SCENARIO-LOG` | problem-focused support 개념; domain map `executionSupport` | 실행 기능, 난이도, 시간 압박 | INTERVIEW |
| `C6-ES2` | `ES` | partner-collaboration | `S0` | `M0` | `SRC-DYADIC-COPING-REVIEW-2019`, `SRC-PRODUCT-SCENARIO-LOG` | emotion-focused support 개념; domain map `emotionalSupport` | 의사결정 피로, 관계 규범, 현재 기분 | INTERVIEW |
| `C6-AS2` | `AS` | partner-collaboration | `S0` | `M0` | `SRC-DYADIC-COPING-REVIEW-2019`, `SRC-PRODUCT-SCENARIO-LOG` | problem-focused support; `executionSupport` / `guidanceNeed` | 정보 부족, 결정 책임, 기준 합의 | INTERVIEW |
| `C6-ES3` | `ES` | partner-collaboration | `S0` | `M0` | `SRC-DYADIC-COPING-REVIEW-2019`, `SRC-PRODUCT-SCENARIO-LOG` | emotion-focused support 개념; domain map `emotionalSupport` | 손실 크기, 대안 매력, 대화 선호 | INTERVIEW |
| `C6-AS3` | `AS` | partner-collaboration | `S0` | `M0` | `SRC-DYADIC-COPING-REVIEW-2019`, `SRC-PRODUCT-SCENARIO-LOG` | problem-focused support 개념; domain map `executionSupport` | 피로, 대안 가용성, 과제 명확성 | INTERVIEW |
| `C6-SI1` | `SI` | stakeholder-context | `S0` | `M0` | `SRC-PRODUCT-SCENARIO-LOG` | domain map `familyIntegration` / `coupleAutonomy` 1-4 | 관계 권력, 경제 지원, 문화 규범 | CONTEXTUAL ONLY; CORE 뒤 배치 |
| `C6-SI2` | `SI` | stakeholder-context | `S0` | `M0` | `SRC-PRODUCT-SCENARIO-LOG` | domain map `familyIntegration` / `coupleAutonomy` 5-8 | 관계 거리, 참여 가능성, 문화 규범 | CONTEXTUAL ONLY; CORE 뒤 배치 |

## 정확한 source registry

| source ID | URL/URI | locator | 적용 population/context | 지지하는 것 | 지지하지 않는 것 |
|---|---|---|---|---|---|
| `SRC-AERA-TEST-STANDARDS-2014` | https://www.testingstandards.net/uploads/7/6/6/4/76643089/standards_2014edition.pdf | Validity chapter, Standards 1.0-1.3 | 일반 교육·심리검사 타당도 논증; WeddingCode 표본 아님 | 의도한 해석마다 관련된 여러 타당도 근거가 필요하다는 원칙 | WeddingCode 문항·theme·점수·분류의 타당성 |
| `SRC-CDC-COGNITIVE-INTERVIEWING-2024` | https://www.cdc.gov/nchs/ccqder/question-evaluation/cognitive-interviewing.html | Overview, Characteristics, Follow-up questions | 관련 경험을 가진 목적표집 소규모 질적 응답자; 문항평가 맥락 | 응답자가 문항을 어떻게 이해·판단·응답하는지 조사하는 방법 | 인지면접만으로 scale/result가 성립한다는 주장 |
| `SRC-KCA-WEDDING-PRICE-2025-06` | https://www.kca.go.kr/home/sub.do?menukey=4002&mode=view&no=1003902297&page=4 | 2025-07-29 보도자료와 2025년 6월 결혼서비스 가격조사 첨부 | 한국 14개 지역 결혼서비스업체 515개 가격조사; 소비자 응답자 표본이 아님 | 한국 결혼서비스 공급의 가격·옵션 구조 차이가 존재하는 장면 | 소비자의 선택 이유·행동·성향 construct, 현재 문항 wording, 점수 |
| `SRC-DYADIC-COPING-REVIEW-2019` | https://pmc.ncbi.nlm.nih.gov/articles/PMC6443825/ | common dyadic coping과 emotion-/problem-focused supportive coping 논의 | 리뷰가 종합한 커플 연구, 주로 한국 웨딩 준비 밖의 관계·스트레스 맥락 | 공동 대처와 정서·실행 지원을 구분해 볼 연구 가설 | 한국 웨딩 장면·현재 behavior·개인 profile의 타당성 |
| `SRC-PRODUCT-SCENARIO-LOG` | docs/wedding-code/05_question_domain_map.md | 각 item row의 section/scenario 번호 | 참여자 표본 없음; 내부 제품 장면 가설과 concept elicitation 설계 맥락 | 결혼 준비·협업 장면을 concept elicitation에서 확인할 제품 가설 | 독립 경험 근거, 빈도, 대표성, 측정 타당성 |

코드 registry의 영문 `supportedClaim`, `notSupportedClaim`, `population`, `context`와
`CANDIDATE6_ITEM_EVIDENCE_LINKS`도 동일 경계를 강제한다. 현재 독립 장면 자료가 붙은 `S1`은
`DS1/DS3` 두 개뿐이고, 나머지 19개는 간접 개념 또는 내부 설계 가설인 `S0`다. 한국 예비부부가
exact wording을 의도대로 이해한다는 직접 근거는 0개다.

## grade 규칙

- `S0`: 내부 가설 또는 간접 개념 자료만 있음. 실제 한국 예비부부 장면 반복성 미확인.
- `S1`: 독립 자료가 장면 범주의 존재는 지지함. endpoint·문항·theme는 미지지.
- `S2`: 현재 사용 금지. exact citation, population, locator, claim linkage와 독립 human review 없이는 부여 불가.
- `M0`: 문항 내용·응답과정·구조·외적 관계·공정성·결과 사용 근거가 아직 없음.

## 공통 폐기·개정 기준

다음 중 하나면 표현만 다듬지 않고 REWRITE/SPLIT/DROP review를 연다.

- prompt, premise, endpoint/behavior를 자기 말로 일관되게 설명하지 못함
- 한 답이 더 합리적·배려 깊음·성실함·효도처럼 반복 해석됨
- 같은 exact item에서 2명 이상 construct 오해 또는 맞는 답 없음 보고
- 응답이 예산·마감·숙련·성별 역할·관계 권력·장애/신경다양성에 지배됨
- `not_applicable`, `no_experience`, `depends`, `skip`을 구분하지 못함
- CP가 stable hypothesis가 아니라 단발 조율 도구로만 작동함
- SI가 사람 특성 판정으로 읽힘
- 한 번의 severe harm, 낙인, 비난, 통제, 답 공개 압박 발생

숫자는 자동 PASS가 아니라 review trigger다. founder intuition, AI review, alpha 하나, 합성 persona는
사람 근거를 대체하지 않는다.
