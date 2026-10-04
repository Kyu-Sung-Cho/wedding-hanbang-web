/**
 * 웨딩코드 4.0 모듈 계약: 병렬 빌더가 구현할 함수의 서명과 의미.
 *
 * 이 파일은 타입만 낸다(런타임 코드 없음). 모듈마다 인터페이스 하나가 있고, 구현 파일은 마지막 줄에
 * `... satisfies PresentModule` 처럼 자기 인터페이스를 만족하는지 검사한다(예: present.ts 의 named export 를 객체로 묶어 검사).
 * 정의 절은 설계 문서 spec.md 의 절 번호이고 "부록 E" 용어를 따른다.
 *
 * 공통 규칙
 * - 모든 함수는 순수하다(시계, 난수, 저장소는 인자로 받는다). 부동소수는 판정에 쓰지 않는다(정수 비교).
 * - bank 는 createBank(data) 가 만든 Bank 다. 문항은 bank.items 의 질문 순서(= 코드 순서)로 다룬다.
 * - 저장 상태(ResponseValue)는 폼 비트와 무관하다. 화면 번호를 저장 상태로 바꾸는 곳은 present.toStored 하나뿐이고,
 *   저장 상태를 화면 번호로 바꾸는 곳은 present.fromStored 와 present.viewPosition 두 곳뿐이다.
 * - 채점(scoreResponses)은 폼 비트를 받지 않는다. 폼 비트가 필요한 것은 위치 반복 검사와 화면뿐이다.
 * - 잘못된 저장값(그 형식에 없는 문자, 알 수 없는 문항 id)은 던지지 않고 빠진 값으로 다룬다. 링크와 저장소는 읽을 때 엄격하게 거절한다.
 *
 * 4.1 단계 2(어두운 진입 뒤의 선택 화면): 위 코어 모듈(V40Core)에는 한 줄도 더하지 않았다. 새 모듈 둘의 인터페이스는 각 트랙 폴더가 정의하고 구현 파일 끝에서
 * satisfies 로 검사하며, 이 파일은 아래에서 타입만 다시 내보낸다. 글자 고르기(letterGuess)는 결과를 읽기만 하는 순수 모듈이고 저장은 포트(storage.ts 의 createExtraPort)로 한다.
 * 서로 짐작하기(guess)의 링크 코덱은 codec.ts 를 감싸서 선택 필드 ga, gb 를 더한다. flow.ts 의 reducer 와 Page 는 두 단계를 모른다(클라이언트가 결과 앞뒤에 얹는다).
 */
import type {
  AppendResult,
  AxisQuotes,
  AxisResult,
  Axis,
  Bank,
  BankData,
  BuildPagesOptions,
  CodecBankView,
  CoupleResult,
  DecodedCode,
  FlowAction,
  FlowInit,
  FlowState,
  FormBit,
  Format,
  HistoryEntry,
  HistoryRead,
  Item,
  ItemId,
  ItemView,
  LegacyProgressProbe,
  Page,
  Perspective,
  ProgressRead,
  ProgressSegment,
  ProgressSnapshot,
  ProgressWrite,
  PurgeResult,
  ResponseValue,
  Responses,
  RhythmReport,
  ScoreResult,
  ScoredItem,
  SelfItem,
  SelfLine,
  ShareParse,
  Side,
  StateChar,
  StorageLike,
  V40Placement,
  V40Result,
  ViewAnswer,
} from "./types";

// ===========================================================================
// states.ts: 저장 상태 문자 도우미 (다른 모듈이 함께 쓰는 유일한 변환기)
// ===========================================================================

/**
 * 저장 상태 표는 types.ts 4절과 README 의 표가 기준이다. 이 모듈이 그 표의 색인 계산을 한 곳에 모은다.
 * 알파벳은 V40_STATE_ALPHABET(0-9a-zA-Z 62자), 링크 코드의 특수 문자는 - (skip)와 _ (na)다.
 */
export interface StatesModule {
  /** 알파벳[index]. 0 이상 62 미만의 정수가 아니면 RangeError. */
  stateChar(index: number): StateChar;
  /** 알파벳 색인. 알파벳 밖의 문자(-, _, ., 한글 포함)나 길이가 1이 아닌 문자열은 null. */
  stateIndex(char: string): number | null;
  /** 이 형식에서 쓸 수 있는 상태 문자인가: 알파벳 색인이 0 이상 V40_STATE_COUNTS[format] 미만. */
  isStateFor(format: Format, char: string): boolean;
  /** skip, na, 또는 isStateFor 인 상태 문자이면 true(형식 기준 저장값 검증). */
  isResponseValueFor(format: Format, value: string): value is ResponseValue;
  /**
   * 칸 나누기 상태 색인. a = entries[0] 칸 수, b = entries[1] 칸 수(은행 순서), 나머지 6 - a - b 는 entries[2].
   * s = a x (15 - a) / 2 + b. a, b 가 0 이상 정수이고 a + b <= 6 이 아니면 RangeError. 결과 0에서 27.
   */
  splitStateOf(a: number, b: number): number;
  /** splitStateOf 의 역: 색인 s 에서 [a, b, 6 - a - b]. 0에서 27 밖이면 RangeError. 28개 상태 전수에서 왕복이 맞아야 한다. */
  splitCountsOf(state: number): readonly [number, number, number];
  /** 가장·가장 아닌 것 상태 색인. best 와 worst 는 0에서 3의 서로 다른 은행 카드 색인. s = 3 x best + (worst < best ? worst : worst - 1). 결과 0에서 11. */
  bestWorstStateOf(best: number, worst: number): number;
  /** bestWorstStateOf 의 역. 12개 상태 전수에서 왕복이 맞아야 한다. */
  bestWorstPairOf(state: number): { readonly best: number; readonly worst: number };
  /** 메모리 저장값 -> 링크 코드 문자: skip 은 -, na 는 _, 상태 문자는 그대로. */
  toCodeChar(value: ResponseValue): string;
  /** 링크 코드 문자 -> 메모리 저장값: - 는 skip, _ 는 na, 알파벳 문자는 그대로. 그 밖은 null(형식별 범위 검사는 isResponseValueFor). */
  fromCodeChar(char: string): ResponseValue | null;
  /**
   * 응답 맵에서 문항 하나의 저장값을 읽는 유일한 방법: 맵이 객체가 아니거나, 그 id 가 맵의 자기 소유 키가 아니거나(상속 키 무시), 값이 문자열이 아니면 undefined.
   * score, gates, codec, flow, quote, couple, storage 가 모두 responses[id] 대신 이것을 쓴다. 그래서 상속된 키(constructor 등)와 문자열이 아닌 값은 빠진 답이다.
   */
  responseAt(responses: Responses | null | undefined, id: ItemId): ResponseValue | undefined;
}

