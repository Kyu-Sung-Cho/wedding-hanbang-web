import {
  CATEGORY_CHECKLISTS,
  type WeddingChecklistCategoryKey,
} from "./weddingPlanning";

/**
 * 결혼식 날짜를 기준으로 한 권장 확인 시점입니다.
 * 양수는 결혼식 전, 0은 당일, 음수는 결혼식 뒤의 일수입니다.
 * 업체·기관의 실제 마감일을 대신하지 않으며 사용자가 언제든 바꿀 수 있습니다.
 */
export type ChecklistRelativeDueDays = number;

export type ChecklistApplicabilityTag =
  | "ceremony"
  | "family_meal"
  | "reception"
  | "legal_marriage"
  | "international_marriage"
  | "religious_ceremony"
  | "no_ceremony"
  | "remarriage"
  | "children_participating"
  | "pregnancy_or_health_support"
  | "accessibility_support"
  | "pet_participation"
  | "travel"
  | "overseas_travel"
  | "rental_home"
  | "home_purchase"
  | "family_tradition";

export interface ChecklistItemGuidanceSource {
  title: string;
  url: string;
  /** 해당 링크와 안내 내용을 마지막으로 직접 확인한 날짜(YYYY-MM-DD). */
  checkedAt: "2026-08-12" | "2026-08-13";
}

export const CHECKLIST_ITEM_GUIDANCE_SOURCES = {
  kca_dispute_standard: {
    title: "한국소비자원 소비자분쟁해결기준",
    url: "https://www.kca.go.kr/odr/cm/in/rsltnCrtral.do",
    checkedAt: "2026-08-12",
  },
  court_marriage_report: {
    title: "대한민국 법원 전자가족관계등록시스템 혼인 신고 안내",
    url: "https://efamily.scourt.go.kr/cs/CsBltnWrtGuide.do?bltnbordId=0000008&guideCd=0000008007&guideYn=Y",
    checkedAt: "2026-08-12",
  },
  easylaw_international_marriage: {
    title: "찾기쉬운 생활법령 국제결혼 성립요건 안내",
    url: "https://www.easylaw.go.kr/CSP/CnpClsMain.laf?ccfNo=1&cciNo=1&cnpClsNo=2&csmSeq=47",
    checkedAt: "2026-08-12",
  },
  molit_rental_reporting: {
    title: "국토교통부 부동산거래관리시스템 주택 임대차 신고 안내",
    url: "https://rtms.molit.go.kr/?cmd=preDetail",
    checkedAt: "2026-08-12",
  },
  easylaw_lease_safety: {
    title: "찾기쉬운 생활법령 주택임대차 계약 전 확인사항",
    url: "https://www.easylaw.go.kr/CSP/CnpClsMainBtr.laf?ccfNo=2&cciNo=1&cnpClsNo=1&csmSeq=629&popMenu=ov",
    checkedAt: "2026-08-12",
  },
  court_real_estate_registry: {
    title: "대한민국 법원 인터넷등기소 부동산 등기 열람 안내",
    url: "https://www.iros.go.kr/index.jsp",
    checkedAt: "2026-08-13",
  },
  gov24_building_register: {
    title: "정부24 건축물대장 등본·초본 발급 및 열람 안내",
    url: "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=15000000098",
    checkedAt: "2026-08-13",
  },
  gov24_move_in_report: {
    title: "정부24 전입신고 안내",
    url: "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000016",
    checkedAt: "2026-08-13",
  },
  molit_real_transaction_prices: {
    title: "국토교통부 실거래가공개시스템",
    url: "https://rt.molit.go.kr/",
    checkedAt: "2026-08-13",
  },
  foreign_ministry_travel_safety: {
    title: "외교부 해외안전여행 여행 전 점검·위기 대응 안내",
    url: "https://www.0404.go.kr/app/main/mainPage",
    checkedAt: "2026-08-12",
  },
  kdca_travel_health: {
    title: "질병관리청 해외여행 전 건강정보",
    url: "https://www.kdca.go.kr/KDCAtemp/5043/subview.do",
    checkedAt: "2026-08-12",
  },
  easylaw_accessibility: {
    title: "찾기쉬운 생활법령 장애인 편의시설·편의 제공 안내",
    url: "https://www.easylaw.go.kr/CSP/CnpClsMain.laf?ccfNo=3&cciNo=1&cnpClsNo=1&csmSeq=1003",
    checkedAt: "2026-08-12",
  },
  food_safety_allergy: {
    title: "식품안전나라 식품 알레르기 대처 안내",
    url: "https://www.foodsafetykorea.go.kr/portal/board/boardDetail.do?bbs_no=bbs001&menu_grp=MENU_NEW01&menu_no=3120&ntctxt_no=1100304",
    checkedAt: "2026-08-12",
  },
} as const satisfies Record<string, ChecklistItemGuidanceSource>;

export type ChecklistItemGuidanceSourceId = keyof typeof CHECKLIST_ITEM_GUIDANCE_SOURCES;

export interface ChecklistItemGuidance {
  /** 사용자가 무엇을 확인해야 체크할 수 있는지 설명하는 관찰 가능한 기준. */
  completionCriteria: string;
  /** 다음 행동을 줄여 주는 짧은 실무 팁. */
  tip: string;
  /** 실수·분쟁·개인정보 노출을 줄이기 위한 주의. */
  caution: string;
  relativeDueDays?: ChecklistRelativeDueDays;
  applicabilityTags?: readonly string[];
  sourceRefs?: readonly ChecklistItemGuidanceSource[];
}

