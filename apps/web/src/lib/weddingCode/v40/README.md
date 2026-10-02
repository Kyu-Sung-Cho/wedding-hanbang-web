# 웨딩코드 4.0 (v4.0-tendency) 구현 계약

설계 정본은 설계 문서 spec.md(이 저장소 밖 작업 폴더)이고, 이 폴더의 파일이 그것을 코드로 굳힌 인터페이스다. 처음에는 동결이었고, 통합 정리(2026-09-30)에서 코어 정리 담당이 계약 변경 요청을 한 번에 반영했다(10절).
병렬 빌더는 이 README, `types.ts`, `contract.ts`, `layout.ts`, `../../../constants/weddingCodeV40.ts` 만 읽어도 자기 몫을 구현할 수 있어야 한다.
v3.1 웨딩코드 파일(`app/wedding-code/*`, `lib/weddingCode/*` 의 기존 파일, `constants/weddingCodeV31*.ts`)은 동결이다. 이 폴더에서 가져오지도 고치지도 않는다.

## 1. 파일 지도

| 파일 | 내용 | 소유 |
|---|---|---|
| `constants/weddingCodeV40.ts` | 판 태그, 글자 8개, 주제 4개, 측면 16개, 세기, 구간 이름표, 고정 문구, 코덱과 저장 상수 | 설계(동결) |
| `v40/types.ts` | 모든 타입(작성용 문항, 뷰, 저장 상태, 채점, 두 사람, 흐름, 저장소, props) | 설계(동결) |
| `v40/contract.ts` | 모듈별 함수 서명과 의미(런타임 코드 없음) | 설계(동결) |
| `v40/layout.ts` | 질문 68개 배치 골격(id, 구간, 화면, 형식, 종류, 키) | 설계(동결) |
| `v40/types.test.ts` | 상수와 골격 확인 시험 | 설계(동결) |
| `v40/states.ts` | 저장 상태 문자 도우미 (`StatesModule`) | 코어 |
| `v40/bank.ts`, `bank.test.ts` | 은행 결합, 검사, 조회 구조 (`BankModule`) | 코어 |
| `v40/present.ts` | 뷰 만들기, 화면 답 <-> 저장 상태, 인용 문구 (`PresentModule`) | 코어 |
| `v40/value.ts`, `score.ts`, `gates.ts` | 문항 값, 축 집계와 결과, 위치 반복 검사 | 코어 |
| `v40/codec.ts` | 링크 코드, 링크 만들기와 읽기 | 코어 |
| `v40/flow.ts` | 화면 묶음과 순수 reducer | 코어 |
| `v40/quote.ts`, `couple.ts`, `storage.ts` | 인용, 두 사람 비교, 이 브라우저 저장(브라우저 저장소의 이름을 부르는 유일한 파일, `browserStorage()`) | 코어 |
| `v40/fixtures.ts` | 고정 표본 응답 12개(화면 빌더도 이것으로 화면을 그린다) | 코어 |
| `docs/wedding-code/2026-09-29_v40_items.json`, `constants/weddingCodeV40Bank.ts` | 문항 68개 원천(JSON)과 그것에서 스크립트가 만든 **단일 생성 파일**(`V40_BANK_DATA`, 고치지 않는다). 주제별 `bank.<주제>.ts` 파일은 없다 | 문항 작성 |
| `components/wedding-code/v40/{ItemFrame,PairInput,ReactInput,ChoiceInput,BestWorstInput,SplitInput}.tsx` | 입력 컴포넌트. `ItemView`와 `ViewAnswer`만 다룬다 | 입력 |
| `components/wedding-code/v40/{Intro,RestCard,SelfIntro,ProgressBar,Result*,Couple*,Share*,Receive,QualityNotes}.tsx` | 화면 | 화면 |
| `app/wedding-code/WeddingCodeV40Client.tsx`, `entry.ts` 변경, 통계, 문서 | 클라이언트, 입구, 계약 문서 | 클라이언트/입구/문서 |

경로는 모두 `apps/web/src/` 아래. 컴포넌트 폴더 이름은 제안이며 리드가 바꿀 수 있다.

### 소유 규칙

- 다른 빌더의 파일을 고치지 않는다. 계약(types, contract, layout, constants)이 모자라면 고치지 말고 보고서에 「계약 변경 요청」으로 적는다. 리드가 한 곳에서 반영한다.
- 입력과 화면 빌더는 `lib/weddingCode/v40` 에서 `types.ts` 와 `contract.ts`(타입만)를 가져오고, 함수는 코어 모듈의 named export 를 쓴다. 코어가 아직 없을 때는 `contract.ts` 인터페이스에 맞춘 가짜를 시험 안에서 만든다.
- 입력 컴포넌트는 극, 값, 키를 볼 수 없다(뷰에 없다). 색만으로 뜻을 전하지 않고, 화면에 번호와 A/B 라벨을 쓰지 않는다(낭독용 이름은 예외).
- 코어 모듈 파일 마지막에 자기 인터페이스를 만족하는지 검사한다: `const _module = { ... } satisfies PresentModule;` 처럼.
- 새 파일은 LF 줄바꿈. 한국어는 직접 입력하고 `\u` 이스케이프를 쓰지 않는다. 쓴 뒤 원문과 대조한다.

## 2. 용어와 문구 규칙 (부록 E)

| 낱말 | 뜻 | 쓰지 않는 다른 뜻 |
|---|---|---|
| 주제 | 네 축(돈을 정할 때 / 준비를 굴릴 때 / 함께 정하는 사람 / 지쳤을 때) | 측면, 글자 위치 |
| 글자 | V S W D U F H A 한 자 | 문항 번호, 카드 라벨 |
| 코드 | 네 글자 | 유형 이름 |
| 세기 | 뚜렷해요 / 기울어요 / 반반이에요 | 수치, 순위 |
| 구간 | 질문을 나눈 네 덩어리(처음 / 이어서 / 조금만 더 / 마지막 구간) | 이야기, 장면 |
| 질문 | 문항 하나 | 장면 |

