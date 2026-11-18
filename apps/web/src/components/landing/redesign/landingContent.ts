/**
 * 랜딩(`/landing`) 문구.
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 랜딩은 앱의 '시작'
 * 화면이 됐다. 첫 화면 글자는 `@hanbang/shared/invitation` 의 `START_COPY` 가 정본이고
 * 앱과 같이 쓴다. 이 파일에는 첫 화면 밖에 남는 것만 둔다.
 *
 * - `start`·`account`: 첫 화면 두 버튼과 오른쪽 위 로그인 자리의 목적지.
 * - `boundaries`·`notices`·`footer`: 첫 화면 아래 조용한 바닥글. 법·신뢰 고지는 옛 섹션에서
 *   글자 하나 바꾸지 않고 옮겼다. 어디서 왔는지는 키마다 적는다.
 *
 * 옛 섹션의 예시 대화 표식("기능을 설명하는 예시 대화예요 …")은 옮기지 않았다. 예시 대화가
 * 이 화면에서 없어졌고, 예시라는 표시는 예시 화면(`/example`)이 맨 위에 직접 단다.
 */
import { CONTACT } from "@/lib/constants/contact";

export const landingContent = {
  start: {
    // 로그인이 필요한 보호 경로다. 로그아웃이면 미들웨어가 로그인으로 보냈다가
    // `redirect` 로 여기에 돌려보낸다.
    primary: { href: "/wedding/chat" },
    // 로그인 없이 보는 예시 커플 화면.
    example: { href: "/example" },
  },

  account: {
    logIn: { label: "로그인", href: "/login?redirect=%2Fwedding%2Fchat" },
  },

  // 옛 `BoundariesSection` 의 넷. AI 기본법 고지(세 번째 항목)가 여기 산다.
  boundaries: {
    title: "아모라는 준비를 돕고, 결정은 두 사람이 해요.",
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

  notices: {
    // 옛 `confirm.note`. 지금은 결제를 요청하지 않고 앞으로의 요금은 정해지지 않았다는 고지.
    pricing:
      "결제 수단 등록 없이 핵심 기능을 바로 써볼 수 있어요. 현재 무료로 이용할 수 있어요. 향후 요금은 아직 정해지지 않았어요.",
    // 옛 `closing.note`. 무엇이 가입 없이 열리는지.
    signup:
      "무료 도구는 가입 없이 이용할 수 있어요. 아모라와 예산·할 일·일정 관리에는 가입이 필요해요.",
    // 옛 `amoraNote.privacyNote`. 나만 보는 상담도 서비스가 처리·저장한다는 개인정보 고지.
    privacy:
      "나만 보는 상담은 파트너에게 공유되지 않으며, 이어서 볼 수 있도록 개인 상담도 서비스에서 처리·저장돼요.",
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
