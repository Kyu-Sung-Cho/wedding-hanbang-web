# 랜딩 문구 수정표 80개 항목 최종 대조

80개 요청을 현재 카피의 필드·문장과 실제 JSX 사용처에 다시 연결했습니다. 같은 줄번호의 다음 속성·괄호를 인용하던 근거 오류를 교정했습니다. 이 문서는 소스·원문·이미지 감사이며 기능 테스트나 배포 완료 보고서가 아닙니다.

- 스냅샷: 2026-10-11T15:21:42Z. 기준 HEAD: `35ae89f3b4399d94a8ee18990f781a1289a35d72` 및 커밋 전 수정본.
- 원본 XLSX SHA256: `f71ece9715f7a866d817d7ff2df5806e8d4e064e92a57169332934171b2a2410`. 읽기 전후 일치하며 XLSX XML의 406셀과 기존 추출값을 직접 대조했습니다.
- 시트 1개·비어 있지 않은 83행입니다. #1–80은 엑셀 6–85행입니다. 원본 위치/현재 문구/문제점/권장안의 320필드는 바꾸지 않았습니다.
- landingContent.ts: `6f044915f67451559091f97fcafec8ea4fd19f2457b78ce7b8ec20c4dba94a21`. AppPreviewCard.tsx: `29bb27a1fa5d073018d0fe88a1965ddc152cd935d31e21c89de0f02fc28af7f6`.

## 적용 상태

| 구분 | 항목 수 | 의미 |
|---|---:|---|
| 제안 그대로 채택 | 27 | 권장 문장·핵심 문구 또는 삭제 의도를 그대로 적용했습니다. 줄바꿈·조사·추가 기능 설명은 행별로 구분합니다. |
| 의미 반영 | 46 | 실제 기능·검증·개인정보 범위에 맞는 다른 문구로 지적한 문제를 해결했습니다. |
| 비노출 | 6 | 교체된 지표 또는 현재 렌더하지 않는 섹션입니다. 데이터 삭제와 비노출을 구분합니다. |
| 현재 방향으로 제외 | 1 | #73 보조 버튼은 단일 아모라 행동 방향에서 제외했습니다. 반영 완료로 합산하지 않습니다. |

## 근거와 예외

E는 현재 값과 실제 JSX 바인딩을 함께 제시합니다. lineStart/lineEnd와 sourceText를 현재 소스에서 재검증했습니다. 태그 선언이나 같은 줄번호만으로 문장이 표시된다고 판정하지 않았습니다. 적용 판단은 I입니다.

- #37 일정: 비노출 confirm.tools 대신 실제 confirm.management[2]와 map/body 사용처를 인용했습니다.
- #52–55 WC: title/body/note를 각각 인용했습니다. 기본 새 판은 동의 후 내 답 링크 전달→파트너 응답→결과 링크 직접 반환입니다. 기본 판의 답 서버 전송 없음과 이전판의 별도 동의 서버 공유를 구분했습니다.
- #16–18 blockedReasons는 실제 page 목록에 없습니다. 존재하지 않는 visible=false 속성을 만들지 않았습니다. #64–65 community는 visible=false와 실제 렌더 목록 부재를 함께 확인했습니다.
- #23/#44/#63 삭제 문구는 현재 내용/렌더 범위와 옛 문자열 부재 검사를 함께 남겼습니다.
- #46 비용은 첫 CTA 옆과 FAQ에 남고 저장 섹션은 로그인·시작 설정 조건으로 바뀌었습니다.
- #73 보조 버튼은 제외 상태입니다. 공개 도구는 앞 카드/푸터에 남고 도구 주소 독립화는 구현하지 않았습니다.

## 실제 라운지 화면

375×520 JPEG, 23,766bytes. SHA256: `234ae10e83bfe0668439d00ba5b6a6de8bd433bdf5f2a7e06405a27d93e6e246`. 이미지를 다시 열어 날짜·일정 미정과 체크리스트/예산 배정 0%, 기록 지출 0원을 확인했습니다. 개인 이름·상담·답변·입력 금액은 보이지 않습니다. 알림 숫자는 화면 상태입니다.

src·alt·375px 부모 폭·intrinsic 크기·입력 전 캡션·기록 수정 불가 고지를 현재 렌더와 연결했습니다. 두 AI 예시는 AI 생성/오류/비작동 고지를 유지합니다. 실제 운영 캡처 과정은 root의 별도 근거이며 이 작업에서 재촬영하지 않았습니다.

## 행별 대조