- 해요체. 줄표(긴 것과 짧은 것) 없음. 시스템 말투와 AI 티 없음. 「~인 답」 같은 명사형 없음. Tailwind 클래스처럼 보이는 문자열을 주석에 쓰지 않는다.
- 화면 문구에 쓰지 않는 말(주장으로): 검증된, 정확, 과학적, 진단, 백분율(퍼센트 기호), 점수, 등급, 궁합 점수, 동물과 캐릭터, 「~스타일」 이름, 상표가 된 성격 유형 약어.
- 「검증을 마친 심리검사가 아니에요」는 화면마다 한 번만. 이야기 화면과 코드 복사 글에는 넣지 않는다.
- 글자는 대문자 여덟 개뿐이다. 상태 글자(B M N ?)와 소문자 변형을 만들지 않는다. 카드 라벨에 A/B 를 쓰지 않는다.
- 세기를 숫자, 막대 너비, 색 등급으로 보이지 않는다. 낱말 세 개(뚜렷해요 / 기울어요 / 반반이에요)로만.

## 3. 저장 상태 표 (stored state)

문항 하나의 저장값은 문자 한 개다. 알파벳 `V40_STATE_ALPHABET` = `0-9a-zA-Z`(62자)의 앞에서 형식의 상태 수만큼을 쓴다.
기준은 **문항 은행에 적힌 순서(폼 비트 0의 화면 순서)** 이고 폼 비트와 무관하다. 화면 번호와의 변환은 `present.toStored / fromStored` 만 한다.

| 형식 | 상태 수 | 상태 색인 s (문자 = 알파벳[s]) | 문항 값 |
|---|---|---|---|
| pair | 6 | 0 = 위 카드(cards[0]) 아주, 1 = 위 꽤, 2 = 위 조금, 3 = 아래 카드(cards[1]) 조금, 4 = 아래 꽤, 5 = 아래 아주 | 2 x 세기(아주 3, 꽤 2, 조금 1) x (고른 카드가 front 면 +1, back 이면 -1): -6 -4 -2 +2 +4 +6 |
| react | 5 | 0 = 왼쪽 끝 칸에서 4 = 오른쪽 끝 칸 (은행 배치 기준, 오른쪽 끝이 높은 칸) | (s - 2) x 3 x (highPole 이 front 면 +1, back 이면 -1): -6 -3 0 +3 +6 |
| recall | 4 | s = options 색인 0에서 3 | 그 보기의 극 x 세기(strong 6, weak 2): -6 -2 +2 +6 |
| instant | 4 | recall 과 같다 | recall 과 같다 |
| bestworst | 12 | (b = 가장 나 같은 것의 cards 색인, w = 가장 나 같지 않은 것의 색인, b != w) s = 3b + (w < b ? w : w - 1) | (cards[b] 가 front 면 +4, back 이면 -4) + (cards[w] 가 front 면 -2, back 이면 +2): -6 -2 +2 +6 |
| split | 28 | (a = entries[0] 칸 수, b = entries[1] 칸 수, 나머지 = entries[2]) s = a(15 - a)/2 + b, a 0에서 6, b 0에서 6-a | (front 항목 칸 수) - (back 항목 칸 수): -6 에서 +6. 중립 칸은 값에 넣지 않음 |
| self | 6 | pair 와 같은 6칸 | 값 없음. 고른 방향(카드의 pole)과 세기 1, 2, 3 만 쓴다 |

특수 값 (모든 형식 공통, 둘 다 **빠진 값**이며 0 이 아니다):

| 메모리 | 링크 코드 문자 | 화면 |
|---|---|---|
| `"skip"` | `-` | 잘 모르겠어요 |
| `"na"` | `_` | 제 상황과 안 맞아요 (지난 일 떠올리기에서는 이런 일이 없었어요도 같은 값) |
| (진행 저장에서만) 아직 답하지 않음 | `.` | 링크 코드에는 없다 |

### 폼 비트가 화면에서 뒤집는 것

| 형식 | 폼 비트 1 이면 | 화면 번호 -> 저장 색인 |
|---|---|---|
| pair, self | 카드 위아래 교환(6칸 DOM 순서도 뒤집힘) | s = 5 - 화면 칸 |
| react | 양끝 이름 자리 교환 | s = 4 - 화면 칸 |
| recall, instant | 보기 4개 순서 뒤집기 | s = 3 - 화면 번호 |
| bestworst | 카드 4장 순서 뒤집기 | 저장 색인 = 3 - 화면 색인 (best, worst 각각) |
| split | 앞 두 항목만 자리 교환, 세 번째는 그대로 | 저장 칸 수 (a, b, c) = 화면 (v1, v0, v2) |

이 표와 문항 값 표는 설계의 분석 스크립트(analyze.js)의 value 함수와 1,120개 화면 답에서 모두 같은 값이 나온다는 것을 시제품으로 확인했다(폼 비트 0, 1). 같은 시제품에서 고정 화면 답 248가지의 형식별 축 합이 모두 0 이다.

### 화면 답(ViewAnswer)의 번호

pair, self: `cell` 0에서 5 = DOM 순서 [위 아주, 위 꽤, 위 조금, 아래 조금, 아래 꽤, 아래 아주]. react: `cell` 0에서 4 = 화면 왼쪽부터.
recall, instant: `option` 0에서 3 = 화면 위에서부터. bestworst: `best`, `worst` = 화면 카드 색인(둘 다 고르기 전에는 null 허용). split: `counts` = 화면 항목 순서의 칸 수(합 6이 되기 전에는 중간 상태).
escape: `{ fmt: "escape", which: "unsure" | "na" }`.

## 4. 링크 코드 (70자)

```
[0]      폼 비트 문자 "0" 또는 "1"
[1..64]  채점 문항 64개, 질문 순서 (layout 색인 0에서 63)
[65..68] 자기 선택 4개 (돈, 준비, 정하는 사람, 지쳤을 때)
[69]     체크섬 문자
```

- 문항 문자: 그 형식의 상태 문자, `-`, `_` 중 하나. 위치마다 쓸 수 있는 문자가 다르다(예: pair 위치는 `0`에서 `5`, `-`, `_`).
- 체크섬: 앞 69자를 `body` 라 하고 값 `v` = 알파벳 색인(`0-9a-zA-Z`), `-` 는 59, `_` 는 60 으로 두고
  `T = sum(i = 0..68) ((i mod 60) + 1) x v(body[i])`, 체크섬 문자 = `알파벳[T mod 61]`.
  61 이 소수이고 가중치 1에서 60 이 61 로 나누어떨어지지 않으며 한 위치의 유효 문자 값이 61 로 나눈 나머지가 모두 다르다. 시제품으로 문자 한 개를 다른 유효 문자로 바꾼 261,200가지를 모두 거절함을 확인했다(체크섬 색인은 60 이하만 쓰임). 인접 교환도 유효한 경우 모두 거절됐다.
