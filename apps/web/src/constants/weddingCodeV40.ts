/**
 * 웨딩코드 4.0 (v4.0-tendency) 고정 자료.
 *
 * 이 파일이 글자 여덟 개, 주제 네 개, 측면 열여섯 개, 세기 세 단계, 구간 이름표와 화면에 나오는
 * 고정 문구의 유일한 출처다. 문항 68개의 문구는 여기에 없고 문항 은행(bank)에 있다.
 * 글자표는 데이터 한 곳이라서, 글자를 바꾸려면 이 파일의 V40_LETTERS 한 곳만 고친다.
 *
 * 규칙
 * - 글자는 대문자 여덟 개(V S W D U F H A)이고 한 글자는 뜻 하나다. 상태 글자(B, M, N, ?)와 소문자 변형은 없다.
 * - 아래 한국어 문구는 설계 문서(spec.md 2절, 6절, 7절, 부록 E)에서 그대로 옮겼다. 다듬으려면 판을 올릴지 먼저 정한다.
 * - 용어(부록 E): 주제 = 네 축 중 하나, 글자 = V S W D U F H A 한 자, 코드 = 네 글자, 세기 = 뚜렷해요 / 기울어요 / 반반이에요,
 *   구간 = 질문을 나눈 네 덩어리, 질문 = 문항 하나.
 * - 이 파일의 문자열에는 줄표를 쓰지 않고, 숫자로 세기를 말하는 표현도 쓰지 않는다.
 *
 * 타입(Letter, Axis 등)은 여기서 정의하고 lib/weddingCode/v40/types.ts 가 다시 내보낸다. 다른 파일은 types.ts 에서 가져온다.
 */

export const WEDDING_CODE_V40_VERSION = "v4.0-tendency" as const;

// ---------------------------------------------------------------------------
// 기본 유니온
// ---------------------------------------------------------------------------

/** 주제(축) 키. 코드의 글자 위치 순서와 같다. */
export const V40_AXIS_KEYS = ["money", "process", "scope", "support"] as const;
export type Axis = (typeof V40_AXIS_KEYS)[number];

/** 글자 여덟 개. 앞 글자(front)는 값이 양수, 뒤 글자(back)는 음수 쪽이다. */
export const V40_LETTER_LIST = ["V", "S", "W", "D", "U", "F", "H", "A"] as const;
export type Letter = (typeof V40_LETTER_LIST)[number];
export type FrontLetter = "V" | "W" | "U" | "H";
export type BackLetter = "S" | "D" | "F" | "A";

/** 축의 두 방향. front = 앞 글자(V W U H), back = 뒤 글자(S D F A). */
export type Side = "front" | "back";
/** 카드나 보기가 향하는 극. neutral 은 칸 나누기의 중립 항목에만 있다. */
export type Pole = Side | "neutral";

/** 측면 열여섯 개. 화면에 보이지 않는 내용 범위이며 이름이 열여섯 개 모두 다르다. */
export const V40_FACET_KEYS = [
  "limit", "check", "worth", "moment",
  "search", "detail", "report", "owner",
  "timing", "circle", "final", "form",
  "vent", "fight", "give", "recover",
] as const;
export type FacetKey = (typeof V40_FACET_KEYS)[number];

/** 질문 형식. recall 과 instant 는 문서의 「고르기」 두 하위 종류(지난 일 떠올리기 / 그때 나는)다. */
export const V40_FORMATS = ["pair", "react", "recall", "instant", "bestworst", "split", "self"] as const;
export type Format = (typeof V40_FORMATS)[number];
/** 축 합에 들어가는 채점 형식 여섯 개. self 는 뺀다. */
export type ScoredFormat = Exclude<Format, "self">;

/** 세기 세 단계. clear = 뚜렷해요, lean = 기울어요, even = 반반이에요. 숫자로 화면에 내지 않는다. */
export type StrengthBand = "clear" | "lean" | "even";

/** 구간 번호. 0 처음, 1 이어서, 2 조금만 더, 3 마지막 구간, 4 마지막 정리(자기 선택). */
export type SectionIndex = 0 | 1 | 2 | 3 | 4;
/** 폼 비트. 0 이면 문항 은행에 적힌 순서 그대로, 1 이면 위아래, 좌우, 보기 순서를 뒤집는다. */
export type FormBit = 0 | 1;

// ---------------------------------------------------------------------------
// 주제(축)
// ---------------------------------------------------------------------------

export interface AxisInfo {
  readonly key: Axis;
  /** 코드에서 글자 위치. 0 이 첫 글자. */
  readonly order: 0 | 1 | 2 | 3;
  /** 주제 이름(글자 읽는 법 표의 왼쪽 칸). */
  readonly title: string;
  /** 코드 줄 글자 위에 붙는 작은 주제 이름. */
  readonly topic: string;
  /** 주제 블록 위에 놓을 수 있는 질문 문장. */
  readonly question: string;
  readonly front: Letter;
  readonly back: Letter;
  /** 이 주제의 측면 네 개(문항 은행 순서와 같다). */
  readonly facets: readonly [FacetKey, FacetKey, FacetKey, FacetKey];
  /** 반반이에요 문장의 앞 조각. 뒤에 V40_SUFFIX.even(「 어느 쪽으로도 크게 기울지 않았어요.」)을 붙이면 evenSentence 가 된다. */
  readonly evenPiece: string;
  readonly evenSentence: string;
  /** 두 사람 화면에서 이 주제의 글자가 서로 다를 때 붙이는 한 줄(끝 마침표 없음). */
  readonly differentNote: string;
}

