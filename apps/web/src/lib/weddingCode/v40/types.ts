/**
 * 웨딩코드 4.0 (v4.0-tendency) 타입 계약. 이 파일이 고정 인터페이스이며 다른 v40 파일은 타입을 여기서만 가져온다.
 * 함수 서명과 의미는 contract.ts, 모듈 배치와 소유는 README.md.
 *
 * 읽는 순서
 *   1. 기본 유니온과 부호 규칙
 *   2. 문항 은행에 실리는 작성용 문항(Authoring): 형식마다 필드가 다르다
 *   3. 화면이 받는 뷰와 화면 답: 극과 값 정보가 없고 폼 비트가 이미 반영돼 있다
 *   4. 저장 상태: 문항마다 글자 한 개, 형식별 표는 아래 StoredState 주석과 README 참고
 *   5. 채점 결과, 품질 관문, 두 사람 비교
 *   6. 흐름(Page, reducer), 저장소, 클라이언트 props, 이용 통계 값
 *
 * 부호 규칙(모든 값의 기준): 문항 값은 정수이고 양수는 앞극(front) 쪽이다. 앞극은 축의 앞 글자(V W U H)이고
 * 뒤극(back)은 뒤 글자(S D F A)다. 앞극을 양수로 둔 까닭은 글자표와 배치표(문서 부록 A의 (+) 표기)가 같은 방향이라
 * 사람이 손으로 검산하기 쉽기 때문이다. 어느 쪽이 더 좋다는 뜻은 없다. 폼 비트는 화면에서만 순서를 뒤집고
 * 저장 상태와 값은 폼 비트와 무관하다(저장은 문항 은행에 적힌 순서, 곧 폼 비트 0의 화면 순서 기준).
 */
import type {
  Axis,
  FacetKey,
  FormBit,
  Format,
  GuideKey,
  Letter,
  Pole,
  ScoredFormat,
  SectionIndex,
  Side,
  StrengthBand,
  WEDDING_CODE_V40_VERSION,
} from "@/constants/weddingCodeV40";

export type {
  Axis,
  BackLetter,
  FacetKey,
  FormBit,
  Format,
  FrontLetter,
  GuideKey,
  Letter,
  Pole,
  ScoredFormat,
  SectionIndex,
  Side,
  StrengthBand,
} from "@/constants/weddingCodeV40";

// ===========================================================================
// 1. 기본
// ===========================================================================

export type V40Version = typeof WEDDING_CODE_V40_VERSION;

/**
 * 문항 id. 채점 문항은 `<axis>.<facet>.<section+1>` (예: money.limit.1, support.give.4),
 * 자기 선택 문항은 `self.<axis>` (예: self.money). 데이터에만 있고 화면과 결과에는 나오지 않는다.
 */
export type ItemId = string;

/**
 * 문항 키. 문항 은행의 보기 배치가 어느 방향인지 나타내며 배치에서 파생된다(필드 값과 배치가 어긋나면 은행 검사 실패).
 * +1 이면 앞극이 위 카드, 높은 칸이 앞극, 보기 배열 V, 카드 배열 앞·뒤·뒤·앞, 항목 순서 앞·뒤·중립.
 * -1 이면 그 반대(뒤극이 위 카드 등). 구간 c 와 c+2 의 같은 위치 문항은 키가 반대다.
 */
export type Key = 1 | -1;

/** 두 가지 중 고르기의 하위 종류: 내 방식(구간 0, 2), 어느 순간이 더 끌려요(구간 1), 친구 이야기(구간 3). */
export type PairKind = "method" | "moment" | "friends";
/** 이럴 때 내 마음의 하위 종류: 상대 행동(구간 0, 2), 3인칭 사연(구간 1, 3). */
export type ReactKind = "action" | "story";
/** 고르기 보기의 세기. strong 은 값 절댓값 6, weak 는 2. */
export type ChoiceStrength = "strong" | "weak";
/** 동점 사슬 단계. 0 = 동점 아님(N 이 0 이 아님), 1~4 = 사슬의 그 단계에서 갈림, 5 = 마지막 단계까지 가서 앞 글자를 임시로 적음. */
export type TieLevel = 0 | 1 | 2 | 3 | 4 | 5;

// ===========================================================================
// 2. 작성용 문항 (문항 은행 JSON/TS 에 실리는 모양)
// ===========================================================================
//
// 공통 규칙
// - 목록 필드(cards, options, entries)는 폼 비트 0 의 화면 순서(위에서 아래, 왼쪽에서 오른쪽)로 적는다.
// - pole 은 그 보기가 향하는 극이다. 화면과 뷰에는 나가지 않는다.
// - 은행 배열은 질문 순서(screen 오름차순, 같은 화면 안에서는 pos 순서)이며 이 순서가 링크 코드 위치다.
// - 문구 규칙(작성 규칙 16조와 은행 검사): 앞말 90자 이하, 보기 60자 이하, 해요체, 줄표 없음, 축 이름과 글자 이름 없음.

interface AuthoringBase {
  readonly id: ItemId;
  readonly axis: Axis;
  /** 0 처음, 1 이어서, 2 조금만 더, 3 마지막 구간, 4 마지막 정리(자기 선택). */
  readonly section: SectionIndex;
  /** 질문 화면 번호(0 기준). 채점 문항 0~39(구간 x 10 + 화면), 자기 선택 40~41. 화면에는 나가지 않는다. */
  readonly screen: number;
  readonly key: Key;
  /** 문항 제목(10자 안팎). 문항 위 작은 캡션과 결과의 인용에 쓴다. 번호와 축 이름이 없다. */
  readonly caption: string;
  /** 앞말(90자 이하). 상황 설명이나 물음. */
  readonly stem: string;
}

interface ScoredBase extends AuthoringBase {
  readonly section: 0 | 1 | 2 | 3;
  readonly facet: FacetKey;
}

/** 두 가지 중 고르기의 카드. */
export interface PairCard {
  /** front 또는 back. 카드 한 장은 한 극이다. */
  readonly pole: Side;
  /** 카드 원문(60자 이하). 장점 하나와 대가 하나를 함께 담는다. 결과의 「내가 고른 답」에 그대로 인용된다. */
  readonly text: string;
}

/**
 * 두 가지 중 고르기. 카드 두 장(위, 아래) + 조금·꽤·아주 세 칸. 한 번 눌러 카드와 세기를 함께 고른다.
 * key = cards[0].pole === "front" ? +1 : -1.
 */
export interface PairItem extends ScoredBase {
  readonly fmt: "pair";
  readonly kind: PairKind;
  readonly cards: readonly [PairCard, PairCard];
}

export interface ReactQuote {
  /** 말한 사람. 짧은 명사(상대, 선배, 어머니 ...). 낭독에서 화자를 밝히는 데 쓴다. */
  readonly speaker: string;
  /** 인용문. 바깥 「」는 적지 않는다(화면이 붙인다). */
  readonly text: string;
}