// ===========================================================================
// bank.ts: 문항 은행 결합과 검사 (소유: 코어)
// ===========================================================================

export interface BankIssue {
  /** 안정된 규칙 코드(예: layout-mismatch, key-arrangement, text-too-long, dash, digit, banned-word, letter-name). */
  readonly rule: string;
  /** 문제의 문항. 전체 문제이면 null. */
  readonly itemId: ItemId | null;
  readonly message: string;
}

/**
 * 문항 은행 결합과 검사. 원본은 생성된 단일 파일 constants/weddingCodeV40Bank.ts 의 V40_BANK_DATA 하나다(원천은 docs/wedding-code/2026-09-29_v40_items.json 이고
 * 스크립트가 이 TS 파일을 만든다. 주제별 bank.<주제>.ts 파일은 없다). bank.ts 는 그 원본을 layout 의 질문 순서와 대조해 검사하고
 * 조회 구조를 만들어 WEDDING_CODE_V40_BANK 를 낸다. 조회 도우미(itemById, scoredItemById, itemsOfFacet, itemsOfSection, itemsOfScreen, selfItemOfAxis, deriveKey)는
 * bank.ts 의 named export 이고 계약(BankModule)에는 넣지 않았다(Bank 구조가 이미 byId, scoredByAxis, screens 를 갖고 있다).
 *
 * validateBank 가 잡아야 하는 규칙(문서 4절, 5절 방향 균형, 부록 C.1 작성 규칙):
 *  1. 구조: version 이 WEDDING_CODE_V40_VERSION, items 68개, items[i] 가 V40_LAYOUT[i] 와 id, axis, facet, section, screen, fmt, key 가 같음,
 *     pair 와 react 의 kind 가 layout 과 같음. id 중복 없음.
 *  2. 형식별 모양과 키 파생(키는 배치에서 파생되며 key 필드와 같아야 한다):
 *     pair: cards 2장에 front 1, back 1, key = cards[0].pole === front ? 1 : -1.
 *     react: ends.left/right 비어 있지 않음, recap 비어 있지 않음, highPole 과 key 일치, quote 가 있으면 speaker 와 text 둘 다.
 *     recall, instant: options 4개, key 1 이면 (뒤 약, 앞 강, 앞 약, 뒤 강), key -1 이면 (앞 약, 뒤 강, 뒤 약, 앞 강)과 pole, strength 가 모두 같음.
 *     bestworst: cards 4장, key 1 이면 극이 (앞, 뒤, 뒤, 앞), key -1 이면 (뒤, 앞, 앞, 뒤). 카드 text 는 요로 끝나고 마침표가 없음.
 *     split: entries 3개, key 1 이면 (앞, 뒤, 중립), key -1 이면 (뒤, 앞, 중립).
 *     self: cards 2장에 front 1, back 1, key 일치, caption 이 V40_WRAP_UP.title.
 *  3. 균형(축마다): 형식별 key 합이 0(pair, react, recall, instant, bestworst, split 각각), 구간 c 와 c+2 의 같은 (주제, 슬롯) 문항은 키가 반대,
 *     pair 는 위 카드가 앞극인 문항 2 : 뒤극 2. 자기 선택 키 합 0. (layout 이 이미 만족하므로 이 규칙은 은행이 layout 을 따랐는지의 재확인이다.)
 *  4. 글자 수: caption 12자 이하, stem 90자 이하(react 는 stem 과 quote.text 합), 카드, 보기, 항목 text 60자 이하, recap 50자 이하, ends 20자 이하.
 *     두 극의 카드와 보기 길이는 서로 15퍼센트 안(같은 문항 안에서 pair 의 두 카드, split 의 앞극과 뒤극 항목).
 *  5. 금지: 줄표(긴줄표, 짧은줄표), 아라비아 숫자, 퍼센트 기호, 화면 숫자 라벨(1. 2. A. B. 가. 나.), 글자 이름과 축 이름(V40_LETTERS 의 name 여덟 개와
 *     V40_AXES 의 title 이 문항 문구 안에 그대로 들어감), README 의 금지어 목록, 「~인 답」, 시스템 말투, 가치 판단어(현명한, 합리적인, 감성적인, 충동적인,
 *     꼼꼼한, 무난한), 같은 문항 안에서 두 극 text 가 같음.
 *  6. 간접 구성: 축마다 fmt 가 pair(method) + bestworst + instant 인 자기 묘사 문항 6개 이하(레이아웃이 보장), 그 밖은 간접 10개 이상.
 *  이 규칙은 시험(bank.test.ts)에서 실행하고 은행이 바뀔 때마다 통과해야 병합할 수 있다.
 */
export interface BankModule {
  /** 원본을 검사한다. 문제가 없으면 빈 배열. */
  validateBank(data: BankData): readonly BankIssue[];
  /** validateBank 가 문제를 내면 모든 메시지를 담아 Error 를 던진다. 통과하면 조회 구조를 만든다. */
  createBank(data: BankData): Bank;
}

// ===========================================================================
// present.ts: 문항 -> 뷰, 화면 답 <-> 저장 상태, 인용 문구 (소유: 코어)
// ===========================================================================

/**
 * 폼 비트 규칙(문서 3절, 5절): 폼 비트 0 이면 은행에 적힌 순서 그대로, 1 이면 아래를 뒤집는다.
 *   pair, self: 카드 위아래를 바꾼다(6칸의 DOM 순서도 함께 뒤집혀 저장 상태 s 는 5 - s 칸이 된다).
 *   react: 양끝 이름의 자리를 바꾼다(저장 칸 s 는 화면 칸 4 - s).
 *   recall, instant: 보기 네 개의 순서를 뒤집는다(저장 s 는 화면 3 - s).
 *   bestworst: 카드 네 장의 순서를 뒤집는다(저장 색인 i 는 화면 3 - i).
 *   split: 앞 두 항목의 자리만 바꾸고 세 번째는 그대로다(화면 칸 수 (v0, v1, v2) 는 저장 (v1, v0, v2)).
 * 뷰와 화면 답에는 극, 값, 키가 없다. 화면 답의 번호는 모두 화면 기준(폼 비트 반영 뒤)이다.
 */
