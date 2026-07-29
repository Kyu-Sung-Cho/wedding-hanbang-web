/**
 * 「오늘 한 마디」 카드 덱 — 운영 표면 전용 결정적 상수.
 *
 * ## 연구 프로토타입과 무엇이 다른가
 *
 * WeddingCode 연구 프로토타입(연구 전용 디렉터리에 격리돼 있다)은 심리측정 M0 문항 21개를
 * 투여하고 그 위에 카드를 얹었다. 문항이 교란변수를 피하려고 일부러 추상적이라
 * (「후보를 처음 찾는 장면」) 그 위에 쓴 카드도 결혼과 무관한 일반 협업 문장이 됐다 —
 * 실측 결과 회수 문장 17개 중 결혼 고유어가 **1개**였고, 파운더가 직접 보고
 * 「재미도 없고 이게 뭔가 싶다」고 판정했다.
 *
 * 이 덱은 **문항이 없다.** 실제 한국 결혼 준비 장면을 그대로 쓰고 설문 없이 바로 카드를
 * 준다. 연구 코드를 import하지 않고, 점수·유형·궁합을 만들지 않으며, 응답을 수집하지
 * 않는다. 측정을 하지 않으므로 연구 게이트(R1·R4)의 적용 대상이 아니다.
 *
 * ## 저작 규칙
 *
 * - `scene` 20~34자. **과잉 구체 디테일 정확히 하나** — 여기서 알아봄이 터진다.
 * - `say` 30자 이내, 물음표로 끝나는 **반말 한 문장**. 그대로 소리 내 말할 수 있어야 한다.
 *   **상대가 답할 수 있는 질문만** 쓴다 — 「추가금 얼마 붙어?」처럼 업체에 물을 말은
 *   상대 앞에서 아무것도 열지 못한다. 그런 사실은 `check`로 내린다.
 * - `when` 하루 속의 자리. 소요 시간 추정이 아니다. 가사 성역할·운전은 쓰지 않는다.
 * - `check` 돈·계약이 실제로 걸린 카드에만. 전체의 1/3을 넘지 않는다 — 넘으면 잔소리가 된다.
 * - 판정 금지(점수·등급·유형·궁합·안전/위험·가격대 분류), 특정 업체명 금지,
 *   의무형(~해야 한다) 금지, 상대 평가·대리 개입 금지, 특정 가족 형태 전제 금지.
 *
 * ## 왜 `kind`가 있나
 *
 * 초판은 28장을 한 목록에 늘어놓았고 앞쪽 10장 중 9장이 돈·계약이었다. 실제로 띄워보니
 * 첫인상이 **청구서**였다 — 따뜻한 카드는 전부 스크롤 몇 번 아래에 묻혀 있었다.
 * 이제 한 번에 세 장만 뽑고(`drawThree`), 그 세 장은 항상 마음 2 + 돈 1로 구성한다.
 * 순서 운에 첫인상을 맡기지 않는다.
 *
 * 위 규칙은 전부 `__tests__/deck.test.ts`가 강제한다.
 */
export type TodayCard = Readonly<{
  id: string;
  /** 장면 한 줄. 알아봄이 터지는 자리. */
  scene: string;
  /** 오늘 그대로 말할 반말 한 문장. */
  say: string;
  /** 하루 속의 자리. */
  when: string;
  /** 계약 전 확인할 것. 해당 없으면 빈 문자열. */
  check: string;
  /** 돈·계약이 걸린 장면(`money`)인지, 마음이 걸린 장면(`heart`)인지. 뽑기 구성에 쓴다. */
  kind: "money" | "heart";
}>;

export const TODAY_DECK_VERSION = "today-deck.2";

/** 한 번에 보여주는 카드 수. */
export const DRAW_SIZE = 3;

/** 첫 화면 안내. H1이 「고르세요」라고 말하므로 여기서도 고르는 사람은 나다. */
export const TODAY_OPENING_LINE =
  "세 장 중 한 장. 고르고 나면, 상대가 나한테 물어줄 한 장도 골라요.";

/** 「상대가 나한테 물어줄 한 장」 화면의 안내. */
export const TODAY_GIVE_LINE =
  "이 한 장은 내가 묻지 않아요. 넘겨서, 오늘은 상대가 나한테 물어보게 해요.";