export const V40_AXES = [
  {
    key: "money", order: 0, title: "돈을 정할 때", topic: "돈",
    question: "돈이 걸린 결정을 내릴 때 무엇을 먼저 붙잡나요? 총액과 조건 같은 숫자인가요, 결혼식이 끝난 뒤에 남을 장면인가요?",
    front: "V", back: "S", facets: ["limit", "check", "worth", "moment"],
    evenPiece: "돈은 조건과 장면",
    evenSentence: "돈은 조건과 장면 어느 쪽으로도 크게 기울지 않았어요.",
    differentNote: "돈을 정할 때 무엇부터 보는지가 다를 수 있어요",
  },
  {
    key: "process", order: 1, title: "준비를 굴릴 때", topic: "준비",
    question: "찾고 고르고 확인하는 준비 과정을 어떻게 굴리고 싶나요? 둘이 함께 하나요, 나눠 맡고 결과로 만나나요?",
    front: "W", back: "D", facets: ["search", "detail", "report", "owner"],
    evenPiece: "준비는 같이 하기와 나눠 하기",
    evenSentence: "준비는 같이 하기와 나눠 하기 어느 쪽으로도 크게 기울지 않았어요.",
    differentNote: "준비를 굴리는 방식이 다를 수 있어요",
  },
  {
    key: "scope", order: 2, title: "함께 정하는 사람", topic: "정하는 사람",
    question: "결혼 준비의 결정을 누구까지 함께 정하나요? 우리 둘이 먼저 정하나요, 정하기 전에 가족의 마음도 모으나요?",
    front: "U", back: "F", facets: ["timing", "circle", "final", "form"],
    evenPiece: "정하는 사람은 둘과 가족",
    evenSentence: "정하는 사람은 둘과 가족 어느 쪽으로도 크게 기울지 않았어요.",
    differentNote: "누구까지 함께 정할지가 다를 수 있어요",
  },
  {
    key: "support", order: 3, title: "지쳤을 때", topic: "지쳤을 때",
    question: "준비가 힘들어 지친 날 무엇이 먼저 필요한가요? 마음을 알아주는 것인가요, 할 일을 덜어 내는 것인가요? 상대가 지쳤을 때 내가 하는 쪽도 함께 물어요.",
    front: "H", back: "A", facets: ["vent", "fight", "give", "recover"],
    evenPiece: "지친 날에는 마음과 할 일",
    evenSentence: "지친 날에는 마음과 할 일 어느 쪽으로도 크게 기울지 않았어요.",
    differentNote: "지친 날 필요한 도움이 다를 수 있어요",
  },
] as const satisfies readonly AxisInfo[];

/** 두 사람 화면에서 두 사람이 둘 다 기울어요 이상이고 글자가 같을 때 붙이는 한 줄(끝 마침표 없음). */
export const V40_SAME_LETTER_NOTE = "같은 쪽이어도 이유는 다를 수 있어요";

// ---------------------------------------------------------------------------
// 글자
// ---------------------------------------------------------------------------

export interface LetterInfo {
  readonly letter: Letter;
  readonly axis: Axis;
  readonly side: Side;
  /** 글자 이름. 글자 읽는 법 표에 「V 조건 먼저」처럼 글자와 함께 적는다. */
  readonly name: string;
  /** 작은 영어 낱말(Verify, Scene, With, Divide, Us, Family, Heart, Action). */
  readonly english: string;
  /** 영어 낱말과 한국어 풀이를 붙인 줄. */
  readonly mnemonic: string;
  /** 뜻 한 줄. 글자 하나는 이 뜻 하나만 가진다. */
  readonly meaning: string;
  /** 이렇게 나타날 수 있어요 네 줄. */
  readonly appearances: readonly [string, string, string, string];
  /** 이 글자가 말하는 범위를 좁히는 문장(이 글자는 ~만 말해요.). */
  readonly scopeNote: string;
  /** 둘이 이야기해 봐요 뒤에 붙는 질문 한 줄(라벨 「둘이 이야기해 봐요:」는 V40_LABELS.talk). */
  readonly talk: string;
  /** 이렇게 해 봐요 뒤에 붙는 제안 한 줄(라벨 「이렇게 해 봐요:」는 V40_LABELS.tryThis). */
  readonly tryThis: string;
  /** 한 줄 읽기 조각. 뒤에 「 쪽으로 답했어요.」를 붙이면 answerSentence 가 된다. */
  readonly readingPiece: string;
  /** 「답을 모아 보니」에 나오는 뚜렷해요 또는 기울어요 주제의 문장. */
  readonly answerSentence: string;
}