/**
 * 이럴 때 내 마음(다섯 칸). 짧은 사연이나 상대 행동을 읽고 마음에 가까운 칸을 고른다.
 * 칸은 은행 배치 기준 왼쪽(0)에서 오른쪽(4)이고 오른쪽 끝 칸이 높은 칸이다. 높은 칸이 향하는 극이 highPole 이다.
 * key = highPole === "front" ? +1 : -1. 왼쪽 끝 칸은 반대 극을 향하고 가운데 칸은 어느 쪽도 아니다.
 */
export interface ReactItem extends ScoredBase {
  readonly fmt: "react";
  readonly kind: ReactKind;
  /** 인용 블록으로 따로 보여 줄 말(선택). 있으면 stem 은 인용 앞의 상황 설명이다. */
  readonly quote?: ReactQuote;
  /** 물음(예: 그때 내 마음은?). */
  readonly question: string;
  /** 양끝 이름(양쪽 다 정당한 마음이어야 한다). left 는 칸 0, right 는 칸 4. */
  readonly ends: { readonly left: string; readonly right: string };
  readonly highPole: Side;
  /**
   * 결과 인용용 앞 구절. `${recap} ${고른 쪽 끝 이름}` 이 자연스러운 한 문장이 되게 쓴다
   * (예: 「상대가 「많이 힘들었겠다」 하고 먼저 말해 주면」 + 「든든할 것 같아요」).
   */
  readonly recap: string;
}

export interface ChoiceOption {
  readonly text: string;
  readonly pole: Side;
  readonly strength: ChoiceStrength;
}

/**
 * 고르기 - 지난 일 떠올리기(결혼과 무관한 최근 일상). 네 보기 + 「이런 일이 없었어요」(화면이 붙이는 고정 카드).
 * options 는 폼 비트 0 화면 순서 네 개. key +1 이면 배열이 (뒤 약, 앞 강, 앞 약, 뒤 강) = 값 -2, +6, +2, -6,
 * key -1 이면 (앞 약, 뒤 강, 뒤 약, 앞 강) = +2, -6, -2, +6. 세기 순 정렬을 피하려는 고정 배열이다.
 */
export interface RecallItem extends ScoredBase {
  readonly fmt: "recall";
  readonly options: readonly [ChoiceOption, ChoiceOption, ChoiceOption, ChoiceOption];
}

/** 고르기 - 그때 나는(결혼 준비 상황 한 줄 뒤 「나는 보통…」). 보기 배열 규칙은 RecallItem 과 같고 「이런 일이 없었어요」 카드는 없다. */
export interface InstantItem extends ScoredBase {
  readonly fmt: "instant";
  readonly options: readonly [ChoiceOption, ChoiceOption, ChoiceOption, ChoiceOption];
}

export interface BestWorstCard {
  readonly pole: Side;
  /** 카드 원문. 짧은 행동 장면이며 「나는 ~한다」 자기 서술이 아니다. 해요체 요로 끝나고 마침표를 붙이지 않는다(인용문 조사 때문). */
  readonly text: string;
}

/**
 * 가장·가장 아닌 것. 카드 네 장(극마다 두 장)에서 가장 나 같은 것 하나, 가장 나 같지 않은 것 하나.
 * key +1 이면 카드 극 배치가 (앞, 뒤, 뒤, 앞), key -1 이면 (뒤, 앞, 앞, 뒤).
 */
export interface BestWorstItem extends ScoredBase {
  readonly fmt: "bestworst";
  readonly cards: readonly [BestWorstCard, BestWorstCard, BestWorstCard, BestWorstCard];
}

export interface SplitEntry {
  /** front, back, neutral. 중립 항목(미루기, 쉬기 같은 두 극 밖의 답)은 값에 넣지 않는다. */
  readonly pole: Pole;
  /** 항목 원문(인용에 그대로 쓴다). */
  readonly text: string;
}

/**
 * 칸 나누기. 항목 세 개에 6칸을 나눠 놓는다(한 곳에 몰아도 된다).
 * entries 는 폼 비트 0 화면 순서. key +1 이면 (앞, 뒤, 중립), key -1 이면 (뒤, 앞, 중립). 중립은 항상 세 번째다.
 */
export interface SplitItem extends ScoredBase {
  readonly fmt: "split";
  readonly entries: readonly [SplitEntry, SplitEntry, SplitEntry];
}

export interface SelfCard {
  readonly pole: Side;
  /** 그 방향을 직접 적은 문장. 기본은 글자 뜻 한 줄과 같은 내용이다. */
  readonly text: string;
}

/**
 * 자기 선택(마지막 정리, 채점 제외). 두 가지 중 고르기와 같은 화면 구성(카드 두 장 + 조금·꽤·아주).
 * facet 이 없다. caption 은 「직접 고른 쪽」, stem 은 기본으로 「스스로는 어느 쪽에 더 가깝다고 생각해요?」.
 * 저장 상태와 뷰는 pair 와 같은 모양이다. 값이 없고 동점 사슬 4단계, 직접 고른 쪽 대비, 파일럿 기준 변수로만 쓴다.
 * key = cards[0].pole === "front" ? +1 : -1. 네 문항의 키는 2:2 (기본 배치: money +1, process -1, scope -1, support +1).
 */
export interface SelfItem extends AuthoringBase {
  readonly fmt: "self";
  readonly section: 4;
  readonly cards: readonly [SelfCard, SelfCard];
}

/** 채점 문항 64개의 합집합. */
export type ScoredItem = PairItem | ReactItem | RecallItem | InstantItem | BestWorstItem | SplitItem;
/** 문항 은행 68개의 합집합. fmt 로 좁힌다. */
export type Item = ScoredItem | SelfItem;

/**
 * 문항 은행 원본(JSON 또는 TS 모듈). items 는 질문 순서 68개다: 채점 문항 64개(화면 0에서 39) 다음에 자기 선택 4개(화면 40, 41).
 * 같은 화면 안에서는 pos 순서. 이 순서가 layout.ts 의 V40_LAYOUT 과 같아야 하고, 링크 코드 위치가 된다.
 */
export interface BankData {
  readonly version: V40Version;
  readonly items: readonly Item[];
}

/**
 * 은행에서 파생한 조회용 구조. createBank(data) 가 만든다.
 * 링크 코드 위치: 폼 비트 0번, items[i] 는 코드의 i+1번, 체크섬은 69번 (총 70자).
 */
export interface Bank {
  readonly version: V40Version;
  /** 질문 순서 68개. 화면 순서이자 링크 코드 순서. 채점 40 화면(64개) 다음에 자기 선택 2 화면(4개). */
  readonly items: readonly Item[];
  readonly scored: readonly ScoredItem[];
  readonly self: readonly SelfItem[];
  readonly byId: ReadonlyMap<ItemId, Item>;
  /** 문항 id -> 코드 색인(0에서 67). 코드 글자 위치는 색인 + 1. */
  readonly codeIndexById: ReadonlyMap<ItemId, number>;
  /** 축마다 채점 문항 16개(질문 순서). */
  readonly scoredByAxis: Readonly<Record<Axis, readonly ScoredItem[]>>;
  /** 질문 화면 42개. 화면마다 문항 id 1~2개(화면 번호 = 배열 색인). */
  readonly screens: readonly (readonly ItemId[])[];
}