export const TODAY_DECK: readonly TodayCard[] = [
  {
    id: "helper-fee-after-signing",
    scene: "본식 헬퍼비 얘기를 계약하고 나서 처음 들은 날",
    say: "이런 거 또 나오면 어디까지 낼래?",
    when: "퇴근하고 만나서 밥 나오기 기다리는 동안",
    check: "추가금 항목 전체(헬퍼비·얼리스타트·원본·피팅)와 각각의 회당 단가·상한을 견적서에 적어 서면으로 받아둘 것",
    kind: "money",
  },
  {
    id: "early-start-dawn-makeup",
    scene: "예식 시간 정하고 나서 메이크업 새벽 시작이라고 들은 날",
    say: "새벽에 일어나는 거, 너는 괜찮겠어?",
    when: "샤워하고 나와 머리 말리면서",
    check: "얼리스타트 기준 시각과 회당 추가금, 상한을 견적서에 적어 받아둘 것",
    kind: "money",
  },
  {
    id: "guest-list-below-minimum",
    scene: "하객 명단 세어보니 보증인원보다 마흔 명 모자랐던 날",
    say: "보증인원 이백 명, 우리한테 가능한 숫자야?",
    when: "주말 아침에 각자 폰 보다가",
    check: "보증인원 미달 시 식대 정산 방식, 각보증(신랑측·신부측 따로) 적용 여부, 인원 조정이 가능한 시점을 계약 전 서면으로 확인",
    kind: "money",
  },
  {
    id: "same-shop-different-agency",
    scene: "같은 드레스샵인데 다른 대행사 견적이 오십만 원 싸던 날",
    say: "싼 데는 왜 싼 건지 같이 물어볼까?",
    when: "투어 끝나고 카페에 앉자마자",
    check: "같은 샵이어도 계약 경로에 따라 취소·위약금 규정이 다를 수 있으니 양쪽 규정을 각각 서면으로 받아 나란히 대조",
    kind: "money",
  },
  {
    id: "friday-evening-cheaper",
    scene: "금요일 저녁 예식이 토요일보다 사백 싸다고 들은 날",
    say: "그 사백 아끼면 우리 뭐가 달라져?",
    when: "달력 앱 켜고 날짜 넘기다가",
    check: "",
    kind: "money",
  },
  {
    id: "jeonse-loan-limit-short",
    scene: "전세 대출 한도가 우리가 본 집보다 오천 낮게 나온 날",
    say: "우리 집이랑 예식 중에 뭐부터 줄일까?",
    when: "은행 앱 닫고 한참 말이 없을 때",
    check: "",
    kind: "money",
  },
  {
    id: "studio-original-files-extra",
    scene: "촬영 끝나고 원본 파일은 따로 사는 거라고 들은 날",
    say: "우리 사진 어디까지 남기고 싶어?",
    when: "사진 셀렉 링크 열어놓고 나란히 앉아서",
    check: "원본 파일 제공 여부, 수정본 포함 장수, 추가 수정 단가, 납품 기한을 계약서에 명시 요청",
    kind: "money",
  },
  {
    id: "tour-three-shops-shoes-on",
    scene: "투어 세 군데 돌고 와서 신발도 안 벗고 앉아 있던 밤",
    say: "오늘은 결혼 얘기 여기까지 하자, 응?",
    when: "그날 밤 씻으러 들어가기 전에",
    check: "",
    kind: "heart",
  },
  {
    id: "kakao-quote-photos-thirty",
    scene: "카톡에 견적서 사진만 서른 장 넘게 쌓인 밤",
    say: "이거 오늘 말고 내일 아침에 열래?",
    when: "자기 전에 불 끄기 직전",
    check: "견적은 카톡 사진 말고, 포함 내역과 항목별 금액이 적힌 문서로 받아둘 것",
    kind: "money",
  },
  {
    id: "penalty-clause-wont-register",
    scene: "위약금 조항 세 번 읽었는데 글자가 안 들어오는 밤",
    say: "이거 소리 내서 같이 읽어볼까?",
    when: "계약서 파일 열어놓고 한참 지났을 때",
    check: "예식일 기준 남은 기간별 위약금 비율을 계약서 문구 그대로 옮겨 적어둘 것. 기준이 헷갈리면 1372 소비자상담센터에 물어볼 수 있다",
    kind: "money",
  },
  {
    id: "two-months-of-weekends",
    scene: "두 달째 주말마다 웨딩 상담이라 늦잠을 못 잔 상태",
    say: "다음 주말은 아무것도 안 넣어두면 어때?",
    when: "금요일 밤에 다음 주 일정 보다가",
    check: "",
    kind: "heart",
  },
  {
    id: "you-decide-three-times",
    scene: "예식 준비 얘기마다 네가 정해, 라는 말이 세 번 나온 날",
    say: "오늘은 내가 정해도 괜찮아?",
    when: "또 정하자는 말이 나온 직후에",
    check: "",
    kind: "heart",
  },
  {
    id: "sanggyeonrye-eve-titles",
    scene: "상견례 전날 밤에 호칭을 뭐라 부를지 검색만 하다 잔 날",
    say: "내일 서로 어색해지면 어떤 신호 줄 거야?",
    when: "내일 입을 옷 꺼내놓다가",
    check: "",
    kind: "heart",
  },
  {
    id: "sanggyeonrye-bill-pause",
    scene: "상견례 계산서가 가운데 놓인 채로 아무도 안 잡던 순간",
    say: "다음엔 우리가 먼저 계산하기로 정해둘래?",
    when: "집 도착해서 겉옷 걸어놓고",
    check: "",
    kind: "heart",
  },
  {
    id: "yedan-first-mention",
    scene: "예단 얘기가 처음 나온 날, 카톡 답을 세 번 지운 밤",
    say: "예단 얘기 나오면 우리 답은 뭐로 하지?",
    when: "밤에 방 불만 켜놓고 앉아서",
    check: "",
    kind: "heart",
  },
  {
    id: "deposit-paid-before-contract",
    scene: "계약금 먼저 넣었다는 연락을 계약서도 못 본 채로 받은 날",
    say: "그 계약서 사본 나도 볼 수 있어?",
    when: "알림 확인하다 폰 든 김에",
    check: "이미 넣었더라도 계약서 사본과 취소·환불 조항을 지금 받아둘 것. 남은 계약은 입금 전에 서류부터",
    kind: "money",
  },
  {
    id: "elder-joined-group-chat",
    scene: "결혼 얘기 단톡방에 어른이 들어오고 나서 조용해진 사흘",
    say: "우리끼리 먼저 정하고 올리는 걸로 하면 안 돼?",
    when: "단톡 알림 끄고 나서",
    check: "",
    kind: "heart",
  },
  {
    id: "dress-all-pretty-answer",
    scene: "드레스 다섯 벌 입고 나왔는데 돌아온 답이 다 예뻐",
    say: "너 눈엔 어떤 게 제일 나 같았어?",
    when: "샵 나와서 버스 기다리면서",
    check: "",
    kind: "heart",
  },
  {
    id: "invitation-three-hours-ten-seconds",
    scene: "청첩장 시안 스무 개 중 한 명은 세 시간, 한 명은 십 초",
    say: "너는 청첩장에서 뭐부터 봤어?",
    when: "시안 메일 다시 열어보다가",
    check: "",
    kind: "heart",
  },
  {
    id: "yemul-three-second-pause",
    scene: "예물 생략하자는 말에 한 명이 바로 대답을 못 한 저녁",
    say: "아까 그 침묵은 뭐였어?",
    when: "지하철에서 나란히 서서 가는 길에",
    check: "",
    kind: "heart",
  },
  {
    id: "snap-must-vs-optional",
    scene: "스냅 견적 앞에서 한 명은 필수, 한 명은 없어도 된다고",
    say: "십 년 뒤에 뭐가 남았으면 좋겠어?",
    when: "견적서 캡처 띄워놓고",
    check: "",
    kind: "heart",
  },
  {
    id: "planner-or-diy-stalled",
    scene: "플래너 쓰자와 우리끼리 하자 사이에서 사흘째 멈춘 상태",
    say: "너는 돈이 더 걸려, 시간이 더 걸려?",
    when: "일요일 늦게 일어나 이불 속에서",
    check: "",
    kind: "heart",
  },
  {
    id: "same-day-discount-eye-contact",
    scene: "오늘 계약하면 삼십만 원 빼준다는 말 앞에서 갈린 눈빛",
    say: "이 할인 내일도 되는지 물어볼까?",
    when: "상담실에 담당자가 잠깐 나간 사이에",
    check: "당일 할인 조건을 서면으로 받고, 취소 시 그 할인분이 어떻게 계산되는지, 청약철회가 되는 계약인지와 며칠 이내인지를 그 자리에서 확인",
    kind: "money",
  },
  {
    id: "dress-curtain-three-seconds",
    scene: "커튼 열고 드레스 입고 나왔을 때 아무 말 없던 삼 초",
    say: "그때 진짜 무슨 생각 했어?",
    when: "자기 전에 불 끄고 누워서",
    check: "",
    kind: "heart",
  },
  {
    id: "tasting-galbi-seconds",
    scene: "식장 시식 갔다가 갈비찜만 두 번 더 달라고 한 날",
    say: "그날 우리 갈비찜 얘기만 한 거 알아?",
    when: "저녁 먹고 자리에서 안 일어난 채로",
    check: "",
    kind: "heart",
  },
  {
    id: "hall-virgin-road-walk",
    scene: "웨딩홀 답사 갔다가 빈 버진로드 끝까지 걸어본 날",
    say: "그때 손 잡았던 거 기억나?",
    when: "산책하다 벤치에 앉았을 때",
    check: "",
    kind: "heart",
  },
  {
    id: "ring-engrave-same-word",
    scene: "반지 안쪽 글자 정하다 둘 다 같은 단어 적어낸 날",
    say: "너는 왜 그 단어 골랐어?",
    when: "엘리베이터 기다리면서",
    check: "",
    kind: "heart",
  },
  {
    id: "honeymoon-ticket-email",
    scene: "항공권 결제 완료 메일이 둘 다 폰에 동시에 뜬 순간",
    say: "거기서 뭐 하는 게 제일 기대돼?",
    when: "출근 준비하다 폰 확인하고",
    check: "",
    kind: "heart",
  },
];