export interface PresentModule {
  /**
   * 문항 뷰. 캡션, 앞말, 두 넘기기 이름(V40_ESCAPES)을 싣고 형식별로:
   *  pair, self: cards = 화면 [위, 아래] 원문, cells 6칸을 DOM 순서 [위 아주, 위 꽤, 위 조금, 아래 조금, 아래 꽤, 아래 아주]로
   *    (cell 0에서 5, level 3,2,1,1,2,3, 이름은 pairCellAccessibleName(cardIndex, level)).
   *  react: ends 는 화면 기준, groupDescription 은 reactGroupDescription(left, right), cells 5칸 이름은 reactCellAccessibleName.
   *  recall, instant: options = 화면 순서 원문 4개, noneLabel 은 recall 만 V40_ESCAPES.recallNone.
   *  bestworst: cards = 화면 순서 4장, bestLabel/worstLabel/duplicateAnnounce 는 V40_BESTWORST_LABELS.
   *  split: entries = 화면 순서 3항목, total 6.
   * 결과에 pole, strength, key, highPole, recap 은 넣지 않는다.
   */
  present(item: Item, formBit: FormBit): ItemView;
  /**
   * 화면 답 -> 저장값. escape 는 unsure 이면 skip, na 이면 na. 형식이 다르거나 중간 상태(isViewAnswerComplete 가 false)이거나 범위 밖이면 null.
   * 그 밖에는 화면 번호를 폼 비트로 되돌려 저장 색인을 만들고 stateChar 로 바꾼다.
   */
  toStored(item: Item, formBit: FormBit, answer: ViewAnswer): ResponseValue | null;
  /** 저장값 -> 화면 답(toStored 의 역). skip 은 unsure, na 는 na escape. 그 형식에 없는 문자이면 null. 상태 전수에서 왕복이 맞아야 한다. */
  fromStored(item: Item, formBit: FormBit, value: ResponseValue): ViewAnswer | null;
  /** 화면 답이 저장 상태로 바꿀 수 있게 완성됐는가: escape 와 단일 선택은 범위 안이면 true, bestworst 는 best 와 worst 가 서로 다른 0에서 3, split 은 세 칸 수가 0 이상 정수이고 합 6. */
  isViewAnswerComplete(item: Item, answer: ViewAnswer): boolean;
  /**
   * 위치 반복 검사용 화면 위치. pair 는 고른 카드가 화면에서 위(0)인지 아래(1)인지(세기는 무시),
   * react 는 화면 칸 0에서 4, recall 과 instant 는 화면 보기 0에서 3. 그 밖의 형식, skip, na, 잘못된 값은 null.
   */
  viewPosition(item: Item, formBit: FormBit, value: ResponseValue): number | null;
  /**
   * 결과 인용 원문(캡션 없음). skip, na 는 null. 형식별 규칙:
   *  pair: 고른 카드 원문. 세기가 아주(level 3)이면 뒤에 " (아주 가까워요)"를 붙인다.
   *  react: `${recap} ${고른 쪽 끝 이름}`. 값의 부호가 뒤집힌 왼쪽 칸(0, 1)은 ends.left, 오른쪽 칸(3, 4)은 ends.right.
   *    바깥 칸(0, 4)이 아닌 안쪽 칸(1, 3)이면 뒤에 " (조금 가까워요)"를 붙인다. 가운데 칸(값 0)은 인용하지 않으므로 null.
   *  recall, instant: 고른 보기 원문.
   *  bestworst: `가장 나 같은 것으로 「${가장 나 같은 것 카드 원문}」를 골랐어요` (조사는 항상 를: 카드 원문이 요로 끝난다는 은행 규칙).
   *  split: 값이 0 이 아닐 때, 값이 양수이면 front 항목, 음수이면 back 항목을 골라 `6칸 중 ${칸 수}칸을 「${항목 원문}」에 놓았어요`(여섯 칸 모두이면 `여섯 칸을 모두 「${항목 원문}」에 놓았어요`). 값 0 이면 null.
   *  self: null (자기 선택은 인용하지 않는다).
   * 해석을 덧붙이지 않는다. 성격 명사와 유형 이름은 붙이지 않는다.
   */
  answerText(item: Item, value: ResponseValue): string | null;
  /** answerText 앞에 `${caption}: `을 붙인 문장. answerText 가 null 이면 null. */
  answerLabel(item: Item, value: ResponseValue): string | null;
}

// ===========================================================================
// value.ts: 문항 값 (소유: 코어)
// ===========================================================================

export interface ValueModule {
  /**
   * 채점 문항의 정수 값(-6에서 +6, 양수는 앞극). skip, na, 없음, 그 형식에 없는 문자는 null(빠진 값이며 0 으로 세지 않는다).
   *  pair: 상태 s(0에서 5) -> 카드 = s < 3 ? cards[0] : cards[1], 세기 = s < 3 ? 3 - s : s - 2, 값 = 2 x 세기 x (front 이면 +1, back 이면 -1).
   *  react: (s - 2) x 3 x (highPole 이 front 이면 +1, back 이면 -1). 가운데 칸은 0.
   *  recall, instant: options[s] 의 극과 세기. front strong +6, front weak +2, back weak -2, back strong -6.
   *  bestworst: (best, worst) = bestWorstPairOf(s). 값 = (cards[best] 가 front 이면 +4, back 이면 -4) + (cards[worst] 가 front 이면 -2, back 이면 +2).
   *  split: (a, b, c) = splitCountsOf(s). 값 = (front 항목 칸 수) - (back 항목 칸 수). 중립 칸은 값에 넣지 않는다.
   */
  itemValue(item: ScoredItem, value: ResponseValue | undefined): number | null;
  /** 자기 선택의 고른 방향과 세기(1 조금, 2 꽤, 3 아주). skip, na, 없음, 잘못된 문자는 null. */
  selfChoice(item: SelfItem, value: ResponseValue | undefined): { readonly side: Side; readonly level: 1 | 2 | 3 } | null;
}

// ===========================================================================
// score.ts: 축 집계와 결과 (소유: 코어)
// ===========================================================================