- 디코드는 길이, 알파벳 밖 문자, 위치별 범위, 폼 비트 문자, 체크섬 중 하나라도 어긋나거나 상태 문자가 하나도 없으면 링크 전체를 거절한다. 한 사람의 답만 살리지 않고 기본값도 채우지 않는다.
- 링크: `${origin}/wedding-code#v=v4.0-tendency&a=<70자>[&b=<70자>]`. 링크를 만드는 길은 `buildGatedShareUrl` 하나다(관문이 닫힌 사람의 답이면 null. 조립만 하는 `buildShareUrl` 은 공개하지 않는다). 질문만 보내기는 답이 없고(`buildQuestionOnlyUrl`), 기본 진입이 v3.1 인 동안은 `?v=v4.0-tendency` 를 붙인다.
- origin 규칙: 끝의 `/` 를 모두 뗀 뒤 빈 문자열(같은 사이트 상대 주소) 또는 `http(s)://호스트[:포트]` 한 덩어리만 쓴다. 문자열이 아니거나 다른 스킴(`javascript:` 등), `//host`, 경로, 질문, 조각, 공백, `@`, 역슬래시가 들었거나 255자를 넘으면 `buildGatedShareUrl` 은 null, `buildQuestionOnlyUrl` 은 상대 주소(`/wedding-code...`)를 낸다.
- 은행 인자: `encodeCode`, `decodeCode`, `decodeShareParams`, `parseShareHash` 는 문항 id 와 형식만 읽으므로 `CodecBankView`(`Bank` 도 배치 골격 `V40_LAYOUT` 도 만족)를 받는다. 입구(`entry.ts`)는 문항 문구가 든 은행 없이 `{ items: V40_LAYOUT }` 로 받은 링크를 푼다.
- 체크섬은 오타를 잡는 장치이지 위조를 막는 장치가 아니다. 한 글자 바꾸기와 이웃한 두 글자 맞바꾸기는 모두 잡지만 60칸 떨어진 두 자리의 맞바꾸기는 잡지 못한다(알려진 한계: 고치려면 검사 문자를 늘려야 하고 판을 올리는 변경이다).
- 받는 사람 화면은 상대 답을 디코드한 즉시 메모리로 옮기고 `history.replaceState` 로 주소의 `#` 뒤를 지운다(클라이언트 몫).
- 진행 저장은 링크 코드와 다른 표기다: 68자(체크섬, 폼 비트 없음, `.` 허용) + JSON 봉투의 `formBit`, `cursor`, `screen`. 키 `hanbang:wedding-code:v4:progress`, 30일.

## 5. 문항 은행 작성 규칙 (문항 작성 빌더용)

파일은 주제마다 하나. `export const MONEY_ITEMS: readonly Item[] = [...]` 처럼 그 주제의 17개(채점 16 + 자기 선택 1)를 `layout.ts` 의 순서대로 낸다.
`id, axis, facet, section, screen, fmt, key`(그리고 pair, react 의 `kind`)는 `V40_LAYOUT` 의 해당 칸과 **글자 그대로 같아야** 한다. 문구 필드만 채운다. 목록 필드는 폼 비트 0 화면 순서다.

공통 필드: `caption`(제목 12자 이하, 번호와 축 이름 없음), `stem`(앞말 90자 이하).

| fmt | 채울 필드 | 배열 규칙(키에서 파생) |
|---|---|---|
| pair | `cards: [위, 아래]` 각 `{ pole, text }` | key 1 이면 cards[0] 이 front |
| react | `quote?`(있으면 `{ speaker, text }`, 바깥 「」 없이), `question`, `ends: { left, right }`, `highPole`, `recap` | key 1 이면 highPole = front. right 가 높은 칸 |
| recall, instant | `options` 4개 `{ text, pole, strength }` | key 1: (back weak, front strong, front weak, back strong). key -1: (front weak, back strong, back weak, front strong) |
| bestworst | `cards` 4장 `{ pole, text }` | key 1: (front, back, back, front). key -1: (back, front, front, back). text 는 요로 끝나고 마침표 없음 |
| split | `entries` 3개 `{ pole, text }` | key 1: (front, back, neutral). key -1: (back, front, neutral) |
| self | `cards: [위, 아래]` 각 `{ pole, text }`, caption 은 「직접 고른 쪽」, stem 은 기본 「스스로는 어느 쪽에 더 가깝다고 생각해요?」 | key 1 이면 cards[0] 이 front |

- `react.recap`: `${recap} ${고른 쪽 끝 이름}` 이 자연스러운 한 문장이 되는 앞 구절(결과의 「내가 고른 답」에 쓴다). 예: recap 「상대가 「많이 힘들었겠다」 하고 먼저 말해 주면」 + 끝 이름 「든든할 것 같아요」.
- `react.ends`: 양쪽 모두 정당한 마음이어야 하고 한쪽이 더 좋은 답처럼 들리면 안 된다. 본문의 화자를 `quote.speaker` 로 밝힌다(낭독용).
- pair 의 종류: method = 내 방식(카드가 접근 방식을 서술), moment = 결혼식 뒤 한 달쯤의 두 순간(같은 생생함), friends = 친구 두 커플 이야기(따라 하고 싶은 쪽).
- 돈 주제 문항의 앞말에는 금액을 쓰지 않고 「형편이 넉넉하든 빠듯하든 지금 마음이 가는 쪽」 취지를 붙인다. 신혼집, 예단과 예물, 양가 비용 분담, 실제 금액은 묻지 않는다.
- 작성 규칙 16조(설계 부록 C.1)를 지킨다: 축 이름과 글자 이름 금지, 두 극의 길이 15퍼센트 이내와 같은 무게의 대가, 추상어 대신 행동과 장면, 가치 판단어 금지, 한 문항 한 측면, 결혼 준비 경험 없이도 상상 가능, 숫자 없음.

예시 (설계 부록 C의 견본, 실제 문구는 검수 전):

```ts
{
  id: "money.limit.1", axis: "money", facet: "limit", section: 0, screen: 0, key: 1, fmt: "pair", kind: "method",
  caption: "첫 주말의 대화",
  stem: "결혼 준비를 막 시작한 주말, 둘이 마주 앉았어요. 형편이 넉넉하든 빠듯하든 지금 마음이 가는 쪽을 골라 주세요.",
  cards: [
    { pole: "front", text: "쓸 수 있는 총액의 선부터 긋고 그 안에서 채워 가요. 접어야 하는 것이 생겨도 선은 지켜요." },
    { pole: "back", text: "그날 꼭 남기고 싶은 모습부터 그려 보고 돈은 그다음에 맞춰 가요. 총액이 흔들려 불안한 날도 있어요." },
  ],
}
```