/**
 * 링크로 받은 카드 id를 찾는다. 없는 id면 `null` — 조용히 다른 카드를 보여주면
 * 받은 사람이 "상대가 이걸 골랐구나"라고 잘못 읽는다.
 */
export function findCard(id: string): TodayCard | null {
  return TODAY_DECK.find((card) => card.id === id) ?? null;
}

/** mulberry32. 같은 seed면 언제 어디서 돌려도 같은 순서 — SSR과 클라이언트가 어긋나지 않는다. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function take(pool: TodayCard[], count: number, rand: () => number): TodayCard[] {
  const out: TodayCard[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return out;
}

/**
 * 오늘 보여줄 세 장.
 *
 * **항상 마음 2 + 돈 1**이다. 무작위로 세 장을 뽑으면 돈 카드만 세 장 나오는 날이
 * 생기고, 그런 날 이 화면은 청구서가 된다 — 초판이 정확히 그렇게 실패했다.
 * `exclude`는 이미 고른 카드를 빼는 데 쓴다(내가 고른 장을 상대 몫으로 또 뽑지 않는다).
 */
export function drawThree(seed: number, exclude: readonly string[] = []): readonly TodayCard[] {
  const rand = randomFrom(seed);
  const available = TODAY_DECK.filter((card) => !exclude.includes(card.id));
  const drawn = [
    ...take(available.filter((card) => card.kind === "heart"), 2, rand),
    ...take(available.filter((card) => card.kind === "money"), 1, rand),
  ];
  // 자리도 섞는다. 안 섞으면 돈 카드가 매번 맨 아래라 세 번째 칸을 아무도 안 읽는다.
  for (let i = drawn.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [drawn[i], drawn[j]] = [drawn[j], drawn[i]];
  }
  return drawn;
}

/** KST 기준 `YYYY-MM-DD`. 「오늘」이 한국 자정에 넘어가야 말이 된다. */
export function kstDateString(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 날짜 문자열 → seed(FNV-1a). 날이 바뀌면 뽑히는 세 장이 통째로 바뀐다. */
export function seedFromDate(isoDate: string): number {
  let hash = 2166136261;
  for (let i = 0; i < isoDate.length; i += 1) {
    hash = Math.imul(hash ^ isoDate.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}