type ChecklistItemGuidanceOverride = Omit<
  Partial<ChecklistItemGuidance>,
  "sourceRefs"
> & {
  sourceRefs?: readonly ChecklistItemGuidanceSourceId[];
};

interface CategoryGuidanceProfile {
  completion: (label: string) => string;
  tip: string;
  caution: string;
  applicabilityTags?: ChecklistApplicabilityTag[];
}

const AGREEMENT_COMPLETION = (label: string) =>
  `‘${label}’에 대해 두 사람이 선택한 내용과 보류한 내용을 말로 확인하고, 다시 볼 날짜나 다음 담당까지 정했을 때 완료로 체크하세요.`;

const CONTRACT_COMPLETION = (label: string) =>
  `‘${label}’의 최종 조건을 계약서·견적·업체 메시지 중 하나에서 확인하고, 담당자와 확인 날짜를 남겼을 때 완료로 체크하세요.`;

const RESERVATION_COMPLETION = (label: string) =>
  `‘${label}’의 날짜·시간·장소·담당자와 변경 가능 시점을 예약 확인서나 메시지로 확인했을 때 완료로 체크하세요.`;

const DELIVERY_COMPLETION = (label: string) =>
  `‘${label}’에 필요한 품목·수량·상태·받는 사람과 전달 시점을 확인하고, 누락 시 연락할 담당자까지 알 때 완료로 체크하세요.`;

const OPERATION_COMPLETION = (label: string) =>
  `‘${label}’의 담당자·실행 시각·장소·연락 방법과 문제가 생겼을 때의 대체 행동을 한 진행표에서 확인했을 때 완료로 체크하세요.`;

const ADMIN_COMPLETION = (label: string) =>
  `‘${label}’의 현재 요건을 관할 기관의 공식 안내에서 확인하고, 필요한 서류·신청 장소·처리 상태를 당사자가 확인했을 때 완료로 체크하세요.`;

const AFTERCARE_COMPLETION = (label: string) =>
  `‘${label}’의 상대방·기한·남은 조치와 증빙 보관 위치를 확인하고, 미완료 사항의 다음 확인일을 정했을 때 완료로 체크하세요.`;