은행 검사가 잡는 것은 `contract.ts` 의 `BankModule` 주석에 있다(구조, 키 파생, 균형, 글자 수, 금지 표현). 은행이 바뀔 때마다 통과해야 병합한다.

## 6. 흐름 요약

- 전체 흐름 쪽 순서: intro, 구간 0 질문 화면 10개, rest(after 0), 구간 1 x 10, rest(after 1), 구간 2 x 10, rest(after 2), 구간 3 x 10, selfIntro, 자기 선택 화면 2개, result. 화면 묶음 screen 이면 48쪽.
- 질문 화면은 문항 1~2개(서로 다른 주제). 첫 두 화면은 두 가지 중 고르기와 이럴 때 마음만, 지쳤을 때 주제 없음(배치가 보장).
- 답을 골라도 자동으로 넘어가지 않는다. 다음으로만 넘어간다. 칸 나누기는 6칸을 다 놓기 전에 다음을 눌러도 단추는 꺼져 있지 않고 남은 칸을 안내한다(reducer 가 notice incomplete 를 낸다). 저장값이 있는 문항이라도 지금 화면 답이 중간 상태이면(`FlowState.partialIds`) 같다.
- 한 번 완성한 답은 지워지지 않는다: 중간 상태는 `drafts` 와 `partialIds` 에만 있고 `responses` 는 그대로다. 쪽을 벗어나면(이전, 필터 닫기 포함) 중간 답은 버리고 마지막 완성 값을 쓴다. 그래서 모든 문항에 완성된 값이 있으면 언제든 결과에 이른다.
- 결과 앞에서 저절로 열린 넘어간 질문 다시 보기(`filterOrigin` advance)의 첫 쪽에서 이전은 마지막 질문 화면으로, 결과에서 사람이 연 필터(`open`)의 첫 쪽에서 이전은 결과로 돌아간다.
- 결과는 항상 저장된 답에서 다시 계산한다. 「이 주제 답 다시 보기」와 건너뛴 질문 다시 보기는 새 화면이 아니라 `openFilter` 로 여는 필터다.
- 두 사람 결과 링크를 연 화면은 이 브라우저에 아무것도 쓰지 않고(진행 저장, 비교 기록, 선호, 지우기 모두, `purgeExpired` 도 부르지 않는다), 읽는 것은 「나」 표시를 위한 `readProgress` 한 번뿐이다(`detectPerspective`). 읽기는 저장된 내용도 저장 기간도 바꾸지 않는다. 초대 링크로 연 사람은 상대 답을 메모리에만 두고 본인 답은 일반 시작과 같은 규칙으로 저장한다.
- 라운지 안(`embedded`)에서 쓰이는 같은 클라이언트다: `embedded`, `onRestart`, `initialNotice` 가 처음부터 props 에 있다.

### 입력 컴포넌트 계약

- props 는 `types.ts` 의 `ItemInputProps<TView>` (`view`, `value`, `onAnswer`, `idPrefix`, `incomplete?`). 형식별 별칭: `PairInputProps`(pair, self), `ReactInputProps`, `ChoiceInputProps`, `BestWorstInputProps`, `SplitInputProps`.
- `ItemFrame` 이 캡션(작은 글씨, 번호 없음), 앞말(react 의 인용은 인용 블록 + 화자 낭독), 형식 입력, 모든 문항 아래 작은 두 단추(잘 모르겠어요 / 제 상황과 안 맞아요)를 감싼다. 두 단추는 `onAnswer({ fmt: "escape", which: "unsure" | "na" })`.
- pair/self: 라디오 그룹 하나에 6칸, DOM 순서가 `view.cells` 순서(위 아주, 꽤, 조금, 아래 조금, 꽤, 아주)라 방향키가 척도를 따라 걷는다(시험으로 고정). 칸 이름은 `cell.accessibleName`. 터치 목표 44px 이상.
- react: 양끝 이름을 그룹 설명(`groupDescription`)에 붙이고 칸마다 `accessibleName`(보이는 글자에 번호 없음).
- recall/instant: 라디오 카드 4개(+ recall 은 `noneLabel` 카드 = escape na)와 넘기기 단추를 같은 화면에. 긴 보기는 줄바꿈 허용.
- bestworst: 라디오 그룹 두 개(`bestLabel` / `worstLabel`). 카드는 절대 비활성이 아니다. 같은 카드를 두 그룹에서 고르면 나중에 고른 쪽만 남기고 `duplicateAnnounce` 를 aria-live 로 낭독. 둘 다 고르기 전에는 `best`/`worst` 에 null 을 담은 중간 답을 부른다.
- split: 항목마다 -/+ 단추와 현재 값 라벨, 남은 칸은 aria-live. 단추는 `aria-disabled` 와 이유 문구를 쓰고 `disabled` 속성을 쓰지 않는다. 한 곳에 몰아도 된다. 드래그 없음. 합이 6 이 되기 전에도 `counts` 중간 답을 부른다.
- 모든 컴포넌트: 자동으로 넘어가지 않는다, 색만으로 뜻을 전하지 않는다, 보이는 글자에 번호와 A/B 를 쓰지 않는다, 폼 비트를 알 필요가 없다(뷰가 이미 뒤집혀 있다).

### 고정 표본 12개 (`fixtures.ts`, 코어가 `V40Fixture[]` 로 낸다)

화면 빌더가 실제 채점 결과로 화면을 그리는 데 쓴다. 각 표본은 68개 모두 채워진 응답이다.

| 이름 | 보여 주는 것 |
|---|---|
| `swua-example` | 문서 예시: 돈 S 기울어요, 준비 W 뚜렷해요, 정하는 사람 U 기울어요, 지쳤을 때 A 반반이에요 |
| `all-clear` | 네 주제 모두 뚜렷해요 |
| `all-even` | 네 주제 모두 반반이에요 (확정 글자는 있음) |
| `mixed-bands` | 뚜렷해요, 기울어요, 반반이에요가 모두 섞임 |
| `unusable-axis` | 한 주제의 유효 답이 12개 미만이라 글자 자리가 「·」 |
| `provisional-tie` | 한 주제가 동점 사슬 끝까지 가서 앞 글자를 임시로 적음 |
| `tie-chain` | 동점 사슬 1에서 4단계에서 갈리는 주제들 |
| `rhythm-hint` | 위치 반복 형식이 2개라 세기가 한 단계 낮춰짐 |
| `rhythm-gate` | 위치 반복 형식이 3개라 코드가 없음 |
| `skip-hint` | 잘 모르겠어요가 17개 이상이라 세기가 낮춰짐 |
| `self-contrast` | 직접 고른 쪽 대비가 나오는 주제 (자기 선택이 답 쪽과 다르고 꽤 이상) |
| `couple-partner` | `swua-example` 와 짝으로 두 사람 비교(다른 글자, 이야기해 볼 질문, 비슷한 질문)가 나오는 상대 표본 |