export interface ScoreModule {
  /**
   * 폼 비트와 무관한 축 집계(문서 5절 축 합, 글자, 동점, 세기). 축마다:
   *  1. 채점 문항 16개의 itemValue. 값이 있는 것이 유효 답(answered), skip 은 skipped, na 는 notApplicable로 센다.
   *  2. 측면(4개)마다 유효 답 수 n_f 와 합 s_f. 답이 2개 이상이면 세는 측면(counted). 세는 측면 수가 m.
   *  3. unusable = m < 3 또는 answered < 12. unusable 이면 weighted, s, side, letter, tieLevel, band 는 모두 null(글자는 가운뎃점으로 적는다).
   *  4. weighted N = 세는 측면마다 s_f x (12 / n_f)의 합(정수). s = N / (72 x m)는 판정에 쓰지 않는다(화면과 시험용).
   *  5. N > 0 이면 front, N < 0 이면 back, tieLevel 0. N = 0 이면 동점 사슬로 tieLevel 1에서 5:
   *       1: 고르기(recall + instant) 유효 답 값 합의 부호   2: 이럴 때(react) 유효 답 값 합의 부호
   *       3: 세는 측면의 합 s_f 부호 다수결(합 0 측면은 뺌; 양 대 음 개수가 같으면 결정 못 함)
   *       4: 그 주제 자기 선택의 방향(답했을 때)   5: 그래도 같으면 front 를 적고 provisional true.
   *  6. band: tieLevel 이 1 이상이면 even. 아니면 |N| >= 36 x m 이면 clear, |N| >= 18 x m 이면 lean, 그 밖 even (정수 비교, N = 18m, 36m 와 양옆에서 경계 시험).
   */
  scoreResponses(bank: Bank, responses: Responses): ScoreResult;
  /**
   * 화면이 읽는 전체 결과. scoreResponses + 위치 반복 검사 + 건너뜀 힌트 + 관문 + 자기 선택 대비 + 품질 안내.
   *  힌트: rhythm.flaggedCount >= 2 또는 건너뜀 초과이면 모든 자리의 shownBand 를 demoteBand 로 한 단계만 낮춘다(둘 다여도 한 단계).
   *  관문: rhythm.flaggedCount === 3 이면 gate.closed(reason rhythm), 확정 글자(unusable 도 provisional 도 아닌 주제)가 하나도 없으면 closed(reason noInformation). 닫히면 code null.
   *  code: 네 글자, 글자를 못 정한 주제는 V40_UNSET_LETTER_MARK, 임시 글자는 글자 그대로.
   *  contrast: 자기 선택이 답해졌고 그 방향이 글자 방향과 다르며 shownBand 가 clear 또는 lean 이고 자기 선택 세기가 2 이상일 때만.
   *  notes.hasOmitted: 채점 문항 중 skip 또는 na 가 하나라도 있음.
   */
  buildResult(bank: Bank, formBit: FormBit, responses: Responses): V40Result;
  /**
   * 마지막 정리에서 고른 쪽 줄(4.1 단계 1, 결과 화면 주제 블록). 자기 선택에 답했고(skip, na, 빠진 답은 null) 그 주제에 글자가 있고(못 정한 주제는 null)
   * 직접 고른 쪽 대비(axis.contrast)가 그 주제에 없을 때만 {axis, side, letter, level}. side 와 level 은 자기 선택에서 본인이 고른 방향과 세기(1 조금, 2 꽤, 3 아주)이고
   * letter 는 그 방향의 글자다. 모은 답과 견주지 않고 세기, 힌트, 관문을 읽지 않으며 결과의 어떤 필드도 바꾸지 않는다.
   */
  selfLine(bank: Bank, responses: Responses, axis: AxisResult): SelfLine | null;
}

// ===========================================================================
// gates.ts: 위치 반복 검사와 건너뜀 힌트 (소유: 코어)
// ===========================================================================

export interface GatesModule {
  /**
   * 위치 반복 검사(문서 5절 주의 검사 1). 세 묶음(pair, react, choose = recall 과 instant 를 질문 순서로 합침) 각각:
   * 질문 순서대로 유효 답(skip, na 는 건너뛰고 나머지 순서)의 viewPosition 열을 만든다. 답이 12개 이상일 때만 검사한다.
   * 주기 p = 1에서 4 각각에서 위치 묶음(i mod p)별 최다 값 수의 합을 구해 최댓값 agree 를 고르고(period 는 가장 작은 최적 p),
   * agree x 16 >= considered x 임계 이면 flagged. 임계: pair 15, react 14, choose 14 (부동소수 없이 정수 비교).
   * 12개 미만이면 considered 만 채우고 period null, agree 0, flagged false.
   */
  rhythmReport(bank: Bank, formBit: FormBit, responses: Responses): RhythmReport;
  /** 채점 문항 중 skip(잘 모르겠어요) 개수. na 는 세지 않는다. */
  skippedCount(bank: Bank, responses: Responses): number;
  /** skippedCount > V40_COUNTS.skipHintOver(16) 이면 true. */
  skipHint(bank: Bank, responses: Responses): boolean;
  /**
   * 건너뜀 개수가 힌트를 켜는가(count > V40_COUNTS.skipHintOver). 「건너뜀 16개 초과」 규칙이 사는 유일한 자리라서 skipHint 와 score.buildResult 가 모두 이것을 쓴다
   * (두 곳이 따로 어긋나지 않게).
   */
  isSkipHintCount(count: number): boolean;
}

// ===========================================================================
// codec.ts: 링크 코드 (소유: 코어)
// ===========================================================================

/**
 * 링크 코드 v4.0-tendency, 길이는 언제나 70자:
 *   [0]      폼 비트 문자 "0" 또는 "1"
 *   [1..64]  채점 문항 64개(질문 순서)      [65..68] 자기 선택 4개(돈, 준비, 정하는 사람, 지쳤을 때)
 *   [69]     체크섬 문자
 * 문항 문자는 형식별 상태 문자, - (skip), _ (na) 중 하나(형식별 표는 types.ts 4절). 폼 비트로 뒤집지 않은 저장값 그대로다.
 *
 * 체크섬: 앞 69자를 body 라 하면 값 v(c) = 알파벳 색인(문자가 0-9a-zA-Z 일 때), "-" 는 59, "_" 는 60.
 *   T = (i = 0에서 68에 대해) 합 ((i mod 60) + 1) x v(body[i]),  체크섬 문자 = 알파벳[T mod 61].
 * 61 이 소수이고 가중치 1에서 60 이 61 로 나누어떨어지지 않으며, 한 위치에서 쓸 수 있는 문자(상태 색인 0에서 27, 59, 60)의 값이 61 로 나눈
 * 나머지가 모두 달라서 "문자 한 개를 다른 유효 문자로 바꾸면" 항상 체크섬이 달라진다(전수 시험: 70자 x 위치별 유효 문자 전수).
 * 위치별로 쓸 수 없는 문자로 바꾸거나 길이가 다르면 형식 검사에서 거절한다.
 *
 * decode 는 하나라도 어긋나면 null 이다(길이, 알파벳 밖 문자, 위치별 범위, 폼 비트 문자, 체크섬, 상태 문자가 하나도 없는 코드).
 * 한 사람 답만 살리거나 기본값을 채우지 않는다.
 *
 * 체크섬은 오타를 잡는 장치이지 위조를 막는 장치가 아니다(계산법이 공개돼 누구나 맞는 코드를 만들 수 있다). 한 글자 바꾸기와 이웃한 두 글자 맞바꾸기는 모두 잡지만
 * 가중치가 60가지뿐이라 60칸 떨어진 두 자리(0에서 8번과 60에서 68번)의 맞바꾸기는 잡지 못한다(알려진 한계: 고치려면 검사 문자를 늘려야 하고 판을 올리는 변경이다).
 *
 * 은행 인자의 모양: encodeCode, decodeCode, decodeShareParams, parseShareHash 는 질문 순서의 문항 id 와 형식만 읽으므로 CodecBankView(Bank 도 배치 골격 V40_LAYOUT 도 만족한다)를 받는다.
 * 그래서 입구(entry.ts)는 문항 문구가 든 은행을 가져오지 않고 배치 골격만으로 받은 링크를 푼다(형변환 없이). 채점이 필요한 buildGatedShareUrl 만 온전한 Bank 를 받는다.
 *
 * 링크를 만드는 길은 buildGatedShareUrl 하나다. 조립만 하는 buildShareUrl 은 공개하지 않는다(관문이 닫힌 응답에 링크가 나가는 길을 두지 않기 위해서다).
 * 받는 쪽은 관대하게 풀되(decode) 두 사람 보기(couple)가 관문이 닫힌 쪽의 문항을 목록에 올리지 않는다.
 *
 * origin 규칙: 끝의 / 를 모두 뗀 뒤 빈 문자열(같은 사이트 상대 주소) 또는 `http(s)://호스트[:포트]` 한 덩어리만 쓴다. 문자열이 아니거나, 다른 스킴(javascript: 등),
 * 프로토콜 상대(//host), 경로, 질문, 조각, 공백, 사용자 정보(@), 역슬래시가 들었거나 255자를 넘으면 쓸 수 없는 값이다. 쓸 수 없는 값이면
 * buildGatedShareUrl 은 null, buildQuestionOnlyUrl 은 던지지 않고 같은 사이트 상대 주소(`/wedding-code...`)로 낸다(엉뚱한 호스트로 가는 링크를 만들지 않는다).
 */
