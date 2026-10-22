/**
 * 계약 전 포함·불포함 확인 항목.
 *
 * 항목 근거와 원문 검토 기록은 docs/wedding-code/02a에 둔다. 실제 가격과 이용 통계는
 * 런타임 소스에 고정하지 않으며, 가격 표시는 검수·발행된 업체별 공시 데이터만 사용한다.
 */

export interface HiddenCostItem {
  id: string;
  category: "studio" | "dress" | "makeup" | "common";
  name: string;
  /** 확인 우선순위. 비용 발생 가능성이나 가격 적정성의 판정값이 아니다. */
  severity: "critical" | "high" | "medium";
  /** 사용자가 업체에 그대로 보낼 수 있도록 업계 용어를 풀어 쓴 중립 질문. */
  checkQuestion: string;
}

export const HIDDEN_COSTS: HiddenCostItem[] = [
  // ===== 스튜디오 =====
  {
    id: "studio_original_data",
    category: "studio",
    name: "촬영 뒤 받는 사진 파일의 수",
    severity: "critical",
    checkQuestion:
      "촬영한 사진을 파일로 몇 장 받을 수 있나요? 파일 제공은 견적 금액에 포함되어 있나요?",
  },
  {
    id: "studio_album_extra",
    category: "studio",
    name: "앨범의 사진 수와 페이지 수",
    severity: "high",
    checkQuestion:
      "앨범에는 사진 몇 장이 들어가고 총 몇 페이지인가요? 페이지를 늘리면 얼마를 더 내나요?",
  },
  {
    id: "studio_retouch_extra",
    category: "studio",
    name: "보정해 주는 사진 수",
    severity: "high",
    checkQuestion:
      "색감이나 피부 등을 보정해 주는 사진은 몇 장인가요? 사진 수를 늘리면 얼마를 더 내나요?",
  },
  {
    id: "studio_frame_change",
    category: "studio",
    name: "기본 액자 크기와 재질",
    severity: "medium",
    checkQuestion:
      "견적에 포함된 액자의 크기와 재질은 무엇인가요? 다른 액자로 바꾸면 얼마를 더 내나요?",
  },
  {
    id: "studio_early_start",
    category: "studio",
    name: "이른 시간 촬영 추가 비용",
    severity: "medium",
    checkQuestion:
      "추가 비용 없이 시작할 수 있는 촬영 시간은 언제인가요? 이른 시간에 시작하면 얼마를 더 내나요?",
  },
  {
    id: "studio_designate",
    category: "studio",
    name: "촬영 담당자 선택 비용",
    severity: "medium",
    checkQuestion:
      "원하는 촬영 담당자를 고를 수 있나요? 고를 때 별도 비용이 있다면 얼마인가요?",
  },
  {
    id: "studio_outdoor",
    category: "studio",
    name: "야외 촬영",
    severity: "high",
    checkQuestion:
      "야외 촬영이 견적에 포함되어 있나요? 포함되지 않았다면 촬영 시간과 추가 금액은 얼마인가요?",
  },
  {
    id: "studio_confirm_fee",
    category: "studio",
    name: "촬영 뒤 사진을 고르는 과정의 비용",
    severity: "medium",
    checkQuestion:
      "촬영 뒤 받을 사진과 앨범에 넣을 사진을 직접 고를 수 있나요? 이 과정에 별도 비용이 있나요?",
  },
  {
    id: "studio_overtime",
    category: "studio",
    name: "기본 촬영 시간과 연장 비용",
    severity: "high",
    checkQuestion:
      "견적에 포함된 촬영 시간은 몇 시간인가요? 시간을 늘리면 몇 분 단위로 얼마를 더 내나요?",
  },
  {
    id: "studio_video",
    category: "studio",
    name: "사진 촬영 현장을 담은 영상",
    severity: "high",
    checkQuestion:
      "사진을 찍는 날의 모습을 담은 영상도 받을 수 있나요? 견적에 포함되지 않았다면 금액은 얼마인가요?",
  },
  {
    id: "studio_prop_costume",
    category: "studio",
    name: "촬영 소품과 추가 의상",
    severity: "medium",
    checkQuestion:
      "견적 금액으로 빌릴 수 있는 촬영 소품과 의상은 무엇인가요? 다른 소품이나 의상을 더 빌리면 얼마인가요?",
  },
  {
    id: "studio_photo_table",
    category: "studio",
    name: "결혼식장에 둘 사진과 식전 영상",
    severity: "high",
    checkQuestion:
      "결혼식장 입구에 둘 사진과 식 전에 상영할 영상이 포함되어 있나요? 포함되지 않았다면 각각 얼마인가요?",
  },

  // ===== 드레스 =====
  {
    id: "dress_helper_shoot",
    category: "dress",
    name: "촬영 헬퍼비 (드레스 동행 직원 비용)",
    severity: "critical",
    checkQuestion:
      "촬영 날 드레스를 입고 갈아입는 일을 도와줄 직원이 오나요? 견적에 포함되지 않았다면 얼마인가요?",
  },
  {
    id: "dress_helper_ceremony",
    category: "dress",
    name: "본식 헬퍼비 (결혼식 당일 동행 비용)",
    severity: "critical",
    checkQuestion:
      "결혼식 날 드레스를 입고 이동하는 일을 도와줄 직원이 오나요? 촬영 날의 직원 비용과 따로 내는 금액인가요?",
  },
  {
    id: "dress_fitting_extra",
    category: "dress",
    name: "드레스 피팅비 (입어보는 비용)",
    severity: "high",
    checkQuestion:
      "계약한 금액으로 드레스를 몇 번 입어볼 수 있나요? 정해진 횟수를 넘으면 한 번에 얼마를 더 내나요?",
  },
  {
    id: "dress_alteration",
    category: "dress",
    name: "드레스 가봉·수선비 (내 몸에 맞게 고치는 비용)",
    severity: "high",
    checkQuestion:
      "드레스를 몸에 맞게 길이나 품을 고치는 비용이 포함되어 있나요? 포함되지 않았다면 얼마인가요?",
  },
  {
    id: "dress_second",
    category: "dress",
    name: "2부 드레스 (피로연·인사 의상)",
    severity: "high",
    checkQuestion:
      "결혼식 뒤 식사나 모임에서 갈아입을 옷도 빌릴 수 있나요? 견적에 포함되지 않았다면 얼마인가요?",
  },
  {
    id: "dress_designate",
    category: "dress",
    name: "특정 드레스 선택 시 추가 비용",
    severity: "medium",
    checkQuestion:
      "견적 금액 안에서 고를 수 있는 드레스는 어디까지인가요? 특정 드레스를 고를 때 추가 금액이 붙는 기준은 무엇인가요?",
  },
  {
    id: "dress_tuxedo",
    category: "dress",
    name: "함께 입을 정장 대여",
    severity: "high",
    checkQuestion:
      "배우자가 결혼식에서 입을 정장 대여도 포함되어 있나요? 포함되지 않았다면 얼마인가요?",
  },
  {
    id: "dress_innerwear",
    category: "dress",
    name: "드레스 안에 입는 속옷과 패드",
    severity: "high",
    checkQuestion:
      "드레스 안에 입는 속옷과 모양을 잡는 패드가 포함되어 있나요? 따로 사거나 빌려야 한다면 얼마인가요?",
  },
  {
    id: "dress_accessories",
    category: "dress",
    name: "베일·장갑·신발 등 드레스 소품",
    severity: "high",
    checkQuestion:
      "면사포, 장갑, 신발 중 견적에 포함된 것은 무엇인가요? 포함되지 않은 물품은 각각 얼마인가요?",
  },
  {
    id: "dress_cleaning_deposit",
    category: "dress",
    name: "오염·파손 보증금과 반환 조건",
    severity: "high",
    checkQuestion:
      "드레스를 빌릴 때 보증금을 내야 하나요? 전액 돌려받는 조건과 오염·파손 때 내는 금액은 어떻게 되나요?",
  },
  {
    id: "dress_mini",
    category: "dress",
    name: "2부 미니드레스 (피로연 짧은 드레스)",
    severity: "medium",
    checkQuestion:
      "결혼식 뒤 식사나 모임에서 갈아입을 짧은 드레스를 빌릴 수 있나요? 빌리는 금액은 얼마인가요?",
  },

  // ===== 메이크업 =====
  {
    id: "makeup_rehearsal",
    category: "makeup",
    name: "결혼식 전 미리 받아보는 헤어·메이크업",
    severity: "critical",
    checkQuestion:
      "결혼식 전에 헤어와 메이크업을 미리 받아보는 과정이 포함되어 있나요? 포함되지 않았다면 얼마인가요?",
  },
  {
    id: "makeup_parents",
    category: "makeup",
    name: "부모님 헤어·메이크업 인원과 비용",
    severity: "high",
    checkQuestion:
      "양쪽 부모님의 헤어와 메이크업은 몇 명까지 포함되어 있나요? 인원을 늘리면 한 명당 얼마인가요?",
  },
  {
    id: "makeup_groom",
    category: "makeup",
    name: "배우자 헤어·메이크업",
    severity: "high",
    checkQuestion:
      "배우자의 헤어와 메이크업도 견적에 포함되어 있나요? 포함되지 않았다면 얼마인가요?",
  },
  {
    id: "makeup_designate",
    category: "makeup",
    name: "담당 메이크업 전문가 선택 비용",
    severity: "medium",
    checkQuestion:
      "원하는 헤어·메이크업 담당자를 고를 수 있나요? 고를 때 별도 비용이 있다면 얼마인가요?",
  },
  {
    id: "makeup_early_start",
    category: "makeup",
    name: "이른 시간 시작 추가 비용",
    severity: "medium",
    checkQuestion:
      "결혼식이 이른 아침이나 늦은 저녁이면 헤어·메이크업 비용이 더 붙나요? 붙는다면 시간대별 금액은 얼마인가요?",
  },
  {
    id: "makeup_hairpiece",
    category: "makeup",
    name: "붙임 머리 대여·구매·보증금",
    severity: "medium",
    checkQuestion:
      "머리 길이나 숱을 더하는 붙임 머리가 필요한가요? 필요하다면 대여료, 구매비, 보증금은 각각 얼마인가요?",
  },
  {
    id: "makeup_trip_fee",
    category: "makeup",
    name: "촬영 장소 출장 비용",
    severity: "medium",
    checkQuestion:
      "헤어·메이크업 담당자가 촬영 장소로 이동할 때 드는 비용이 포함되어 있나요? 포함되지 않았다면 얼마인가요?",
  },
  {
    id: "makeup_eyelash",
    category: "makeup",
    name: "속눈썹 시술",
    severity: "high",
    checkQuestion:
      "속눈썹 연장이나 펌이 헤어·메이크업 견적에 포함되어 있나요? 포함되지 않았다면 얼마인가요?",
  },
  {
    id: "makeup_nail",
    category: "makeup",
    name: "손톱 관리",
    severity: "medium",
    checkQuestion:
      "손톱 관리나 장식이 헤어·메이크업 견적에 포함되어 있나요? 포함되지 않았다면 얼마인가요?",
  },
  {
    id: "makeup_corsage",
    category: "makeup",
    name: "혼주·가족 코사지 (가슴 꽃 장식)",
    severity: "medium",
    checkQuestion:
      "결혼식 날 두 사람이 옷에 다는 작은 꽃 장식이 포함되어 있나요? 포함되지 않았다면 얼마인가요?",
  },
  {
    id: "makeup_accessory_rental",
    category: "makeup",
    name: "티아라·헤어 장식 대여비",
    severity: "medium",
    checkQuestion:
      "왕관 모양 장식이나 머리 장식 중 빌릴 수 있는 것은 무엇인가요? 별도 대여료가 있다면 얼마인가요?",
  },

  // ===== 공통/본식 =====
  {
    id: "common_ceremony_snap",
    category: "common",
    name: "결혼식 당일 사진 촬영",
    severity: "critical",
    checkQuestion:
      "결혼식 당일 사진 촬영이 포함되어 있나요? 포함되지 않았다면 촬영 시간과 금액은 얼마인가요?",
  },
  {
    id: "common_ceremony_original",
    category: "common",
    name: "결혼식 날 받는 사진 파일의 수",
    severity: "high",
    checkQuestion:
      "결혼식 날 촬영한 사진을 파일로 몇 장 받을 수 있나요? 파일 제공은 견적 금액에 포함되어 있나요?",
  },
  {
    id: "common_ceremony_video",
    category: "common",
    name: "결혼식 당일 영상 촬영",
    severity: "critical",
    checkQuestion:
      "결혼식 당일 영상 촬영이 포함되어 있나요? 포함되지 않았다면 촬영 시간, 받는 영상 종류, 금액은 얼마인가요?",
  },
  {
    id: "common_bouquet",
    category: "common",
    name: "웨딩 부케 (본식 꽃장식)",
    severity: "critical",
    checkQuestion:
      "손에 드는 꽃은 촬영 날과 결혼식 날에 각각 제공되나요? 견적에 포함되지 않은 꽃은 얼마인가요?",
  },
  {
    id: "common_pyebaek",
    category: "common",
    name: "폐백 비용 (한복 절 인사)",
    severity: "high",
    checkQuestion:
      "결혼식 뒤 한복을 입고 절하는 전통 인사를 진행한다면 의상, 음식, 장소 비용이 각각 얼마인가요?",
  },
  {
    id: "common_wedding_car",
    category: "common",
    name: "이동 차량 꽃 장식",
    severity: "medium",
    checkQuestion:
      "결혼식 날 이동 차량에 다는 꽃 장식이 포함되어 있나요? 포함되지 않았다면 얼마인가요?",
  },
  {
    id: "common_thank_you_gift",
    category: "common",
    name: "결혼식에 온 분께 드릴 선물",
    severity: "medium",
    checkQuestion:
      "하객에게 드릴 선물을 준비하나요? 준비한다면 예상 인원과 한 사람당 금액은 얼마로 정할까요?",
  },
];

