/**
 * 승인된 Main.dc.html·LandingMobile.dc.html의 시각 규격은 유지한다.
 * 2026-10-09: 대화 → 직접 확인 → 둘이 함께 쓰는 준비 기록을 실제 기능으로 설명한다.
 * 예시·AI 한계·공유 범위·비용 고지는 각 문장이 가리키는 표면에 둔다.
 */
import { upcomingWeddingQuarterLabels } from "@/utils/quarter";

import { CONTACT } from "@/lib/constants/contact";

export const landingContent = {
  hero: {

    tape: "결혼 준비 동반자 아모라",

    title: "결혼 준비의 첫 질문부터,\n함께 챙기는 계획까지.",

    body: "견적에서 뭘 더 확인할지, 우리 예산을 어디에 쓸지 AI 동반자 아모라와 정리해요. 정한 예산·일정·할 일은 직접 확인해 기록하고, 파트너를 연결해 함께 봐요.",
    shareDescription: "견적에서 뭘 더 확인할지, 우리 예산을 어디에 쓸지 아모라와 정리해요. 정한 예산·일정·할 일은 직접 확인해 기록하고, 파트너를 연결해 함께 봐요.",

    titleAccent: "함께 챙기는 계획까지.",
    primary: { label: "아모라와 준비 시작하기", href: "/wedding/chat" },
    secondary: { label: "웨딩코드로 내 생각 살펴보기", href: "/wedding-code" },

    note: "아모라는 로그인과 시작 설정 후 이용해요. 현재 무료이며, 향후 요금은 아직 정해지지 않았어요. 웨딩코드는 가입 없이 해 볼 수 있어요.",

    preview: {
      appName: "내 질문이 준비 계획이 되는 과정",
      badge: "기능 예시",
      selectorLabel: "어떻게 쓰는지 눌러 보세요",
      defaultSceneId: "starting",
      questionLabel: "01 · 지금 고민",
      answerLabel: "02 · 아모라의 답변 · AI 생성",
      scenes: [
        {
          id: "starting",
          label: "첫 질문",
          userPrompt: "하객은 100명 정도야. 식장 견적에서 뭘 확인할까?",
          answer: "하객 100명 기준 식대와 최소 보증 인원을 물어보세요. 대관료에 포함된 항목과 추가 비용도 확인하면, 우리 예산으로 무엇을 비교할지 정리할 수 있어요.",
          proposalLabel: "03 · 먼저 확인할 일",
          proposalStatus: "상담 전",
          proposalKind: "상담 질문",
          proposal: "식대 · 보증 인원 · 대관료 · 추가 비용",
          proposalNote: "‘무엇이 포함되고, 별도 비용은 얼마인가요?’를 업체에 물어보세요.",
        },
        {
          id: "budget",
          label: "저장 전 확인",
          userPrompt: "결혼식장 예산은 1,000만 원으로 정했어. 예산에 남겨줘.",
          answer: "결혼식장 예산을 1,000만 원으로 저장할까요? 아래 내용을 확인해 주세요.",
          proposalLabel: "03 · 저장할 내용 확인하기",
          proposalStatus: "저장 전",
          proposalKind: "예산",
          proposal: "결혼식장 · 1,000만 원",
          proposalNote: "직접 확인하고 저장해야 예산에 반영돼요.",
        },
        {
          id: "together",
          label: "함께 챙기기",
        },
      ],
      note: "기능을 설명하는 예시예요. 이 화면에서는 대화하거나 저장할 수 없어요. AI 답변에는 오류가 있을 수 있어요.",
    },
  },

  blockedReasons: {
    eyebrow: "이런 것도 물어봐도 되나?",
    title: "처음 해 보는 일이라\n모르는 게 자꾸 생겨요.",
    quotes: [
      "결혼하기로 했는데,\n이제 뭐부터 해야 해?",
      "견적서 받았는데,\n업체에 뭘 더 물어봐야 해?",
      "부모님한테 결혼 비용 얘기는\n어떻게 꺼내지?",
    ],

    noteLead: "질문 예시예요. ",
    noteMark: "파트너에게 아직 꺼내기 어려운 이야기는 ‘나만 보는 상담’에서 먼저 이야기할 수 있어요.",
    noteTail: "",
  },

  amoraNote: {
    eyebrow: "첫 질문도, 준비하다 생긴 고민도",
    title: "받은 견적서,\n업체에 뭘 더 물어볼까요?",
    body:
      "궁금한 걸 아모라에게 물어보세요. 말해 준 상황과 저장된 예산·일정을 바탕으로 다음에 확인할 내용과 할 일을 제안해요.",
    attachment: {
      title: "견적서는 사진·PDF로 올려 질문하세요",
      body: "포함된 항목이나 추가 비용처럼 업체에 다시 확인할 내용을 아모라와 정리해 볼 수 있어요.",
    },

    lanes: [
      {
        name: "함께 보는 대화",
        detail: "예산·하객·일정처럼 함께 정할 내용을 같은 대화방에서 이야기할 수 있어요.",
        shared: true,
      },
      {
        name: "나만 보는 상담",
        detail: "파트너에게 말하기 어려운 고민을 먼저 이야기할 수 있어요. 상담 내용은 파트너에게 표시되지 않아요.",
        shared: false,
      },
    ],
    laneNote: "대화 화면에서 공유 범위를 확인할 수 있어요.",
    privacyNote: "개인 상담도 서비스에서 처리·저장돼요.",

    chat: {
      meLabel: "나",
      me: "받은 견적서에 드레스 피팅비가 안 보여. 어떻게 물어보지?",
      amoraLabel: "아모라 · AI 생성",
      amora:
        "피팅비가 견적에 포함됐는지, 별도라면 1회 비용과 결제 시점을 확인해 보세요. 이렇게 물어볼 수 있어요. ‘피팅비가 포함되어 있나요? 추가로 입어보면 얼마이고, 언제 결제하나요?’",
      chips: ["포함 여부", "추가 피팅 비용"],
    },
    note:
      "기능을 설명하는 예시 대화예요. 이 화면에서는 대화하거나 저장할 수 없어요.",
  },

  noSide: {
    eyebrow: "중요하게 생각하는 게 서로 다를 때",
    title: "사진에 더 쓸까, 식장에 더 쓸까?\n꼭 원하는 것부터 말해 봐요.",
    body:
      "두 사람이 중요하게 생각하는 것을 아모라에게 말해 보세요. 함께 살펴볼 기준과 다음에 확인할 내용을 제안해요. "
      + "웨딩코드로 두 사람의 답을 나란히 보고, 같은 생각과 다른 생각을 이야기할 수도 있어요.",
    cta: { label: "웨딩코드로 둘의 생각 비교하기", href: "/wedding-code" },

    photo: {
      visible: false,
      title: "사진 자리",
      captions: [
        "마주 앉아 이야기 나누는 두 사람 · 가로 3:2",
        "스톡 사진보다 실제 이용 커플 촬영본을 권합니다",
      ],
    },

    turns: [
      { who: "나", say: "사진은 오래 남으니까 여기는 좀 더 쓰고 싶어." },
      { who: "파트너", say: "나는 하객들이 오기 편한 식장에 더 쓰고 싶어." },
      {
        who: "아모라",
        say:
          "사진에서 꼭 원하는 구성과 식장에 필요한 교통 조건을 한 가지씩 적어 볼까요? "
          + "그다음 식장과 사진에 각각 얼마까지 쓸 수 있는지 함께 정해 봐요.",
      },
    ],
    note: "기능을 설명하는 예시 대화예요. 실제 이용자의 대화가 아니에요.",
  },

  confirm: {
    eyebrow: "정한 내용을 다시 찾아 헤매지 않도록",
    title: "정한 예산·일정·할 일,\n직접 확인해 남겨요.",
    lede:
      "정한 내용을 아모라에게 말해 주세요. 저장 전에 바뀔 내용과 저장 위치를 직접 확인하면 예산·할 일·일정에 남길 수 있어요. "
      + "제안이 다르면 다시 말하거나, 저장하지 않을 수도 있어요.",

    tools: [
      {
        title: "예산", body: "총예산과 항목별로 쓸 금액",
        prompt: "결혼식장 예산은 1,000만 원으로 정했어. 예산에 남겨줘.",
        recordTitle: "결혼식장", value: "1,000만 원", status: "배정 예산",
      },
      {
        title: "할 일", body: "준비할 일과 완료한 일",
        prompt: "식장 상담 질문 정리를 할 일로 남겨줘.",
        recordTitle: "식장 상담 질문 정리", value: "미완료", status: "할 일",
      },
      {
        title: "일정", body: "상담·촬영·예식 날짜와 준비 마감일",
        prompt: "2027년 3월 12일 드레스 투어를 일정에 남겨줘.",
        recordTitle: "드레스 투어", value: "2027.03.12", status: "등록 일정",
      },
    ],
    management: [
      { title: "예산", body: "항목별로 쓸 금액과 직접 기록한 지출을 나눠 보세요.", action: "예산 관리 열기", href: "/wedding/budget" },
      { title: "체크리스트", body: "준비 항목을 살펴보고, 끝낸 일과 해당 없는 일을 표시하세요.", action: "체크리스트 열기", href: "/wedding/checklist" },
      { title: "일정", body: "상담·촬영·예식 날짜와 준비 마감일을 등록하고 확인하세요.", action: "일정 관리 열기", href: "/wedding/schedule" },
      { title: "결정 보드", body: "결정 기록과 함께할 일을 모아 보고, 필요한 내용을 다시 찾으세요.", action: "결정 보드 열기", href: "/wedding/chat/board" },
    ],
    records: {
      title: "확인한 계획이 이렇게 남아요",
      note: "각 항목을 직접 확인해 저장한 뒤의 예시예요. 실제 이용자의 준비 현황은 아니에요.",
      sharedNote: "파트너를 연결하면 같은 준비 기록을 보고, 변경 알림도 앱에서 확인할 수 있어요.",
    },
    body2:
      "파트너와 연결한 뒤에는 두 사람 중 한 명이 저장하면 공동 기록에 반영돼요. "
      + "파트너도 앱에서 변경 알림을 볼 수 있어요.",

    sample: {
      cardTitle: "저장할 내용을 확인해 주세요",
      contract: "저장을 확인하기 전에는 기록이 바뀌지 않아요.",
      state: "저장 전",
      saidLabel: "변경 제안",
      rows: [
        { chip: "대화", text: "결혼식장 예산은 1,000만 원으로 정했어. 예산에 남겨줘." },
        { chip: "제안", text: "결혼식장 예산을 1,000만 원으로 설정" },
        { chip: "저장 위치", text: "예산 → 결혼식장" },
      ],
      confirm: "확인하고 저장",
      later: "저장하지 않기",
    },
    note:
      "현재 무료로 이용할 수 있어요. 향후 요금은 아직 정해지지 않았어요.",
    sampleNote:
      "기능을 설명하는 예시예요. 금액은 예시이며, 이 화면에서는 저장할 수 없어요.",
  },

  availableNow: {
    eyebrow: "가입 없이 먼저 써 보세요",
    title: "견적 질문부터,\n두 사람의 우선순위까지.",
    cards: [
      {
        no: "01",
        title: "업체에 무엇을 물어봐야 할까요?",
        body:
          "항목별로 포함 여부와 이용 계획을 고르면, 업체에 물어볼 질문을 만들어줘요. "
          + "질문은 복사해서 보낼 수 있어요.",
        note:
          "가격의 적정 여부는 평가하지 않아요. 가입 없이 선택한 내용은 저장하지 않아요.",
        href: "/wedding/community/quote-check",
      },
      {
        no: "02",
        title: "웨딩코드로 내 준비 기준을 살펴봐요",
        body: "질문에 답하며 지출·준비·가족·도움에 대한 내 기준을 살펴보세요. 파트너도 답하고 결과 링크를 서로 전달하면, 같은 답과 다른 답을 나란히 볼 수 있어요.",
        note:
          "심리 진단이나 궁합 검사가 아니에요. 이어하기는 브라우저에 저장돼요. 함께 보기에 동의하면 답 전체가 담긴 링크를 직접 전달해요. 답은 서버에 저장하지 않으며 전달한 링크는 회수할 수 없어요.",
        href: "/wedding-code",
      },
      {
        no: "03",
        title: "업체 가격과 취소·환불 조건을 봐요",
        body:
          "한국소비자원 참가격에 공시된 기본 가격과 취소 위약금 원문을 확인할 수 있어요. "
          + "가격을 공시한 업체만 제공해요.",
        note:
          "2025년 11월 공시 기준이에요. 가격과 규정은 요약하지 않고 원문으로 제공하며, 가격의 적정 여부는 평가하지 않아요.",
        href: "/price",
      },
      {
        no: "04",
        title: "상견례·예단, 어떻게 준비할까요?",
        body: "상견례·예단처럼 두 가족이 함께 준비하는 일의 관행을 예절 가이드에서 확인해 보세요.",
        note: "관행은 지역과 가족마다 달라요. 가이드를 참고하며 두 가족의 생각을 먼저 확인해 보세요.",
        href: "/wedding/manners",
      },
    ],
  },

  community: {
    visible: false,
    title: "나랑 같은 분기에 결혼하는 사람들은 뭘 궁금해할까요?",
    body:
      "결혼식 분기별로 동기방이 나뉘어 있어요. "
      + "견적이나 계약처럼 검색으로는 잘 안 나오는 이야기를 나누는 곳이에요.",
    get cohorts(): string[] {
      return upcomingWeddingQuarterLabels();
    },
    cohortTag: "동기방",
    note: "로그인 없이 읽을 수 있어요. 글을 쓰려면 계정이 필요해요.",
    cta: { label: "커뮤니티 둘러보기", href: "/wedding" },
  },

  photoBand: {

    visible: false,
    title: "전면 사진 자리 · 1440 × 300",
    captions: [
      "예식장을 둘러보거나 상담받는 장면처럼, 준비 과정이 보이는 사진.",
      "드레스·본식 컷보다 ‘준비 중’인 순간이 이 서비스와 맞습니다.",
    ],
  },

  faq: {
    eyebrow: "자주 묻는 질문",
    title: "시작 전에 궁금한 점",
  },

  boundaries: {

    title: "아모라는 준비를 돕고,\n결정은 두 사람이 해요.",
    items: [
      {
        title: "업체에 점수·등급·순위를 매기지 않아요",
        note: "공시 가격과 규정은 요약하지 않고 원문으로 제공해요. 광고 상품은 운영하지 않아요.",
      },
      {
        title: "계약 조건을 대신 해석하거나 판단하지 않아요",
        note: "업체 계약 신청·예약·결제를 중개하지 않아요.",
      },
      {
        title: "아모라의 답변은 AI가 작성해요",
        note: "AI 답변에는 오류가 있을 수 있어요. 계약 금액·취소 조건·중요 날짜는 원문과 업체 안내를 다시 확인해 주세요.",
      },
      {
        title: "법률·의료·금융 판단을 하지 않아요",
        note: "전문적인 판단이 필요한 질문에는 관련 기관을 안내해요.",
      },
    ],
    policyLink: { label: "AI 서비스 정책과 정보 출처 보기", href: "/ai-policy" },
  },

  closing: {

    title: "궁금한 건 아모라에게,\n정한 건 우리 기록에.",
    primary: { label: "아모라와 준비 시작하기", href: "/wedding/chat" },
    body: "혼자 먼저 시작하고, 파트너는 나중에 연결해도 돼요. 예산도 날짜도 아직이라면, 지금 상황부터 이야기해 보세요.",
    steps: ["준비 공간 열기", "아모라에게 지금 고민 말하기", "필요한 제안만 확인해 저장하기"],


    note:
      "무료 도구는 가입 없이 이용할 수 있어요. 아모라와 예산·할 일·일정 관리에는 가입이 필요해요.",
  },

  footer: {
    tagline: "아모라 상담부터 예산·할 일·일정 관리까지, 둘이 함께하는 결혼 준비.",
    columns: [
      {
        heading: "가입 없이 이용",
        links: [
          { label: "공시 가격·위약금", href: "/price" },
          { label: "견적 질문 만들기", href: "/wedding/community/quote-check" },
          { label: "웨딩코드", href: "/wedding-code" },
          { label: "결혼 예절 가이드", href: "/wedding/manners" },
        ],
      },
      {
        heading: "가입 후 이용",
        links: [
          { label: "아모라", href: "/wedding/chat" },
          { label: "결정 보드", href: "/wedding/chat/board" },
          { label: "예산", href: "/wedding/budget" },
          { label: "체크리스트", href: "/wedding/checklist" },
          { label: "일정", href: "/wedding/schedule" },
        ],
      },
      {
        heading: "정책·문의",
        links: [
          { label: "이용약관", href: "/terms" },
          { label: "개인정보처리방침", href: "/privacy" },
          { label: "AI 서비스 정책", href: "/ai-policy" },
          { label: CONTACT.email, href: `mailto:${CONTACT.email}` },
        ],
      },
    ],
    notice:
      "가격 출처: 한국소비자원 참가격, 2025년 11월 공시 기준. "
      + "공시 가격은 기본 조건 기준이라 실제 계약가와 다를 수 있어요. 가격을 공시한 업체만 제공하므로 지역별 등록 업체 수가 달라요. "
      + "업체가 공개한 취소·환불 규정은 원문으로 제공해요. 예약·결제·계약은 업체와 직접 진행해 주세요.",
    copyright: "© 2026 Hanbang Group",
  },
} as const;

export const headerNav = [
  { label: "아모라", href: "#amora" },
  { label: "둘의 우선순위", href: "#noside" },
  { label: "준비 관리", href: "#confirm" },
  { label: "먼저 써보기", href: "#now" },
  { label: "자주 묻는 질문", href: "#faq" },
] as const;

export const headerAuth = {
  signUp: { label: "아모라 시작하기", href: "/wedding/chat" },
  logIn: { label: "로그인", href: "/login?redirect=%2Fwedding%2Fchat" },
} as const;