export interface CodecModule {
  /**
   * 68개 문항이 모두 유효 저장값(형식에 맞는 상태 문자, skip, na)이고 상태 문자가 하나 이상이면 70자 코드, 아니면 null.
   * (답하지 않은 문항이 있거나 전부 skip/na 이면 null. 관문 여부는 여기서 보지 않는다: 링크는 buildGatedShareUrl, 코드 복사는 canShare 로 본다.)
   */
  encodeCode(bank: CodecBankView, formBit: FormBit, responses: Responses): string | null;
  /** 70자 코드 -> DecodedCode. 68개 문항이 모두 채워진 responses. 어긋나면 null. 입력이 문자열이 아니어도 던지지 않는다. */
  decodeCode(bank: CodecBankView, code: string | null | undefined): DecodedCode | null;
  /** body(69자) 의 체크섬 문자. body 에 알파벳, -, _ 밖의 문자가 있으면 RangeError. */
  checksumChar(body: string): string;
  /**
   * 보내기 링크(유일한 링크 만들기): `${origin}/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=${a}` 이고 second 가 있으면 `&b=${b}` (해시의 키 순서 v, a, b). origin 은 위 규칙을 따른다.
   * 쿼리의 `?v=` 는 서버가 처음부터 v4 화면을 그리게 하려는 것이다(주소의 # 뒤는 서버가 보지 못한다). options.explicitVersion 이 false(기본 진입을 v4 로 교체한 뒤)이면 쿼리가 빠진다. 옛 링크(쿼리 없음)도 그대로 열린다.
   * first 나 second 로 만든 결과(buildResult)의 관문이 닫혀 있으면(위치 반복 세 형식, 확정 글자 없음) null 이다(canShare 가 false 인 사람은 코드도 링크도 없다).
   * 하나라도 encode 가 null 이거나 origin 을 쓸 수 없으면 null. 링크에 글자, 세기, 결과를 싣지 않는다.
   */
  buildGatedShareUrl(bank: Bank, origin: string, first: DecodedCode, second?: DecodedCode, options?: { readonly explicitVersion?: boolean }): string | null;
  /**
   * 질문만 보내기 링크(답 없음). explicitVersion 이 true 이면 `${origin}/wedding-code?v=v4.0-tendency`(기본 진입이 아직 v3.1 인 동안),
   * false 이면 `${origin}/wedding-code`(기본 진입을 v4 로 교체한 뒤). 기본 true. 쓸 수 없는 origin 은 위 규칙대로 상대 주소가 된다.
   */
  buildQuestionOnlyUrl(origin: string, options?: { readonly explicitVersion?: boolean }): string;
  /**
   * 해시의 a, b 값 -> ShareParse. a 와 b 가 모두 null 이면 none. a 가 null 인데 b 가 있으면 invalid.
   * 하나라도 decodeCode 가 null 이면 invalid. a 만 있으면 partner, 둘 다 있으면 both(first = a, second = b).
   */
  decodeShareParams(bank: CodecBankView, a: string | null, b: string | null): ShareParse;
  /**
   * 주소의 해시 전체(앞의 # 는 있어도 없어도 된다)를 읽는다. 키는 v, a, b 만 각각 한 번씩 허용하고 v 는 판 태그(v4.0-tendency)여야 한다.
   * 해시가 없거나 비어 있으면 none. 그 밖의 어긋남(모르는 키, 중복 키, 빈 부분, 판 태그 없음 또는 다름, 퍼센트 인코딩, 문자열이 아닌 입력, 길이 512자 초과)은 invalid.
   * 나머지는 decodeShareParams 와 같다. 어떤 입력에도 던지지 않는다.
   */
  parseShareHash(bank: CodecBankView, hash: string | null | undefined): ShareParse;
  /** 코드 복사, 링크 보내기가 열려도 되는가: result.code !== null. */
  canShare(result: V40Result): boolean;
}

// ===========================================================================
// flow.ts: 화면 묶음과 순수 reducer (소유: 코어)
// ===========================================================================