## 7. 내가 내린 결정 (계약을 굳히면서)

리드가 뒤집을 수 있게 이유와 함께 적는다. 번호는 보고서와 같다.

1. **폴더와 이름**: `lib/weddingCode/v40/`, `constants/weddingCodeV40.ts`. 문서 안의 v4 이름과 다르다(요청대로 v40). 타입 이름 `Response` 는 DOM 전역 `Response` 를 가려서 `Responses` 로 했다.
2. **저장 상태는 은행 배치 좌표**: 문서의 「저장값은 원본 배치(키) 기준」을 그대로 따랐다. 극 기준 정규화(값 기준 저장)는 가장·가장 아닌 것과 칸 나누기에서 카드 정체를 잃으므로 쓰지 않았다.
3. **칸 나누기의 폼 비트**: 앞 두 항목만 자리를 바꾸고 중립은 그대로 둔다(분석 스크립트가 검증한 모형과 같다). 전체 위아래 뒤집기가 아니다.
4. **자기 선택 배치**: 화면 40(돈, 준비), 41(정하는 사람, 지쳤을 때). 키는 돈 +1, 준비 -1, 정하는 사람 -1, 지쳤을 때 +1 (2:2, 같은 주제가 연달아 나오지 않음). 두 넘기기가 다른 문항과 똑같이 있고 저장 상태와 뷰는 pair 와 같은 모양이며 폼 비트 규칙도 pair 를 따른다.
5. **링크 코드**: 위 4절 그대로. 상태 문자가 하나도 없는(전부 skip 또는 na) 코드는 정보가 없어 인코드도 디코드도 거절한다. 관문이 닫힌 응답의 코드 복사 차단은 `canShare(result)` 로 호출자가 하고, 링크는 관문을 확인하는 `buildGatedShareUrl` 하나로만 만든다(2026-09-30 통합 정리 전에는 호출자 몫이었다).
6. **질문만 보내기 링크**: 기본 진입이 v3.1 인 동안 `?v=v4.0-tendency`, 기본 진입을 v4 로 바꾼 뒤 `/wedding-code`. `buildQuestionOnlyUrl(origin, { explicitVersion })`.
7. **구간 이름 카드 없음**: 리드 요청의 쪽 종류 목록에 있던 「section card」 를 만들지 않았다. 문서는 이야기 카드와 구간 카드를 두지 않고 이름표를 진행 막대와 쉬는 카드에만 붙인다. `QuestionsPage.section` 이 이름표를 찾는 열쇠다. 필요하면 `Page` 에 종류 하나를 더하면 된다.
8. **진행 저장 위치는 쪽 번호가 아니라 문항 색인(cursor)**: 320x568 에서 화면 묶음을 나누면(pack single) 쪽 번호가 달라지기 때문. 필터 흐름(편집 중)은 저장하지 않는다: 편집 중 저장돼도 다음에는 결과(모두 답한 경우)나 첫 미답 쪽에서 이어진다.
9. **화면 답의 중간 상태**: `bestworst` 의 한쪽만 고른 상태와 `split` 의 합 6 미만은 `ViewAnswer` 로 표현하되 저장 상태로는 바꾸지 않는다. reducer 는 `drafts` 와 `partialIds`(문항별 깃발)에만 두고 `responses` 는 건드리지 않는다: 이미 완성해 둔 저장값이 있으면 그대로 남는다(예전에는 중간 상태가 되는 순간 저장값을 지워서, 한 번 눌러 고치다가 이전으로 나오면 결과에 이를 수 없었다). 다음 단추는 responses 에 값이 있고 깃발이 서 있지 않을 때만 넘어간다. 쪽을 벗어나면 중간 답은 버리고 마지막 완성 값을 쓴다.
10. **동점 사슬의 입력**: 1단계 고르기(recall + instant) 유효 답 값 합의 부호, 2단계 이럴 때(react) 유효 답 값 합의 부호, 3단계 세는 측면의 합 부호 다수결(합 0 측면은 뺌), 4단계 자기 선택 방향, 5단계 앞 글자 임시. 설계 시제품(ties.js)과 같은 정의다.
11. **힌트는 한 단계까지**: 위치 반복 힌트와 건너뜀 힌트가 겹쳐도 세기를 한 단계만 낮춘다(문서의 「한 단계」). 위치 반복 검사는 저장 상태가 아니라 **화면 위치**(폼 비트 반영)의 열로 한다(`present.viewPosition`). 임계값은 정수 비교.
12. **코드 문자열**: 글자를 못 정한 주제는 `·`, 임시 글자는 글자 그대로. 관문이 닫히거나 확정 글자가 하나도 없으면 null. 관문 사유는 `rhythm` 과 `noInformation` 두 가지.
13. **인용 문구 규칙**(`present.answerText`): pair 는 카드 원문(+ 아주면 「 (아주 가까워요)」), react 는 작성 필드 `recap` + 고른 쪽 끝 이름(안쪽 칸이면 「 (조금 가까워요)」, 가운데는 null), 고르기는 보기 원문, 가장·아닌은 「가장 나 같은 것으로 「카드 원문」를 골랐어요」(조사 고정: 카드가 요로 끝남), 칸 나누기는 「6칸 중 n칸을 「항목 원문」에 놓았어요」(고른 극 쪽 항목, 값 0 이면 null). 설계 문서의 react 인용 서식이 예시와 맞지 않아 작성 필드 `recap` 을 새로 뒀다.
14. **인용 뽑기**(`quote.pickQuotes`): 측면과 형식(fmt 여섯 값 그대로)이 겹치지 않게, 부족하면 부족한 대로. 반반이에요 주제는 앞쪽 2개와 뒤쪽 2개를 |값| 조건 없이. 반대로 고른 답은 |값| 3 이상.
15. **두 사람 비교의 「비슷한 질문」**: 문서가 정렬을 정하지 않아 「두 값 중 작은 절댓값이 큰 순」으로 하고 「먼저 이야기해 볼 질문」과 같이 주제마다 하나씩 먼저 뽑는다.
16. **자동 저장 끄기**: v4 진행, v4 기록, 이전 판(v3.1) 진행 저장 키를 함께 지운다. 읽는 규칙: v4 키에 on 이나 off 가 적혀 있으면 그것이 이기고, v4 키가 없을 때만 이전 판 자동 저장 선호가 off 이면 v4 도 끈 것으로 읽는다(그래서 이전 판에서 끈 사람도 v4 에서 다시 켤 수 있다). 끈 동안 `writeProgress` 와 `appendHistory` 는 아무것도 쓰지 않고 `off` 로 답한다(저장소가 막힌 `unavailable` 과 다르다). 함께 보기 확인 주소 키(`hanbang:wedding-code:comparison:v1`)는 v3.1 파일 소유라 건드리지 않는다(클라이언트가 기존 도우미로 지운다).
17. **지난번 기록**: 항목마다 `at` 으로 30일 규칙을 적용한다(봉투 전체 savedAt 을 두지 않음). 답은 저장하지 않고 글자, 세기, 시각, 폼 비트만.
18. **반반 코드 안내 문구**: 구조 목록(2)의 「반반으로」와 예시의 「「반반」으로」가 달라서 예시(최종 문구 수준)를 골랐다.
19. **낭독 이름**: 이럴 때 칸은 모두 위치 이름(「다섯 칸 중 가운데」 등)이고 양끝 칸은 끝 이름을 앞에 붙인다. 구간 낭독 알림은 문서의 「지금 두 번째 구간이에요」 형식을 네 구간과 마지막 정리로 넓혔다.
20. **측면 키 이름**: 영어 열여섯 개(limit ... recover)는 배치표 데이터의 이름을 그대로 쓴다. 화면에 내지 않는다.