const CATEGORY_PROFILES: Record<WeddingChecklistCategoryKey, CategoryGuidanceProfile> = {
  foundation: {
    completion: AGREEMENT_COMPLETION,
    tip: "정답을 찾기보다 서로 다른 기준을 먼저 적고, 합의한 것과 아직 보류한 것을 분리하면 다음 대화가 쉬워집니다.",
    caution: "가족의 기대나 관행을 두 사람의 동의로 간주하지 말고, 민감한 대화의 상세 내용은 체크리스트에 적지 마세요.",
  },
  contracts: {
    completion: CONTRACT_COMPLETION,
    tip: "구두 설명은 최종 견적과 계약서에 반영해 달라고 요청하고, 포함·제외·변경 조건을 같은 화면에서 비교하세요.",
    caution: "광고 화면이나 상담자의 약속만으로 결제하지 말고, 서명 전 빈칸과 별도 비용·환불 조건을 직접 확인하세요.",
  },
  meeting: {
    completion: AGREEMENT_COMPLETION,
    tip: "부모님께 연락하기 전에 두 사람이 가능한 범위와 이 자리에서 나눌 주제를 먼저 맞추면 전달 과정의 오해가 줄어듭니다.",
    caution: "한쪽 가족의 방식이 기본이라고 전제하지 말고, 비용·선물·날짜를 그 자리에서 즉시 확정하도록 압박하지 마세요.",
  },
  venue: {
    completion: CONTRACT_COMPLETION,
    tip: "후보마다 같은 질문표를 사용해 공간, 식사, 접근성, 운영 인력, 최종 인원 변경 기한을 함께 비교하세요.",
    caution: "최소 인원·필수 상품·세금·장식 철거·주차처럼 총액을 바꾸는 조건을 구두 설명만으로 판단하지 마세요.",
    applicabilityTags: ["ceremony", "family_meal", "reception"],
  },
  studio: {
    completion: CONTRACT_COMPLETION,
    tip: "대표 사진뿐 아니라 실제 한 회차의 결과물과 납품 형식, 보정 범위, 원본 제공 여부를 같은 기준으로 비교하세요.",
    caution: "촬영자 지정, 일정 지연, 재촬영, 사진 공개 동의가 자동 포함되는지 계약서에서 따로 확인하세요.",
  },
  dress: {
    completion: DELIVERY_COMPLETION,
    tip: "서 있는 모습뿐 아니라 걷기·앉기·화장실 이동을 해 보고, 최종 피팅 때 입을 속옷과 신발도 함께 확인하세요.",
    caution: "대여품의 오염·파손 기준, 수선 범위, 반납 시각과 추가 비용은 매장마다 다르므로 인수 전에 확인하세요.",
    applicabilityTags: ["ceremony"],
  },
  makeup: {
    completion: RESERVATION_COMPLETION,
    tip: "원하는 사진과 피하고 싶은 표현을 함께 전달하고, 피부·두피 민감 사항은 필요한 범위에서 담당자에게 미리 알리세요.",
    caution: "이동 시간과 시작 지연 가능성을 빼고 일정을 잡지 말고, 알레르기·민감 정보는 공개 메모에 남기지 마세요.",
    applicabilityTags: ["ceremony"],
  },
  ring: {
    completion: DELIVERY_COMPLETION,
    tip: "착용 습관과 손의 붓기까지 고려해 사이즈를 확인하고, 소재·각인·수선·수령 조건을 주문서에 적으세요.",
    caution: "사진만 보고 소재나 보석의 품질을 단정하지 말고, 교환·재제작·사이즈 조정 조건을 결제 전에 확인하세요.",
  },
  hanbok: {
    completion: DELIVERY_COMPLETION,
    tip: "입을 사람별 착용 시간과 이동량을 확인하고, 대여품 목록과 반납 방법을 수령할 때 사진으로 남겨두세요.",
    caution: "가족 관행 때문에 당사자의 의사나 신체 편안함을 뒤로 미루지 말고, 진행하지 않으면 해당 없음으로 정리하세요.",
    applicabilityTags: ["family_tradition"],
  },
  yedan: {
    completion: AGREEMENT_COMPLETION,
    tip: "양가에 전달할 의미와 범위를 먼저 확인하고, 품목보다 두 사람이 감당 가능한 기준을 문장으로 합의하세요.",
    caution: "관행이나 체면을 이유로 한쪽에 부담을 몰거나 예상하지 못한 품목을 추가하지 말고, 생략도 같은 선택으로 존중하세요.",
    applicabilityTags: ["family_tradition"],
  },
  honeymoon: {
    completion: RESERVATION_COMPLETION,
    tip: "예약별 취소·변경 조건과 여권 이름 표기를 확인하고, 공식 안전·입국 안내를 출발 직전에 다시 확인하세요.",
    caution: "비자·입국·보건 요건은 목적지와 개인 상황에 따라 바뀔 수 있으므로 후기만 믿지 말고 공식 기관에서 확인하세요.",
  },
  houseware: {
    completion: DELIVERY_COMPLETION,
    tip: "입주일과 공간 치수를 기준으로 지금 필요한 것, 살아 본 뒤 살 것, 사지 않을 것을 나누면 중복 구매를 줄일 수 있습니다.",
    caution: "배송·설치 가능 조건, 반품 범위, 기존 제품 처분과 문 통과 치수를 확인하지 않은 채 한꺼번에 주문하지 마세요.",
  },
  housing: {
    completion: CONTRACT_COMPLETION,
    tip: "예산뿐 아니라 통근, 계약 기간, 수리 책임, 보증금 반환 위험을 같은 표에서 비교하고 공식 서류를 직접 확인하세요.",
    caution: "소유자·대리 권한과 권리관계를 확인하기 전 송금하지 말고, 대출이나 보증 가능성을 광고 문구로 단정하지 마세요.",
  },
  invitation: {
    completion: DELIVERY_COMPLETION,
    tip: "두 사람이 날짜·장소·연락처·이름 표기를 교차 검수하고, 모바일 링크는 다른 기기에서도 직접 열어보세요.",
    caution: "주소·연락처·계좌 등 개인정보를 필요 이상 공개하지 말고, 발송 전 오탈자와 변경 연락 방법을 확인하세요.",
  },
  snap: {
    completion: CONTRACT_COMPLETION,
    tip: "원하는 순간과 촬영을 원하지 않는 장면을 함께 전달하고, 결과물의 형식·납품일·수정 횟수를 적어두세요.",
    caution: "업체 홍보용 공개 동의와 촬영 계약을 묶어서 판단하지 말고, 원본 보관 기간과 촬영자 변경 조건을 확인하세요.",
    applicabilityTags: ["ceremony"],
  },
  shoes: {
    completion: DELIVERY_COMPLETION,
    tip: "예식 동선과 같은 바닥에서 미리 걸어 보고, 통증이나 미끄러움이 있으면 갈아 신을 신발을 가까운 담당자에게 맡기세요.",
    caution: "외형만 보고 고르지 말고, 새 신발을 당일 처음 신거나 통증을 참고 장시간 착용하지 마세요.",
    applicabilityTags: ["ceremony"],
  },
  bouquet: {
    completion: DELIVERY_COMPLETION,
    tip: "의상과 공간 사진을 함께 보내 크기·색·소재를 맞추고, 전달 장소·보관 온도·회수 대상을 담당자와 확인하세요.",
    caution: "계절과 수급에 따라 꽃이 바뀔 수 있으므로 대체 가능한 범위와 추가 장식의 설치·철거 책임을 미리 정하세요.",
    applicabilityTags: ["ceremony"],
  },
  gift: {
    completion: DELIVERY_COMPLETION,
    tip: "대상, 수량 변경 기한, 보관 장소, 남은 물품 처리 방법을 정하고 샘플로 크기와 포장 상태를 확인하세요.",
    caution: "예상 인원을 그대로 확정 수량으로 주문하지 말고, 식품이면 알레르기·보관·소비기한 정보를 확인하세요.",
    applicabilityTags: ["reception"],
  },
  mc: {
    completion: OPERATION_COMPLETION,
    tip: "진행자에게 최종 대본, 정확한 이름·호칭, 금지할 농담, 시간 초과 때 줄일 순서를 한 문서로 전달하세요.",
    caution: "즉흥 진행에 맡기지 말고, 당사자 동의 없는 공개 질문·압박·개인사 언급은 사전에 제외하세요.",
    applicabilityTags: ["ceremony"],
  },
  ham: {
    completion: AGREEMENT_COMPLETION,
    tip: "전통을 재현할지 의미만 간단히 남길지 양가와 먼저 합의하고, 전달자·시간·운반 방법을 실제 동선에 맞추세요.",
    caution: "원치 않는 음주·소음·현금 요구나 성 역할을 관행으로 강요하지 말고, 생략 선택을 존중하세요.",
    applicabilityTags: ["family_tradition"],
  },
  pyebaek: {
    completion: OPERATION_COMPLETION,
    tip: "참여자와 순서, 의상 교체 시간, 이동 동선, 음식 보관과 남은 음식 처리를 장소 담당자와 확인하세요.",
    caution: "어른의 기대만으로 진행을 확정하지 말고, 무릎·허리 부담이나 임신 등 신체 상황에 맞춰 동작을 조정하세요.",
    applicabilityTags: ["family_tradition"],
  },
  guests: {
    completion: OPERATION_COMPLETION,
    tip: "참석 여부와 필요한 지원만 최소한으로 모으고, 최종 인원·좌석·식사·이동 정보를 같은 명단에서 관리하세요.",
    caution: "알레르기·장애·연락처 같은 민감 정보를 공개 문서에 적지 말고, 필요한 현장 담당자에게만 전달하세요.",
    applicabilityTags: ["ceremony", "family_meal", "reception"],
  },
  ceremony: {
    completion: OPERATION_COMPLETION,
    tip: "두 사람이 당일 결정을 직접 처리하지 않도록 최종 진행표 한 부와 현장 총괄, 대체 담당자를 정하세요.",
    caution: "서로 다른 파일이나 구두 지시가 동시에 돌지 않게 버전과 최종 수정 시각을 표시하고, 비상 연락망을 공개 배포하지 마세요.",
    applicabilityTags: ["ceremony"],
  },
  home_admin: {
    completion: ADMIN_COMPLETION,
    tip: "계약 형태와 주소에 따라 절차가 달라질 수 있으니 계약 직전과 실제 입주일에 공식 안내를 다시 확인하세요.",
    caution: "등기·건축물·소유자·대리 권한과 권리 변동을 확인하기 전 큰 금액을 보내지 말고, 민감 서류를 채팅에 올리지 마세요.",
  },
  health_admin: {
    completion: ADMIN_COMPLETION,
    tip: "두 사람에게 필요한 항목만 선택하고, 건강은 의료진·행정은 관할 기관의 최신 안내에서 개별 상황을 확인하세요.",
    caution: "검사나 임신 준비를 결혼의 의무로 표현하지 말고, 진단명·검사 결과·신분 서류를 체크리스트에 저장하지 마세요.",
  },
  aftercare: {
    completion: AFTERCARE_COMPLETION,
    tip: "반납·정산·납품·행정을 계약별 기한으로 나누고, 결혼식 뒤 한 달과 석 달에 미완료 항목을 다시 확인하세요.",
    caution: "행사가 끝났다는 이유로 영수증·계약서·대화 기록을 바로 지우지 말고, 모든 환불과 결과물 수령을 확인한 뒤 정리하세요.",
  },
  special_cases: {
    completion: AGREEMENT_COMPLETION,
    tip: "먼저 해당 여부를 정하고, 해당한다면 당사자가 원하는 지원과 공개 범위, 담당자, 재확인 날짜만 최소한으로 남기세요.",
    caution: "국적·장애·임신·이전 관계·가족 상황을 추측하거나 공개하지 말고, 법률·의료 판단은 관할 기관이나 전문가에게 확인하세요.",
  },
};