/** 글자 정의 순서는 V S W D U F H A 로 고정한다(축 순서, 축 안에서 앞 글자, 뒤 글자). */
export const V40_LETTERS = [
  {
    letter: "V", axis: "money", side: "front", name: "조건 먼저", english: "Verify", mnemonic: "Verify: 조건을 따져 봐요",
    meaning: "돈이 걸린 결정에서 총액, 한도, 계약 조건 같은 숫자를 먼저 맞춰 보고 정해요.",
    appearances: [
      "견적서를 받으면 총액과 추가금부터 표로 옮겨 적고 예산선과 맞춰 봐요.",
      "계약 전에 환불과 취소 조건을 문서로 받아 끝까지 읽어야 마음이 놓여요.",
      "남는 돈은 결혼식 뒤의 생활과 예비 쪽에 두고 싶어요.",
      "오늘 정하면 혜택이라는 말에도 다른 곳과 견줘 보고 정해요.",
    ],
    scopeNote: "이 글자는 돈을 정하는 순서만 말해요.",
    talk: "총액 안에서 끝까지 지키고 싶은 건 뭐예요?",
    tryThis: "총액 안에서 어디까지가 필수인지 함께 적어 두세요.",
    readingPiece: "돈은 조건과 총액부터 맞춰 보는",
    answerSentence: "돈은 조건과 총액부터 맞춰 보는 쪽으로 답했어요.",
  },
  {
    letter: "S", axis: "money", side: "back", name: "장면 먼저", english: "Scene", mnemonic: "Scene: 남을 장면을 그려 봐요",
    meaning: "돈이 걸린 결정에서 결혼식이 끝난 뒤 남을 장면과 분위기를 먼저 그려 보고 정해요.",
    appearances: [
      "마음에 드는 항목부터 골라 두고 총액은 나중에 맞춰 봐요.",
      "계약 전에 그 공간에 직접 앉아 보고 그날이 그려지는지 확인해요.",
      "남는 돈은 사진이나 꽃처럼 그날 남을 것에 쓰고 싶어요.",
      "「여기다」 싶은 곳을 만나면 그날 마음을 정해요.",
    ],
    scopeNote: "이 글자는 돈을 정하는 순서만 말해요.",
    talk: "마음이 움직여도 꼭 확인하고 싶은 조건이 있나요?",
    tryThis: "계약 조건은 서면으로 받아 두세요. 마음에 드는 곳을 고를 때도 든든해요.",
    readingPiece: "돈은 남을 장면부터 그려 보는",
    answerSentence: "돈은 남을 장면부터 그려 보는 쪽으로 답했어요.",
  },
  {
    letter: "W", axis: "process", side: "front", name: "같이 하기", english: "With", mnemonic: "With: 과정을 함께해요",
    meaning: "찾고, 고르고, 확인하는 준비 과정을 둘이 함께 해요.",
    appearances: [
      "웨딩홀 투어와 업체 상담은 시간을 맞춰 둘이 같이 다녀요.",
      "청첩장 문구나 배경음악 같은 작은 것도 같이 정하고 싶어요.",
      "일이 어디까지 됐는지 중간중간 주고받아야 마음이 놓여요.",
      "막히는 일이 생기면 혼자 붙들지 않고 바로 같이 풀어요.",
    ],
    scopeNote: "이 글자는 준비 과정을 함께하는 방식만 말해요.",
    talk: "꼭 같이 해야 하는 일과 각자 해도 되는 일은 뭐예요?",
    tryThis: "같이 갈 상담과 따로 맡을 일을 처음에 나눠 적어 두면 서로 덜 서운해요.",
    readingPiece: "준비는 같이 하는",
    answerSentence: "준비는 같이 하는 쪽으로 답했어요.",
  },
  {
    letter: "D", axis: "process", side: "back", name: "나눠 하기", english: "Divide", mnemonic: "Divide: 일을 나눠 맡아요",
    meaning: "준비할 일을 나눠 맡고, 맡은 사람이 이끌어 결과로 만나요.",
    appearances: [
      "한 사람이 후보를 추려 오고 마지막 선택만 같이 해요.",
      "작은 결정은 맡은 사람이 정하면 그대로 따라도 좋아요.",
      "정리가 끝난 뒤에 한 번에 알려 주는 편이 오히려 편해요.",
      "시작할 때 담당과 마감을 나눠 두면 내 몫은 끝까지 가져가요.",
    ],
    scopeNote: "이 글자는 일을 맡기고 믿는 방식만 말해요.",
    talk: "맡긴 일에서 중간에 알려 줬으면 하는 순간이 있나요?",
    tryThis: "맡긴 일마다 중간에 알려 줄 시점을 하나씩 정해 두세요.",
    readingPiece: "준비는 나눠 맡는",
    answerSentence: "준비는 나눠 맡는 쪽으로 답했어요.",
  },
  {
    letter: "U", axis: "scope", side: "front", name: "둘이 정하기", english: "Us", mnemonic: "Us: 우리 둘이 먼저 정해요",
    meaning: "결혼 준비의 결정을 우리 둘이 먼저 정하고, 가족과는 정한 뒤에 나눠요.",
    appearances: [
      "정하기 전에 미리 말씀드리기보다 정해진 뒤에 알려요.",
      "초대 명단은 두 사람의 관계를 기준으로 정해요.",
      "가족 생각이 달라도 마지막 선택은 둘이 해요.",
      "식의 방식은 우리에게 맞게 새로 짜는 쪽이 좋아요.",
    ],
    scopeNote: "이 글자는 결정에 함께하는 사람의 범위만 말해요.",
    talk: "어른들께 알리기 전에 둘이 꼭 맞춰 둘 건 뭐예요?",
    tryThis: "어른들께 알리기 전에 둘이 꼭 맞춰 둘 것 세 가지를 적어 보세요.",
    readingPiece: "정할 때는 둘이 먼저 정하는",
    answerSentence: "정할 때는 둘이 먼저 정하는 쪽으로 답했어요.",
  },
  {
    letter: "F", axis: "scope", side: "back", name: "가족과 정하기", english: "Family", mnemonic: "Family: 가족과 함께 정해요",
    meaning: "결혼 준비의 결정을 정하기 전에 가족의 마음과 의견을 함께 모아요.",
    appearances: [
      "정하기 전에 미리 말씀드려야 나중에 서운함이 없다고 봐요.",
      "부모님 쪽 인연과 어른들이 편한 자리도 넉넉히 살펴요.",
      "가족이 서운해하시면 뜻을 조금 내려놓고 마음을 풀어 드리고 싶어요.",
      "집안에서 해 오던 방식을 살려 맞추는 쪽이 마음 편해요.",
    ],
    scopeNote: "이 글자는 결정에 함께하는 사람의 범위만 말해요.",
    talk: "어른들 뜻을 듣고도 끝까지 지키고 싶은 건 뭐예요?",
    tryThis: "어른들께 여쭐 것과 이미 둘이 정한 것을 나눠서 말씀드려 보세요.",
    readingPiece: "정할 때는 가족의 마음도 먼저 모으는",
    answerSentence: "정할 때는 가족의 마음도 먼저 모으는 쪽으로 답했어요.",
  },
  {
    letter: "H", axis: "support", side: "front", name: "마음 먼저", english: "Heart", mnemonic: "Heart: 마음을 먼저 알아줘요",
    meaning: "지치고 힘든 날, 해결보다 마음을 알아주는 게 먼저인 쪽이에요.",
    appearances: [
      "힘들다고 털어놓을 때 해결책보다 「많이 힘들었겠다」는 말이 먼저 필요해요.",
      "다툰 뒤에는 서로 마음이 풀렸는지 확인하고 다시 이야기해요.",
      "상대가 지쳐 보이면 조언보다 「오늘 어땠어?」부터 물어요.",
      "마음을 말로 꺼내 놓아야 풀려요.",
    ],
    scopeNote: "이 글자는 지친 날 도움이 오가는 순서만 말해요.",
    talk: "들어주기만 하면 되는 날과 같이 정리해 줬으면 하는 날을 어떻게 알릴까요?",
    tryThis: "힘든 날에는 「들어줘」와 「같이 정리해 줘」 중 어느 쪽인지 먼저 말해 두세요.",
    readingPiece: "지친 날에는 마음부터 알아주는",
    answerSentence: "지친 날에는 마음부터 알아주는 쪽으로 답했어요.",
  },
  {
    letter: "A", axis: "support", side: "back", name: "할 일 먼저", english: "Action", mnemonic: "Action: 할 일부터 움직여요",
    meaning: "지치고 힘든 날, 할 일을 정리하고 덜어 내는 게 먼저인 쪽이에요.",
    appearances: [
      "털어놓은 뒤 방법이 하나라도 나와야 마음이 가벼워져요.",
      "다툰 뒤에는 원인을 짚고 다음 규칙을 정해야 풀려요.",
      "상대가 지친 밤에는 내일 할 일 하나를 대신 가져가 줘요.",
      "일 하나를 끝내면 기분이 풀려요.",
    ],
    scopeNote: "이 글자는 지친 날 도움이 오가는 순서만 말해요.",
    talk: "해결보다 그냥 들어주면 좋은 날은 어떻게 알릴까요?",
    tryThis: "정리가 먼저인 사람도 「오늘은 들어만 줘」가 필요한 날이 있다는 걸 상대에게 알려 두세요.",
    readingPiece: "지친 날에는 할 일부터 덜어 내는",
    answerSentence: "지친 날에는 할 일부터 덜어 내는 쪽으로 답했어요.",
  },
] as const satisfies readonly LetterInfo[];