| 번호 | 엑셀 행 | 위치 | 상태 | 현재 노출 | 현재 E 근거 | I 판단 및 적용 내용 |
|---:|---:|---|---|---|---|---|
| 1 | 6 | 페이지 제목 | 제안 그대로 채택 | 메타데이터 | `apps/web/src/app/landing/page.tsx:26`, `apps/web/src/app/page.tsx:11` | 페이지와 루트 제목에 서비스 전체를 포괄하는 권장문을 적용했다. |
| 2 | 7 | 첫 화면 작은 문구 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:13`, `apps/web/src/components/landing/redesign/TransformationHero.tsx:23` | 아모라와 하나씩 준비해요라는 완성된 문장으로 명사형 광고 표현을 바꿨다. |
| 3 | 8 | 첫 화면 제목 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:15`, `apps/web/src/components/landing/redesign/TransformationHero.tsx:29–50`, `DESIGN.md:494` | 권장 질문을 제목으로 적용했다. 화면 줄바꿈과 디자인 문서도 같은 문구를 따른다. |
| 4 | 9 | 첫 화면 설명 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:17`, `apps/web/src/components/landing/redesign/TransformationHero.tsx:52`, `apps/web/src/components/landing/redesign/LandingFaqSection.tsx:21–22`, `apps/web/src/components/landing/redesign/LandingFaqSection.tsx:99–119` | 견적서·예산에 관해 아모라에게 질문하는 실제 도움을 설명하고 날짜가 필수라는 인상을 없앴다. 근거 없는 전문 플래너 비유는 채택하지 않았다. |
| 5 | 10 | 첫 화면 설명 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:17`, `apps/web/src/components/landing/redesign/landingContent.ts:18`, `apps/web/src/app/landing/page.tsx:28`, `apps/web/src/app/page.tsx:14`, `apps/web/src/components/landing/redesign/TransformationHero.tsx:52` | 문장 전체를 삭제하는 대신 확인하고 저장하면 반영된다고 명확히 고쳤다. 사실 검증과 저장 동의를 구분하며 검색·공유 설명에도 같은 기준을 적용했다. |
| 6 | 11 | 첫 화면 보조 버튼 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:22`, `apps/web/src/components/landing/redesign/TransformationHero.tsx:69` | 내 결혼 준비 기준 알아보기로 기능 목적을 드러냈다. 사람 데이터 검증 전 성향 검사로 오인할 표현은 채택하지 않았다. |
| 7 | 12 | 첫 화면 이용 안내 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:24`, `apps/web/src/components/landing/redesign/TransformationHero.tsx:63`, `apps/web/src/components/landing/redesign/LandingFaqSection.tsx:31–33`, `apps/web/src/components/landing/redesign/LandingFaqSection.tsx:99–119` | 로그인과 시작 설정을 마치면 아모라를 이용할 수 있다고 이용 주체와 조건을 명확히 설명한다. |
| 8 | 13 | 무료 안내 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:24`, `apps/web/src/components/landing/redesign/TransformationHero.tsx:63`, `apps/web/src/components/landing/redesign/landingContent.ts:204`, `apps/web/src/components/landing/redesign/LandingFaqSection.tsx:68`, `apps/web/src/components/landing/redesign/LandingFaqSection.tsx:99–119` | 현재 무료·향후 요금 미정은 첫 CTA의 바로 다음 안내와 FAQ에 남겼다. 저장 섹션에는 요금 대신 로그인·시작 설정 조건을 두었다. |
| 9 | 14 | 화면 예시 지표 | 의미 반영 | 실제 라운지 탭 | `apps/web/src/components/landing/redesign/landingContent.ts:62–67`, `apps/web/src/components/landing/redesign/AppPreviewCard.tsx:52–57` | 옛 결혼식 날짜/D-52 가상 지표를 실제 입력 전 라운지 캡처로 교체했다. 이미지 픽셀에서 D-day와 날짜가 미정인 것을 확인했고, src·alt·캡션과 실제 이미지 렌더를 연결했다. |
| 10 | 15 | 화면 예시 지표 | 의미 반영 | 실제 라운지 탭 | `apps/web/src/components/landing/redesign/landingContent.ts:62–67`, `apps/web/src/components/landing/redesign/AppPreviewCard.tsx:52–57` | 옛 체크 진행 가상 지표를 제거했다. 실제 이미지의 체크리스트 진행 0%를 픽셀에서 확인했으며 대상과 단위를 구체적으로 보여준다. |
| 11 | 16 | 화면 예시 지표 | 제안 그대로 채택 | 실제 라운지 탭 | `apps/web/src/components/landing/redesign/landingContent.ts:58`, `apps/web/src/components/landing/redesign/landingContent.ts:62–67`, `apps/web/src/components/landing/redesign/AppPreviewCard.tsx:52–57`, `apps/web/src/components/landing/redesign/AppPreviewCard.tsx:89` | 권장안의 실제 웨딩라운지 이미지 교체를 적용했다. 픽셀 및 src·375×520 크기·375px 부모 폭·대체 텍스트·입력 전 캡션을 대조했다. 운영 환경의 캡처 과정은 root의 별도 근거이며 본 감사자가 재촬영하지 않았다. |
| 12 | 17 | 화면 예시 지표 | 비노출 | 원래 지표 제거 | `apps/web/src/components/landing/redesign/landingContent.ts:26–67`, `apps/web/src/components/landing/redesign/AppPreviewCard.tsx:52–57`, `apps/web/src/app/landing/page.tsx:72–80` | 옛 준비 방식/함께 지표는 현재 preview 값과 실제 렌더에 없다. 세 번째 선택은 실제 입력 전 라운지 이미지이며 확인하지 않은 파트너 연결됨 상태를 표시하지 않는다. visible=false가 아닌 지표 교체로 비노출된 경우다. |
| 13 | 18 | 화면 예시 제목 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:27`, `apps/web/src/components/landing/redesign/AppPreviewCard.tsx:27` | 낯선 브리핑 대신 아모라와 이렇게 준비해요라는 직접적인 설명으로 바꿨다. |
| 14 | 19 | 화면 예시 안내 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:38`, `apps/web/src/components/landing/redesign/AppPreviewCard.tsx:70` | 장소 조건이 확 줄어든다는 과장 문구를 제거하고 업체에 물어볼 식대·보증 인원·포함 항목·별도 비용을 구체적으로 제시한다. |
| 15 | 20 | 화면 예시 주석 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:28`, `apps/web/src/components/landing/redesign/landingContent.ts:61`, `apps/web/src/components/landing/redesign/landingContent.ts:66`, `apps/web/src/components/landing/redesign/landingContent.ts:67`, `apps/web/src/components/landing/redesign/AppPreviewCard.tsx:30`, `apps/web/src/components/landing/redesign/AppPreviewCard.tsx:52–57`, `apps/web/src/components/landing/redesign/AppPreviewCard.tsx:89` | 중복된 샘플 설명을 줄이고 비작동 예시·AI 오류 가능성은 유지한다. 화면 미리보기라는 중립 표지 아래 AI 예시와 실제 라운지 캡처의 고지를 선택한 탭에 따라 따로 표시한다. |
| 16 | 21 | 고민 소개 제목 | 비노출 | 콘텐츠만 보관 | `apps/web/src/components/landing/redesign/landingContent.ts:74`, `apps/web/src/app/landing/page.tsx:72–80` | 공감 제목은 blockedReasons.title 데이터에 남아 있다. 실제 LandingPage main의 전체 컴포넌트 목록에는 해당 섹션이 없어 현재 비노출이다. 존재하지 않는 visible=false 속성을 근거로 삼지 않았다. |
| 17 | 22 | 질문 예시 | 비노출 | 콘텐츠만 보관 | `apps/web/src/components/landing/redesign/landingContent.ts:76`, `apps/web/src/app/landing/page.tsx:72–80` | 권장 질문은 blockedReasons.quotes[0]에 남아 있다. 실제 LandingPage main에서 해당 섹션을 렌더하지 않아 화면 반영과 데이터 수정을 구분한다. |
| 18 | 23 | 질문 예시 아래 | 비노출 | 콘텐츠만 보관 | `apps/web/src/components/landing/redesign/landingContent.ts:81`, `apps/web/src/components/landing/redesign/landingContent.ts:82`, `apps/web/src/app/landing/page.tsx:72–80` | 파트너에게 꺼내기 어려운 이야기와 실제 기능명 나만 상담으로 데이터 문구를 고쳤다. 질문 예시 고지와 상담 안내는 blockedReasons의 비노출 데이터에 남고 현재 페이지 목록에 그 섹션은 없다. |
| 19 | 24 | 상담 구분 제목 | 의미 반영 | 기존 제목 대체 | `apps/web/src/components/landing/redesign/landingContent.ts:88`, `apps/web/src/components/landing/redesign/AmoraNoteSection.tsx:37` | 혼자/같이 대칭을 반복하던 제목은 제거하고 견적에서 물어볼 질문으로 상담의 쓰임을 설명한다. |
| 20 | 25 | 상담 구분 설명 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:98–100`, `apps/web/src/components/landing/redesign/landingContent.ts:103–105`, `apps/web/src/components/landing/redesign/AmoraNoteSection.tsx:88–104` | 함께 볼 이야기와 개인 고민을 각 카드의 완성된 문장으로 설명하고 개인 상담명은 실제 제품 명칭에 맞췄다. |
| 21 | 26 | 상담 구분 설명 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:90`, `apps/web/src/components/landing/redesign/AmoraNoteSection.tsx:44` | 말한 상황과 저장된 예산·일정에 맞춰 다음 확인 내용과 할 일을 제안한다고 설명한다. |
| 22 | 27 | 아모라 예시 답변 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:116`, `apps/web/src/components/landing/redesign/AmoraNoteSection.tsx:67` | 일반적인 질문으로 끝나던 예시를 피팅비의 포함 여부·비용·결제 시점을 업체에 물어볼 문장으로 바꿨다. |
| 23 | 28 | 예시 답변 아래 | 제안 그대로 채택 | 기존 캡션 삭제 | `apps/web/src/components/landing/redesign/landingContent.ts:111–120`, `apps/web/src/components/landing/redesign/AmoraNoteSection.tsx:56–82` | 옛 추상 캡션이 현재 카피/대화 컴포넌트에 없는 것을 검사했다. 현재 대화 값·AI 생성 라벨·짧은 예시/비작동 고지가 실제 렌더되는 위치를 인용했다. |
| 24 | 29 | 예시 고지 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:114`, `apps/web/src/components/landing/redesign/landingContent.ts:120`, `apps/web/src/components/landing/redesign/landingContent.ts:294`, `apps/web/src/components/landing/redesign/AmoraNoteSection.tsx:64`, `apps/web/src/components/landing/redesign/AmoraNoteSection.tsx:82`, `apps/web/src/components/landing/redesign/BoundariesSection.tsx:53–70` | 긴 설명은 짧은 예시·비작동 문장으로 줄이고 AI 생성 라벨과 페이지 신뢰 섹션의 오류·직접 확인 고지는 유지했다. 예시 고지를 전부 삭제한 것으로 계산하지 않는다. |
| 25 | 30 | 함께 보는 대화 설명 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:99`, `apps/web/src/components/landing/redesign/AmoraNoteSection.tsx:88–104` | 예산·하객·일정처럼 함께 정할 내용을 같은 대화방에서 이야기할 수 있다고 자연스럽게 설명한다. |
| 26 | 31 | 개인 상담 설명 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:104`, `apps/web/src/components/landing/redesign/AmoraNoteSection.tsx:88–104` | 파트너에게 말하기 어려운 고민을 먼저 이야기하고 상담 내용은 파트너에게 표시되지 않는다는 권장문을 적용했다. |
| 27 | 32 | 개인 상담 고지 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:109`, `apps/web/src/components/landing/redesign/AmoraNoteSection.tsx:104`, `apps/web/src/components/landing/redesign/LandingFaqSection.tsx:55–58`, `apps/web/src/components/landing/redesign/LandingFaqSection.tsx:99–119` | 파트너 비노출과 서비스 처리·저장은 다른 범위이므로 짧은 처리·저장 문장을 유지했다. 완전 비밀로 오인하지 않게 하는 필요한 설명이다. |
| 28 | 33 | 상담 범위 안내 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:108`, `apps/web/src/components/landing/redesign/AmoraNoteSection.tsx:108` | 대화 화면에서 공유 범위를 확인할 수 있어요로 자리/항상 표현을 제거했다. |
| 29 | 34 | 커플 조율 제목 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:125`, `apps/web/src/components/landing/redesign/NoSideSection.tsx:27` | 사진과 식장이라는 비교 가능한 지출 고민을 사용하고 갈리다라는 갈등 표현을 제거했다. |
| 30 | 35 | 커플 예시 답변 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:146–147`, `apps/web/src/components/landing/redesign/NoSideSection.tsx:37–52` | 원하는 사진 구성과 식장 교통 조건을 적고 항목별 예산을 정하는 구체적 제안을 보여준다. |
| 31 | 36 | 커플 예시 고지 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:150`, `apps/web/src/components/landing/redesign/NoSideSection.tsx:57` | 없는 이름·금액을 언급하지 않고 예시 대화이며 실제 이용자의 대화가 아니라고 밝힌다. |
| 32 | 37 | 커플 조율 설명 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:127`, `apps/web/src/components/landing/redesign/NoSideSection.tsx:61` | 누가 맞는지 가리지 않는다는 판단 회피 문구를 제거했다. 두 사람의 우선순위를 듣고 검토 기준을 제안하는 도움으로 설명한다. |
| 33 | 38 | 웨딩코드 연결 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:128`, `apps/web/src/components/landing/redesign/landingContent.ts:226`, `apps/web/src/components/landing/redesign/landingContent.ts:228`, `apps/web/src/components/landing/redesign/NoSideSection.tsx:61`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 두 사람의 같은 답과 다른 답을 비교한다고 설명한다. 기본 새 판은 동의 후 내 답 링크를 보내고 상대가 자기 답을 마친 뒤 두 사람 결과 링크를 돌려주는 절차다. 서버 자동 연결로 설명하지 않는다. |
| 34 | 39 | 웨딩코드 버튼 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:129`, `apps/web/src/components/landing/redesign/NoSideSection.tsx:69` | 원하는 것부터 보기라는 추상적인 버튼을 둘의 생각 비교하기라는 실제 목적 중심 표현으로 바꿨다. 성향 검사로 소개하는 권장 표현은 채택하지 않았다. |
| 35 | 40 | 저장 설명 제목 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:155`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:42`, `DESIGN.md:505–507` | 저장할 내용을 확인한다는 문구를 제목에 넣어 정보 검증과 저장 승인의 혼동을 없앴다. |
| 36 | 41 | 저장 설명 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:156`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:45` | 저장 전에 내용과 위치를 보여주며 다르면 다시 말하거나 저장하지 않을 수 있다고 설명한다. 직접 편집 기능이 있다고 과장하지 않는다. |
| 37 | 42 | 일정 설명 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:178`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:48–56` | 현재 실제로 렌더되는 confirm.management[2] 일정 카드가 상담·촬영·예식 날짜와 준비 마감일을 등록하고 확인하라고 설명한다. 비노출 confirm.tools의 같은 문장을 화면 근거로 사용하지 않았다. |
| 38 | 43 | 저장 예시 제목 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:191`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:67` | 저장할 내용을 확인해 주세요라는 권장문을 예시 제목에 적용했다. 이 랜딩에서 실제 저장을 실행한다는 주장은 하지 않으며 예시 고지가 남는다. |
| 39 | 44 | 저장 예시 라벨 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:194`, `apps/web/src/components/landing/redesign/landingContent.ts:193`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:72` | 변경 제안·저장 전 값과 실제 결합 렌더를 인용했다. 두 사람이 이미 합의했다는 표현을 쓰지 않는다. |
| 40 | 45 | 저장 위치 라벨 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:198`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:77–79` | 목적지를 저장 위치로 바꿨다. |
| 41 | 46 | 저장 예시 확인 버튼 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:200`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:105`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:103–108` | 확인하고 저장이라는 권장문을 적용했다. 이 랜딩 표시는 aria-hidden 장식 span이며 실제 저장 버튼으로 작동한다는 증거가 아니다. |
| 42 | 47 | 저장 예시 취소 버튼 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:201`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:108`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:103–108` | 저장하지 않기로 간결하게 표시한다. 나중에 저장이라는 권장안은 미래 저장 예약으로 오인할 수 있어 채택하지 않았다. 실제 작동 버튼이 아닌 장식 span이다. |
| 43 | 48 | 저장 설명 강조 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:192`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:113` | 저장을 확인하기 전에는 기록이 바뀌지 않아요로 변경 기능이 없다는 오해를 없앴다. |
| 44 | 49 | 저장 설명 | 제안 그대로 채택 | 기존 문장 삭제 | `apps/web/src/components/landing/redesign/landingContent.ts:153–206`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:42–119` | 옛 한 번에 한 가지 변경 문구가 현재 confirm 카피/컴포넌트에 없는 것을 검사했다. 저장 전 내용·위치 확인과 확인 전 기록 변경 없음 안내는 유지된다. |
| 45 | 50 | 공동 변경 고지 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:187–188`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:118`, `apps/web/src/components/landing/redesign/LandingFaqSection.tsx:57–58`, `apps/web/src/components/landing/redesign/LandingFaqSection.tsx:99–119` | 두 사람 중 한 명이 저장하면 공동 기록이 바뀐다는 주체를 명확히 설명한다. 실제 알림 동작과 플랫폼 가용성은 기능 검증의 범위다. |
| 46 | 51 | 비용 고지 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:24`, `apps/web/src/components/landing/redesign/TransformationHero.tsx:63`, `apps/web/src/components/landing/redesign/landingContent.ts:204`, `apps/web/src/components/landing/redesign/ConfirmSection.tsx:119`, `apps/web/src/components/landing/redesign/LandingFaqSection.tsx:68`, `apps/web/src/components/landing/redesign/LandingFaqSection.tsx:99–119`, `DESIGN.md:511–513` | 첫 CTA 안내와 FAQ에는 현재 무료·향후 요금 미정을 유지했다. 현재 confirm.note는 로그인·시작 설정 뒤 기록할 수 있다는 조건이다. 비용 문장 반복을 줄인 것이며 고지를 삭제한 것이 아니다. |
| 47 | 52 | 무료 도구 작은 제목 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:210`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:58` | 가입 없이 먼저 써 보세요를 적용했다. |
| 48 | 53 | 무료 도구 제목 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:211`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:62` | 업체 질문 만들기와 두 사람 답 비교라는 실제 행동을 완성된 문장으로 설명한다. 가입 전 반복과 모든 고민 해결 과장을 제거했다. |
| 49 | 54 | 견적 도구 제목 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:215`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 견적에서 빠진 항목이라고 단정하지 않고 업체에 무엇을 물어볼지 확인하는 도구로 소개한다. |
| 50 | 55 | 견적 도구 설명 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:217–218`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 포함 여부와 이용 계획을 고르면 업체 질문을 만들고 복사할 수 있다고 기능을 구체적으로 설명한다. |
| 51 | 56 | 견적 도구 고지 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:220`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 가격의 적정 여부는 평가하지 않아요라는 권장문을 적용했다. |
| 52 | 57 | 웨딩코드 제목 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:225`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 실제 title 필드의 웨딩코드로 내 준비 기준을 살펴봐요를 인용했다. 결혼식 자체를 골라 주거나 검증된 성향 진단을 약속하지 않는다. |
| 53 | 58 | 웨딩코드 설명 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:226`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84`, `apps/web/src/app/wedding-code/releaseEntry.ts:14`, `apps/web/src/app/wedding-code/WeddingCodeReleaseClient.tsx:51–52`, `apps/web/src/components/weddingCodeLikert/WeddingCodeLikertClient.tsx:295–302`, `apps/web/src/components/weddingCodeLikert/WeddingCodeLikertClient.tsx:317–324` | 지출·준비·가족·도움 네 영역과 내 답 링크 전달→파트너 응답→두 사람 결과 링크 직접 반환의 순서를 설명한다. 기본 공개 Likert 클라이언트도 공유 동의 후 직접 링크를 만들며 자동 도착은 없다고 안내한다. 검증된 성향 진단으로 소개하지 않는다. |
| 54 | 59 | 웨딩코드 고지 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:228`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 실제 note는 심리 진단이나 궁합 검사가 아니라고 설명한다. 내부 계산·점수의 존재 자체를 부정하는 권장문은 채택하지 않았다. |
| 55 | 60 | 웨딩코드 고지 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:228`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84`, `DESIGN.md:507–510`, `apps/web/src/app/wedding-code/releaseEntry.ts:14`, `apps/web/src/app/wedding-code/WeddingCodeReleaseClient.tsx:51–52`, `apps/web/src/components/weddingCodeLikert/WeddingCodeLikertClient.tsx:295–302`, `apps/web/src/components/weddingCodeLikert/WeddingCodeLikertClient.tsx:317–324`, `apps/web/src/app/wedding-code/WeddingCodeV31Connection.tsx:17–26` | 브라우저 답 저장 조건과 동의한 답 전체 직접 링크·전달 후 회수 불가를 유지한다. 지금 시작하는 기본 새 판은 답을 서버에 보내지 않는 직접 링크 방식이고, 이전 판의 서버 공유는 별도 동의 후 보관하므로 그 화면의 보관·삭제 안내를 확인하도록 범위를 분리했다. 소스·고지 정합성을 확인했으며 실제 네트워크/DB 저장 검증은 아니다. |
| 56 | 61 | 가격 도구 제목 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:233`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 거친 취소 비용 표현과 메뉴명을 장소처럼 연결하는 문구를 없애고 업체 가격·취소·환불 조건을 보여준다고 설명한다. |
| 57 | 62 | 가격 도구 설명 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:235`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 취소 위약금이라는 정확한 용어를 쓴다. |
| 58 | 63 | 가격 도구 설명 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:236`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 가격을 공시한 업체만 제공한다고 자연스럽게 설명한다. |
| 59 | 64 | 가격 도구 고지 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:235–238`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 가격 카드 body의 원문 제공과 note의 공시 기준일·적정 가격 평가 없음 값을 각각 인용했다. 중복 원문 설명을 줄였으며 원문 제공 자체가 삭제된 것은 아니다. |
| 60 | 65 | 예절 가이드 제목 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:243`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 모든 애매한 고민을 해결한다는 과장과 편수 나열을 없애고 상견례·예단 준비 질문으로 제목을 바꿨다. |
| 61 | 66 | 예절 가이드 설명 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:244`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 두 가족이 함께 준비하는 일의 관행으로 설명하며 가족을 갈등처럼 묘사하는 얽히다를 제거했다. |
| 62 | 67 | 예절 가이드 고지 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:245`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 지역과 가족별 차이, 두 가족의 생각 확인을 해요체로 자연스럽게 안내한다. |
| 63 | 68 | 무료 도구 하단 | 제안 그대로 채택 | 기존 문장 삭제 | `apps/web/src/components/landing/redesign/landingContent.ts:209–251`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–90` | 공개 도구 아래의 옛 커뮤니티 약속이 현재 카피/섹션에 없는 것을 검사했다. 현재 카드 루프 이후의 실제 섹션 끝까지 확인했다. |
| 64 | 69 | 커뮤니티 제목 | 비노출 | 콘텐츠만 보관 | `apps/web/src/components/landing/redesign/landingContent.ts:251–253`, `apps/web/src/app/landing/page.tsx:72–80` | community.title 데이터는 남아 있지만 community.visible=false이고 실제 LandingPage 전체 목록에 CommunitySection이 없어 비노출이다. 데이터까지 삭제한 것으로 보고하지 않는다. |
| 65 | 70 | 커뮤니티 설명 | 비노출 | 콘텐츠만 보관 | `apps/web/src/components/landing/redesign/landingContent.ts:251–256`, `apps/web/src/app/landing/page.tsx:72–80` | community.body의 동기방 설명은 남아 있지만 community.visible=false이고 실제 LandingPage main에 그 섹션이 없다. 현재 랜딩에서 공개 기능으로 소개하지 않는다. |
| 66 | 71 | 신뢰 섹션 제목 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:282`, `apps/web/src/components/landing/redesign/BoundariesSection.tsx:46` | 아모라는 준비를 돕고 결정은 두 사람이 한다는 권장문을 해요체로 적용했다. |
| 67 | 72 | 신뢰 섹션 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:286`, `apps/web/src/components/landing/redesign/landingContent.ts:301`, `apps/web/src/components/landing/redesign/BoundariesSection.tsx:53–70`, `apps/web/src/components/landing/redesign/BoundariesSection.tsx:76`, `DESIGN.md:506–507` | 원문 제공과 광고 상품 미운영은 서로 다른 필드다. items.note와 별도 advertisingNote 문단의 실제 렌더를 함께 인용해 역할 분리를 확인했다. |
| 68 | 73 | 신뢰 섹션 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:289`, `apps/web/src/components/landing/redesign/BoundariesSection.tsx:53–70` | 계약 조건을 해석하거나 어느 쪽이 유리한지 판단하지 않아요로 범위를 구체적으로 설명한다. |
| 69 | 74 | 신뢰 섹션 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:290`, `apps/web/src/components/landing/redesign/BoundariesSection.tsx:53–70` | 업체 계약 신청·예약·결제를 중개하지 않아요로 문체를 통일했다. |
| 70 | 75 | 신뢰 섹션 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:293`, `apps/web/src/components/landing/redesign/landingContent.ts:302`, `apps/web/src/components/landing/redesign/BoundariesSection.tsx:53–70`, `apps/web/src/components/landing/redesign/BoundariesSection.tsx:80–83` | AI가 작성한다는 실제 카피와 items.title/note 렌더, AI 정책 링크의 실제 href/label 렌더를 인용했다. 모델 정보는 정책에서 확인하는 방향이며 실제 실행 모델명·계약 최신성을 증명하지 않는다. |
| 71 | 76 | 신뢰 섹션 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:297–298`, `apps/web/src/components/landing/redesign/BoundariesSection.tsx:53–70` | 법률·의료·금융 범위를 먼저 밝혀 전문 판단이 필요한 질문에는 관련 기관을 안내한다고 설명한다. |
| 72 | 77 | 마지막 제목 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:307`, `apps/web/src/components/landing/redesign/ClosingAction.tsx:33` | 지금 가장 궁금한 것부터 아모라에게 물어보세요라는 직접 행동 문구로 반복적인 정리와 대칭 슬로건을 없앴다. |
| 73 | 78 | 마지막 버튼 | 현재 방향으로 제외 | 비노출 | `apps/web/src/components/landing/redesign/ClosingAction.tsx:48–54`, `apps/web/src/components/landing/redesign/landingContent.ts:305–317`, `DESIGN.md:474–476`, `apps/web/src/components/landing/redesign/landingContent.ts:321–326`, `apps/web/src/components/landing/redesign/LandingFooter.tsx:43–44`, `apps/web/src/components/landing/redesign/AvailableNowSection.tsx:66–84` | 현재 ClosingAction은 단일 primary 아모라 CTA만 렌더한다. DESIGN의 단일 주요 행동 방향에 따른 제외이며 권장 보조 버튼의 그대로 적용으로 합산하지 않는다. 공개 도구는 앞 카드와 실제 푸터 링크에 남아 있다. 도구 주소 독립화는 구현하지 않았다. |
| 74 | 79 | 마지막 이용 안내 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:314`, `apps/web/src/components/landing/redesign/ClosingAction.tsx:60` | 무료 도구의 무가입 이용과 아모라·예산·할 일·일정의 가입 필요를 명확히 나눠 안내한다. |
| 75 | 80 | 푸터 서비스 설명 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:318`, `apps/web/src/components/landing/redesign/LandingFooter.tsx:33` | 아모라 상담부터 예산·할 일·일정 관리까지라는 권장 설명을 적용했다. |
| 76 | 81 | 푸터 메뉴 제목 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:321`, `apps/web/src/components/landing/redesign/landingContent.ts:330`, `apps/web/src/components/landing/redesign/LandingFooter.tsx:23`, `apps/web/src/components/landing/redesign/LandingFooter.tsx:40` | 가입 없이 이용/가입 후 이용으로 메뉴 제목 기준과 문체를 통일했다. |
| 77 | 82 | 푸터 출처 | 의미 반영 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:350`, `apps/web/src/components/landing/redesign/LandingFooter.tsx:60` | 옛 내부 화면 집계 확인일이 현재 카피/푸터에서 없어졌고 footer.notice에 가격 출처와 2025년 11월 공시 기준일이 있다. 원문 데이터 최신성을 이 문서로 검증하지 않았다. |
| 78 | 83 | 푸터 가격 안내 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:351`, `apps/web/src/components/landing/redesign/LandingFooter.tsx:60` | 지역별 등록 업체 수로 수의 대상을 명확히 밝혔다. |
| 79 | 84 | 푸터 규정 안내 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:352`, `apps/web/src/components/landing/redesign/LandingFooter.tsx:60` | 업체가 공개한 취소·환불 규정은 원문으로 제공한다고 주체와 제공 방식을 설명한다. |
| 80 | 85 | 푸터 가격 안내 | 제안 그대로 채택 | 노출 | `apps/web/src/components/landing/redesign/landingContent.ts:352`, `apps/web/src/components/landing/redesign/LandingFooter.tsx:60` | 예약·결제·계약은 업체와 직접 진행해 주세요로 자연스럽게 안내한다. |