## 8. 열린 질문 (리드가 정해 주세요)

1. 「section card」 쪽 종류가 정말 필요한가(위 7번). 필요하면 어떤 내용을 넣을지.
2. 문서가 「작성 필요」로 남긴 글: 두 사람 화면의 주제별 **여는 질문 4줄**, **직접 고른 쪽 대비 문구**(주제별 4개, 세기 뚜렷해요와 기울어요 어감 차이), 받는 사람 화면과 시작 화면의 최종 문구 배치. 상수 파일에는 넣지 않았다(화면 빌더/리드가 씀).
3. 문서 7절의 「지난번과 비교」 두 문구(「반반이에요가 낀 주제는 바뀌기 쉬워요」 / 「바뀌기 쉬운 주제예요」)가 서로 다르다. 어느 쪽인가.
4. 자기 선택 문항에도 「제 상황과 안 맞아요」를 둘지(지금은 다른 문항과 똑같이 둠). 빼려면 코덱 위치 범위 표가 바뀐다.
5. 첫 방문 자동 저장 기본값(켜짐)과 같이 쓰는 브라우저 안내는 문서 그대로 켜짐으로 뒀다. 확인 필요 없으면 그대로.
6. 화면 빌더와 클라이언트 빌더 사이의 props(시작 화면, 질문 화면, 결과 화면, 두 사람 화면, 보내기 블록)는 고정하지 않았다. 입력 컴포넌트 props(`ItemInputProps`)와 클라이언트 props(`WeddingCodeV40ClientProps`)만 고정했다. 화면 빌더가 자기 props 를 보고하면 리드가 한 번에 굳히는 것을 권한다(데이터 props + 콜백만, 코어의 `V40Result`, `AxisQuotes`, `CoupleResult`, `ProgressSegment[]` 를 그대로 받게).

## 9. 확인한 것

- `npx tsc --noEmit` (apps/web): 이 폴더와 상수 파일이 만든 오류 0건. `npx eslint`: 위 다섯 파일 오류 0건.
- `npx vitest run src/lib/weddingCode/v40/types.test.ts`: 17개 통과.
- 상수의 한국어 179개 문자열을 설계 문서 원문과 글자 단위로 대조(누락 0건). 배치 골격 64칸을 설계 스크립트 출력과 대조(불일치 0건).
- 시제품(작업 폴더 build-logs/proto-contract-check.js): 저장 상태 표 + 폼 비트 규칙 + 값 함수가 설계 분석 스크립트와 1,120개 화면 답에서 일치, 고정 화면 답 248가지 합 0, 체크섬 단일 문자 손상 261,200가지 전부 검출.

## 10. 통합 정리(2026-09-30)에서 계약에 반영한 것

빌더와 검토자가 계약 변경 요청으로 남긴 것을 `types.ts`, `contract.ts`, 이 문서에 한 번에 반영했다. 구현은 요청대로 이미 되어 있던 것과 이번에 고친 것이 섞여 있다.

| 항목 | 반영한 내용 |
|---|---|
| `StatesModule.responseAt` | 응답 맵에서 문항 하나를 읽는 유일한 방법(자기 소유 키의 문자열만). 상속 키와 문자열이 아닌 값은 빠진 답이다 |
| `CodecModule.parseShareHash`, `buildGatedShareUrl` | 주소의 해시 전체를 읽고(길이 512자 상한, 키 v, a, b), 링크는 관문까지 확인하는 `buildGatedShareUrl` 하나로만 만든다. `buildShareUrl` 은 공개하지 않는다 |
| `CodecBankView` | 코드를 만들고 푸는 함수의 은행 인자. 입구가 형변환 없이 배치 골격을 넘긴다 |
| origin 규칙 | 4절. 쓸 수 없는 origin 은 링크 null, 질문만 보내기는 상대 주소 |
| `StorageModule.browserStorage` | 계약 문서 9.3절의 유일한 저장소 이름 자리. 임시 파일(`lib/weddingCode/browserStorageHandle.ts`)은 지웠고 소스 가드 규칙 5 가 v4 가 가져오는 이웃 파일까지 훑는다 |
| `StorageModule.purgeExpired`, `PurgeResult` | 읽기는 아무것도 쓰지 않으므로 기간이 지난 저장은 이 함수가 지운다. 시작 화면이 `expired` 를 보면 부르고 두 사람 결과 화면은 부르지 않는다 |
| 자동 저장이 꺼져 있을 때의 상태 | `writeProgress` 와 `appendHistory` 는 `off` 로 답한다(새 상태). `unavailable` 은 저장소가 막혔거나 쓴 값이 확인되지 않은 경우만이다. 모양 검사(`invalid`)가 먼저다 |
| `readAutosavePreference` | v4 키의 on, off 가 이전 판 키보다 먼저다(이전 판에서 끈 사람도 v4 에서 다시 켤 수 있다) |
| `GatesModule.isSkipHintCount` | 「건너뜀 16개 초과」 규칙이 사는 유일한 자리(`skipHint` 와 `buildResult` 가 함께 쓴다) |
| `compareCouple` 제외 규칙 | 어느 한 사람의 관문이 닫혀 있으면 네 주제가 모두 제외이고, 제외된 주제의 문항은 `talk` 와 `similar` 에 나오지 않는다 |
| `ProgressSegment.current` | 질문 화면은 그 문항의 구간(필터 흐름도), 쉬는 카드는 방금 끝낸 구간, 마지막 정리 카드는 4, 소개와 결과는 없음. `placementOf` 도 같다 |
| `LegacyProgressProbe`, `HistoryRead` | `present` 는 읽을 수 있는 v3.1 진행(30일 안, 미래 아님)에 고른 답이 하나 이상일 때만(시작만 누른 진행, 기간이 지난 값, 깨진 값은 false)이고 `savedAt` 은 그때만 값. `HistoryRead` 의 empty, expired, invalid 정의 |
| `FlowState.partialIds`, `filterOrigin` | 중간 화면 답의 문항별 깃발과 필터를 연 방식. 위 6절과 7절 9항 |
| 은행 주석 | 원본은 생성된 단일 파일 `constants/weddingCodeV40Bank.ts` 이고 주제별 `bank.<주제>.ts` 는 없다 |