const ITEM_OVERRIDES: Partial<Record<string, ChecklistItemGuidanceOverride>> = {
  makeup_07: {
    relativeDueDays: 0,
  },
  contracts_04: {
    completionCriteria:
      "계약서의 상호·사업자 정보·주소·연락처가 견적과 일치하고, 계약 이행을 책임질 담당자와 변경 시 연락 창구를 확인했을 때 완료로 체크하세요.",
  },
  contracts_07: {
    completionCriteria:
      "소비자·업체 귀책, 날짜 변경, 감염병·재난·장소 폐쇄 등 상황별 취소·환불·대체 조건과 통지 방법을 계약서에서 확인했을 때 완료로 체크하세요.",
    tip: "계약서 기준과 한국소비자원의 현재 분쟁해결기준을 함께 확인하고, 합의한 예외 조건은 서면으로 남기세요.",
    caution: "인터넷의 오래된 위약금 표를 그대로 적용하지 말고, 계약일·예식일·실제 계약 조항을 기준으로 확인하세요.",
    sourceRefs: ["kca_dispute_standard"],
  },
  contracts_10: {
    completionCriteria:
      "서비스 제공에 필요한 정보와 선택적인 홍보·게시 동의를 구분해 확인하고, 공개 범위·철회 문의처·보관 기간을 알 때 완료로 체크하세요.",
  },
  venue_04: {
    completionCriteria:
      "메뉴·제공 방식·어린이 식사·알레르기 대응·음료·시식 여부와 최종 보증 인원 변경 기한을 견적에서 확인했을 때 완료로 체크하세요.",
    tip: "참석자의 식사 요청은 필요한 내용만 익명 수량으로 전달하고, 주방이 교차접촉까지 대응 가능한지 별도로 물어보세요.",
    caution: "알레르기 대응을 단순 선호 메뉴와 같게 다루거나, 확인되지 않은 ‘완전 무첨가’를 참석자에게 약속하지 마세요.",
    applicabilityTags: ["family_meal", "reception"],
    sourceRefs: ["food_safety_allergy"],
  },
  venue_06: {
    sourceRefs: ["kca_dispute_standard"],
  },
  venue_08: {
    completionCriteria:
      "대기·휴식 공간, 화장실·주차·수유·휠체어 접근 경로와 사진 촬영 공간을 실제 동선으로 확인하고 제한 사항을 기록했을 때 완료로 체크하세요.",
    sourceRefs: ["easylaw_accessibility"],
  },
  honeymoon_01: {
    applicabilityTags: ["travel"],
  },
  honeymoon_02: {
    applicabilityTags: ["travel"],
  },
  honeymoon_03: {
    tip: "탑승자 이름과 예약 정보를 한 글자씩 대조하고, 좌석·수하물·환승·변경·환불 조건을 결제 화면과 예약 확인서에서 확인하세요.",
    applicabilityTags: ["travel"],
  },
  honeymoon_04: {
    tip: "도착 시각과 이동 방법, 체크인 조건, 접근성, 취소 마감과 현지 추가 결제 항목을 예약 확인서에 모아두세요.",
    applicabilityTags: ["travel"],
  },
  honeymoon_05: {
    completionCriteria:
      "여행 일정과 건강 상태에 맞는 보장·제외 항목, 청구 연락처와 필요한 증빙을 약관에서 확인하고 증권을 저장했을 때 완료로 체크하세요.",
    caution: "‘여행자 보험’이라는 이름만 보고 모든 사고가 보장된다고 가정하지 말고, 기존 질환·임신·액티비티·수하물 제외 조건을 확인하세요.",
    applicabilityTags: ["travel"],
  },
  honeymoon_06: {
    completionCriteria:
      "여권의 영문명·만료일·훼손 여부와 목적지·경유지의 현재 비자·입국 조건을 각 공식기관에서 확인했을 때 완료로 체크하세요.",
    caution: "국가별 입국 요건은 바뀔 수 있으므로 항공권 판매 화면이나 개인 후기만 믿지 말고 출발 직전에 다시 확인하세요.",
    applicabilityTags: ["overseas_travel"],
    sourceRefs: ["foreign_ministry_travel_safety"],
  },
  honeymoon_07: {
    applicabilityTags: ["travel"],
  },
  honeymoon_08: {
    applicabilityTags: ["overseas_travel"],
  },
  housing_01: {
    applicabilityTags: ["rental_home", "home_purchase"],
  },
  housing_02: {
    applicabilityTags: ["rental_home", "home_purchase"],
  },
  housing_03: {
    applicabilityTags: ["rental_home", "home_purchase"],
  },
  housing_04: {
    caution: "사전 안내나 계산 결과를 승인으로 보지 말고, 실제 신청 가능 여부·금리·비용·상환 조건은 금융기관의 최종 서류에서 확인하세요.",
    applicabilityTags: ["rental_home", "home_purchase"],
  },
  housing_05: {
    applicabilityTags: ["rental_home", "home_purchase"],
  },
  bouquet_06: {
    completionCriteria:
      "무대·테이블·입구 등 꽃과 장식의 위치·수량·대체 소재, 설치·철거 시각, 화기·접착 제한과 폐기 담당을 도면에서 확인했을 때 완료로 체크하세요.",
    caution: "장소 기본 장식과 외부 업체 장식을 중복 주문하지 말고, 벽·바닥 훼손이나 생화 폐기 책임을 현장에서 정하지 마세요.",
  },
  gift_05: {
    completionCriteria:
      "최종 참석 답변과 장소의 수량 변경 기한을 기준으로 주문 수량·예비 수량·남은 물품 처리 방법을 확인했을 때 완료로 체크하세요.",
  },
  guests_04: {
    completionCriteria:
      "식사 알레르기·종교·건강 조정과 이동 지원 요청을 당사자에게 확인하고, 민감한 사유 없이 필요한 조치와 담당자만 전달했을 때 완료로 체크하세요.",
    sourceRefs: ["food_safety_allergy", "easylaw_accessibility"],
  },
  guests_05: {
    completionCriteria:
      "가족·어린이·고령자·휠체어·보조견·통역 이용자의 의사를 확인해 좌석표, 통로 폭, 화장실·출구 접근과 동반 좌석을 점검했을 때 완료로 체크하세요.",
    tip: "지원이 필요한 사람에게 먼저 원하는 좌석과 도움 방식을 묻고, 현장 담당자와 함께 실제 입장·식사·퇴장 동선을 걸어보세요.",
    sourceRefs: ["easylaw_accessibility"],
  },
  guests_06: {
    completionCriteria:
      "성인·어린이·식사 제외·알레르기 조정 인원을 구분하고, 장소가 받는 최종 식사 인원과 변경 마감을 문서로 확인했을 때 완료로 체크하세요.",
  },
  guests_07: {
    completionCriteria:
      "대중교통·주차·셔틀의 운행 시각과 승하차 위치, 휠체어·유아차 접근 경로, 지연 시 연락 방법을 실제 이용 가능한 안내로 공유했을 때 완료로 체크하세요.",
    sourceRefs: ["easylaw_accessibility"],
  },
  guests_08: {
    completionCriteria:
      "숙박이 필요한 사람에게 위치·이동 시간·예약 마감·취소 조건·접근성 정보를 전달하고, 각자가 직접 예약 여부를 확인했을 때 완료로 체크하세요.",
  },
  guests_10: {
    completionCriteria:
      "접수·방명록·하객 안내·선물 보관 담당별 시작·교대·종료 시각과 귀중품 인계 상대를 연락망에서 확인했을 때 완료로 체크하세요.",
    applicabilityTags: ["ceremony", "reception"],
  },
  ceremony_03: {
    completionCriteria:
      "음악·영상·발표 파일을 장소 장비에서 끝까지 재생하고 화면비·글꼴·음량·마이크 수를 확인한 뒤, 다른 기기와 오프라인 매체에 백업했을 때 완료로 체크하세요.",
    caution: "스트리밍이나 개인 휴대전화 한 대에만 의존하지 말고, 저작권·네트워크·어댑터·파일 손상 가능성을 현장 재생으로 확인하세요.",
  },
  ceremony_05: {
    completionCriteria:
      "현장 총괄 한 명과 대체 총괄을 지정하고, 두 사람 대신 결정할 수 있는 범위·업체별 연락처·비상 승인 방법을 진행표에 적었을 때 완료로 체크하세요.",
    tip: "총괄에게는 최종 진행표와 ‘두 사람에게 바로 묻지 않아도 되는 결정’ 목록을 함께 전달하세요.",
    caution: "이름만 지정하지 말고 현장 도착 시각과 권한을 당사자에게 확인하며, 모든 책임을 무급 지인 한 명에게 몰지 마세요.",
  },
  ceremony_07: {
    completionCriteria:
      "참여자가 실제 위치에서 입장 신호·보행 동선·서 있는 자리·마이크 높이와 음향 상태를 확인하고, 불참 시 대체 순서를 알 때 완료로 체크하세요.",
  },
  ceremony_08: {
    completionCriteria:
      "악천후·교통 지연·정전·업체 불참·응급 상황별 중단 기준, 대체 공간·담당자·연락 순서와 하객 공지 방법을 장소와 확인했을 때 완료로 체크하세요.",
    tip: "가장 가능성 높은 비상 상황부터 ‘누가 판단하고 누구에게 무엇을 알리는지’를 한 줄씩 적어 현장 총괄에게 주세요.",
    caution: "실제 응급 상황에서는 앱보다 현장 안내와 긴급기관 지시를 우선하고, 의료 정보는 필요한 사람에게만 공유하세요.",
  },
  ceremony_12: {
    completionCriteria:
      "대여품·개인 물품·분실물별 회수 담당과 보관 장소, 귀가 지원이 필요한 사람의 차량·동행·비상 연락을 확인했을 때 완료로 체크하세요.",
  },
  home_admin_01: {
    applicabilityTags: ["rental_home", "home_purchase"],
  },
  home_admin_02: {
    completionCriteria:
      "등기·건축물 정보에서 주소·소유자·권리관계를 확인하고, 대리 계약이면 위임 범위와 신분을 공식 서류로 대조했을 때 완료로 체크하세요.",
    tip: "매수라면 공식 실거래가와 현장 하자·예상 수리비를 별도로 확인하세요.",
    applicabilityTags: ["rental_home", "home_purchase"],
    sourceRefs: [
      "court_real_estate_registry",
      "gov24_building_register",
      "molit_real_transaction_prices",
    ],
  },
  home_admin_03: {
    completionCriteria:
      "선순위 권리와 시세·보증금 반환 위험을 확인하고, 해당되는 보증 상품의 가입 가능 여부와 제외 조건을 운영기관에서 확인했을 때 완료로 체크하세요.",
    applicabilityTags: ["rental_home"],
    sourceRefs: ["easylaw_lease_safety"],
  },
  home_admin_04: {
    applicabilityTags: ["rental_home"],
  },
  home_admin_05: {
    completionCriteria:
      "잔금 송금 직전에 최신 권리관계와 인도 상태를 다시 확인하고, 계약서의 수취인 계좌와 실제 수취인을 대조해 영수증을 보관했을 때 완료로 체크하세요.",
    applicabilityTags: ["rental_home", "home_purchase"],
    sourceRefs: ["court_real_estate_registry"],
  },
  home_admin_06: {
    completionCriteria:
      "계약 주소·금액·형태가 현재 임대차 신고 대상인지 공식 시스템에서 확인하고, 신고·확정일자 처리 결과를 조회했을 때 완료로 체크하세요.",
    caution: "기준과 기한은 바뀔 수 있으므로 과거 안내문만 따르지 말고 계약 체결 시점의 공식 안내와 관할 기관에 확인하세요.",
    applicabilityTags: ["rental_home"],
    sourceRefs: ["molit_rental_reporting"],
  },
  home_admin_07: {
    completionCriteria:
      "실제 입주일과 관할 주소를 기준으로 전입신고 방법·준비 서류·연계 가능한 절차를 공식 안내에서 확인하고 접수 결과를 보관했을 때 완료로 체크하세요.",
    sourceRefs: ["gov24_move_in_report"],
  },
  health_admin_03: {
    completionCriteria:
      "임신을 계획하는 당사자가 원할 때 의료진에게 복용약·예방접종·기저질환 상담 시점을 확인하고, 필요한 예약만 남겼을 때 완료로 체크하세요.",
    caution: "임신 계획이나 검사를 결혼의 의무로 만들지 말고, 검사 결과나 진단명은 체크리스트와 공동 알림에 기록하지 마세요.",
    applicabilityTags: ["pregnancy_or_health_support"],
  },
  health_admin_04: {
    completionCriteria:
      "목적지별 최신 감염병 정보와 필요한 예방접종·예방약·상비약을 질병관리청 안내와 의료진에게 확인했을 때 완료로 체크하세요.",
    applicabilityTags: ["overseas_travel"],
    sourceRefs: ["kdca_travel_health"],
  },
  health_admin_05: {
    completionCriteria:
      "법률혼 선택 여부와 희망 시점을 두 사람이 합의하고, 신고 장소와 각자 방문 가능 여부를 현재 공식 안내에서 확인했을 때 완료로 체크하세요.",
    applicabilityTags: ["legal_marriage"],
    sourceRefs: ["court_marriage_report"],
  },
  health_admin_06: {
    completionCriteria:
      "혼인신고서의 모든 필수란과 증인 서명, 당사자 신분증 등 현재 필요한 서류를 접수 기관의 공식 안내와 대조했을 때 완료로 체크하세요.",
    caution: "서식·첨부서류는 개인 상황에 따라 달라질 수 있으므로 블로그 목록만 보고 준비를 끝내지 말고 관할 접수처에 재확인하세요.",
    applicabilityTags: ["legal_marriage"],
    sourceRefs: ["court_marriage_report"],
  },
  health_admin_07: {
    completionCriteria:
      "국제혼인·재외국민 등 당사자 상황에 맞는 혼인성립 증명, 국적·번역·인증 서류와 양국 신고 순서를 각 관할 기관에서 확인했을 때 완료로 체크하세요.",
    applicabilityTags: ["international_marriage", "legal_marriage"],
    sourceRefs: ["court_marriage_report", "easylaw_international_marriage"],
  },
  health_admin_08: {
    completionCriteria:
      "접수기관에서 혼인신고 처리 상태를 확인하고, 필요한 가족관계 증명에 반영됐는지 당사자가 직접 확인했을 때 완료로 체크하세요.",
    applicabilityTags: ["legal_marriage"],
    sourceRefs: ["court_marriage_report"],
  },
  aftercare_03: {
    completionCriteria:
      "분실·파손·계약 불이행의 일시와 피해 내용을 정리하고 계약서·사진·결제·대화 증빙을 보관해 업체 답변과 다음 분쟁 조정 단계를 알 때 완료로 체크하세요.",
    tip: "업체에 원하는 해결안을 서면으로 먼저 전달하고, 해결되지 않으면 한국소비자원의 최신 피해구제·분쟁조정 안내를 확인하세요.",
    caution: "증빙 원본을 보내거나 공개 글에 상대방 개인정보를 올리지 말고, 법적 결론을 앱 안내만으로 단정하지 마세요.",
    sourceRefs: ["kca_dispute_standard"],
  },
  aftercare_06: {
    completionCriteria:
      "사진·영상의 원본·선택본·수정본별 약속된 전달일과 선택·수정 상태를 확인하고, 결혼식 뒤 석 달 점검 때 미납품 항목의 새 기한을 문서로 받았을 때 완료로 체크하세요.",
    relativeDueDays: -90,
  },
  special_cases_01: {
    completionCriteria:
      "국제혼인 당사자 각각의 본국법상 성립 요건과 양국의 신고 순서·번역·아포스티유 또는 영사 확인 필요 여부를 각 공식기관에서 확인했을 때 완료로 체크하세요.",
    applicabilityTags: ["international_marriage", "legal_marriage"],
    sourceRefs: ["court_marriage_report", "easylaw_international_marriage"],
  },
  special_cases_02: {
    completionCriteria:
      "비자·체류·국적 절차가 실제로 필요한지 관할 출입국·재외공관에 확인하고, 신청 주체·서류·예약·처리 상태를 당사자가 관리할 때 완료로 체크하세요.",
    applicabilityTags: ["international_marriage"],
    sourceRefs: ["easylaw_international_marriage"],
  },
  special_cases_03: {
    completionCriteria:
      "종교 예식의 필수·선택 의식, 교육·서류·복장·음식·참여자를 당사자와 주례 기관에 확인하고 생략 항목까지 합의했을 때 완료로 체크하세요.",
    applicabilityTags: ["religious_ceremony"],
  },
  special_cases_04: {
    completionCriteria:
      "무예식 또는 예식 없이 혼인신고·식사·사진만 진행할 범위를 합의하고, 알릴 사람·문구·시점과 법률혼 여부를 따로 확인했을 때 완료로 체크하세요.",
    applicabilityTags: ["no_ceremony"],
  },
  special_cases_05: {
    completionCriteria:
      "재혼 당사자가 이전 관계의 법적 절차·재산·채무·양육·가족 호칭 중 현재 합의가 필요한 범위를 정하고, 필요 시 전문가 확인을 마쳤을 때 완료로 체크하세요.",
    caution: "이전 관계의 상세 사정이나 자녀 정보를 가족·업체에 불필요하게 공개하지 말고, 앱 안내를 법률 자문으로 사용하지 마세요.",
    applicabilityTags: ["remarriage"],
  },
  special_cases_06: {
    completionCriteria:
      "자녀가 이해할 수 있는 방식으로 참여·불참 선택, 호칭, 돌봄 담당, 휴식 공간과 사진 공개 범위를 확인했을 때 완료로 체크하세요.",
    applicabilityTags: ["children_participating"],
  },
  special_cases_07: {
    completionCriteria:
      "장애·질환·임신·고령 등 지원 당사자에게 원하는 도움과 원하지 않는 도움을 묻고, 접근 경로·좌석·휴식·약·비상 연락을 최소 담당자에게 전달했을 때 완료로 체크하세요.",
    tip: "진단명을 묻기보다 계단, 이동 거리, 소음, 식사, 휴식처럼 실제 필요한 지원을 당사자의 표현 그대로 확인하세요.",
    caution: "선의로 지원 방식을 대신 결정하거나 민감한 사유를 좌석표·단체 채팅에 공개하지 마세요.",
    applicabilityTags: ["pregnancy_or_health_support", "accessibility_support"],
    sourceRefs: ["easylaw_accessibility"],
  },
  special_cases_08: {
    completionCriteria:
      "통역·수어·자막·큰 글자·쉬운 안내·조용한 공간 중 당사자가 원하는 지원, 제공자, 장비, 위치와 대체 방법을 현장에서 확인했을 때 완료로 체크하세요.",
    applicabilityTags: ["accessibility_support"],
    sourceRefs: ["easylaw_accessibility"],
  },
  special_cases_09: {
    completionCriteria:
      "안전 우려 당사자의 동의 아래 초대 제외·주소 비공개·사진 제한·현장 출입 대응과 비상 연락 담당을 필요한 인원에게만 공유했을 때 완료로 체크하세요.",
    caution: "위험 신호가 있으면 가족 중재보다 당사자의 안전과 전문기관 안내를 우선하고, 위치·연락처를 공용 문서에 남기지 마세요.",
  },
  special_cases_10: {
    completionCriteria:
      "선택한 특별 준비와 반려동물 참여 여부를 정하고, 담당·비용·이동·휴식·배변·소음·알레르기·동물 출입 허용·대체 돌봄과 개인정보 범위를 확인했을 때 완료로 체크하세요.",
    tip: "반려동물이 참여한다면 장소 허용을 서면으로 받고, 익숙한 보호자와 조용한 대기 장소, 중도 귀가 계획을 따로 정하세요.",
    caution: "사진을 위해 동물의 스트레스 신호를 무시하지 말고, 음식 공간·알레르기·보조견 접근을 일반 반려동물과 같은 기준으로 다루지 마세요.",
    applicabilityTags: ["pet_participation"],
  },
};