/**
 * 링크 코드 도우미(encodeCode, decodeCode, decodeShareParams, parseShareHash)가 은행에서 읽는 부분: 질문 순서의 문항 id 와 형식뿐이다.
 * Bank 도, 배치 골격 V40_LAYOUT(LayoutSlot)도 이 모양을 만족한다. 그래서 입구(entry.ts)는 문항 문구가 든 은행(bank.ts, 생성된 문항 파일)을 가져오지 않고
 * 배치 골격만으로 받은 링크를 풀 수 있다. 채점이 필요한 buildGatedShareUrl 은 이 모양이 아니라 온전한 Bank 를 받는다.
 */
export interface CodecBankView {
  readonly items: readonly { readonly id: ItemId; readonly fmt: Format }[];
}

/** 배치 골격의 한 칸(layout.ts). 문항 은행은 이 골격을 채운 것이라 키와 위치를 바꾸지 못한다. */
export interface LayoutSlot {
  readonly id: ItemId;
  readonly axis: Axis;
  /** 자기 선택은 null. */
  readonly facet: FacetKey | null;
  readonly section: SectionIndex;
  readonly screen: number;
  /** 같은 화면 안 순서(0 또는 1). */
  readonly pos: 0 | 1;
  readonly fmt: Format;
  /** pair 는 PairKind, react 는 ReactKind, 나머지는 null. */
  readonly kind: PairKind | ReactKind | null;
  readonly key: Key;
}

// ===========================================================================
// 3. 뷰와 화면 답 (UI 가 받고 돌려주는 것). 극, 값, 키, 세기 정보가 없다.
// ===========================================================================

/** 모든 문항 아래에 붙는 두 단추의 이름. 둘 다 빠진 값이다. */
export interface EscapeLabels {
  /** 잘 모르겠어요 (건너뜀). */
  readonly unsure: string;
  /** 제 상황과 안 맞아요 (해당 없음). */
  readonly notApplicable: string;
}

interface ViewBase {
  readonly id: ItemId;
  /** 문항 제목. 화면에는 작은 캡션으로만 나온다(번호와 축 이름 없음). */
  readonly caption: string;
  readonly stem: string;
  readonly escapes: EscapeLabels;
}

export interface ViewText {
  readonly text: string;
}

/** 두 가지 중 고르기와 자기 선택의 6칸 라디오 한 칸. DOM 순서는 위 카드의 아주, 꽤, 조금, 아래 카드의 조금, 꽤, 아주. */
export interface PairCellView {
  /** 화면 답에 쓰는 번호 0에서 5(DOM 순서). 화면에 보이지 않는다. */
  readonly cell: number;
  /** 화면에서 위 카드가 0, 아래 카드가 1. */
  readonly cardIndex: 0 | 1;
  readonly level: 1 | 2 | 3;
  /** 보이는 글자(조금, 꽤, 아주). */
  readonly label: string;
  /** 낭독 이름(예: 위 카드에 가까워요, 아주). */
  readonly accessibleName: string;
}

export interface PairView extends ViewBase {
  readonly fmt: "pair";
  readonly kind: PairKind;
  /** 화면 순서(폼 비트 반영): [위, 아래]. */
  readonly cards: readonly [ViewText, ViewText];
  readonly cells: readonly PairCellView[];
}

/** 자기 선택 뷰. 두 가지 중 고르기와 같은 화면 구성이라 같은 컴포넌트를 재사용한다. */
export interface SelfView extends ViewBase {
  readonly fmt: "self";
  readonly cards: readonly [ViewText, ViewText];
  readonly cells: readonly PairCellView[];
}

export interface ReactCellView {
  /** 화면 왼쪽부터 0에서 4. */
  readonly cell: number;
  readonly accessibleName: string;
}

export interface ReactView extends ViewBase {
  readonly fmt: "react";
  readonly kind: ReactKind;
  readonly quote: ReactQuote | null;
  readonly question: string;
  /** 화면 기준 양끝 이름(폼 비트 1 이면 자리가 바뀐다). */
  readonly ends: { readonly left: string; readonly right: string };
  /** 라디오 그룹 설명(양끝 이름). */
  readonly groupDescription: string;
  readonly cells: readonly ReactCellView[];
}

export interface ChoiceView extends ViewBase {
  readonly fmt: "recall" | "instant";
  /** 화면 순서(폼 비트 반영) 네 개. */
  readonly options: readonly ViewText[];
  /** recall 에만 있는 「이런 일이 없었어요」 카드 이름. 누르면 해당 없음이다. instant 는 null. */
  readonly noneLabel: string | null;
}

export interface BestWorstView extends ViewBase {
  readonly fmt: "bestworst";
  /** 화면 순서(폼 비트 반영) 네 장. */
  readonly cards: readonly ViewText[];
  /** 두 그룹 이름: 가장 나 같은 것 / 가장 나 같지 않은 것. */
  readonly bestLabel: string;
  readonly worstLabel: string;
  /** 같은 카드를 두 그룹에서 골랐을 때 aria-live 로 읽는 문장. */
  readonly duplicateAnnounce: string;
}

export interface SplitView extends ViewBase {
  readonly fmt: "split";
  /** 화면 순서(폼 비트 반영) 세 항목. 폼 비트 1 이면 앞 두 항목의 자리가 바뀌고 세 번째는 그대로다. */
  readonly entries: readonly [ViewText, ViewText, ViewText];
  /** 나눠 놓을 칸 수(6). */
  readonly total: number;
}

export type ItemView = PairView | SelfView | ReactView | ChoiceView | BestWorstView | SplitView;

// --- 화면 답 (입력 컴포넌트가 만들고 flow 가 저장 상태로 바꾼다) ---
// 번호는 모두 화면 기준이다(폼 비트 반영 뒤). 저장 상태로의 변환은 toStored 만 한다.

export interface PairViewAnswer {
  readonly fmt: "pair";
  /** PairCellView.cell (0에서 5, DOM 순서). */
  readonly cell: number;
}
export interface SelfViewAnswer {
  readonly fmt: "self";
  readonly cell: number;
}
export interface ReactViewAnswer {
  readonly fmt: "react";
  /** 왼쪽부터 0에서 4. */
  readonly cell: number;
}
export interface ChoiceViewAnswer {
  readonly fmt: "recall" | "instant";
  /** 화면 순서 0에서 3. */
  readonly option: number;
}
/** 가장·가장 아닌 것. 하나만 고른 중간 상태를 null 로 담을 수 있다(완성되기 전에는 저장 상태로 바뀌지 않는다). */
export interface BestWorstViewAnswer {
  readonly fmt: "bestworst";
  readonly best: number | null;
  readonly worst: number | null;
}
/** 칸 나누기. 화면 순서 세 항목의 칸 수. 합이 6 이 아닌 중간 상태를 담을 수 있다. */
export interface SplitViewAnswer {
  readonly fmt: "split";
  readonly counts: readonly [number, number, number];
}
/** 모든 형식 공통의 두 넘기기. unsure = 잘 모르겠어요(skip), na = 제 상황과 안 맞아요 또는 이런 일이 없었어요(na). */
export interface EscapeViewAnswer {
  readonly fmt: "escape";
  readonly which: "unsure" | "na";
}

