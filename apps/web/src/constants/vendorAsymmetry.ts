/**
 * 웨딩 업체 정보 비대칭 — 업체는 알지만 소비자는 모르는 것
 *
 * 5가지 역할 중 #5 "정보 격차 해소자" 데이터 코어.
 * 마케팅 약속: "업체가 아는 모든 것을 당신도 알 수 있게."
 * 가격·법률·업계 관행은 단정하지 않고, 사용자가 받은 최신 서면 자료를
 * 확인하는 질문과 행동만 제공한다.
 */

export type VendorAsymmetryCategory =
  | "negotiation"   // 협상 전술 — 업체가 쓰는 압박 패턴
  | "scam"          // 흔한 분쟁/사기 패턴
  | "redFlag"       // 계약 전 경고 신호
  | "secret";       // 업계가 안 알려주는 사실 (소비자 우위 정보)

export interface VendorAsymmetryItem {
  id: string;
  category: VendorAsymmetryCategory;
  title: string;
  /** 업체 측 행동/주장/관행 */
  pattern: string;
  /** 소비자가 알아야 할 진실 */
  truth: string;
  /** 실전 대응 방법 */
  defense: string;
  /** 출처 (있으면) */
  source?: string;
}

export const VENDOR_ASYMMETRY: VendorAsymmetryItem[] = [
  {
    id: "neg_artificial_urgency",
    category: "negotiation",
    title: "당일 계약을 권유받을 때",
    pattern: '"오늘 계약 안 하시면 이 가격 보장 못 해드려요"',
    truth: "유효기간과 수량 조건이 서면에 없다면 실제 마감 조건인지 확인할 수 없습니다.",
    defense: "견적 유효기간, 적용 조건, 재문의 시 가격, 취소 조건을 서면으로 받은 뒤 결정하세요.",
  },
  {
    id: "neg_false_intimacy",
    category: "negotiation",
    title: "특별 할인을 제안받을 때",
    pattern: '"고객님은 특별히 친한 손님이라 깎아드리는 거예요"',
    truth: "말로 들은 혜택만으로는 최종 적용 여부와 제외 조건을 알 수 없습니다.",
    defense: "할인 전후 항목, 최종 총액, 적용·제외 조건이 적힌 새 견적서를 요청하세요.",
  },
  {
    id: "neg_anchor_pricing",
    category: "negotiation",
    title: "정가 대비 할인을 강조할 때",
    pattern: '"원래 가격에서 특별히 할인해드릴게요"',
    truth: "정가의 구성과 현재 견적의 구성이 같아야 할인 폭을 비교할 수 있습니다.",
    defense: "검수된 공시가와 다른 업체 견적을 같은 지역·일정·구성 기준으로 맞춰 비교하세요.",
  },
  {
    id: "neg_sunk_cost_trap",
    category: "negotiation",
    title: "세부 조건 전에 계약금을 요청할 때",
    pattern: '"계약금부터 일단 내시고 세부사항은 천천히 정하시면 돼요"',
    truth: "세부 조건이 비어 있으면 이후 변경·취소 범위와 최종 금액을 판단하기 어렵습니다.",
    defense: "가격, 포함 항목, 일정, 변경·취소 조건을 계약서에 적고 결제 증빙을 보관하세요.",
  },
  {
    id: "scam_no_retouching",
    category: "scam",
    title: "사진 제공 범위가 모호할 때",
    pattern: "계약서에 사진 제공이라고만 적혀 있음",
    truth: "원본·보정본·앨범의 수량과 전달 방식이 구분되지 않으면 결과물을 예측하기 어렵습니다.",
    defense: "원본과 보정본의 수량, 파일 형식, 전달 기한, 추가 선택 비용을 각각 적어달라고 요청하세요.",
  },
  {
    id: "scam_overtime_fee",
    category: "scam",
    title: "시간 연장료 사후 청구",
    pattern: "촬영 뒤 처음 보는 연장료가 청구서에 추가됨",
    truth: "기본 시간과 연장 조건이 확인되지 않으면 청구 근거를 판단할 수 없습니다.",
    defense: "기본 시간, 연장 단위와 단가, 연장 전 동의 절차를 계약 전에 서면으로 확인하세요.",
  },
  {
    id: "scam_helper_extra",
    category: "scam",
    title: "당일 보조 인력 비용이 별도일 때",
    pattern: "본식 당일 \"헬퍼분 식대 별도예요\" 통보",
    truth: "헬퍼비·식대·교통비의 포함 여부가 없으면 최종 결제액을 알기 어렵습니다.",
    defense: "당일 발생 가능한 인력·식대·교통 항목을 포함과 별도로 나눠 견적서에 적어달라고 요청하세요.",
  },
  {
    id: "scam_package_change_penalty",
    category: "scam",
    title: "패키지 일부 변경 비용이 불명확할 때",
    pattern: "한 항목을 바꾸려는데 패키지 전체 변경 비용을 안내받음",
    truth: "계약 유형과 변경 시점에 따라 조건이 달라 문구와 산식을 확인해야 합니다.",
    defense: "적용 조항, 변경 대상, 계산 근거를 서면으로 요청하고 최신 표준약관 적용 여부를 공식 기관에 확인하세요.",
  },
  {
    id: "rf_cash_only",
    category: "redFlag",
    title: "결제 수단이 제한될 때",
    pattern: '"카드 결제는 부가세 별도예요" 또는 "현금만 받습니다"',
    truth: "결제 수단에 따라 총액이나 증빙이 달라지는지 서면 확인이 필요합니다.",
    defense: "부가세 포함 총액, 가능한 결제 수단, 현금영수증·카드전표 발급 여부를 결제 전에 확인하세요.",
  },
  {
    id: "rf_no_business_reg",
    category: "redFlag",
    title: "사업자등록번호 없는 업체",
    pattern: "계약서에 사업자등록번호 없거나 거부",
    truth: "계약 상대방의 법적 명칭과 연락처가 불분명하면 책임 주체를 확인하기 어렵습니다.",
    defense: "상호, 대표자, 사업자등록번호, 주소, 연락처가 계약서와 결제 증빙에 일치하는지 확인하세요.",
  },
  {
    id: "rf_verbal_only",
    category: "redFlag",
    title: "구두 약속만 남아 있을 때",
    pattern: '"우린 다 이렇게 해요, 믿고 맡기세요"',
    truth: "말로 합의한 내용은 당사자별 기억이 달라질 수 있어 제공 범위를 입증하기 어렵습니다.",
    defense: "무료 제공, 할인, 서비스 범위, 일정 변경 약속을 계약서나 업체의 공식 메시지로 남기세요.",
  },
  {
    id: "rf_last_minute_price_change",
    category: "redFlag",
    title: "계약 직전 가격 변경",
    pattern: "처음 받은 견적과 계약 직전 총액이 달라짐",
    truth: "구성과 수량이 달라졌는지 확인해야 가격 변경 이유를 판단할 수 있습니다.",
    defense: "이전 견적을 보관하고 변경된 항목, 단가, 수량, 적용일을 나란히 표시해달라고 요청하세요.",
  },
  {
    id: "secret_offseason_discount",
    category: "secret",
    title: "일정별 조건 차이 확인",
    pattern: "선택한 날짜의 조건만 안내받음",
    truth: "요일·시간·시즌에 따른 가격과 포함 항목 차이는 업체별로 다릅니다.",
    defense: "가능한 일정 후보마다 같은 구성의 서면 견적을 받아 차이가 있는지 직접 비교하세요.",
  },
  {
    id: "secret_deposit_refund",
    category: "secret",
    title: "계약금 환불 불가 안내",
    pattern: '"계약금은 어떤 경우에도 환불 안 돼요"',
    truth: "환불·위약금 조건은 계약 유형, 변경·취소 시점, 실제 계약 문구에 따라 달라질 수 있습니다.",
    defense: "적용 조항과 계산 근거를 서면으로 받고 최신 표준약관 및 공식 소비자 상담 창구에서 확인하세요.",
  },
  {
    id: "secret_price_negotiable_fields",
    category: "secret",
    title: "견적서의 기타 항목",
    pattern: "견적서에 기타·부대비용·운영비처럼 범위가 모호한 항목이 있음",
    truth: "명칭만으로는 무엇을 제공하고 언제 청구하는지 알 수 없습니다.",
    defense: "세부 구성, 단가, 수량, 필수 여부, 제외 가능 여부를 항목별로 적어달라고 요청하세요.",
  },
  {
    id: "secret_individual_vs_package",
    category: "secret",
    title: "패키지 vs 개별 견적 비교",
    pattern: '"패키지가 훨씬 싸요" (or "개별이 더 싸요")',
    truth: "구성, 변경 자유도, 취소 조건이 다르면 총액만으로 어느 쪽이 유리한지 판단할 수 없습니다.",
    defense: "같은 구성 기준표로 패키지와 개별 견적의 포함·별도 항목 및 변경·취소 조건을 비교하세요.",
  },
];

/**
 * 시스템 프롬프트에 주입할 텍스트 생성
 * - 너무 많이 주입하면 토큰 폭증 → 카테고리당 핵심 3-4개씩만
 * - AI가 사용자 상황 맞춰 자연스럽게 인용하도록 가이드
 */
export function getVendorAsymmetryContext(): string {
  return `## 업체·계약 상담 안전 원칙

- 업체의 의도나 평판을 추측해 사기·거짓말·압박 전술이라고 규정하지 마세요.
- 사기 여부·위법 여부·계약 효력을 단정하지 마세요. 표준약관 적용 여부도 계약 유형과 최신 원문을 확인하기 전에는 확정하지 마세요.
- 할인율, 환불 비율, 협상 성공률, 절약액을 일반적인 사실처럼 제시하지 마세요.
- 사용자가 받은 견적서·계약서와 업체의 서면 답변을 기준으로 가격, 포함 항목, 변경·취소 조건, 제공 일정, 추가금 상한을 확인하도록 도우세요.
- 분쟁이나 법적 판단이 필요한 경우 증빙 보존과 공식 기관 또는 자격 있는 전문가 확인을 안내하세요.`;
}