/**
 * buildPages 의 전체 흐름(only 없음) 순서:
 *   intro, [구간 0 질문 화면 10개], rest(after 0), [구간 1 x 10], rest(after 1), [구간 2 x 10], rest(after 2), [구간 3 x 10],
 *   selfIntro, [자기 선택 화면 2개], result   (pack screen 이면 모두 48쪽, single 이면 질문 쪽이 채점 64 + 자기 선택 4 = 68쪽으로 늘어 총 74쪽).
 * 구간 앞에 따로 이름 카드는 두지 않는다(구간 이름은 진행 막대와 쉬는 카드에만 나온다).
 * 형식 안내(guides): 전체 흐름 순서에서 그 안내 키(pair, react, choose, bestworst, split)가 처음 나오는 질문 화면에만 넣는다.
 * pack single 이면 그 형식이 처음 나오는 문항의 쪽에 넣는다. elderHint: 주제 scope 의 문항이 처음 나오는 질문 화면.
 * only 가 있으면 질문 화면만, guides 는 비고 elderHint 는 false 다. 화면 묶음은 원래 화면(같은 screen)을 따르고 pack single 이면 하나씩.
 *
 * reducer 규칙(createFlowReducer(bank)):
 *  - start: 시작 전(started false)에만. formBit 을 정하고 started true, 첫 질문 화면(pageIndex 1)으로. 이미 시작했으면 상태를 그대로 돌려준다.
 *  - answer: 지금 화면에 있는 문항이고 형식이 맞을 때만(escape 는 모든 형식에서). escape 는 responses 에 skip 또는 na.
 *      완성된 답은 responses 에 toStored 결과, drafts 에 그 화면 답. 중간 상태(bestworst 하나만 고름, split 합 6 미만)는 drafts 와 partialIds 에만 두고
 *      responses 는 건드리지 않는다: 그 문항에 이미 완성해 둔 저장값이 있으면 그대로 남고(한 번 완성한 답은 한 번 눌러 중간 상태로 바꿨다고 사라지지 않는다), 없으면 계속 비어 있다.
 *      notice 를 지운다.
 *  - next: 질문 화면에서는 화면의 문항이 모두 responses 에 있고 그 화면 답이 중간 상태(partialIds)가 아니어야 넘어간다(아니면 notice incomplete 에
 *      저장값이 없거나 중간 상태인 id, 위치 그대로). 넘어갈 때 drafts 와 partialIds 를 비운다. rest, selfIntro 는 무조건 다음 쪽.
 *      마지막 질문 화면 다음이 result 이고 filter 가 없을 때: skippedReviewIds 가 비어 있지 않고 skippedReviewDone 이 false 이면 필터 skipped
 *      (filterOrigin advance)로 그 문항만 한 번 다시 보여 주고(skippedReviewDone true, notice skippedReview), 아니면 result 로.
 *      필터 흐름의 마지막 쪽에서 next 는 필터를 닫고 result 로 간다. intro, result 에서 next 는 무시.
 *  - back: 전체 흐름에서는 pageIndex - 1 (첫 질문 화면에서는 무시: 소개로 되돌아가지 않는다. result 에서는 마지막 질문 화면으로). 쪽을 벗어나므로 그 쪽의 drafts 와 partialIds 는 비운다
 *      (중간 상태는 버리고 저장값은 그대로). 필터 흐름 첫 쪽에서는 filterOrigin 이 open(사람이 결과에서 연 필터)이면 필터를 닫고 result 로,
 *      advance(결과 앞에서 저절로 열린 넘어간 질문 다시 보기)이면 전체 흐름의 마지막 질문 화면으로 돌아간다(이미 봤으므로 skippedReviewDone 은 true 로 남는다).
 *  - openFilter: 시작한 뒤에만. axis 는 그 주제 채점 문항 16개를 질문 순서로, skipped 는 주어진 id 를 필터 pages(질문 화면만)로 열고 pageIndex 0. filterOrigin open.
 *  - closeFilter: 전체 흐름의 result 쪽으로 돌아가고 필터와 drafts, partialIds 를 비운다. 68개가 모두 저장값을 갖지 않으면 첫 미답 질문 화면으로 간다.
 *  - repack: pack 을 바꿔 pages 를 다시 만들고 지금 쪽의 첫 문항이 든 쪽으로 이어진다(질문 화면이 아니면 같은 key 의 쪽, 없으면 가장 가까운 쪽).
 *  - dismissNotice, restart(답, formBit, 필터 초기화하고 소개로; pack 은 유지).
 *  - 결과는 항상 responses 에서 다시 계산한다(reducer 는 결과를 저장하지 않는다). 그래서 모든 문항에 완성된 저장값이 있으면 언제든(필터 흐름과 중간 상태 뒤에도) 결과에 이를 수 있다.
 */
export interface FlowModule {
  buildPages(bank: Bank, options?: BuildPagesOptions): readonly Page[];
  /** 소개 쪽에서 시작(started false)하거나 snapshot 이 있으면 이어 하기: started true, screen result 이면 result 쪽, questions 이면 cursor 문항이 든 쪽. */
  initialFlowState(bank: Bank, init?: FlowInit): FlowState;
  createFlowReducer(bank: Bank): (state: FlowState, action: FlowAction) => FlowState;
  /** 지금 화면에 보일 답: drafts 의 화면 답(중간 상태 포함)이 있으면 그것, 없으면 responses 를 fromStored 로. 답이 없으면 null. */
  viewAnswerOf(bank: Bank, state: FlowState, itemId: ItemId): ViewAnswer | null;
  /** 68개 문항이 모두 responses 에 있는가(상태 문자, skip, na 중 하나). */
  allResolved(bank: Bank, responses: Responses): boolean;
  /**
   * 결과 전에 한 번 다시 보여 줄 문항 id. 유효 답이 12개 미만인 주제가 있고 그 주제에 skip(잘 모르겠어요)인 채점 문항이 있으면
   * 그 skip 문항(na 는 제외)을 질문 순서로. 없으면 빈 배열.
   */
  skippedReviewIds(bank: Bank, responses: Responses): readonly ItemId[];
  /**
   * 진행 막대 5칸: 구간 0에서 3은 문항 16개, 마지막 정리는 4개. done = 저장값이 있는 문항 수.
   * current 는 지금 쪽이 속한 칸이다: 질문 화면은 그 문항의 구간(필터 흐름에서도 지금 열린 문항의 구간), 쉬는 카드는 방금 끝낸 구간, 마지막 정리 카드는 4.
   * 시작 전의 소개 쪽과 결과 쪽은 어느 칸도 아니다(모두 false). placementOf 도 같은 규칙이다(쉬는 카드 after 0 은 c1, 마지막 정리 카드는 self).
   */
  progressSegments(bank: Bank, state: FlowState): readonly ProgressSegment[];
  /** 진행 저장용 스냅샷. 시작 전이면 null. cursor 는 지금 쪽(rest, selfIntro 이면 다음 질문 화면)의 첫 문항 코드 색인. 필터 흐름이면 result 또는 첫 미답 쪽 기준. */
  snapshotOf(bank: Bank, state: FlowState): ProgressSnapshot | null;
  /** 이용 통계 placement: 소개 intro, 구간 0에서 3은 c1에서 c4, 자기 선택 self, 결과 result, 필터 흐름 edit. */
  placementOf(state: FlowState): V40Placement;
}

// ===========================================================================
// quote.ts: 내가 고른 답 (소유: 코어)
// ===========================================================================