function completionForItem(categoryKey: WeddingChecklistCategoryKey, itemId: string, label: string) {
  if (/예약|일정 확정|날짜 예약/.test(label)) {
    return RESERVATION_COMPLETION(label);
  }
  if (/계약|견적|금액|비용|납부|환불/.test(label)) {
    return CONTRACT_COMPLETION(label);
  }
  if (/수령|구매|주문|배송|준비|포장|반납/.test(label)) {
    return DELIVERY_COMPLETION(label);
  }
  return CATEGORY_PROFILES[categoryKey].completion(label);
}

function tailoredTip(baseTip: string, label: string) {
  if (/필요한 경우|진행할지|필요 여부/.test(label)) {
    return "먼저 두 사람에게 해당하는지 결정하고, 하지 않기로 했다면 할 일로 남겨두지 말고 ‘해당 없음’으로 정리하세요.";
  }
  if (/전달|공유|발송|안내/.test(label)) {
    return "누가 누구에게 무엇을 언제 전달할지 정하고, 받은 사람이 확인했다는 답을 남기면 반복 연락과 누락을 줄일 수 있습니다.";
  }
  if (/비교|후보/.test(label)) {
    return "후보마다 같은 필수 조건과 제외 조건을 적어 두고, 총액·일정·취소 조건을 한 표에서 비교하세요.";
  }
  return baseTip;
}