export type ViewAnswer =
  | PairViewAnswer
  | SelfViewAnswer
  | ReactViewAnswer
  | ChoiceViewAnswer
  | BestWorstViewAnswer
  | SplitViewAnswer
  | EscapeViewAnswer;

// ===========================================================================
// 4. 저장 상태 (링크 코드와 진행 저장이 공유하는 문항별 값)
// ===========================================================================
//
// 문항마다 문자 한 개. 알파벳은 V40_STATE_ALPHABET(0-9a-zA-Z 62자)의 앞에서 상태 수만큼.
// 기준은 문항 은행에 적힌 순서(폼 비트 0 화면 순서)이며 폼 비트로 뒤집히지 않는다.
//
//  형식        상태 수  상태 색인 s (문자 = 알파벳[s])       값(채점 문항) 또는 뜻
//  pair          6      은행 순서 6칸: 0 = cards[0] 아주, 1 = cards[0] 꽤, 2 = cards[0] 조금,
//                       3 = cards[1] 조금, 4 = cards[1] 꽤, 5 = cards[1] 아주.
//                       값 = 2 x 세기(1,2,3) x (고른 카드가 front 면 +1, back 이면 -1)   -> -6 -4 -2 +2 +4 +6
//  react         5      은행 순서 왼쪽에서 오른쪽 칸: s = 0..4. 값 = (s - 2) x 3 x (highPole 이 front 면 +1, back 이면 -1)
//                                                                                        -> -6 -3 0 +3 +6
//  recall        4      s = options 색인 0..3. 값: 그 보기의 극(front +, back -) x 세기(strong 6, weak 2)   -> -6 -2 +2 +6
//  instant       4      recall 과 같다.
//  bestworst    12      (b = 가장 나 같은 것의 cards 색인, w = 가장 나 같지 않은 것의 색인, b 와 w 는 달라야 한다)
//                       s = 3 x b + (w < b ? w : w - 1). 값 = 4 x sign(cards[b].pole) - 2 x sign(cards[w].pole) -> -6 -2 +2 +6
//  split        28      (a = entries[0] 칸 수, b = entries[1] 칸 수, 나머지 6 - a - b 가 entries[2] 칸 수)
//                       s = a x (15 - a) / 2 + b  (a 0..6, b 0..6-a). 값 = (front 항목 칸 수) - (back 항목 칸 수)   -> -6..+6
//  self          6      pair 와 같은 6칸. 값 없음(고른 방향 pole 과 세기 1,2,3 만 뽑는다).
//
// 특수 문자(링크 코드): 건너뜀 skip = V40_SKIP_CHAR(-), 해당 없음 na = V40_NA_CHAR(_).
// 진행 저장에서만: 아직 답하지 않음 = V40_UNANSWERED_CHAR(.).
// 폼 비트 문자: 링크 코드 0번째, "0" 또는 "1". 체크섬 문자: 링크 코드 69번째, 알파벳[c] (c 는 0에서 60).

/** 저장 상태 문자 한 개(V40_STATE_ALPHABET 의 한 글자). 형식마다 쓸 수 있는 범위가 다르다. */
export type StateChar = string;

/** 문항 한 개의 저장값: 상태 문자, 또는 skip(잘 모르겠어요), 또는 na(제 상황과 안 맞아요). 메모리 안에서는 단어를 쓰고 링크에서만 - 와 _ 로 적는다. */
export type ResponseValue = StateChar | "skip" | "na";

/**
 * 문항 id -> 저장값. 답하지 않은 문항은 키가 없다(값 undefined 도 없는 것으로 본다).
 * 이름이 Responses 인 까닭: DOM 전역 타입 Response 를 가리지 않으려고.
 */
export type Responses = Readonly<Record<ItemId, ResponseValue>>;

/** 링크 코드 한 개를 풀어낸 것 또는 화면이 가진 한 사람의 답. */
export interface DecodedCode {
  readonly formBit: FormBit;
  /** 링크 코드로 풀었으면 68개 문항이 모두 채워져 있다(state, skip, na). */
  readonly responses: Responses;
}

// ===========================================================================
// 5. 채점 결과
// ===========================================================================

/** 측면 하나의 집계. */
export interface FacetTally {
  readonly facet: FacetKey;
  /** 유효 답 수(0에서 4). */
  readonly answered: number;
  /** 유효 답의 문항 값 합(정수). */
  readonly sum: number;
  /** 답이 2개 이상이라 세는 측면인가. */
  readonly counted: boolean;
}

/**
 * 폼 비트와 무관한 축 집계. scoreResponses 가 만든다.
 * 유효 답 = 채점 문항 16개 중 상태 문자를 가진 것(skip, na, 없음은 빠진 값).
 * weighted(N) = 세는 측면마다 (측면 합 x 12 / 측면 유효 답 수)의 합. 유효 답 수가 2, 3, 4 이면 12/n 은 6, 4, 3 이라 항상 정수다.
 * s = weighted / (72 x countedFacets). 완전한 답이면 weighted = 3 x sum, countedFacets = 4 라서 s = sum / 96.
 */
export interface AxisScore {
  readonly axis: Axis;
  readonly answered: number;
  readonly skipped: number;
  readonly notApplicable: number;
  readonly facets: readonly [FacetTally, FacetTally, FacetTally, FacetTally];
  readonly countedFacets: number;
  /** 유효 답 문항 값의 합(정수, 세지 않는 측면의 답도 포함). */
  readonly sum: number;
  /** 유효 답이 12개 미만이거나 세는 측면이 3개 미만이면 true. 글자를 만들지 않는다. */
  readonly unusable: boolean;
  /** N. unusable 이면 null. */
  readonly weighted: number | null;
  /** S = N / (72 x countedFacets), -1에서 +1. 화면에 내지 않는다(판정과 시험용). unusable 이면 null. */
  readonly s: number | null;
  /** 글자 방향. unusable 이면 null. */
  readonly side: Side | null;
  readonly letter: Letter | null;
  /** 0 = N 이 0 이 아님. 1~4 = 동점 사슬 단계. 5 = 사슬이 못 갈라서 앞 글자를 임시로 적음. unusable 이면 null. */
  readonly tieLevel: TieLevel | null;
  /** tieLevel 5 (두 사람 비교와 코드 복사의 확정 글자로 세지 않는다). */
  readonly provisional: boolean;
  /**
   * 관문 힌트를 적용하기 전 세기: |N| >= 36 x countedFacets 이면 clear, |N| >= 18 x countedFacets 이면 lean, 그 밖 even.
   * 동점 사슬로 정한 글자(tieLevel 1 이상)는 항상 even. unusable 이면 null.
   */
  readonly band: StrengthBand | null;
}

