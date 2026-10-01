/**
 * 승인된 Main.dc.html·LandingMobile.dc.html의 시각 규격은 유지한다.
 * 2026-09-08: 팀 HTML의 첫 제목과 섹션 순서를 복원하고 실제 기능 고지는 유지한다.
 * 예시·AI 한계·공유 범위·비용 고지는 각 문장이 가리키는 표면에 둔다.
 */
import { upcomingWeddingQuarterLabels } from "@/utils/quarter";

import { CONTACT } from "@/lib/constants/contact";

export const landingContent = {
  hero: {

    tape: "둘이 하는 결혼 준비, 아모라와",

    title: "결혼식까지 몇 달 남았는데\n지금 뭐부터 하면 될까요?",

    body: "날짜를 알려 주면 결혼 준비 동반자 AI 아모라가 예산부터 준비 순서까지 같이 살펴봐요. 직접 확인한 내용은 예산·할 일·일정에 남아요.",

    titleAccent: "지금 뭐부터",
    primary: { label: "아모라와 준비 시작하기", href: "/login?mode=signup" },
    secondary: { label: "웨딩코드 해보기", href: "/wedding-code" },

    note: "아모라는 계정을 만들고 웹에서 시작해요. 웨딩코드는 가입 없이 해볼 수 있어요. 지금은 결제를 요청하지 않아요.",

    preview: {
      appName: "웨딩 라운지",
      badge: "함께 준비 중",
      dLabel: "결혼식 날짜",
      dValue: "D-52",
      stats: [
        { label: "체크 진행", value: "34%" },
        { label: "정한 것", value: "9건" },
        { label: "준비 방식", value: "함께" },
      ],
      briefLabel: "아모라 브리핑",
      brief: "예산 상한부터 잡으면 장소 조건이 확 줄어요",
      note: "기능 예시 · 숫자와 문장은 화면을 보여주기 위한 샘플이고 실제 이용 현황이 아니에요.",
    },
  },

  blockedReasons: {
    eyebrow: "이런 것도 물어봐도 되나?",
    title: "처음 해 보는 일이라\n모르는 게 자꾸 생겨요.",
    quotes: [
      "결혼하자는 얘기는 됐는데,\n그다음엔 뭘 해야 해?",
      "견적서 받았는데,\n업체에 뭘 더 물어봐야 해?",
      "부모님한테 결혼 비용 얘기는\n어떻게 꺼내지?",
    ],

    noteLead: "질문 예시예요. ",
    noteMark: "민망해서 못 꺼낸 건 ‘나만 보는 상담’에서 먼저 물어봐도 돼요.",
    noteTail: " 정한 게 없으면 지금 상황부터 얘기해 봐요.",
  },

  amoraNote: {
    eyebrow: "말 꺼내기 전에 나 혼자 생각해 보고 싶은데",
    title: "혼자 생각할 건 혼자 하고,\n같이 정할 건 같이 해요.",
    body:
      "같이 정할 얘기는 ‘함께 보는 대화’에, 상대한테 꺼내기 전인 얘기는 ‘나만 보는 상담’에 말해 보세요. "
      + "아모라가 다음에 살펴볼 것부터 짚어 줘요.",

    lanes: [
      {
        name: "함께 보는 대화",
        detail: "예산, 하객, 일정. 같이 정해야 하는 건 둘 다 볼 수 있어요.",
        shared: true,
      },
      {
        name: "나만 보는 상담",
        detail: "말 꺼내기 전에 혼자 정리하는 자리. 상대 화면에는 안 보여요.",
        shared: false,
      },
    ],
    laneNote: "지금 어느 자리에 쓰고 있는지 화면이 항상 알려줘요.",
    privacyNote: "개인 상담의 대화 내용은 서비스에서 처리·저장될 수 있어요. 연결된 배우자 화면에는 표시하지 않아요.",

    chat: {
      meLabel: "나",
      me: "내년 가을쯤 하고 싶은데 진짜 아무것도 안 했어. 식장부터 알아봐야 하나?",
      amoraLabel: "아모라",
      amora:
        "식장을 알아보기 전에 예산 범위와 예상 하객 수를 정리하면 비교할 기준이 생겨요. "
        + "두 가지 중 정해둔 게 있나요?",
      chips: ["예산부터", "하객부터"],
      caption: "말씀한 준비 시기를 바탕으로, 먼저 정리할 조건을 함께 살펴봐요.",
    },
    note:
      "AI 생성 답변 · 기능 예시예요. "
      + "날짜와 답변은 기능을 보여주기 위한 샘플이고, "
      + "이 화면에서는 실제로 저장되지 않아요. "
      + "AI는 틀리거나 놓칠 수 있어요 — 계약 금액·취소 조건·중요 날짜는 원문과 업체 안내를 "
      + "다시 확인해 주세요.",
  },

  noSide: {
    eyebrow: "둘 다 일리 있어서 더 어려운데",
    title: "돈 쓸 곳이 서로 다르면,\n어디서 갈리는지 같이 봐요.",
    body:
      "누가 맞는지는 가리지 않아요. 웨딩코드 질문에 상대도 답하면 "
      + "둘의 답을 나란히 놓고, 먼저 의논할 것부터 볼 수 있어요.",
    cta: { label: "웨딩코드로 내가 원하는 것부터 보기", href: "/wedding-code" },

    photo: {
      visible: false,
      title: "사진 자리",
      captions: [
        "마주 앉아 이야기 나누는 두 사람 · 가로 3:2",
        "스톡 사진보다 실제 이용 커플 촬영본을 권합니다",
      ],
    },

    turns: [
      { who: "신부", say: "사진은 오래 남으니까 여기는 좀 더 쓰고 싶어." },
      { who: "신랑", say: "근데 신혼집 자금은 안 건드렸으면 해." },
      {
        who: "아모라",
        say:
          "사진에 쓰고 싶은 예산과 신혼집에 남겨둘 금액을 함께 살펴볼게요. "
          + "촬영 범위·앨범·본식 영상을 나눠 비교해보면 조정할 항목을 찾을 수 있어요.",
      },
    ],
    note: "아모라 답변은 AI가 만든 내용이에요. AI는 틀리거나 놓칠 수 있어요. 이름과 금액은 기능을 보여주기 위한 샘플이고 실제 이용 현황이 아니에요.",
  },

  confirm: {
    eyebrow: "아모라가 멋대로 바꾸면 어떡해?",
    title: "확인한 것만\n예산·할 일·일정에 남아요.",
    lede:
      "아모라와 정리한 내용은 어디에 남길지 먼저 보여 줘요. "
      + "고치거나 나중에 정해도 돼요.",

    tools: [
      { title: "예산", body: "둘이 정한 총예산과 항목별 금액" },
      { title: "할 일", body: "지금 해야 하는 일, 나중에 해도 되는 일" },
      { title: "일정", body: "정한 날짜와 놓치면 안 되는 시기" },
    ],
    body:
      "예산·할 일·일정 중 한 번에 한 가지 변경을 제안하고, "
      + "눌러서 확인한 것만 준비 기록에 반영해요.",
    body2:
      "파트너를 연결하면 한 분이 확인했을 때 바로 반영되고, "
      + "파트너에게 “함께 쓰는 계획이 변경됐어요” 알림이 가요.",

    sample: {
      cardTitle: "아모라가 이렇게 이해했어요",
      contract: "아모라가 바꾸지 않아요. 확인한 것만 남아요.",
      state: "아직 반영 전",
      saidLabel: "둘이 말한 것",
      rows: [
        { chip: "대화", text: "예식장 예산은 1,000만 원으로 잡고 싶어." },
        { chip: "제안", text: "예식장 예산을 1,000만 원으로 변경" },
        { chip: "목적지", text: "예산 화면 → 예식장" },
      ],
      confirm: "맞아요",
      edit: "수정하기",
      later: "지금은 저장 안 함",
    },
    note:
      "향후 이용 비용은 아직 정해지지 않았고, "
      + "계정을 만들어도 지금은 결제를 요청하지 않아요.",
    sampleNote:
      "기능 예시예요. 이름·금액은 기능을 보여주기 위한 샘플이고 "
      + "실제 이용 현황이 아니에요.",
  },

  availableNow: {
    eyebrow: "스드메 견적서 받았어요? 가입 전에 그냥 써보세요",
    title: "가입 전에, 제일 답답한 것부터 풀어봐요.",
    cards: [
      {
        no: "01",
        title: "견적에서 빠진 항목을 질문으로 바꿔요",
        body:
          "분야별 항목을 하나씩 확인하면서 포함인지, 안 쓸 건지, 아직 모르는지 골라 봐요. "
          + "모르는 것 중 먼저 챙길 항목은 업체에 물어볼 질문으로 만들어 주고, 복사해서 그대로 보낼 수 있어요.",
        note:
          "분야별 9~12개 확인 항목 · 값이 적정한지는 판정하지 않아요 · "
          + "로그인 없이 선택한 내용은 저장하지 않아요",
        href: "/wedding/community/quote-check",
      },
      {
        no: "02",
        title: "웨딩코드로 내가 원하는 결혼식부터 골라 봐요",
        body: "내가 원하는 결혼식 취향과 준비 방식은 어떤지, 꼭 지키고 싶은 것과 돈을 더 쓰고 싶은 곳은 어딘지 살펴봐요. 혼자 내 결과를 보고, 상대도 답하면 함께 원하는 것과 먼저 의논할 부분을 비교할 수 있어요.",
        note:
          "점수도 궁합도 매기지 않아요 · 답은 기기 안에서 계산해요 · "
          + "답을 담은 공유 링크는 함께 볼 사람에게만 보내세요",
        href: "/wedding-code",
      },
      {
        no: "03",
        title: "취소하면 얼마 무는지, 공시 가격·위약금에서 확인해요",
        body:
          "업체가 공시한 기본 금액과 취소하면 무는 돈을 원문 그대로 볼 수 있어요. "
          + "한국소비자원이 공개한 자료예요. 공시 안 한 업체는 여기 안 나와요.",
        note:
          "한국소비자원 참가격 · 2025년 11월 공시 기준 · "
          + "값이 적정한지는 판정하지 않고, 요약하지도 않아요",
        href: "/price",
      },
      {
        no: "04",
        title: "부모님께 묻기 애매한 건 결혼 예절 가이드 25편에 있어요",
        body: "상견례나 예단처럼 양가가 얽힌 일은 보통 어떻게 하는지 읽어볼 수 있어요.",
        note: "정답이 아니라 흔한 관행이에요 · 지역·집안마다 다릅니다",
        href: "/wedding/manners",
      },
    ],
    footLead: "여기에 ",
    footLinks: [
      { label: "공시 가격·위약금 원문", href: "/price" },
      { label: "커뮤니티", href: "/wedding" },
    ],
    footTail: "도 로그인 없이 열려 있어요.",
  },

  community: {
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

  boundaries: {

    title: "결정은 직접,\n아모라는 준비를 돕습니다.",
    items: [
      {
        title: "업체에 점수·등급·순위를 매기지 않아요",
        note: "공시된 문장을 요약하지도 않습니다. 현재 광고 상품을 운영하지 않아요.",
      },
      {
        title: "계약서 해석이나 유불리 판단을 하지 않아요",
        note: "업체 계약 신청·예약·결제를 중개하지 않습니다.",
      },
      {
        title: "AI가 만든 답변임을 표시해요",
        note: "아모라는 OpenAI GPT-5.6 Luna·Terra를 씁니다. AI는 틀리거나 놓칠 수 있어요.",
      },
      {
        title: "법률·의료·금융 판단을 하지 않아요",
        note: "해당하는 질문은 판정하지 않고 공식 창구를 안내해요.",
      },
    ],
    policyLink: { label: "AI 서비스 정책과 정보 출처 보기", href: "/ai-policy" },
  },

  closing: {

    title: "지금 뭐부터 할지\n아모라와 정리해 봐요.",
    primary: { label: "아모라와 준비 시작하기", href: "/login?mode=signup" },
    secondary: { label: "가입 전에 무료 도구 둘러보기", href: "#now" },
    tertiary: { label: "계정이 있다면 로그인", href: "/login" },
    note:
      "공시 가격·위약금 원문, 견적 점검, 웨딩코드, 예절 가이드, 커뮤니티는 "
      + "로그인·결제 없이 열려요. 예산·할 일·일정을 남기려면 계정이 필요해요. "
      + "계정을 만들어도 지금은 결제를 요청하지 않아요.",
  },

  footer: {
    tagline: "아모라와 고민을 나누고, 확인한 내용을 예산·할 일·일정으로 이어가는 결혼 준비 공간.",
    columns: [
      {
        heading: "로그인 없이",
        links: [
          { label: "공시 가격·위약금", href: "/price" },
          { label: "견적 점검", href: "/wedding/community/quote-check" },
          { label: "웨딩코드", href: "/wedding-code" },
          { label: "결혼 예절 가이드", href: "/wedding/manners" },
          { label: "커뮤니티", href: "/wedding" },
        ],
      },
      {
        heading: "계정이 필요한 것",
        links: [{ label: "예산·할 일·일정", href: "/login?mode=signup" }],
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
      "가격 출처 · 한국소비자원 참가격 · 2025년 11월 공시 기준 · 2026.08.08 화면 집계 확인. "
      + "공시된 가격은 기본 조건 기준이라 실제 계약가와 다를 수 있고, 공시한 업체만 싣기 때문에 "
      + "지역별로 수가 크게 달라요. 취소·환불 규정 원문은 업체가 쓴 문장 그대로예요. "
      + "예약·결제·계약은 업체와 직접 진행합니다. 아모라 답변은 AI가 만든 내용이며 참고용이에요.",
    copyright: "© 2026 Hanbang Group",
  },
} as const;

export const headerNav = [
  { label: "아모라", href: "#amora" },
  { label: "웨딩코드", href: "/wedding-code" },
  { label: "둘의 준비", href: "#confirm" },
  { label: "무료 도구", href: "#now" },
  { label: "커뮤니티", href: "#community" },
] as const;

export const headerAuth = {
  signUp: { label: "시작하기", href: "/login?mode=signup" },
  logIn: { label: "로그인", href: "/login" },
} as const;