/** 글자 설명 안의 고정 라벨. 「라벨: 내용」 꼴로 이어 붙인다. */
export const V40_LABELS = {
  appearances: "이렇게 나타날 수 있어요",
  talk: "둘이 이야기해 봐요",
  tryThis: "이렇게 해 봐요",
  moreToggle: "더 보기",
  reviewAxis: "이 주제 답 다시 보기",
  myLetter: "내 글자",
  collectedTitle: "답을 모아 보니",
  answersMine: "내가 고른 답",
  answersOpposite: "반대로 고른 답",
} as const;

/**
 * 반반이에요 문장 끝 조각. readingPiece 와 같은 방식으로 axis.evenPiece 뒤에 붙이면 evenSentence 다.
 * 「비슷하게 나왔어요」라고 하지 않는다: 반반이에요는 한쪽으로 약하게만 답했거나, 가운데 칸을 많이 눌렀거나, 힌트로 세기가 한 단계
 * 내려간 경우에도 나와서 두 쪽이 같은 만큼 나왔다는 말은 거짓이 될 수 있다. 어느 쪽으로도 크게 기울지 않았다는 말만 한다.
 */
export const V40_SUFFIX = {
  answered: " 쪽으로 답했어요.",
  even: " 어느 쪽으로도 크게 기울지 않았어요.",
} as const;

const LETTER_INDEX: Readonly<Record<Letter, number>> = { V: 0, S: 1, W: 2, D: 3, U: 4, F: 5, H: 6, A: 7 };

/** 글자 정보. 글자는 대문자 한 자여야 한다. */
export function letterInfo(letter: Letter): LetterInfo {
  return V40_LETTERS[LETTER_INDEX[letter]];
}

export function isLetter(value: unknown): value is Letter {
  return typeof value === "string" && (V40_LETTER_LIST as readonly string[]).includes(value);
}

/** 같은 주제의 반대쪽 글자(V 는 S, S 는 V, W 는 D ...). */
export function oppositeLetter(letter: Letter): Letter {
  const info = letterInfo(letter);
  const axis = axisInfo(info.axis);
  return info.side === "front" ? axis.back : axis.front;
}

export function axisOfLetter(letter: Letter): Axis {
  return letterInfo(letter).axis;
}