## 검증 범위

이 문서의 E는 소스·원본 셀·이미지·문자열 부재 검사입니다. 실제 브라우저·기능 테스트·가격 최신성·알림 동작·실행 모델·CI/Preview/운영 결과는 별도 증거가 필요합니다. 모든 요청 검토와 모든 권장문 그대로 적용을 구분합니다.

정확한 인용은 final-row-audit.json의 evidence.sourceText/semanticAnchor에, raw SHA256/줄은 source-snapshots-final.json에 보존했습니다.

## 원본 수정표 인용 — 변경 없이 보존

다음 original은 XLSX B~E열의 문자열·줄바꿈·빈 셀(null)을 그대로 보존합니다. 현재 카피나 새 권장문으로 바꾸지 않았습니다. 번호는 A열이며 xlsxRow는 실제 시트 행입니다.

<details>
<summary>80개 원본 위치·문구·지적·권장안</summary>

```json
[
  {
    "number": 1,
    "xlsxRow": 6,
    "original": {
      "location": "페이지 제목",
      "currentCopy": "웨딩한방 | 결혼 준비 동반자, 아모라",
      "issue": "서비스 전체를 포괄하지 않음",
      "recommendedCopy": "웨딩한방 | 둘이 함께하는 결혼 준비"
    }
  },
  {
    "number": 2,
    "xlsxRow": 7,
    "original": {
      "location": "첫 화면 작은 문구",
      "currentCopy": "둘이 하는 결혼 준비, 아모라와",
      "issue": "조사와 서술어를 생략한 광고식 표현",
      "recommendedCopy": "둘이 준비하는 결혼, 아모라와 함께"
    }
  },
  {
    "number": 3,
    "xlsxRow": 8,
    "original": {
      "location": "첫 화면 제목",
      "currentCopy": "결혼식까지 몇 달 남았는데 지금 뭐부터 하면 될까요?",
      "issue": "자연스러운 질문이지만 긴 느낌",
      "recommendedCopy": "결혼 준비, 지금 뭐부터 해야 할까요?"
    }
  },
  {
    "number": 4,
    "xlsxRow": 9,
    "original": {
      "location": "첫 화면 설명",
      "currentCopy": "날짜를 알려 주면 결혼 준비 동반자 AI 아모라가 예산부터 준비 순서까지 같이 살펴봐요.",
      "issue": "AI 수식어가 길고 ‘같이 살펴봐요’는 제공하는 도움을 모호하게 만듦. 날짜가 필수처럼 읽힘",
      "recommendedCopy": "막막한 결혼준비... 친구처럼 고민을 털어놓고, 전문 플래너처럼 방향을 제안해줄 동반자 아모라와 함께하세요.\n아모라에게 상황을 말하면, 우선순위와 할 일을 알려줘요."
    }
  },
  {
    "number": 5,
    "xlsxRow": 10,
    "original": {
      "location": "첫 화면 설명",
      "currentCopy": "직접 확인한 내용은 예산·할 일·일정에 남아요.",
      "issue": "사실을 확인한다는 뜻인지 저장 버튼을 누른다는 뜻인지 불명확",
      "recommendedCopy": "삭제"
    }
  },
  {
    "number": 6,
    "xlsxRow": 11,
    "original": {
      "location": "첫 화면 보조 버튼",
      "currentCopy": "웨딩코드 해보기",
      "issue": "무엇을 하는 기능인지 첫 방문자는 모름",
      "recommendedCopy": "내 결혼 준비 성향 알아보기"
    }
  },
  {
    "number": 7,
    "xlsxRow": 12,
    "original": {
      "location": "첫 화면 이용 안내",
      "currentCopy": "아모라는 계정을 만들고 웹에서 시작해요.",
      "issue": "AI가 계정을 만든다는 문장처럼 읽힐 수 있음. ‘웹에서 시작’도 어색",
      "recommendedCopy": "아모라는 가입 후 이용할 수 있어요. 웨딩코드는 가입 없이 해 볼 수 있어요."
    }
  },
  {
    "number": 8,
    "xlsxRow": 13,
    "original": {
      "location": "무료 안내",
      "currentCopy": "지금은 결제를 요청하지 않아요.",
      "issue": "비용이 없는지, 청구만 미뤄지는지 불명확. 반복되면 오히려 불안감을 줌",
      "recommendedCopy": "현재 무료로 이용할 수 있어요."
    }
  },
  {
    "number": 9,
    "xlsxRow": 14,
    "original": {
      "location": "화면 예시 지표",
      "currentCopy": "결혼식 날짜 / D-52",
      "issue": "값은 날짜가 아니라 남은 일수",
      "recommendedCopy": "결혼식까지 / D-52"
    }
  },
  {
    "number": 10,
    "xlsxRow": 15,
    "original": {
      "location": "화면 예시 지표",
      "currentCopy": "체크 진행",
      "issue": "무엇을 체크한 진행인지 불명확",
      "recommendedCopy": "준비 진행률"
    }
  },
  {
    "number": 11,
    "xlsxRow": 16,
    "original": {
      "location": "화면 예시 지표",
      "currentCopy": "정한 것 / 9건",
      "issue": null,
      "recommendedCopy": "결정 기록 / 9건 --> 실제 웨딩라운지 화면 이미지로 교체"
    }
  },
  {
    "number": 12,
    "xlsxRow": 17,
    "original": {
      "location": "화면 예시 지표",
      "currentCopy": "준비 방식 / 함께",
      "issue": "‘준비 방식’은 성향을 뜻할 수도 있음",
      "recommendedCopy": "파트너 연결 / 연결됨 — 실제 예시가 연결 상태를 보여주는 경우"
    }
  },
  {
    "number": 13,
    "xlsxRow": 18,
    "original": {
      "location": "화면 예시 제목",
      "currentCopy": "아모라 브리핑",
      "issue": "기능이 낯선 사용자에게 군더더기 영어",
      "recommendedCopy": "오늘의 준비 안내"
    }
  },
  {
    "number": 14,
    "xlsxRow": 19,
    "original": {
      "location": "화면 예시 안내",
      "currentCopy": "예산 상한부터 잡으면 장소 조건이 확 줄어요",
      "issue": "장소 ‘조건’이 줄어드는 게 아니라 후보가 좁혀짐. ‘확’은 과장",
      "recommendedCopy": "예산을 먼저 정하면 식장 후보를 좁히기 쉬워요."
    }
  },
  {
    "number": 15,
    "xlsxRow": 20,
    "original": {
      "location": "화면 예시 주석",
      "currentCopy": "기능 예시 · 숫자와 문장은 화면을 보여주기 위한 샘플이고 실제 이용 현황이 아니에요.",
      "issue": "기능 예시·화면·샘플이 같은 뜻을 반복",
      "recommendedCopy": "이해를 돕기 위한 예시 화면입니다."
    }
  },
  {
    "number": 16,
    "xlsxRow": 21,
    "original": {
      "location": "고민 소개 제목",
      "currentCopy": "처음 해 보는 일이라 모르는 게 자꾸 생겨요.",
      "issue": "자연스럽고 사용자 공감에 맞음",
      "recommendedCopy": "유지"
    }
  },
  {
    "number": 17,
    "xlsxRow": 22,
    "original": {
      "location": "질문 예시",
      "currentCopy": "결혼하자는 얘기는 됐는데, 그다음엔 뭘 해야 해?",
      "issue": "조금 어색하나 실사용자 대화로는 자연스러움",
      "recommendedCopy": "결혼하기로 했는데, 이제 뭐부터 해야 해?"
    }
  },
  {
    "number": 18,
    "xlsxRow": 23,
    "original": {
      "location": "질문 예시 아래",
      "currentCopy": "질문 예시예요. 민망해서 못 꺼낸 건 ‘나만 보는 상담’에서 먼저 물어봐도 돼요. 정한 게 없으면 지금 상황부터 얘기해 봐요.",
      "issue": "주석과 설득 문장이 섞임. 고민을 ‘민망한 것’으로 좁힘. 권유가 반복",
      "recommendedCopy": "파트너에게 아직 꺼내기 어려운 이야기는 ‘나만 보는 상담’에서 먼저 이야기할 수 있어요."
    }
  },
  {
    "number": 19,
    "xlsxRow": 24,
    "original": {
      "location": "상담 구분 제목",
      "currentCopy": "혼자 생각할 건 혼자 하고, 같이 정할 건 같이 해요.",
      "issue": "대칭을 위해 같은 단어를 반복해 의미가 자명하고, ‘혼자 생각’이 상담 가치와 연결되지 않음",
      "recommendedCopy": "혼자 먼저 고민하고, 함께 결정할 수 있어요."
    }
  },
  {
    "number": 20,
    "xlsxRow": 25,
    "original": {
      "location": "상담 구분 설명",
      "currentCopy": "같이 정할 얘기는 ‘함께 보는 대화’에, 상대한테 꺼내기 전인 얘기는 ‘나만 보는 상담’에 말해 보세요.",
      "issue": "‘꺼내기 전인 얘기’가 부자연스러움. 한 문장에 기능명이 반복됨",
      "recommendedCopy": "둘이 함께 볼 이야기는 ‘함께 보는 대화’에서 나누세요. 파트너에게 아직 말하지 못한 고민은 ‘나만 보는 상담’에서 이야기할 수 있어요."
    }
  },
  {
    "number": 21,
    "xlsxRow": 26,
    "original": {
      "location": "상담 구분 설명",
      "currentCopy": "아모라가 다음에 살펴볼 것부터 짚어 줘요.",
      "issue": "‘다음에’와 ‘부터’ 관계가 흐리고, 도움 내용도 추상적",
      "recommendedCopy": "아모라가 지금 상황에 맞춰 먼저 확인할 것과 다음에 할 일을 알려줘요."
    }
  },
  {
    "number": 22,
    "xlsxRow": 27,
    "original": {
      "location": "아모라 예시 답변",
      "currentCopy": "식장을 알아보기 전에 예산 범위와 예상 하객 수를 정리하면 비교할 기준이 생겨요. 두 가지 중 정해둔 게 있나요?",
      "issue": "일반적인 챗봇 답변처럼 질문으로 끝남. 문구만 고칠 경우 기능 시연을 과장하지 않도록 주의",
      "recommendedCopy": "먼저 쓸 수 있는 예산과 예상 하객 수를 대략 정해 볼까요? 이 두 가지를 알면 식장을 비교하기 쉬워요. 어느 쪽부터 이야기할까요?"
    }
  },
  {
    "number": 23,
    "xlsxRow": 28,
    "original": {
      "location": "예시 답변 아래",
      "currentCopy": "말씀한 준비 시기를 바탕으로, 먼저 정리할 조건을 함께 살펴봐요.",
      "issue": "직전 답변과 같은 의미를 추상적으로 다시 설명",
      "recommendedCopy": "삭제"
    }
  },
  {
    "number": 24,
    "xlsxRow": 29,
    "original": {
      "location": "예시 고지",
      "currentCopy": "AI 생성 답변 · 기능 예시예요. 날짜와 답변은 기능을 보여주기 위한 샘플이고, 이 화면에서는 실제로 저장되지 않아요. AI는 틀리거나 놓칠 수 있어요 — 계약 금액·취소 조건·중요 날짜는 원문과 업체 안내를 다시 확인해 주세요.",
      "issue": "예시 설명·실제 저장 여부·AI 주의사항이 한꺼번에 들어가 지나치게 김",
      "recommendedCopy": "삭제"
    }
  },
  {
    "number": 25,
    "xlsxRow": 30,
    "original": {
      "location": "함께 보는 대화 설명",
      "currentCopy": "예산, 하객, 일정. 같이 정해야 하는 건 둘 다 볼 수 있어요.",
      "issue": "문장 조각을 의도적으로 연결한 카피가 다소 인위적",
      "recommendedCopy": "예산·하객·일정처럼 함께 정할 내용을 같은 대화방에서 얘기할 수 있어요."
    }
  },
  {
    "number": 26,
    "xlsxRow": 31,
    "original": {
      "location": "개인 상담 설명",
      "currentCopy": "말 꺼내기 전에 혼자 정리하는 자리. 상대 화면에는 안 보여요.",
      "issue": "‘자리’는 기능을 설명하지 않는 비유. 짧은 문장 조각이 반복됨",
      "recommendedCopy": "파트너에게 말하기 어려운 고민을 먼저 이야기할 수 있어요. 상담 내용은 파트너에게 표시되지 않아요."
    }
  },
  {
    "number": 27,
    "xlsxRow": 32,
    "original": {
      "location": "개인 상담 고지",
      "currentCopy": "개인 상담의 대화 내용은 서비스에서 처리·저장될 수 있어요. 연결된 배우자 화면에는 표시하지 않아요.",
      "issue": "이전 설명과 중복됨",
      "recommendedCopy": "삭제"
    }
  },
  {
    "number": 28,
    "xlsxRow": 33,
    "original": {
      "location": "상담 범위 안내",
      "currentCopy": "지금 어느 자리에 쓰고 있는지 화면이 항상 알려줘요.",
      "issue": "‘자리에 쓰다’가 어색. ‘항상’은 동작 확인 없이 강하게 보장하는 표현",
      "recommendedCopy": "대화 화면에서 공유 범위를 확인할 수 있어요."
    }
  },
  {
    "number": 29,
    "xlsxRow": 34,
    "original": {
      "location": "커플 조율 제목",
      "currentCopy": "돈 쓸 곳이 서로 다르면, 어디서 갈리는지 같이 봐요.",
      "issue": "‘곳/어디’ 반복. ‘갈리다’는 차이를 갈등처럼 들리게 함\n신혼집과 사진 비교는 너무 급이 차이남",
      "recommendedCopy": "사진도 결혼식장도 중요할 때, 예산을 어떻게 나눌까요?"
    }
  },
  {
    "number": 30,
    "xlsxRow": 35,
    "original": {
      "location": "커플 예시 답변",
      "currentCopy": "사진에 쓰고 싶은 예산과 신혼집에 남겨둘 금액을 함께 살펴볼게요. 촬영 범위·앨범·본식 영상을 나눠 비교해보면 조정할 항목을 찾을 수 있어요.",
      "issue": "‘함께 살펴볼게요/비교해보면/찾을 수 있어요’라는 모호한 도움의 연쇄",
      "recommendedCopy": "식장에 사용할 금액부터 두 분이 정해 보세요. 그다음 사진에 쓸 수 있는 예산 안에서 촬영 범위·앨범·본식 영상을 비교할 수 있어요."
    }
  },
  {
    "number": 31,
    "xlsxRow": 36,
    "original": {
      "location": "커플 예시 고지",
      "currentCopy": "이름과 금액은 기능을 보여주기 위한 샘플이고 실제 이용 현황이 아니에요.",
      "issue": "해당 예시에는 이름과 금액이 없음. 다른 섹션 문구를 복사한 흔적",
      "recommendedCopy": "이해를 돕기 위한 예시 대화입니다."
    }
  },
  {
    "number": 32,
    "xlsxRow": 37,
    "original": {
      "location": "커플 조율 설명",
      "currentCopy": "누가 맞는지는 가리지 않아요.",
      "issue": "판단을 회피한다는 인상을 줌. 부당한 요구도 무조건 중립으로 다룬다는 의미가 될 수 있음",
      "recommendedCopy": "두 사람이 중요하게 생각하는 것을 듣고, 함께 검토할 방법을 제안해요."
    }
  },
  {
    "number": 33,
    "xlsxRow": 38,
    "original": {
      "location": "웨딩코드 연결",
      "currentCopy": "둘의 답을 나란히 놓고, 먼저 의논할 것부터 볼 수 있어요.",
      "issue": "무엇을 보여주는지 설명이 모호",
      "recommendedCopy": "두 사람의 답변을 비교해, 생각이 같은 부분과 다른 부분을 확인할 수 있어요."
    }
  },
  {
    "number": 34,
    "xlsxRow": 39,
    "original": {
      "location": "웨딩코드 버튼",
      "currentCopy": "웨딩코드로 내가 원하는 것부터 보기",
      "issue": "길고 추상적",
      "recommendedCopy": "내 결혼 준비 성향 알아보기"
    }
  },
  {
    "number": 35,
    "xlsxRow": 40,
    "original": {
      "location": "저장 설명 제목",
      "currentCopy": "확인한 것만 예산·할 일·일정에 남아요.",
      "issue": "‘확인’이 정보 검증인지 저장 동의인지 모호",
      "recommendedCopy": "저장할 내용을 확인한 뒤 반영해요."
    }
  },
  {
    "number": 36,
    "xlsxRow": 41,
    "original": {
      "location": "저장 설명",
      "currentCopy": "아모라와 정리한 내용은 어디에 남길지 먼저 보여 줘요. 고치거나 나중에 정해도 돼요.",
      "issue": "주어·목적어 호응이 어색하고 저장 여부를 ‘나중에 정함’으로 돌려 말함",
      "recommendedCopy": "저장 전에 변경할 내용과 저장 위치를 보여줘요. 내용을 수정하거나 저장을 건너뛸 수 있어요."
    }
  },
  {
    "number": 37,
    "xlsxRow": 42,
    "original": {
      "location": "일정 설명",
      "currentCopy": "정한 날짜와 놓치면 안 되는 시기",
      "issue": "‘시기’는 일정 화면에 저장하는 대상이 무엇인지 불명확",
      "recommendedCopy": "상담·촬영·예식 날짜와 준비 마감일"
    }
  },
  {
    "number": 38,
    "xlsxRow": 43,
    "original": {
      "location": "저장 예시 제목",
      "currentCopy": "아모라가 이렇게 이해했어요",
      "issue": "이해 확인과 실제 저장 실행을 혼동시킬 수 있음",
      "recommendedCopy": "저장할 내용을 확인해 주세요"
    }
  },
  {
    "number": 39,
    "xlsxRow": 44,
    "original": {
      "location": "저장 예시 라벨",
      "currentCopy": "둘이 말한 것 · 아직 반영 전",
      "issue": "두 사람이 합의하지 않았는데 ‘둘이 말한 것’으로 표현",
      "recommendedCopy": "변경 제안 · 저장 전"
    }
  },
  {
    "number": 40,
    "xlsxRow": 45,
    "original": {
      "location": "저장 위치 라벨",
      "currentCopy": "목적지",
      "issue": "이동/물류 용어처럼 들림",
      "recommendedCopy": "저장 위치"
    }
  },
  {
    "number": 41,
    "xlsxRow": 46,
    "original": {
      "location": "저장 예시 확인 버튼",
      "currentCopy": "맞아요",
      "issue": "해석에 동의하는지 저장을 실행하는지 불명확",
      "recommendedCopy": "확인하고 저장"
    }
  },
  {
    "number": 42,
    "xlsxRow": 47,
    "original": {
      "location": "저장 예시 취소 버튼",
      "currentCopy": "지금은 저장 안 함",
      "issue": "이 버튼만 사무적인 문체",
      "recommendedCopy": "나중에 저장"
    }
  },
  {
    "number": 43,
    "xlsxRow": 48,
    "original": {
      "location": "저장 설명 강조",
      "currentCopy": "아모라가 바꾸지 않아요. 확인한 것만 남아요.",
      "issue": "아래 실제 변경 반영 설명과 충돌. 아모라가 변경하는 기능이 없다는 뜻처럼 읽힘",
      "recommendedCopy": "저장을 확인하기 전에는 기록이 바뀌지 않아요."
    }
  },
  {
    "number": 44,
    "xlsxRow": 49,
    "original": {
      "location": "저장 설명",
      "currentCopy": "예산/할 일/일정 중 한 번에 한 가지 변경을 제안하고, 눌러서 확인한 것만 준비 기록에 반영해요.",
      "issue": "삭제",
      "recommendedCopy": "삭제"
    }
  },
  {
    "number": 45,
    "xlsxRow": 50,
    "original": {
      "location": "공동 변경 고지",
      "currentCopy": "파트너를 연결하면 한 분이 확인했을 때 바로 반영되고…",
      "issue": "저장 주체가 모호. ‘둘이 정한 것’과는 별개로 한 명이 바꿀 수 있음을 정확히 보여야 함",
      "recommendedCopy": "파트너와 연결한 뒤에는 두 사람 중 한 명이 저장하면 공동 기록에 반영돼요. 파트너에게도 변경 알림이 가요."
    }
  },
  {
    "number": 46,
    "xlsxRow": 51,
    "original": {
      "location": "비용 고지",
      "currentCopy": "향후 이용 비용은 아직 정해지지 않았고, 계정을 만들어도 지금은 결제를 요청하지 않아요.",
      "issue": "장황하고 ‘이용 비용’보다 ‘요금’이 자연스러움",
      "recommendedCopy": "현재 무료로 이용할 수 있어요."
    }
  },
  {
    "number": 47,
    "xlsxRow": 52,
    "original": {
      "location": "무료 도구 작은 제목",
      "currentCopy": "스드메 견적서 받았어요? 가입 전에 그냥 써보세요",
      "issue": "‘그냥’이 도구의 가치를 낮춤. 네 도구 전체를 소개하는 제목으로는 범위가 좁음",
      "recommendedCopy": "가입 없이 먼저 써 보세요"
    }
  },
  {
    "number": 48,
    "xlsxRow": 53,
    "original": {
      "location": "무료 도구 제목",
      "currentCopy": "가입 전에, 제일 답답한 것부터 풀어봐요.",
      "issue": "바로 위 제목과 가입 전 안내 반복. 모든 고민 해결을 과장할 수 있음",
      "recommendedCopy": "견적 확인부터 준비 성향까지, 한번에 확인해 보세요."
    }
  },
  {
    "number": 49,
    "xlsxRow": 54,
    "original": {
      "location": "견적 도구 제목",
      "currentCopy": "견적에서 빠진 항목을 질문으로 바꿔요",
      "issue": "견적에 없는 항목인지 ‘포함 여부를 모르는’ 항목인지 구분 필요",
      "recommendedCopy": "업체에 무엇을 물어봐야 할지 확인하세요"
    }
  },
  {
    "number": 50,
    "xlsxRow": 55,
    "original": {
      "location": "견적 도구 설명",
      "currentCopy": "포함인지, 안 쓸 건지, 아직 모르는지 골라 봐요.",
      "issue": "상태 기준이 제각각이며 ‘안 쓸 건지’만 거친 구어체",
      "recommendedCopy": "항목별로 포함 여부와 이용 계획을 확인하면, 업체에 물어볼 질문을 만들어줘요. 질문은 복사해서 보낼 수 있어요."
    }
  },
  {
    "number": 51,
    "xlsxRow": 56,
    "original": {
      "location": "견적 도구 고지",
      "currentCopy": "값이 적정한지는 판정하지 않아요",
      "issue": "‘값/판정’의 말투가 주변과 어울리지 않음",
      "recommendedCopy": "가격의 적정 여부는 평가하지 않아요."
    }
  },
  {
    "number": 52,
    "xlsxRow": 57,
    "original": {
      "location": "웨딩코드 제목",
      "currentCopy": "웨딩코드로 내가 원하는 결혼식부터 골라 봐요",
      "issue": "실제 결혼식을 선택하는 기능으로 오해 가능",
      "recommendedCopy": "내가 원하는 결혼식을 찾아봐요."
    }
  },
  {
    "number": 53,
    "xlsxRow": 58,
    "original": {
      "location": "웨딩코드 설명",
      "currentCopy": "내가 원하는 결혼식 취향과 준비 방식은 어떤지…",
      "issue": "‘원하는 취향’ 호응이 어색하고 질문 대상이 나열됨",
      "recommendedCopy": "질문에 답하며 결혼식 취향과 준비 성향을 알아보세요. 파트너도 답하면 두 사람의 생각이 같은 부분과 다른 부분을 비교할 수 있어요."
    }
  },
  {
    "number": 54,
    "xlsxRow": 59,
    "original": {
      "location": "웨딩코드 고지",
      "currentCopy": "점수도 궁합도 매기지 않아요",
      "issue": "점수는 매길 수 있지만 궁합을 매긴다는 호응이 부자연스러움",
      "recommendedCopy": "점수를 매기거나 궁합을 평가하지 않아요."
    }
  },
  {
    "number": 55,
    "xlsxRow": 60,
    "original": {
      "location": "웨딩코드 고지",
      "currentCopy": "답은 기기 안에서 계산해요",
      "issue": "답을 계산한다는 표현이 어색",
      "recommendedCopy": "삭제"
    }
  },
  {
    "number": 56,
    "xlsxRow": 61,
    "original": {
      "location": "가격 도구 제목",
      "currentCopy": "취소하면 얼마 무는지, 공시 가격·위약금에서 확인해요",
      "issue": "‘얼마 무는지’는 거친 말투. 메뉴명을 장소처럼 연결함",
      "recommendedCopy": "업체 가격과 취소·환불 조건을 확인할 수 있어요."
    }
  },
  {
    "number": 57,
    "xlsxRow": 62,
    "original": {
      "location": "가격 도구 설명",
      "currentCopy": "취소하면 무는 돈",
      "issue": "정확한 비용 용어가 이미 있음",
      "recommendedCopy": "취소 위약금"
    }
  },
  {
    "number": 58,
    "xlsxRow": 63,
    "original": {
      "location": "가격 도구 설명",
      "currentCopy": "공시 안 한 업체는 여기 안 나와요",
      "issue": "대화체 흉내가 과하고 비문 같은 리듬",
      "recommendedCopy": "가격을 공시한 업체만 확인할 수 있어요."
    }
  },
  {
    "number": 59,
    "xlsxRow": 64,
    "original": {
      "location": "가격 도구 고지",
      "currentCopy": "값이 적정한지는 판정하지 않고, 요약하지도 않아요",
      "issue": "‘안 한다’는 설명이 앞선 원문 제공 설명과 중복",
      "recommendedCopy": "업체가 공개한 가격과 규정 원문을 제공해요. 가격의 적정 여부는 평가하지 않아요."
    }
  },
  {
    "number": 60,
    "xlsxRow": 65,
    "original": {
      "location": "예절 가이드 제목",
      "currentCopy": "부모님께 묻기 애매한 건 결혼 예절 가이드 25편에 있어요",
      "issue": "모든 애매한 질문이 포함돼 있다는 과장. 편수를 어색하게 문장에 삽입",
      "recommendedCopy": "상견례·예단, 어떻게 준비하면 좋을까요?"
    }
  },
  {
    "number": 61,
    "xlsxRow": 66,
    "original": {
      "location": "예절 가이드 설명",
      "currentCopy": "상견례나 예단처럼 양가가 얽힌 일",
      "issue": "‘얽히다’가 가족을 갈등으로 묘사",
      "recommendedCopy": "상견례·예단처럼 두 가족이 함께 준비하는 일의 관행을 확인할 수 있어요."
    }
  },
  {
    "number": 62,
    "xlsxRow": 67,
    "original": {
      "location": "예절 가이드 고지",
      "currentCopy": "정답이 아니라 흔한 관행이에요 · 지역·집안마다 다릅니다",
      "issue": "주변 ‘해요’ 문체와 ‘합니다’ 혼용",
      "recommendedCopy": "관행은 지역과 가족마다 달라요. 두 가족의 생각을 먼저 확인해야하고 이를 돕는 예절가이드를 제공해요."
    }
  },
  {
    "number": 63,
    "xlsxRow": 68,
    "original": {
      "location": "무료 도구 하단",
      "currentCopy": "여기에 공시 가격·위약금 원문과 커뮤니티도 로그인 없이 열려 있어요.",
      "issue": "커뮤니티 현시점 비공개",
      "recommendedCopy": "삭제"
    }
  },
  {
    "number": 64,
    "xlsxRow": 69,
    "original": {
      "location": "커뮤니티 제목",
      "currentCopy": "나랑 같은 분기에 결혼하는 사람들은 뭘 궁금해할까요?",
      "issue": "커뮤니티 현시점 비공개",
      "recommendedCopy": "삭제"
    }
  },
  {
    "number": 65,
    "xlsxRow": 70,
    "original": {
      "location": "커뮤니티 설명",
      "currentCopy": "결혼식 분기별로 동기방이 나뉘어 있어요. 견적이나 계약처럼 검색으로는 잘 안 나오는 이야기를 나누는 곳이에요.",
      "issue": "커뮤니티 현시점 비공개",
      "recommendedCopy": "삭제"
    }
  },
  {
    "number": 66,
    "xlsxRow": 71,
    "original": {
      "location": "신뢰 섹션 제목",
      "currentCopy": "결정은 직접, 아모라는 준비를 돕습니다.",
      "issue": "문장 앞뒤 호응이 약하고 갑자기 문체가 바뀜",
      "recommendedCopy": "아모라는 준비를 돕고, 결정은 두 사람이 해요."
    }
  },
  {
    "number": 67,
    "xlsxRow": 72,
    "original": {
      "location": "신뢰 섹션",
      "currentCopy": "공시된 문장을 요약하지도 않습니다. 현재 광고 상품을 운영하지 않아요.",
      "issue": "서로 다른 내용을 한 카드에 나열하며 문체 혼용",
      "recommendedCopy": "공시 가격과 규정은 원문으로 제공해요. 광고 상품은 운영하지 않아요."
    }
  },
  {
    "number": 68,
    "xlsxRow": 73,
    "original": {
      "location": "신뢰 섹션",
      "currentCopy": "계약서 해석이나 유불리 판단을 하지 않아요",
      "issue": "사용자에게 딱딱한 ‘유불리’",
      "recommendedCopy": "계약 조건을 해석하거나 어느 쪽이 유리한지 판단하지 않아요."
    }
  },
  {
    "number": 69,
    "xlsxRow": 74,
    "original": {
      "location": "신뢰 섹션",
      "currentCopy": "업체 계약 신청·예약·결제를 중개하지 않습니다.",
      "issue": "갑작스러운 공문체",
      "recommendedCopy": "업체 계약 신청·예약·결제를 중개하지 않아요."
    }
  },
  {
    "number": 70,
    "xlsxRow": 75,
    "original": {
      "location": "신뢰 섹션",
      "currentCopy": "아모라는 OpenAI GPT-5.6 Luna·Terra를 씁니다.",
      "issue": "내부 모델명은 서비스 혜택 설명에 불필요하고 변경 시 쉽게 낡음",
      "recommendedCopy": "모델 정보는 AI 서비스 정책으로 이동. 랜딩에는 ‘아모라의 답변은 AI가 작성해요.’"
    }
  },
  {
    "number": 71,
    "xlsxRow": 76,
    "original": {
      "location": "신뢰 섹션",
      "currentCopy": "해당하는 질문은 판정하지 않고 공식 창구를 안내해요.",
      "issue": "‘해당하는 질문/판정/공식 창구’가 추상적이고 행정적",
      "recommendedCopy": "전문적인 판단이 필요한 질문에는 관련 기관이나 전문가를 안내해요."
    }
  },
  {
    "number": 72,
    "xlsxRow": 77,
    "original": {
      "location": "마지막 제목",
      "currentCopy": "지금 뭐부터 할지 아모라와 정리해 봐요.",
      "issue": "첫 화면·중간 설명과 동일한 ‘정리’ 반복",
      "recommendedCopy": "지금 가장 궁금한 것부터 물어보세요."
    }
  },
  {
    "number": 73,
    "xlsxRow": 78,
    "original": {
      "location": "마지막 버튼",
      "currentCopy": "가입 전에 무료 도구 둘러보기",
      "issue": "버튼이 길고 주변에서 이미 가입 전 안내\n근데 무료 도구 중 견적같은 일부 툴은 커뮤니티에 있어서 별도로 랜딩페이지나 웨딩한방 서비스로 빼야할 것 같음",
      "recommendedCopy": "무료 도구 둘러보기"
    }
  },
  {
    "number": 74,
    "xlsxRow": 79,
    "original": {
      "location": "마지막 이용 안내",
      "currentCopy": "로그인·결제 없이 열려요",
      "issue": "‘서비스가 열린다’는 비유보다 이용 조건이 명확해야 함",
      "recommendedCopy": "무료 도구는 가입 없이 이용할 수 있어요. 아모라와 예산·할 일·일정 관리에는 가입이 필요해요."
    }
  },
  {
    "number": 75,
    "xlsxRow": 80,
    "original": {
      "location": "푸터 서비스 설명",
      "currentCopy": "아모라와 고민을 나누고, 확인한 내용을 예산·할 일·일정으로 이어가는 결혼 준비 공간.",
      "issue": "길고 추상적인 명사형 설명",
      "recommendedCopy": "아모라 상담부터 예산·할 일·일정 관리까지, 둘이 함께하는 결혼 준비."
    }
  },
  {
    "number": 76,
    "xlsxRow": 81,
    "original": {
      "location": "푸터 메뉴 제목",
      "currentCopy": "로그인 없이 / 계정이 필요한 것",
      "issue": "제목의 기준·문체가 서로 다름",
      "recommendedCopy": "가입 없이 이용 / 가입 후 이용"
    }
  },
  {
    "number": 77,
    "xlsxRow": 82,
    "original": {
      "location": "푸터 출처",
      "currentCopy": "2026.08.08 화면 집계 확인",
      "issue": "의미가 불명확한 내부 기록 표현",
      "recommendedCopy": "화면 집계 확인일: 2026년 8월 8일 — 무엇을 집계했는지 운영 측 확인 필요"
    }
  },
  {
    "number": 78,
    "xlsxRow": 83,
    "original": {
      "location": "푸터 가격 안내",
      "currentCopy": "공시한 업체만 싣기 때문에 지역별로 수가 크게 달라요",
      "issue": "‘수’가 무엇을 가리키는지 생략",
      "recommendedCopy": "가격을 공시한 업체만 제공하므로 지역별 등록 업체 수가 달라요."
    }
  },
  {
    "number": 79,
    "xlsxRow": 84,
    "original": {
      "location": "푸터 규정 안내",
      "currentCopy": "업체가 쓴 문장 그대로예요",
      "issue": "정보 제공 문구로 지나치게 구어적",
      "recommendedCopy": "업체가 공개한 취소·환불 규정을 원문으로 제공해요."
    }
  },
  {
    "number": 80,
    "xlsxRow": 85,
    "original": {
      "location": "푸터 가격 안내",
      "currentCopy": "예약·결제·계약은 업체와 직접 진행합니다.",
      "issue": "표현이 불명확함",
      "recommendedCopy": "예약·결제·계약은 업체와 직접 진행해주세요."
    }
  }
]
```

</details>