export interface ScoreResult {
  /** 주제 순서(돈, 준비, 정하는 사람, 지쳤을 때). */
  readonly axes: readonly [AxisScore, AxisScore, AxisScore, AxisScore];
}

/** 위치 반복 검사를 거는 세 묶음: 두 가지 중 고르기(위/아래), 이럴 때(칸), 고르기(recall 과 instant 를 화면 순서로 합침, 칸). */
export type RhythmFamily = "pair" | "react" | "choose";

export interface RhythmFormatReport {
  readonly family: RhythmFamily;
  /** 검사에 쓴 유효 답 수(건너뜀과 해당 없음은 뺀 나머지 순서). */
  readonly considered: number;
  /** 최적 주기 p (1에서 4). considered 가 12 미만이면 null. */
  readonly period: 1 | 2 | 3 | 4 | null;
  /** 최적 주기에서 위치 묶음별 최다 답 수의 합. */
  readonly agree: number;
  /** considered >= 12 이고 agree x 16 >= considered x (pair 15, react 14, choose 14) 이면 true. */
  readonly flagged: boolean;
}

export interface RhythmReport {
  readonly formats: readonly [RhythmFormatReport, RhythmFormatReport, RhythmFormatReport];
  readonly flaggedCount: 0 | 1 | 2 | 3;
}

/** 코드를 만들지 못하는 까닭. rhythm = 세 형식 모두 위치 반복, noInformation = 확정 글자가 하나도 없음(모두 임시이거나 못 정함). */
export type GateReason = "rhythm" | "noInformation";

export interface GateInfo {
  readonly closed: boolean;
  readonly reason: GateReason | null;
}

/** 직접 고른 쪽 대비. 자기 선택과 답이 모인 쪽이 다르고, 세기(힌트 반영 뒤)가 clear/lean 이며 자기 선택 세기가 꽤 이상일 때만 만든다. */
export interface SelfContrast {
  readonly axis: Axis;
  readonly selfSide: Side;
  readonly selfLetter: Letter;
  readonly selfLevel: 2 | 3;
  readonly gatheredSide: Side;
  readonly gatheredLetter: Letter;
  readonly gatheredBand: "clear" | "lean";
}

/** 힌트를 적용한 뒤의 축 결과(화면이 읽는 것). */
export interface AxisResult extends AxisScore {
  /** 위치 반복 힌트 또는 건너뜀 힌트가 있으면 band 를 한 단계 낮춘 값(한 단계까지만). unusable 이면 null. */
  readonly shownBand: StrengthBand | null;
  readonly contrast: SelfContrast | null;
}

export interface QualityNotes {
  /** 위치 반복 형식이 2개 이상. */
  readonly hintRhythm: boolean;
  /** 잘 모르겠어요가 채점 문항 64개 중 16개를 넘음(해당 없음은 세지 않음). */
  readonly hintSkip: boolean;
  /** 두 힌트 중 하나라도 있어서 모든 자리의 세기를 한 단계 낮췄는가(두 힌트가 겹쳐도 한 단계). */
  readonly demoted: boolean;
  /** 채점 문항 중 skip 또는 na 가 하나라도 있음(「넘어간 질문은 계산에서 뺐어요」 한 줄). */
  readonly hasOmitted: boolean;
  readonly skippedCount: number;
  readonly notApplicableCount: number;
  /** 글자를 정하지 못한 주제(가운뎃점으로 적는다). */
  readonly unusableAxes: readonly Axis[];
  /** 임시 글자인 주제. */
  readonly provisionalAxes: readonly Axis[];
}

/** buildResult 의 전체 결과. */
export interface V40Result {
  readonly formBit: FormBit;
  readonly axes: readonly [AxisResult, AxisResult, AxisResult, AxisResult];
  /**
   * 네 글자 코드. 글자를 못 정한 주제는 가운뎃점(V40_UNSET_LETTER_MARK)으로 적는다(예: S·UA). 임시 글자는 글자 그대로 적는다.
   * 관문이 닫혔으면 null(링크 보내기와 코드 복사도 만들지 않는다).
   */
  readonly code: string | null;
  readonly gate: GateInfo;
  readonly rhythm: RhythmReport;
  readonly notes: QualityNotes;
}

// ===========================================================================
// 6. 인용(내가 고른 답)
// ===========================================================================

export interface QuoteItem {
  readonly itemId: ItemId;
  readonly caption: string;
  readonly facet: FacetKey;
  readonly format: ScoredFormat;
  /** 문항 값(정수, 0 이 아님). 화면에 내지 않는다. */
  readonly value: number;
  /** answerText: 캡션 없는 원문. */
  readonly text: string;
  /** answerLabel: `${caption}: ${text}`. */
  readonly label: string;
}

/**
 * 한 주제의 인용.
 * settled: 세기가 뚜렷해요 또는 기울어요. own = 글자 쪽 답 최대 3개, opposite = 반대로 고른 답 최대 2개(없으면 빈 배열, 화면이 없었다고 적는다).
 * even: 반반이에요. front 쪽과 back 쪽 답을 각각 최대 2개씩 같은 무게로.
 * none: 글자를 못 정한 주제.
 */
export type AxisQuotes =
  | { readonly kind: "settled"; readonly own: readonly QuoteItem[]; readonly opposite: readonly QuoteItem[] }
  | { readonly kind: "even"; readonly front: readonly QuoteItem[]; readonly back: readonly QuoteItem[] }
  | { readonly kind: "none" };

// ===========================================================================
// 7. 두 사람 보기
// ===========================================================================

/** 주제별 태그는 셋뿐이다. same = 둘 다 기울어요 이상이고 글자가 같음, different = 둘 다 기울어요 이상이고 글자가 다름, even = 그 밖(같다·다르다를 말하지 않음). */
export type CoupleTag = "same" | "different" | "even";

export interface CoupleSideInfo {
  readonly letter: Letter | null;
  readonly shownBand: StrengthBand | null;
  readonly provisional: boolean;
}

export interface CoupleAxisRow {
  readonly axis: Axis;
  readonly first: CoupleSideInfo;
  readonly second: CoupleSideInfo;
  readonly tag: CoupleTag;
  /**
   * 비교에서 뺀 자리(tag 는 even): 한쪽이라도 글자를 못 정했거나 임시 글자이거나, 어느 한 사람의 관문이 닫혀 있다(관문이 닫힌 사람은 코드도 링크도 없으므로
   * 네 자리가 모두 빠진다). 뺀 주제의 문항은 talk 와 similar 에도 나오지 않는다.
   */
  readonly excluded: boolean;
}

/** 두 사람이 모두 답한 문항 하나의 비교. */
export interface CoupleItemPair {
  readonly itemId: ItemId;
  readonly axis: Axis;
  readonly facet: FacetKey;
  readonly caption: string;
  readonly firstValue: number;
  readonly secondValue: number;
  /** |firstValue - secondValue|. */
  readonly gap: number;
  /** answerText (캡션 없는 원문). */
  readonly firstText: string;
  readonly secondText: string;
}