export function sideOfLetter(letter: Letter): Side {
  return letterInfo(letter).side;
}

export function axisInfo(axis: Axis): AxisInfo {
  return V40_AXES[V40_AXIS_KEYS.indexOf(axis)];
}

/** 주제와 방향에 해당하는 글자. */
export function letterOf(axis: Axis, side: Side): Letter {
  const info = axisInfo(axis);
  return side === "front" ? info.front : info.back;
}

// ---------------------------------------------------------------------------
// 측면(화면에는 보이지 않는 내용 범위)
// ---------------------------------------------------------------------------

export interface FacetInfo {
  readonly key: FacetKey;
  readonly axis: Axis;
  /** 주제 안에서의 순서(0 에서 3). 문항 은행 배치의 f 와 같다. */
  readonly order: 0 | 1 | 2 | 3;
  /** 내부 이름. 화면에 내지 않는다. */
  readonly name: string;
  /** 재는 것. 화면에 내지 않는다. */
  readonly probes: string;
  /** 파일럿 뒤 조치 메모(측면 give 에만 있다). 화면에 내지 않는다. */
  readonly pilotNote?: string;
}

export const V40_FACETS = [
  { key: "limit", axis: "money", order: 0, name: "총액 정하기", probes: "총액의 선을 먼저 긋고 그 안에서 고르는지, 끌리는 곳을 먼저 고르고 총액을 나중에 맞추는지" },
  { key: "check", axis: "money", order: 1, name: "계약 확인", probes: "추가금과 환불 조건을 문서로 대조하는지, 공간에 직접 가 보고 분위기로 확인하는지" },
  { key: "worth", axis: "money", order: 2, name: "쓰는 곳", probes: "남는 돈과 하루 쓰고 끝나는 항목을 결혼식 뒤의 생활과 예비 쪽에 두는지, 그날 남을 순간(사진, 꽃, 조명) 쪽에 두는지" },
  { key: "moment", axis: "money", order: 3, name: "결정하는 순간", probes: "혜택 압박과 후회 예상 앞에서 견주고 시간을 두는지, 끌리는 순간에 정하는지" },
  { key: "search", axis: "process", order: 0, name: "후보 찾기", probes: "투어·상담·후보 찾기를 둘이 함께 하는지, 한 사람이 추려 오는지" },
  { key: "detail", axis: "process", order: 1, name: "작은 결정", probes: "답례품·문구·배경음악 같은 작은 결정까지 같이 정하는지, 맡은 사람을 믿고 따르는지" },
  { key: "report", axis: "process", order: 2, name: "진행 알리기", probes: "진행 상황을 중간중간 주고받는지, 정리가 끝난 뒤 한 번에 알리는지" },
  { key: "owner", axis: "process", order: 3, name: "담당과 막힐 때", probes: "시작할 때 담당과 마감을 나누고 내 몫은 끝까지 가져가는지, 막히면 바로 같이 푸는지" },
  { key: "timing", axis: "scope", order: 0, name: "알리는 때", probes: "정한 뒤에 알리는지, 정하기 전에 미리 의논하는지" },
  { key: "circle", axis: "scope", order: 1, name: "초대와 자리", probes: "초대 명단·자리·순서를 둘의 관계 기준으로 짜는지, 부모님 쪽 인연과 어른들이 편한 자리도 함께 보는지" },
  { key: "final", axis: "scope", order: 2, name: "마지막 선택", probes: "의견이 갈리거나 가족이 서운해하실 때 둘의 선택을 지키는지, 뜻을 조금 내려놓고 마음을 풀어 드리는지" },
  { key: "form", axis: "scope", order: 3, name: "식의 방식", probes: "식의 방식을 우리 방식으로 새로 짜는지, 집안에서 해 오던 방식을 살려 맞추는지" },
  { key: "vent", axis: "support", order: 0, name: "털어놓을 때", probes: "힘들다고 털어놓은 직후 반가운 첫 반응이 공감인지, 해결 방법인지 (받는 쪽)" },
  { key: "fight", axis: "support", order: 1, name: "다툰 뒤", probes: "마음이 풀렸는지 먼저 확인하고 싶은지, 원인을 짚고 다음 규칙을 정해야 풀리는지" },
  {
    key: "give", axis: "support", order: 2, name: "상대가 지쳤을 때",
    probes: "내가 해 주는 쪽: 곁에서 들어 주는지, 방법을 꺼내거나 일을 가져가는지.",
    pilotNote: "파일럿에서 다른 측면과 함께 움직이지 않으면(측면-축 상관 0.30 미만) v4.1에서 글자 합에서 빼고 표시 전용으로 돌리고 이 4문항은 받는 쪽 문항으로 교체한다",
  },
  { key: "recover", axis: "support", order: 3, name: "혼자 풀릴 때", probes: "마음을 말로 꺼내야 풀리는지, 일 하나를 끝내야 풀리는지" },
] as const satisfies readonly FacetInfo[];

export function facetInfo(key: FacetKey): FacetInfo {
  return V40_FACETS[V40_FACET_KEYS.indexOf(key)];
}

export function axisOfFacet(key: FacetKey): Axis {
  return facetInfo(key).axis;
}

// ---------------------------------------------------------------------------
// 세기
// ---------------------------------------------------------------------------

export interface StrengthInfo {
  readonly band: StrengthBand;
  /** 「내 글자 · 기울어요」처럼 글자 옆에 적는 낱말. */
  readonly label: string;
  /** 문장. even 은 글자에 따라 달라서 evenStrengthSentence 로 만든다. */
  readonly sentence: string | null;
}