액션 `jump`, `finish` 는 계약에 없고 필요하지도 않다(끝내기는 마지막 질문 화면의 `next`, 이어 하기는 `initialFlowState(snapshot)`, 폼 비트 배정은 `start`).
코어 모듈이 계약 밖으로 내는 이름(`QUOTE_LIMITS`, `COUPLE_TALK_MIN_GAP`, `COUPLE_SIMILAR_MIN_ABS`, `COUPLE_LIST_LIMIT`, `V40_FIXTURES`, `V40_FIXTURE_NAMES`, `fixtureByName`, `buildFixtures`, `MAX_SHARE_HASH_LENGTH`, 은행 조회 도우미)은 각 파일의 named export 이고 인터페이스에 넣지 않았다.

## 11. 4.1 단계 1에서 더한 것 (2026-09-30, 계약 문서 §22)

| 항목 | 내용 |
|---|---|
| `ScoreModule.selfLine(bank, responses, axis)` | 내가 마지막에 직접 고른 쪽 줄의 자료. 자기 선택에 답했고 그 주제에 글자가 있고 `axis.contrast` 가 없을 때만 `{ axis, side, letter, level }`, 아니면 null. `buildResult` 의 어떤 필드도 바꾸지 않고 링크 코드에 영향이 없다. 기준 계산기(`scripts/lib/wedding-code-v40-ref.mjs`)에 같은 함수가 있고 `oracle.equivalence.test.ts` 가 대조한다. 기준 계산기의 함수는 `buildResult` 가 낸 주제 결과가 아닌 입력(`axis.contrast` 가 undefined)을 조용히 null 로 돌려주지 않고 던진다 |
| `SelfLine` (`types.ts`) | 위 함수의 반환 모양. 세기 `level` 은 1 조금, 2 꽤, 3 아주 |
| `selfChoiceParts`, `selfChoiceLine`, `selfLevelPhrase`, `V40_COPY.block.selfLineLeadLabel` (`copy.ts`) | 「내가 마지막에 직접 고른 쪽: 「D 나눠 하기」 · 아주 가까워요」. `selfChoiceParts` 는 머리말, 글자와 이름, 세기 낱말의 세 덩어리를 내고 `selfChoiceLine` 은 덩어리를 공백으로 이은 줄 전체다 |
| `AxisBlock` 의 `selfLine`, `ResultScreen` 의 `selfLines` | 뚜렷해요·기울어요 주제는 세기 문장 아래에, 반반이에요 주제는 두 글자의 뜻 아래(세기 문장 「코드에는 한 글자만 …」에서 떨어뜨려)에 작고 흐린 메모 글씨로 그린다. 세 덩어리 중 글자 이름과 세기 낱말은 줄바꿈 없이 붙이고 줄 길이를 고른다. 화면은 대비가 있는 주제와 다른 주제의 줄을 한 번 더 거른다. 주제 순서 네 개로 준다(`quotes` 와 같은 방식). 두 사람 결과와 받는 사람 화면에는 없다 |

## 12. 4.1 단계 2에서 더한 것 (2026-10-01, 계약 문서 §23)

서로 짐작하기(`guess`)와 결과 전 글자 고르기(`letterGuess`)를 어둡게 더했다. 선택 2부(내 답 나란히 놓기)는 이 단계에 없다(후속 PR, 계약 문서 §23.6). **`flow.ts`는 바뀌지 않았고** 엔진 열 개 파일(`flow.ts`, `codec.ts`, `score.ts`, `gates.ts`, `value.ts`, `states.ts`, `layout.ts`, `bank.ts`, `constants/weddingCodeV40Bank.ts`, `scripts/lib/wedding-code-v40-ref.mjs`)이 기준 커밋과 한 글자도 다르지 않다는 것을 소스 가드가 내용 해시로 고정한다. 새 화면 둘은 reducer가 모르는 **단계(stage)**로 클라이언트가 결과 앞뒤에 얹는다.