export interface CoupleResult {
  readonly axes: readonly [CoupleAxisRow, CoupleAxisRow, CoupleAxisRow, CoupleAxisRow];
  /** 먼저 이야기해 볼 질문 최대 3개(부호가 반대이고 값 차이 8 이상). 차이가 큰 순. excluded 주제의 문항은 나오지 않는다. */
  readonly talk: readonly CoupleItemPair[];
  /** 이미 비슷하게 고른 질문 최대 3개(부호가 같고 각각 절댓값 4 이상). excluded 주제의 문항은 나오지 않는다. */
  readonly similar: readonly CoupleItemPair[];
}

/** 나 기준 전환. first = 링크의 a(먼저 답한 사람), second = b(나중에 답한 사람). 고른 값은 저장하지 않는다(링크에도 없다). */
export type Perspective = "first" | "second";

/** 링크 해시의 a, b 를 푼 결과. 하나라도 깨졌으면 invalid(한 사람 답만 살리지 않고 기본값도 채우지 않는다). */
export type ShareParse =
  | { readonly kind: "none" }
  | { readonly kind: "invalid" }
  | { readonly kind: "partner"; readonly first: DecodedCode }
  | { readonly kind: "both"; readonly first: DecodedCode; readonly second: DecodedCode };

// ===========================================================================
// 8. 흐름 (Page, reducer)
// ===========================================================================

interface PageBase {
  /** React key 로 쓰는 안정 문자열(intro, q:<첫 문항 id>, rest:<0~2>, selfIntro, result). */
  readonly key: string;
}

export interface IntroPage extends PageBase {
  readonly kind: "intro";
}

export interface QuestionsPage extends PageBase {
  readonly kind: "questions";
  /** 이 화면의 문항 id 1~2개(서로 다른 축, 화면 순서). */
  readonly itemIds: readonly ItemId[];
  /** 진행 막대 칸(구간 번호, 자기 선택은 4). */
  readonly section: SectionIndex;
  /** 질문 화면 번호 0에서 41(이용 통계의 scene_index). 화면 묶음을 나눠도 원래 화면 번호를 유지한다. */
  readonly screen: number;
  /** 이 화면에서 처음 나오는 형식 안내(한 줄). 필터 흐름과 다시 보기에서는 비어 있다. */
  readonly guides: readonly GuideKey[];
  /** 정하는 사람 주제의 첫 문항 위에 「가까운 어른을 떠올려도 돼요」를 한 번 놓는다. */
  readonly elderHint: boolean;
}

/** 구간 사이 쉬는 카드(구간 0, 1, 2 뒤). 이야기 카드는 없다. */
export interface RestPage extends PageBase {
  readonly kind: "rest";
  readonly after: 0 | 1 | 2;
}

/** 마지막 정리 카드(「마지막 정리예요. 하나씩만 더 골라 주세요.」). 마지막 구간 뒤, 자기 선택 화면 앞. */
export interface SelfIntroPage extends PageBase {
  readonly kind: "selfIntro";
}

export interface ResultPage extends PageBase {
  readonly kind: "result";
}

export type Page = IntroPage | QuestionsPage | RestPage | SelfIntroPage | ResultPage;

/** 한 화면에 몇 개씩 묶을까. screen = 배치표대로 1~2개, single = 320x568 에서 넘칠 때 하나씩. */
export type PagePack = "screen" | "single";

export interface BuildPagesOptions {
  /** 주면 이 문항들만 질문 화면으로 만든다(쉬는 카드, 소개, 결과 없음). 화면 묶음은 원래 화면을 따른다. */
  readonly only?: readonly ItemId[];
  /** 기본 screen. */
  readonly pack?: PagePack;
}

/** 결과 화면에서 다시 여는 필터. axis = 그 주제 16개를 화면 순서로, skipped = 결과 전에 한 번 다시 보여 주는 건너뛴 질문. */
export type PageFilter =
  | { readonly kind: "axis"; readonly axis: Axis }
  | { readonly kind: "skipped"; readonly itemIds: readonly ItemId[] };

export type FlowNotice =
  /**
   * 다음을 눌렀는데 화면의 문항이 아직 저장값이 없거나(칸을 다 놓지 않은 칸 나누기 등), 저장값은 있어도 지금 화면 답이 중간 상태(partialIds)다.
   * 화면이 남은 칸 수 등을 안내한다.
   */
  | { readonly kind: "incomplete"; readonly itemIds: readonly ItemId[] }
  /** 유효 답이 12개 미만인 주제가 있어서 건너뛴 질문을 한 번 다시 보여 준다. */
  | { readonly kind: "skippedReview"; readonly itemIds: readonly ItemId[] };

/**
 * 필터 흐름을 어떻게 열었는가. advance = 마지막 질문 화면에서 다음을 눌러 결과 앞에 저절로 열린 넘어간 질문 다시 보기(첫 쪽의 이전은 마지막 질문 화면으로 돌아간다),
 * open = 결과 화면에서 사람이 openFilter 로 연 것(첫 쪽의 이전은 필터를 닫고 결과로 돌아간다). 필터가 없으면 null.
 */
export type FilterOrigin = "advance" | "open";

export interface FlowState {
  /** 시작 단추를 누를 때 한 번 정한다. 시작 전에는 0. */
  readonly formBit: FormBit;
  readonly started: boolean;
  /**
   * 문항마다 마지막으로 완성한 저장값(답하지 않은 문항은 키가 없다). 결과는 언제나 여기서 다시 계산한다.
   * 화면 답이 중간 상태로 바뀌어도 이미 있던 저장값은 지우지 않는다(한 번 완성한 답은 되돌아가도 사라지지 않는다). 완성된 답이나 넘기기만 저장값을 바꾼다.
   */
  readonly responses: Responses;
  /**
   * 지금 화면 문항의 화면 답(중간 상태 포함). 화면을 벗어나면 비운다(중간 상태는 버리고 마지막 완성 저장값을 쓴다).
   * 완성된 답은 responses 에도 들어 있다. 화면은 저장값보다 이것을 먼저 보여 준다(viewAnswerOf).
   */
  readonly drafts: Readonly<Record<ItemId, ViewAnswer>>;
  /**
   * drafts 중 저장 상태로 바꿀 수 없는 중간 답(하나만 고른 가장·아닌 것, 합 6 미만의 칸 나누기)의 문항 id. 문항 하나당 하나의 깃발이다.
   * 저장값이 이미 있어도 이 깃발이 서 있으면 다음은 넘어가지 않고 notice incomplete 를 낸다. 지금 화면의 문항만 들고 화면을 벗어나면 비운다.
   */
  readonly partialIds: readonly ItemId[];
  readonly pack: PagePack;
  /** 지금 보고 있는 화면 목록. 기본은 전체 흐름(소개에서 결과까지), 필터가 있으면 질문 화면만. */
  readonly pages: readonly Page[];
  readonly pageIndex: number;
  readonly filter: PageFilter | null;
  /** 필터를 연 방식. filter 가 null 일 때만 null 이다. */
  readonly filterOrigin: FilterOrigin | null;
  /** 건너뛴 질문 다시 보기를 이미 한 번 보여 줬는가. */
  readonly skippedReviewDone: boolean;
  readonly notice: FlowNotice | null;
}