export const V40_STRENGTH = {
  clear: { band: "clear", label: "뚜렷해요", sentence: "이 주제에서는 답이 한쪽으로 뚜렷하게 모였어요." },
  // 기울어요는 반대쪽 답이 하나도 없어도(모두 한쪽으로 약하게만 답해도) 나올 수 있어서 「반대쪽으로 고른 답도 있었어요」라고 하지 않는다.
  lean: { band: "lean", label: "기울어요", sentence: "이 주제에서는 대체로 이쪽으로 답했어요. 뚜렷하게 한쪽으로 모인 정도는 아니에요." },
  even: { band: "even", label: "반반이에요", sentence: null },
} as const satisfies Record<StrengthBand, StrengthInfo>;

/** 코드 줄에서 반반이에요 글자 아래에 붙는 짧은 표시. */
export const V40_EVEN_MARK = "반반";
/** 반반이에요 글자가 하나라도 있을 때 코드 줄 아래에 한 줄. */
export const V40_EVEN_CODE_NOTE = "어느 쪽으로도 크게 기울지 않은 주제는 「반반」으로 적었어요.";
/**
 * 「반반」 중에 힌트(위치 반복, 건너뜀)가 세기를 한 단계 낮춰서 된 것이 하나라도 있을 때 위 한 줄 대신 쓴다.
 * 낮추기 전에는 한쪽으로 기울어 있던 주제라서 「크게 기울지 않았어요」라고만 하면 아래에 보여 주는 답과 어긋난다.
 */
export const V40_EVEN_CODE_NOTE_LOWERED = "「반반」은 어느 쪽으로도 크게 기울지 않았거나, 세기를 한 단계 낮춘 주제예요.";

/**
 * 반반이에요 주제의 세기 문장. shown 은 코드에 적은 글자다(그 주제의 두 글자 중 하나).
 * 글자는 「V 조건 먼저」처럼 글자와 이름을 낫표로 묶어 적는다(화면 어디서나 글자 한 자 뒤에는 그 글자의 이름이 온다).
 * 낫표 뒤 조사는 와, 를로 고정이라 글자 이름의 받침을 따지지 않는다.
 * 「두 쪽이 비슷하게 나왔어요」라고 하지 않는다(한쪽으로 약하게만 답했거나 세기가 한 단계 내려간 경우에도 반반이에요가 나온다).
 * 코드에는 글자를 하나만 적어야 해서 그 글자를 적었다는 이유만 밝힌다.
 */
export function evenStrengthSentence(axis: Axis, shown: Letter): string {
  const info = axisInfo(axis);
  const front = letterInfo(info.front);
  const back = letterInfo(info.back);
  const shownInfo = letterInfo(shown);
  return `「${front.letter} ${front.name}」와 「${back.letter} ${back.name}」 중 어느 쪽으로도 크게 기울지 않았어요. 코드에는 한 글자만 적을 수 있어서 「${shownInfo.letter} ${shownInfo.name}」를 적었어요.`;
}

/**
 * 힌트가 세기를 기울어요에서 반반이에요로 낮춘 주제의 세기 문장. 낮추기 전에는 한쪽으로 기울어 있었으므로 「어느 쪽으로도 크게 기울지 않았어요」라고 하지 않고,
 * 세기를 낮췄다는 사실과 코드에 적은 글자만 밝힌다(어느 쪽으로 답이 모였다는 말도 하지 않는다). 고른 답은 이 문장 아래에 그대로 나온다.
 */
export function loweredStrengthSentence(shown: Letter): string {
  const shownInfo = letterInfo(shown);
  return `세기를 한 단계 낮춰 「반반이에요」로 적었어요. 고른 답은 아래에 그대로 보여 드려요. 코드에는 한 글자만 적을 수 있어서 「${shownInfo.letter} ${shownInfo.name}」를 적었어요.`;
}

/** 세기를 한 단계 낮춘다(뚜렷해요는 기울어요, 기울어요는 반반이에요, 반반이에요는 그대로). */
export function demoteBand(band: StrengthBand): StrengthBand {
  return band === "clear" ? "lean" : "even";
}

// ---------------------------------------------------------------------------
// 구간 이름표와 마지막 정리
// ---------------------------------------------------------------------------

/** 질문을 나눈 네 구간의 이름표. 진행 막대와 쉬는 카드에만 붙고 구간마다 따로 카드를 두지 않는다. */
export const V40_SECTION_NAMES = ["처음", "이어서", "조금만 더", "마지막 구간"] as const;
export const V40_WRAP_UP_NAME = "마지막 정리";
/** 진행 막대 5칸의 이름(네 구간 + 마지막 정리). SectionIndex 로 찾는다. */
export const V40_SEGMENT_NAMES = ["처음", "이어서", "조금만 더", "마지막 구간", "마지막 정리"] as const;
/** 낭독기용 구간 알림(SectionIndex 로 찾는다). */
export const V40_SECTION_ARIA = [
  "지금 첫 번째 구간이에요",
  "지금 두 번째 구간이에요",
  "지금 세 번째 구간이에요",
  "지금 네 번째 구간이에요",
  "지금 마지막 정리예요",
] as const;

/** 마지막 정리(자기 선택) 화면 문구. */
export const V40_WRAP_UP = {
  /** 마지막 정리 카드. */
  intro: "마지막 정리예요. 하나씩만 더 골라 주세요.",
  /** 자기 선택 화면 제목. 이 말만 적는다. */
  title: "직접 고른 쪽",
  /** 자기 선택 문항의 공통 물음. */
  prompt: "스스로는 어느 쪽에 더 가깝다고 생각해요?",
} as const;