| 파일(경로는 `apps/web/src/` 아래) | 내용 | 가져오는 것 |
|---|---|---|
| `lib/weddingCode/v40/guess/types.ts`, `guessContract.ts` | 타입(`GuessAnswers`, `GuessedShareParse`, `V40EntryGuess` …), 켬 상수 `V40_PAIR_GUESS_ENABLED`, 장면 수 6, 모듈 인터페이스 `GuessLinkModule` | `../types`(타입만) |
| `lib/weddingCode/v40/guess/guessLink.ts` | 링크 필드 `ga`, `gb`의 코덱(`encodeGuessCode`, `decodeGuessCode`, `guessChecksumChar`, `decodeGuessedShareParams`, `parseGuessedShareHash`, `buildGatedShareUrlWithGuess`, 키 상수 `V40_GUESS_LINK_KEYS`, 세트 글자 `V40_GUESS_SET_IDS`) | 상수, `states`, `codec`, 타입만(문구, 은행, 세트 자료, 화면은 가져오지 않는다) |
| `lib/weddingCode/v40/guess/guessCompare.ts`, `guessPresent.ts`, `guessCopy.ts`, `guessFixtures.ts` | 두 사람 비교(장면별, 자르지 않음, 한쪽만 있으면 `oneSided`), 폼 비트에 따른 카드 위아래, 문구 묶음 `V40_GUESS_COPY`, 시험 표본 | 생성 상수 `constants/weddingCodeV40Guess.ts`와 타입 |
| `components/wedding-code/v40/guess/` | `GuessSetFlow`(세트 화면, `data-screen="pair-guess"`), `GuessEntryCard`(보내는 사람 카드), `CoupleGuessSection`(두 사람 결과의 「짐작과 답」) | 각 폴더의 `index.ts`에서만 가져온다(바렐을 고치지 않는다) |
| `lib/weddingCode/v40/letterGuess/` | 모델(`isSettledAxis`, `isLetterGuessEligible`, `summarizeLetterGuess`, `letterGuessChoices`), 봉투를 만들고 푸는 순수 함수 넷(`letterGuessEnvelope.ts`), 주입받은 포트로 읽고 쓰고 지우는 도우미(`letterGuessStore.ts`), 문구 `V40_LETTER_GUESS_COPY`, 켬 상수 `V40_LETTER_GUESS_ENABLED`, 인터페이스 `LetterGuessModule` | 상수와 `../types`, 결과(`V40Result`)는 읽기만 한다. **저장소 이름도 저장 키도 링크 코덱도 모른다** |
| `components/wedding-code/v40/letterGuess/` | `LetterGuessScreen`(결과 전 화면, `data-screen="letter-guess"`), `LetterGuessLines`(결과 줄), `LetterGuessClosedCard`(두 사람 결과의 기본으로 닫힌 카드) | 같음 |
| `app/wedding-code/WeddingCodeV40Client.stage2.tsx` | 단계 상태를 모은 작은 훅과 순수 판단(단계를 열지, 마지막 질문 단추가 「다음」인지). 통계, 저장소, 링크 코덱을 가져오지 않는다 | |
| `constants/weddingCodeV40Guess.ts` | **생성 파일**(고치지 않는다). 서로 짐작하기 여섯 장면과 화면 글. 원천 `docs/wedding-code/2026-10-01_v41_guess_set.json`을 `scripts/build-wedding-code-v41-guess.mjs`가 검사기(`scripts/wedding-code-v41-guess-lint.mjs`)에 통과시켜 허용한 필드만 내보낸다 | |

- **포트 패턴.** 저장소 이름은 `storage.ts`의 `browserStorage()`(있다면 `browserSessionStorage()`도) 한 곳만 부른다. 새 저장은 `storage.ts`의 **일반 내보내기** `createExtraPort(handle, key, { honorAutosave })`(읽기, 쓰기, 지우기 세 함수를 가진 객체, `storageModule`의 열세 개 함수에는 넣지 않았다)가 만든 포트를 클라이언트가 글자 고르기 도우미에 넘기는 것으로 한다. 글자 고르기 키는 `V40_STORAGE.letterGuessKey`(`hanbang:wedding-code:v4:letter-guess`) 하나이고, 서로 짐작하기는 저장하지 않는다(메모리뿐). `writeAutosavePreference(off)`가 이 키를 함께 지우고 `clearProgress`, `clearHistory`, `purgeExpired`는 건드리지 않는다.
- **링크 `ga`, `gb`.** `#v=v4.0-tendency&a=<70자>[&ga=<8자>][&b=<70자>[&gb=<8자>]]`. `g` 8자 = 세트 글자 + 장면 글자 여섯(3 x 내 고름 + 짐작, 문자 `0`에서 `8`) + 검사 글자(61 법, 위치 가중치 1에서 7). 70자 코드의 뜻, `codec.ts`, `V40_LINK_KEYS`는 그대로이고 `ga`, `gb`는 `guess/guessLink.ts`만 안다. 계약 문서 §8의 8.x와 §23.5가 정본이다.
- **새 모듈 인터페이스 둘.** `GuessLinkModule`(`guess/guessContract.ts`), `LetterGuessModule`(`letterGuess/letterGuessContract.ts`)은 `contract.ts`가 타입으로 다시 내보내고 각 구현 파일 끝에서 `satisfies`로 검사한다.
- **`deps.stages`.** 클라이언트 `deps`에 `stages?: { letterGuess?: boolean; pairGuess?: boolean }`가 있다. 주지 않으면 두 켬 상수(둘 다 켬, 어두운 입구 뒤에서만)를 읽고, 시험 도구(`WeddingCodeV40Client.testKit.tsx`)의 기본은 둘 다 꺼짐이라 기존 클라이언트 시험 다섯 파일이 한 줄도 바뀌지 않는다. `V40_LETTER_GUESS_ENABLED`, `V40_PAIR_GUESS_ENABLED`를 거짓으로 하면 화면만 사라지고 링크 해독은 그대로다.
- **소스 가드(`scripts/tests/wedding-code-v40-source-guards.test.mjs`)의 규칙 11, 13에서 17과 확장.** 새 단계 파일은 통계를 부르지 않고(11), 글자 고르기는 링크 코덱, 짐작 폴더, 입구를 가져오지 않고(13), 새 폴더에는 골든 링크와 개발 메모가 없고(14), 바렐을 가져오지 않고(15), 클라이언트의 통계 호출은 열 개 그대로이고(16), 오류 메시지에 입력 글자가 없다(17). 규칙 5, 8, 10은 `browserSessionStorage`(있을 때), 해시 키 `ga`, `gb`, 짐작 코덱이 링크를 여는 모듈이라는 것으로 넓어졌다. 규칙 12는 선택 2부의 자리라 비어 있다.
- **시험과 증명.** 새 시험 파일마다 `scripts/wedding-code-v41-proof-cases/<트랙>/<시험 파일 이름>.json`이 있고 `node scripts/wedding-code-v41-prove-all.mjs`가 영수증 상태를 보고한다(`--run`으로 직렬로 돈다, `--pr-evidence`는 PR 본문에 싣는 엔진과 정제 파일의 `git diff --stat`을 낸다).
- **사람이 읽은 문구는 한 줄도 없다.** 여섯 장면 중 넷은 비평가 검토도 받지 않았고 승인 낱말 목록은 새 낱말을 얼리지 않았다(계약 문서 §23.11).