export interface FlowInit {
  readonly pack?: PagePack;
  /** 진행 저장에서 이어 하는 경우. */
  readonly snapshot?: ProgressSnapshot;
}

export type FlowAction =
  /** 소개에서 시작. formBit 은 호출자가 정한다(시험에서 고정할 수 있게). */
  | { readonly type: "start"; readonly formBit: FormBit }
  /**
   * 화면 답 하나. 완성된 답은 responses 에 저장 상태로 넣고 drafts 에도 둔다. 중간 상태는 drafts 와 partialIds 에만 두고
   * responses 는 건드리지 않는다(이미 있던 저장값이 그대로 남는다). escape 는 skip/na 저장.
   */
  | { readonly type: "answer"; readonly itemId: ItemId; readonly answer: ViewAnswer }
  /**
   * 다음. 화면의 문항이 모두 저장값이 있고 중간 상태의 화면 답(partialIds)이 없어야 넘어간다(아니면 notice incomplete).
   * 마지막 질문 화면에서는 결과 또는 건너뛴 질문 다시 보기.
   */
  | { readonly type: "next" }
  /**
   * 이전. 쪽을 벗어나므로 그 쪽의 화면 답(중간 상태 포함)은 버린다. 저장값은 그대로다. 필터 흐름의 첫 쪽에서는 filterOrigin 이 advance 이면
   * 전체 흐름의 마지막 질문 화면으로, open 이면 필터를 닫고 결과로 돌아간다.
   */
  | { readonly type: "back" }
  /** 결과 화면 등에서 필터로 다시 열기. */
  | { readonly type: "openFilter"; readonly filter: PageFilter }
  /** 필터 흐름을 끝내고 결과로 돌아가기. */
  | { readonly type: "closeFilter" }
  /** 320x568 등에서 화면 묶음을 바꾼다. 지금 보는 첫 문항이 있는 화면으로 이어진다. */
  | { readonly type: "repack"; readonly pack: PagePack }
  | { readonly type: "dismissNotice" }
  /** 처음부터 다시 하기(답과 폼 비트 초기화, 소개로). */
  | { readonly type: "restart" };

/** 진행 막대 한 칸. 화면에는 문항 수만큼 차오르는 얇은 막대로 나오고 숫자는 내지 않는다. */
export interface ProgressSegment {
  readonly index: SectionIndex;
  readonly name: string;
  /** 저장값이 있는 문항 수(중간 상태의 화면 답은 세지 않는다). */
  readonly done: number;
  readonly total: number;
  /**
   * 지금 쪽이 속한 칸이면 true. 시작 전의 소개 쪽과 결과 쪽에는 어느 칸도 아니다(모두 false).
   * 질문 쪽은 그 문항의 구간(필터 흐름에서도 지금 열린 문항의 구간), 쉬는 카드는 방금 끝낸 구간, 마지막 정리 카드는 마지막 정리(4)다.
   * placementOf 도 같은 규칙이다(쉬는 카드 after 0 은 c1, 마지막 정리 카드는 self).
   */
  readonly current: boolean;
}

// ===========================================================================
// 9. 저장소 (이 브라우저에만)
// ===========================================================================

/**
 * 진행 저장 스냅샷. 링크 코드와 섞지 않는다(아직 답하지 않은 문항 표기가 필요해 별도 표기를 쓴다).
 * 필터 흐름은 저장하지 않는다: 편집 중에 저장돼도 다음에는 (모두 답했으면) 결과 화면에서 이어진다.
 */
export interface ProgressSnapshot {
  readonly formBit: FormBit;
  readonly responses: Responses;
  /** questions = 답하지 않은 문항이 남음, result = 68개 모두 저장값이 있음. */
  readonly screen: "questions" | "result";
  /** 이어 할 화면의 첫 문항 코드 색인(0에서 67). screen 이 result 이면 0. 화면 묶음이 바뀌어도 이어지도록 화면 번호가 아니라 문항 색인을 쓴다. */
  readonly cursor: number;
  readonly skippedReviewDone: boolean;
}

/**
 * localStorage 의 JSON 봉투. 키는 아래 여덟 개가 모두 있어야 하고 다른 키가 있거나 모자라면 거절한다. 문자열 길이 상한 V40_STORAGE.maxEnvelopeLength.
 * answers 는 문항 68개를 코드 순서로 이은 68자: 상태 문자, - (skip), _ (na), . (아직 답하지 않음). 체크섬 없음.
 */
export interface ProgressEnvelope {
  readonly schema: 1;
  readonly version: V40Version;
  /** 마지막으로 실제 저장한 시각(밀리초). 읽기만으로 늘리지 않는다. */
  readonly savedAt: number;
  readonly formBit: FormBit;
  readonly answers: string;
  readonly screen: "questions" | "result";
  readonly cursor: number;
  readonly skippedReviewDone: boolean;
}

export type ProgressRead =
  | { readonly status: "ready"; readonly snapshot: ProgressSnapshot; readonly savedAt: number; readonly raw: string }
  | { readonly status: "empty" | "invalid" | "expired" | "unavailable"; readonly raw: string | null };

/**
 * 진행 저장 쓰기의 결과. saved = 쓰고 다시 읽어 확인함, conflict = 다른 탭이 그 사이 바꿨음, unavailable = 저장소가 막혔거나 쓴 값이 확인되지 않음,
 * invalid = 넘긴 스냅샷의 모양이 틀림, off = 자동 저장이 꺼져 있어 아무것도 쓰지 않았음(막힌 것이 아니라 사람이 끈 것이다).
 * raw 는 답 전체를 담고 있으니 다음 쓰기의 expectedRaw 로만 쓰고 기록이나 통계로 보내지 않는다.
 */
export type ProgressWrite =
  | { readonly status: "saved"; readonly raw: string }
  | { readonly status: "conflict" | "unavailable" | "invalid" | "off" };

/** 비교 기록 한 건 추가의 결과. saved, unavailable, invalid 는 ProgressWrite 와 같은 뜻이고 off = 자동 저장이 꺼져 있어 쓰지 않았음. */
export interface AppendResult {
  readonly status: "saved" | "unavailable" | "invalid" | "off";
}

/** purgeExpired 의 결과: 저장에서 지운(또는 덜어 낸) 것이 있으면 true. 지울 것이 없거나 접근이 막혔으면 false. */
export interface PurgeResult {
  readonly progress: boolean;
  readonly history: boolean;
}

/** 지난번과 비교용 기록 한 건: 결과의 글자와 세기, 날짜, 폼 비트만(답은 저장하지 않는다). */
export interface HistoryAxis {
  readonly letter: Letter | null;
  readonly band: StrengthBand | null;
  readonly provisional: boolean;
}