/** 구간 사이 쉬는 카드. 구간 0, 1, 2 뒤에 하나씩 모두 세 개다. */
export const V40_REST_CARD = {
  saved: "여기까지 저장했어요. 쉬었다 와도 돼요.",
  autosaveOff: "쉬었다 오려면 자동 저장을 켜 주세요.",
} as const;

// ---------------------------------------------------------------------------
// 형식별 고정 문구
// ---------------------------------------------------------------------------

/** 형식 안내는 그 형식이 처음 나오는 화면에만 한 줄. recall 과 instant 는 choose 안내를 함께 쓴다. */
export type GuideKey = "pair" | "react" | "choose" | "bestworst" | "split";

export const V40_FORMAT_GUIDES: Readonly<Record<GuideKey, string>> = {
  pair: "더 나 같은 쪽을 골라 주세요. 얼마나 가까운지도 함께 눌러요.",
  react: "그때 내 마음에 가까운 칸을 눌러 주세요.",
  choose: "가장 가까운 것 하나를 골라 주세요. 해 본 적이 없으면 「이런 일이 없었어요」를 눌러도 돼요.",
  bestworst: "가장 나 같은 것 하나, 가장 나 같지 않은 것 하나를 골라 주세요.",
  split: "6칸을 나눠 놓아 주세요. 한 곳에 몰아도 괜찮아요.",
};

export function guideKeyOf(format: Format): GuideKey | null {
  switch (format) {
    case "pair": return "pair";
    case "react": return "react";
    case "recall":
    case "instant": return "choose";
    case "bestworst": return "bestworst";
    case "split": return "split";
    default: return null;
  }
}

/** 정하는 사람 주제의 첫 문항 위에 한 번 놓는 안내. */
export const V40_ELDER_HINT = "가까운 어른을 떠올려도 돼요";

/** 모든 문항 아래의 두 단추와 지난 일 떠올리기의 보기 하나. 둘 다 빠진 값이다. */
export const V40_ESCAPES = {
  /** 저장값 skip(-). */
  unsure: "잘 모르겠어요",
  /** 저장값 na(_). */
  notApplicable: "제 상황과 안 맞아요",
  /** 지난 일 떠올리기(recall)에만 있는 보기. 저장값은 notApplicable 과 같은 na(_). */
  recallNone: "이런 일이 없었어요",
} as const;

/** 두 가지 중 고르기와 자기 선택의 세기 칸 이름(level 1, 2, 3). */
export const V40_PAIR_LEVEL_LABELS = ["조금", "꽤", "아주"] as const;

/** 가장·가장 아닌 것 두 그룹의 이름. */
export const V40_BESTWORST_LABELS = {
  best: "가장 나 같은 것",
  worst: "가장 나 같지 않은 것",
  /** 같은 카드를 두 그룹에서 고르면 나중에 고른 쪽만 남기고 이 문장을 낭독한다. */
  duplicateAnnounce: "같은 카드를 두 곳에 고를 수 없어서 먼저 고른 쪽을 지웠어요",
} as const;

/** 칸 나누기의 칸 수. 세 항목에 나눠 놓는다. */
export const V40_SPLIT_TOTAL = 6;

/** 두 가지 중 고르기 칸 이름표(낭독용): 「위 카드에 가까워요, 아주」. cardIndex 0 이 위 카드. */
export function pairCellAccessibleName(cardIndex: 0 | 1, level: 1 | 2 | 3): string {
  return `${cardIndex === 0 ? "위 카드" : "아래 카드"}에 가까워요, ${V40_PAIR_LEVEL_LABELS[level - 1]}`;
}

/** 이럴 때 내 마음 칸 위치 이름(낭독용, 왼쪽에서 오른쪽). */
export const V40_REACT_CELL_POSITIONS = [
  "다섯 칸 중 왼쪽 끝",
  "다섯 칸 중 왼쪽에서 두 번째",
  "다섯 칸 중 가운데",
  "다섯 칸 중 오른쪽에서 두 번째",
  "다섯 칸 중 오른쪽 끝",
] as const;

/** 이럴 때 내 마음 칸 이름표. 양끝 칸은 끝 이름을 앞에 붙인다. cell 은 화면 왼쪽부터 0에서 4. */
export function reactCellAccessibleName(cell: 0 | 1 | 2 | 3 | 4, leftEnd: string, rightEnd: string): string {
  const position = V40_REACT_CELL_POSITIONS[cell];
  if (cell === 0) return `${leftEnd}, ${position}`;
  if (cell === 4) return `${rightEnd}, ${position}`;
  return position;
}

/** 이럴 때 내 마음 라디오 그룹 설명(양끝 이름). */
export function reactGroupDescription(leftEnd: string, rightEnd: string): string {
  return `왼쪽 끝은 「${leftEnd}」, 오른쪽 끝은 「${rightEnd}」예요.`;
}

// ---------------------------------------------------------------------------
// 품질 안내(결과 화면)
// ---------------------------------------------------------------------------