export interface QuoteModule {
  /**
   * 한 주제의 인용(문서 7절 내가 고른 답 뽑는 규칙). 후보는 그 주제 채점 문항 중 값이 0 이 아닌 유효 답이고 answerText 가 null 이 아닌 것.
   * 정렬: |값| 큰 순, 같으면 질문 순서. 뽑기: 앞에서부터 이미 뽑은 것과 측면이 같거나 형식(fmt 값 여섯 가지 그대로)이 같으면 건너뛴다(부족하면 부족한 대로).
   *  settled(shownBand 가 clear 또는 lean): own = 부호가 글자 방향과 같은 후보 최대 3개, opposite = 부호가 반대이고 |값| >= 3 인 후보 최대 2개.
   *  even(shownBand 가 even, 임시 글자 포함): front = 값이 양수인 후보 최대 2개, back = 값이 음수인 후보 최대 2개(|값| 조건 없음).
   *  none(글자를 못 정한 주제, shownBand null).
   * skip, na 문항은 뽑지 않는다. 해석을 덧붙이지 않는다.
   */
  pickQuotes(bank: Bank, responses: Responses, axis: AxisResult): AxisQuotes;
}

// ===========================================================================
// couple.ts: 두 사람 보기 (소유: 코어)
// ===========================================================================

export interface CoupleModule {
  /**
   * 두 사람 비교(문서 7절). 각자 buildResult 를 하고 주제마다:
   *  same: 둘 다 shownBand 가 clear 또는 lean 이고 임시 글자가 아니며 글자가 같음. different: 같은 조건에서 글자가 다름. even: 그 밖.
   *  excluded: 어느 쪽이든 글자를 못 정했거나 임시 글자이면 그 주제(tag 는 even). 어느 한 사람이라도 관문이 닫혀 있으면(코드도 링크도 없는 사람) 네 주제가 모두 excluded 다.
   *    같은 글자 개수와 총합은 세지 않고 두 코드를 하나의 수치로 합치지 않는다.
   * 문항 단위: 두 사람이 모두 값이 있는 채점 문항(둘 다 유효 답)이면서 그 주제가 excluded 가 아닌 것. excluded 주제의 문항은 talk 와 similar 에 나오지 않는다
   *   (그 자리는 비교에서 뺀다: 설계 7절). 그래서 관문이 닫힌 사람이 끼면 두 목록이 모두 빈다(모든 줄이 excluded 로 나오므로 화면이 알 수 있다).
   *  talk: 값의 부호가 반대(둘 다 0 이 아님)이고 |a - b| >= 8. 차이가 큰 순(같으면 질문 순서), 주제마다 하나씩 먼저 뽑고 남는 자리를 채워 최대 3개, 최종 목록은 차이 큰 순.
   *  similar: 값의 부호가 같고 두 사람 모두 |값| >= 4. 두 값 중 작은 절댓값이 큰 순(같으면 질문 순서), 주제마다 하나씩 먼저 뽑고 남는 자리를 채워 최대 3개.
   * firstText, secondText 는 answerText(캡션 없음). 두 사람의 폼 비트는 달라도 된다(값은 저장 상태에서 나온다).
   */
  compareCouple(bank: Bank, first: DecodedCode, second: DecodedCode): CoupleResult;
  /**
   * 나 기준 전환의 자동 선택. 이 브라우저에 저장된 본인 답(savedOwn)을 encodeCode 한 코드가 first 의 코드와 같으면 first, second 와 같으면 second,
   * 둘 다 아니거나 savedOwn 이 null 이면 null(화면이 먼저 답한 사람 / 나중에 답한 사람 선택을 보여 준다).
   * savedOwn 은 두 사람 결과 화면이 readProgress 로 한 번 읽은 값이다(그 화면이 저장소를 만지는 유일한 일이고 읽기뿐이다).
   */
  detectPerspective(bank: Bank, savedOwn: DecodedCode | null, first: DecodedCode, second: DecodedCode): Perspective | null;
}

// ===========================================================================
// storage.ts: 이 브라우저 저장 (소유: 코어)
// ===========================================================================

/**
 * 규칙(v3.1 진행 저장을 복사해 v4 용으로 새로 만든다. v3.1 모듈은 가져오지 않는다):
 *  - 저장은 브라우저(localStorage)마다 따로다. 다른 브라우저나 다른 기기에는 없다. 화면 글은 「이 브라우저」라고 쓴다.
 *  - 브라우저 저장소의 이름(window.localStorage)은 v3.1 과 함께 쓰는 lib/weddingCode/browserStorageHandle.ts 의 realLocalStorage() 한 곳에만 있고, 이 파일의 browserStorage() 가 그 결과를 돌려준다. 나머지 파일은 그 핸들을 이 파일의 함수에 넘기기만 하고,
 *    핸들에 getItem, setItem, removeItem 을 직접 부르거나 저장 키(V40_STORAGE 의 …Key)를 읽지 않는다(소스 가드 규칙 5).
 *  - 키는 V40_STORAGE. 기간은 30일: now - savedAt >= ttlMs 이면 expired, savedAt 이 지금보다 하루를 넘는 미래이거나 안전한 정수가 아니면 invalid(기기 시계가 저장 뒤에 하루 안으로 뒤로 간 것은 멀쩡한 저장으로 읽는다). 읽기만으로 기간을 늘리지 않는다.
 *  - 읽기(readProgress, readHistory, probeLegacyV31Progress)는 저장소에 아무것도 쓰지 않는다. expired 와 invalid 도 지우지 않는다(두 사람 결과 화면이 「나」 표시에
 *    쓰려고 readProgress 를 부르기 때문이다). 기간이 지난 저장을 실제로 지우는 일은 purgeExpired 가 맡는다(시작 화면이 expired 를 보면 부르고, 두 사람 결과 화면은 부르지 않는다).
 *  - 봉투 JSON 은 ProgressEnvelope 의 여덟 키가 모두 있고 다른 키는 없어야 한다(아니면 invalid). 길이 maxEnvelopeLength 이하. version 이 v4.0-tendency.
 *  - answers 는 68자, 위치마다 그 형식의 상태 문자, -, _, . 중 하나. screen result 이면 . 이 없어야 하고 cursor 0. cursor 는 0에서 67의 정수.
 *  - 쓰기: 자동 저장이 꺼져 있으면 아무것도 쓰지 않고 off(모양 검사가 먼저라 잘못된 입력은 invalid). 지금 저장된 원문이 expectedRaw 와 다르면 conflict
 *    (다른 탭이 쓴 것을 지우지 않으려는 최선 노력의 비교다: 확인과 쓰기 사이는 브라우저 저장소로는 막을 수 없다). 쓴 뒤 다시 읽어 같은지 확인하고 다르면
 *    unavailable (저장 안 됐는데 저장됐다고 말하지 않는다).
 *  - 받은 링크(상대 답)와 두 사람 결과 화면의 답은 저장하지 않는다(호출자 책임: 본인 답만 넘긴다).
 *  - 저장소 접근이 던지면 unavailable. 모든 함수는 던지지 않는다.
 *  - 결과 객체의 raw 는 답 전체를 담고 있으니 다음 쓰기의 expectedRaw 로만 쓰고 기록이나 통계로 보내지 않는다.
 */