export interface HistoryEntry {
  /** 결과를 만든 시각(밀리초). 날짜는 한국 시간 기준 도우미로 적는다. */
  readonly at: number;
  readonly formBit: FormBit;
  readonly axes: readonly [HistoryAxis, HistoryAxis, HistoryAxis, HistoryAxis];
}

/** 기록 봉투. entries 는 최신이 앞이고 최대 V40_STORAGE.historyMax 건. */
export interface HistoryEnvelope {
  readonly schema: 1;
  readonly version: V40Version;
  readonly entries: readonly HistoryEntry[];
}

/**
 * 비교 기록 읽기의 결과. 각 상태의 뜻:
 *  - ready: 30일 안의 건이 하나 이상(최신이 앞).
 *  - empty: 키가 없거나, 봉투는 올바른데 건이 하나도 없음.
 *  - expired: 올바른 건이 있지만 모두 30일이 지남(now - at 가 기간 이상).
 *  - invalid: 형식 위반 하나라도(모르는 키, 4건 이상, 최신이 앞이 아님, 미래 시각, 다른 축의 글자, 글자 없는 세기 등). 그 기록은 통째로 쓰지 않는다.
 *  - unavailable: 저장소 접근이 던짐.
 */
export type HistoryRead =
  | { readonly status: "ready"; readonly entries: readonly HistoryEntry[] }
  | { readonly status: "empty" | "invalid" | "expired" | "unavailable"; readonly entries: readonly [] };

/**
 * 이 브라우저에 이전 판(v3.1) 진행 저장이 있는가. 키와 savedAt 만 읽고 v3.1 모듈을 가져오지 않는다.
 * 화면은 savedAt 이 null 이 아닐 때만 「이전 판에서 하던 답이 있어요」 카드를 보여 준다(present 만 true 인 값은 풀 수 없는 옛 값이라 카드 없이 둔다).
 */
export interface LegacyProgressProbe {
  /** 키에 비어 있지 않은 문자열이 있다(JSON 으로 풀리지 않아도 true). */
  readonly present: boolean;
  /** 키의 값이 JSON 객체이고 savedAt 이 30일 안이고 미래가 아닌 안전한 정수일 때만 값이 있다. 그 밖에는 null. */
  readonly savedAt: number | null;
}

/** 브라우저 저장소의 필요한 부분(테스트에서 가짜로 바꿀 수 있게). */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// ===========================================================================
// 10. 클라이언트와 입구
// ===========================================================================

/** 입구(entry.ts)가 해시 a, b 를 푼 결과. 서버와 첫 하이드레이션은 빈 값으로 그린다. */
export interface V40EntryInitial {
  /** 링크로 받은 상대의 답(a 만 있는 링크). 메모리에만 두고 이 브라우저에 저장하지 않는다. */
  readonly partner: DecodedCode | null;
  /**
   * 두 사람 결과 링크(a 와 b). 이 화면은 이 브라우저에 아무것도 쓰지 않고(진행 저장, 비교 기록, 선호, 지우기 모두), 읽는 것은 저장된 본인 답을
   * 「나」 표시에 쓰기 위한 readProgress 한 번뿐이다(detectPerspective). 상대 답을 저장하지 않고 읽어도 저장 기간이 늘지 않는다.
   */
  readonly both: { readonly first: DecodedCode; readonly second: DecodedCode } | null;
}

export interface WeddingCodeV40ClientProps {
  /** 링크를 만들 때 쓰는 출처(예: https://hanbang.ai). 서버에서 정해 내려준다. */
  readonly shareOrigin: string;
  readonly initial: V40EntryInitial;
  /** 해시 해석이 끝났는가. 저장소 읽기와 intro_viewed 전송의 문이다(false 이면 저장소를 읽지 않는다). */
  readonly resolved: boolean;
  /** 라운지(/preparation-style) 안에서 쓰는가. 하단 고정 막대에 앱 셸 하단 탭 여백을 둔다. */
  readonly embedded?: boolean;
  /** 처음부터 다시 하기와 깨진 링크에서 시작하기가 부르는 함수. 입구가 해시와 쿼리를 지운다. */
  readonly onRestart?: (message?: string) => void;
  /** 화면 위에 한 번 보여 줄 안내(예: 링크를 읽지 못했어요). */
  readonly initialNotice?: string;
}

/** 이용 통계 placement 값(16자 이하 소문자). 이미 고지한 속성 안에서만 쓴다. */
export type V40Placement = "intro" | "c1" | "c2" | "c3" | "c4" | "self" | "result" | "edit" | "retest" | "link";

// ===========================================================================
// 11. 입력 컴포넌트 props와 고정 표본
// ===========================================================================

/**
 * 입력 컴포넌트 공통 props. 컴포넌트는 뷰 데이터만 받으며 극, 값, 키를 볼 수 없다. 어떤 카드나 칸도 disabled 로 만들지 않는다
 * (막는 것은 aria-disabled 와 이유 문구로). ItemFrame 이 캡션, 앞말(react 는 인용 블록), 입력, 두 넘기기 단추(잘 모르겠어요 / 제 상황과 안 맞아요)를 감싸고
 * 넘기기는 `onAnswer({ fmt: "escape", which })` 로 부른다. 지난 일 떠올리기의 「이런 일이 없었어요」 카드는 ChoiceInput 안에서 같은 escape na 를 부른다.
 */
export interface ItemInputProps<TView extends ItemView = ItemView> {
  readonly view: TView;
  /** 지금 화면 답(drafts 의 중간 상태 포함). 아직 없으면 null. */
  readonly value: ViewAnswer | null;
  /** 답이 바뀔 때마다 부른다. bestworst 와 split 은 중간 상태도 부른다. */
  readonly onAnswer: (answer: ViewAnswer) => void;
  /** DOM id 와 라디오 name 의 접두어(한 화면에 두 문항이 있어도 겹치지 않게). */
  readonly idPrefix: string;
  /** 다음을 눌렀는데 이 문항이 아직 완성되지 않았다(칸을 다 놓지 않았거나 하나만 골랐다). 입력이 남은 것을 aria-live 로 안내한다. */
  readonly incomplete?: boolean;
}

export type PairInputProps = ItemInputProps<PairView | SelfView>;
export type ReactInputProps = ItemInputProps<ReactView>;
export type ChoiceInputProps = ItemInputProps<ChoiceView>;
export type BestWorstInputProps = ItemInputProps<BestWorstView>;
export type SplitInputProps = ItemInputProps<SplitView>;

/** 고정 표본 응답(fixtures.ts). 화면 빌더가 실제 채점 결과로 화면을 그리고 시험이 회귀를 잡는 데 쓴다. */
export interface V40Fixture {
  /** 안정된 영문 이름(README 의 표본 목록). */
  readonly name: string;
  /** 무엇을 보여 주는 표본인지 한 줄. */
  readonly description: string;
  readonly formBit: FormBit;
  /** 68개 문항이 모두 채워진 응답. */
  readonly responses: Responses;
}