// 카테고리별 숨겨진 비용 가져오기
export function getHiddenCostsByCategory(category: "studio" | "dress" | "makeup" | "common"): HiddenCostItem[] {
  return HIDDEN_COSTS.filter((item) => item.category === category);
}

// 심각도별 숨겨진 비용 가져오기
export function getCriticalHiddenCosts(): HiddenCostItem[] {
  return HIDDEN_COSTS.filter((item) => item.severity === "critical");
}

// AI 프롬프트용 계약 전 확인 원칙.
// 개별 견적의 구성과 실제 선택 여부를 모르는 상태에서 추가금을
// 합산하면 소비자에게 가짜 정밀도를 주므로 수치 추정은 의도적으로 하지 않는다.
export function getHiddenCostContext(): string {
  return `## 견적의 포함·불포함 확인 원칙

- 견적서에 적힌 구성만으로 사용자가 실제 선택할 추가 항목이나 최종 지불액을 추정하지 마세요.
- 포함·불포함 항목과 추가금 상한을 서면으로 확인하도록 돕고, 확인 전에는 예상 추가금이나 예상 총비용을 합산하지 마세요.
- 개별 참고 가격을 말해야 한다면 현재 출처 URL·기준일·지역·구성 범위가 확인된 데이터만 별도로 제시하세요.
- 누락 가능성이 있는 항목은 "비용이 생긴다"고 단정하지 말고 업체에 보낼 확인 질문으로 바꾸세요.`;
}