export interface StorageModule {
  /** 이 브라우저의 저장소 핸들. 서버 렌더링(window 없음)이거나 접근이 막히면(개인정보 보호 모드, 앱 안 브라우저) null. 던지지 않는다. */
  browserStorage(): StorageLike | null;
  /** 진행 저장 읽기. 상태 empty(없음), invalid(형식 위반), expired(30일 지남), unavailable(접근 실패), ready. */
  readProgress(storage: StorageLike, bank: Bank, now?: number): ProgressRead;
  /** 진행 저장 쓰기. 결과 상태 saved, conflict(다른 탭이 바꿈), unavailable(막힘 또는 확인 안 됨), invalid(모양 틀림), off(자동 저장이 꺼져 있어 쓰지 않음). */
  writeProgress(storage: StorageLike, bank: Bank, snapshot: ProgressSnapshot, expectedRaw: string | null, now?: number): ProgressWrite;
  /** 진행 저장 지우기. */
  clearProgress(storage: StorageLike): { readonly status: "cleared" | "unavailable" };
  /** 진행 저장용 68자 표기(. = 아직 답하지 않음). 상태 문자가 형식에 맞지 않으면 null. 링크 코드와 섞지 않는다(체크섬, 폼 비트 없음). */
  encodeProgressAnswers(bank: Bank, responses: Responses): string | null;
  decodeProgressAnswers(bank: Bank, answers: string): Responses | null;
  /** 지난번과 비교 기록 읽기. 30일 지난 건(now - at >= ttlMs)은 뺀다. 최신이 앞. 상태의 뜻은 HistoryRead 에 있다. */
  readHistory(storage: StorageLike, now?: number): HistoryRead;
  /**
   * 기록 한 건 추가(최신이 앞, 최대 historyMax 건, 넘치면 가장 오래된 것부터 버림). 결과의 글자와 세기, 시각, 폼 비트만 저장하고 답은 저장하지 않는다.
   * 자동 저장이 꺼져 있으면 쓰지 않고 off. 결과 화면에 들어설 때 한 번만 부른다(이어 하기로 결과 화면을 다시 열거나 다시 그릴 때는 부르지 않는다).
   */
  appendHistory(storage: StorageLike, entry: HistoryEntry, now?: number): AppendResult;
  clearHistory(storage: StorageLike): { readonly status: "cleared" | "unavailable" };
  /**
   * 기간이 지난 저장을 저장소에서 실제로 지운다. 진행 저장은 expired 로 읽힐 때만(형식이 깨진 값은 건드리지 않는다), 비교 기록은 기간이 지난 건을 덜어 낸다.
   * 확인한 원문이 그 사이 바뀌었으면(다른 탭이 새로 씀) 그 값은 건드리지 않는다. 지우는 일은 자동 저장 선호와 무관하다. 던지지 않는다.
   * 시작 화면이 진행 저장을 읽어 expired 를 보면 부른 뒤에 「이전 답은 지워졌어요」를 보여 준다. 두 사람 결과 화면에서는 부르지 않는다.
   */
  purgeExpired(storage: StorageLike, bank: Bank, now?: number): PurgeResult;
  /**
   * 자동 저장 선호. 기본 on. v4 키에 on 이나 off 가 적혀 있으면 그것이 이긴다. v4 키가 없거나 다른 값일 때만 이전 판 키(legacyV31AutosaveKey)가 off 이면 off 다
   * (이전 판에서 끈 사람이 v4 에서 처음부터 저장되지 않게. 반대로 v4 에서 on 을 쓰면 이전 판이 off 여도 다시 켤 수 있다).
   */
  readAutosavePreference(storage: StorageLike): "on" | "off";
  /** off 로 쓰면 v4 진행 저장, v4 기록, 이전 판 진행 저장 키를 함께 지운다(같이 쓰는 브라우저에서 끄기는 남기지 않는다는 뜻). on 이면 선호만 쓰고 이전 판 키는 건드리지 않는다. */
  writeAutosavePreference(storage: StorageLike, preference: "on" | "off"): { readonly status: "saved" | "unavailable" };
  /**
   * 이전 판(v3.1)이 남겨 둔 답이 있는가. 키의 원문을 JSON 으로 읽어 v3.1 진행 저장의 모양(스키마 1 또는 2, 봉투 키, 버전, answerCode)을 직접 풀어 본다. 읽기만 하고 지우지 않는다.
   * present = 읽을 수 있는 v3.1 진행이고 savedAt 이 30일 안의 안전한 정수(미래 아님)이고 고른 답이 하나 이상(시작만 눌러 답이 없는 진행, 기간이 지난 값, 깨진 값은 false).
   * savedAt = present 일 때 그 저장 시각, 아니면 null. 화면은 present 일 때 카드를 보여 준다.
   */
  probeLegacyV31Progress(storage: StorageLike, now?: number): LegacyProgressProbe;
}

// ===========================================================================
// 묶음
// ===========================================================================

/** 코어 빌더가 채우는 전체. 화면 빌더는 이 이름의 named export 만 쓴다. */
export interface V40Core {
  states: StatesModule;
  bank: BankModule;
  present: PresentModule;
  value: ValueModule;
  score: ScoreModule;
  gates: GatesModule;
  codec: CodecModule;
  flow: FlowModule;
  quote: QuoteModule;
  couple: CoupleModule;
  storage: StorageModule;
}

/** 모듈 이름 -> 파일. README 의 소유 표와 같다. */
export type V40ModuleFile = "states" | "bank" | "present" | "value" | "score" | "gates" | "codec" | "flow" | "quote" | "couple" | "storage";

/** 시험과 화면 빌더가 축을 순회할 때 쓰는 보조 타입. */
export type AxisRecord<T> = Readonly<Record<Axis, T>>;

// 4.1 단계 2: 새 모듈 둘의 인터페이스(정의는 각 트랙 폴더의 *Contract.ts). 타입만 다시 내보낸다.
export type { GuessLinkModule } from "./guess/guessContract";
export type { LetterGuessModule } from "./letterGuess/letterGuessContract";