export const V40_QUALITY_COPY = {
  /** 같은 위치를 반복해서 누른 응답이 두 형식 이상이면 모든 세기를 한 단계 낮추고 결과 맨 위에 한 줄. */
  rhythmHint: "답이 같은 위치에 여러 번 몰렸어요. 그래서 이번에는 글자 옆 표시(뚜렷해요, 기울어요, 반반이에요)를 모두 한 단계 낮춰 적었어요. 천천히 다시 해 볼 수도 있어요.",
  /** 잘 모르겠어요가 채점 문항 64개 중 16개를 넘으면 모든 세기를 한 단계 낮추고 안내. */
  skipHint: "잘 모르겠다고 넘어간 질문이 많아서 이번에는 글자 옆 표시(뚜렷해요, 기울어요, 반반이에요)를 모두 한 단계 낮춰 적었어요.",
  /** 같은 위치 반복이 세 형식이면 코드를 만들지 않는다. */
  gate: "답이 같은 위치에 몰려 있어서 이번에는 글자를 정하지 못했어요. 처음부터 다시 해 볼 수 있어요.",
  /** 넘어간 질문이 있을 때 한 줄. */
  omitted: "넘어간 질문은 계산에서 뺐어요.",
  /**
   * 유효 답이 12개 미만이거나 세는 측면이 3개 미만인 주제가 있을 때 품질 안내의 한 줄. 코드 줄에서 그 글자 자리를 가운뎃점으로 두는 것을 알린다.
   * 이유(답할 수 있는 질문이 적음)와 다시 보기 안내는 「답을 모아 보니」 문장과 주제 블록에 이미 있어서 여기서는 되풀이하지 않는다.
   */
  unusableAxis: "글자를 정하지 못한 주제는 코드에 「·」로 적었어요.",
  /** 정보가 있는 동점이 마지막 5단계까지 가서 앞 글자(글자 읽는 법 표의 왼쪽 글자)를 임시로 적은 주제. */
  provisional: "두 쪽이 똑같이 나와서, 글자 읽는 법 표에서 왼쪽에 있는 글자를 임시로 적었어요.",
} as const;

/** 유효 답이 없어서 글자를 적지 못한 자리. 코드 문자열과 화면에서 같은 기호를 쓴다. */
export const V40_UNSET_LETTER_MARK = "·";

// ---------------------------------------------------------------------------
// 개수와 코덱 상수
// ---------------------------------------------------------------------------

export const V40_COUNTS = {
  /** 채점 문항: 축 4 x 측면 4 x 형식 4. */
  scored: 64,
  /** 자기 선택 문항(축마다 하나, 채점 제외). */
  self: 4,
  /** 질문 전체. 시작 화면이 「질문은 모두 68개예요」를 여기서 읽는다. */
  items: 68,
  perAxis: 16,
  perFacet: 4,
  sections: 4,
  /** 질문 화면: 구간 4 x 10 + 마지막 정리 2. */
  screens: 42,
  scoredScreens: 40,
  restCards: 3,
  /** 링크 코드 길이: 폼 비트 1 + 채점 문항 64 + 자기 선택 4 + 체크섬 1. */
  codeLength: 70,
  /** 축의 유효 답이 이 수 이상이어야 글자를 만든다. */
  minValidAnswers: 12,
  /** 세는 측면(답 2개 이상)이 이 수 이상이어야 글자를 만든다. */
  minCountedFacets: 3,
  /** 잘 모르겠어요가 이 수를 넘으면 건너뜀 힌트(모든 세기 한 단계 낮춤). */
  skipHintOver: 16,
} as const;

/** 저장 상태 글자 62개. 형식마다 앞에서부터 상태 수만큼 쓴다. */
export const V40_STATE_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** 링크 코드에서 건너뜀(잘 모르겠어요). */
export const V40_SKIP_CHAR = "-";
/** 링크 코드에서 해당 없음(제 상황과 안 맞아요, 이런 일이 없었어요). */
export const V40_NA_CHAR = "_";
/** 진행 저장에서만 쓰는 아직 답하지 않은 문항 표기. 링크 코드에는 없다. */
export const V40_UNANSWERED_CHAR = ".";

/** 형식별 저장 상태 수(건너뜀과 해당 없음 제외). */
export const V40_STATE_COUNTS: Readonly<Record<Format, number>> = {
  pair: 6,
  react: 5,
  recall: 4,
  instant: 4,
  bestworst: 12,
  split: 28,
  self: 6,
};

/** 링크 주소의 해시 키(v, a, b 각 한 번). */
export const V40_LINK_KEYS = { version: "v", first: "a", second: "b" } as const;

/** 브라우저 저장소 키와 기간. 진행 저장은 코드와 분리한 별도 표기를 쓴다. */
export const V40_STORAGE = {
  progressKey: "hanbang:wedding-code:v4:progress",
  historyKey: "hanbang:wedding-code:v4:history",
  /** 결과를 보기 전에 고른 글자. 이 브라우저에만 남고 링크에는 넣지 않는다. */
  letterGuessKey: "hanbang:wedding-code:v4:letter-guess",
  autosaveKey: "hanbang.wedding-code.v4.autosave",
  /** 이전 판 진행 저장의 키. 읽기만 하며 v3.1 모듈을 가져오지 않는다. 값은 v3.1 의 LOCAL_KEY 와 같아야 한다. */
  legacyV31ProgressKey: "hanbang:wedding-code:v3.1:progress",
  /** 이전 판의 자동 저장 끄기 선호 키. 값이 off 면 v4 도 끈 것으로 읽는다. */
  legacyV31AutosaveKey: "hanbang.wedding-code.v31.autosave",
  ttlMs: 30 * 24 * 60 * 60 * 1000,
  historyMax: 3,
  /** 진행 저장 봉투의 문자열 길이 상한. */
  maxEnvelopeLength: 1024,
} as const;
