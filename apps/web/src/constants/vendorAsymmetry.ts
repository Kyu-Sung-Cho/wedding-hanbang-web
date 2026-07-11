/**
 * 계약·견적을 볼 때 사용할 보수적 확인 질문 모음.
 *
 * 특정 업체의 위법·사기 여부, 환불 가능액, 할인율을 단정하지 않는다.
 * 계약 종류와 시점에 따라 적용 기준이 달라질 수 있으므로 원문 계약서,
 * 공정위 표준약관·소비자분쟁해결기준과 1372 상담을 다시 확인한다.
 */

export type VendorAsymmetryCategory =
  | "negotiation"
  | "scam"
  | "redFlag"
  | "secret";

export interface VendorAsymmetryItem {
  id: string;
  category: VendorAsymmetryCategory;
  title: string;
  /** 업체 측 행동·주장·관행의 예시 */
  pattern: string;
  /** 소비자가 확인할 핵심 */
  truth: string;
  /** 보수적 대응 방법 */
  defense: string;
  source?: string;
}

export const VENDOR_ASYMMETRY: VendorAsymmetryItem[] = [
  {
    id: "neg_offer_deadline",
    category: "negotiation",
    title: "기한이 짧은 할인 제안",
    pattern: '"오늘 결정해야 이 가격이 가능해요"',
    truth: "실제 한정 조건일 수도 있으므로 거짓이라고 단정하지 말고, 적용 기한과 제외 조건을 서면으로 확인해야 합니다.",
    defense: "총액·포함 항목·취소 조건을 받은 뒤 결정 시간을 요청하세요. 확인하지 못한 조건 때문에 서둘러 계약할 필요는 없습니다.",
  },
  {
    id: "neg_itemized_quote",
    category: "negotiation",
    title: "정가·할인·추가금 구분",
    pattern: '"원래 가격에서 특별히 할인했어요"',
    truth: "할인율보다 실제 지불 총액과 필수 추가금, 선택 옵션, 세금 포함 여부가 비교에 더 중요합니다.",
    defense: "같은 조건의 항목별 견적을 받아 공공 시세와 다른 업체 견적을 함께 비교하세요.",
    source: "한국소비자원 참가격 결혼서비스 가격정보",
  },
  {
    id: "dispute_written_terms",
    category: "scam",
    title: "구두 설명과 계약서가 다른 경우",
    pattern: "설명받은 보정 수량·시간·추가비용이 계약서에는 없음",
    truth: "분쟁을 줄이려면 상품 범위, 수량, 일정, 추가 단가와 변경·취소 조건을 계약 문서에서 확인해야 합니다.",
    defense: "중요한 설명은 계약 전에 견적서나 계약서에 반영해 달라고 요청하고, 확정본을 보관하세요.",
    source: "한국소비자원 결혼서비스 소비자정보",
  },
  {
    id: "rf_business_and_receipt",
    category: "redFlag",
    title: "사업자·결제 증빙 확인",
    pattern: "계약 상대방 정보나 결제 증빙을 확인하기 어려움",
    truth: "계약 상대방, 사업자 정보, 결제 금액과 환불 창구를 확인할 수 있어야 사후 문의가 쉽습니다.",
    defense: "계약서의 사업자명·등록번호·연락처를 확인하고 결제 수단과 무관하게 계약서와 영수증을 보관하세요. 구체적인 위법 의심은 1372 또는 관계 기관에 문의하세요.",
  },
  {
    id: "secret_cancellation_terms",
    category: "secret",
    title: "변경·취소 조건은 계약별 확인",
    pattern: '"계약금은 어떤 경우에도 돌려받을 수 없어요"',
    truth: "환급·위약금은 서비스 종류, 계약 내용, 취소 시점과 실제 적용 기준에 따라 달라지므로 일률적으로 단정할 수 없습니다.",
    defense: "계약 전 단계별 위약금 표를 받고 공정위 표준약관·소비자분쟁해결기준의 최신 원문을 대조하세요. 분쟁 시 1372 상담을 이용할 수 있습니다.",
    source: "공정거래위원회 표준약관·소비자분쟁해결기준",
  },
  {
    id: "secret_same_condition_compare",
    category: "secret",
    title: "패키지와 개별 견적은 같은 조건으로 비교",
    pattern: '"패키지가 항상 더 저렴해요" 또는 "개별 계약이 항상 더 저렴해요"',
    truth: "구성·시즌·업체가 달라 어느 방식이 항상 저렴하다고 말할 수 없습니다.",
    defense: "수량·등급·추가비·변경·취소 조건을 같게 맞춘 뒤 총액을 비교하세요. 특정 절감액을 기대값으로 잡지 마세요.",
  },
];

/**
 * 현재 런타임 프롬프트에서는 사용하지 않는 보조 컨텍스트다.
 * 재연결할 경우에도 아래 비단정 원칙과 공식 원문 재확인 문구를 유지한다.
 */
export function getVendorAsymmetryContext(): string {
  const formatItem = (item: VendorAsymmetryItem): string => {
    const source = item.source ? ` [확인처: ${item.source}]` : "";
    return `- **${item.title}**: ${item.truth} → ${item.defense}${source}`;
  };

  return `## 계약·견적 확인 질문

아래 내용은 특정 업체의 위법·사기 여부나 환불액을 판정하지 않습니다. 사용자가 계약·견적을 물었을 때 관련된 1~2개만 안내하고, 계약 원문과 최신 공식 기준을 다시 확인하게 하세요.

${VENDOR_ASYMMETRY.map(formatItem).join("\n")}

**활용 원칙**
1. 확인되지 않은 할인율·절감액·분쟁 비율을 만들지 않습니다.
2. 모든 업체가 같다고 일반화하지 않습니다.
3. 환불·위약금·위법 여부를 확정하지 않습니다.
4. 사용자의 계약 원문, 공정위·한국소비자원 최신 자료와 1372 상담을 우선합니다.`;
}