function tailoredCaution(baseCaution: string, label: string) {
  if (/계약|견적|금액|비용|납부|환불/.test(label)) {
    return "구두 약속이나 광고 문구만 믿지 말고, 최종 총액·포함 항목·변경·취소 조건이 서면에 있는지 결제 전에 확인하세요.";
  }
  if (/사진|영상|연락처|신분|건강|알레르기/.test(label)) {
    return "사진·연락처·건강·신분 정보는 필요한 사람에게 필요한 범위만 공유하고, 공개 메모나 단체 채팅에 상세 내용을 남기지 마세요.";
  }
  return baseCaution;
}

function suggestedRelativeDueDays(
  start: number,
  deadline: number,
  itemIndex: number,
  itemCount: number,
) {
  if (itemCount <= 1) return deadline;
  const progress = itemIndex / (itemCount - 1);
  return Math.round(start + (deadline - start) * progress);
}

const guidanceEntries = CATEGORY_CHECKLISTS.flatMap((category) => {
  const profile = CATEGORY_PROFILES[category.key];
  return category.items.map((item, itemIndex) => {
    const base: ChecklistItemGuidance = {
      completionCriteria: completionForItem(category.key, item.id, item.label),
      tip: tailoredTip(profile.tip, item.label),
      caution: tailoredCaution(profile.caution, item.label),
      relativeDueDays: suggestedRelativeDueDays(
        category.ddayStart,
        category.ddayDeadline,
        itemIndex,
        category.items.length,
      ),
      ...(profile.applicabilityTags ? { applicabilityTags: profile.applicabilityTags } : {}),
    };

    const override = ITEM_OVERRIDES[item.id];
    const { sourceRefs, ...overrideFields } = override ?? {};
    const guidance: ChecklistItemGuidance = {
      ...base,
      ...overrideFields,
      ...(sourceRefs
        ? {
            sourceRefs: sourceRefs.map(
              (sourceId) => CHECKLIST_ITEM_GUIDANCE_SOURCES[sourceId],
            ),
          }
        : {}),
    };

    return [item.id, guidance] as const;
  });
});

/**
 * 기존 218개 항목 ID를 그대로 유지하면서 체크 기준·팁·주의·권장 시점·조건부 태그를 보강합니다.
 * 항목 추가/삭제 시 계약 테스트가 누락 또는 고아 메타데이터를 차단합니다.
 */
export const CHECKLIST_ITEM_GUIDANCE: Readonly<Record<string, ChecklistItemGuidance>> =
  Object.fromEntries(guidanceEntries);

export function getChecklistItemGuidance(itemId: string): ChecklistItemGuidance | undefined {
  return CHECKLIST_ITEM_GUIDANCE[itemId];
}
