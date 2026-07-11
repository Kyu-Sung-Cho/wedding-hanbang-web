/**
 * 계약 전 추가비용 확인 항목.
 *
 * 이 목록은 웨딩한방이 편집한 질문 모음이다. 항목별 발생률, 평균 가격, 필수성,
 * 위험도 또는 업체의 고의 은폐를 뜻하지 않는다. 사용자가 받은 견적서와 계약서에
 * 포함 범위와 추가 조건이 적혀 있는지 직접 확인하는 용도로만 사용한다.
 */

export type QuoteCheckItemCategory = "studio" | "dress" | "makeup" | "common";

export interface QuoteCheckItem {
  id: string;
  category: QuoteCheckItemCategory;
  name: string;
  checkQuestion: string;
}

/**
 * 정부 관계부처 합동 「결혼서비스 실태조사」의 스드메 총괄 참고 수치.
 * 개별 항목의 가격·발생률이나 현재 시세로 재사용하면 안 된다.
 */
export const QUOTE_CHECK_SURVEY_REFERENCE = {
  label: "정부 관계부처 합동 결혼서비스 실태조사(2024년 5~11월 조사)",
  basicPriceManwon: 346,
  additionalPaymentManwon: 174,
  note: "스드메 기본금과 추가 지불의 조사 평균이며, 개별 견적이나 항목별 현재 시세가 아닙니다.",
  url: "https://www.kca.go.kr/kca/sub.do?menukey=5084&mode=view&no=1003902297",
} as const;

export const QUOTE_CHECK_ITEMS: readonly QuoteCheckItem[] = [
  { id: "studio_original_data", category: "studio", name: "원본 데이터 제공", checkQuestion: "원본 데이터(전체 촬영 사진)가 포함되나요? 별도라면 가격과 전달 방식은 어떻게 되나요?" },
  { id: "studio_album_extra", category: "studio", name: "앨범 페이지", checkQuestion: "기본 앨범 페이지 수와 페이지 추가 단가는 얼마인가요?" },
  { id: "studio_retouch_extra", category: "studio", name: "보정본", checkQuestion: "기본 보정본 수량과 추가 보정 단가는 얼마인가요?" },
  { id: "studio_frame_change", category: "studio", name: "액자", checkQuestion: "기본 액자의 크기와 소재는 무엇이며 변경·추가 비용이 있나요?" },
  { id: "studio_early_start", category: "studio", name: "촬영 시간대 비용", checkQuestion: "촬영 시작 시간에 따른 별도 비용이 있나요?" },
  { id: "studio_designate", category: "studio", name: "촬영 담당자 지정", checkQuestion: "촬영 담당자를 지정할 수 있나요? 지정 조건과 비용은 무엇인가요?" },
  { id: "studio_outdoor", category: "studio", name: "야외 촬영", checkQuestion: "야외 촬영이 포함되나요? 별도라면 가격과 포함 범위는 무엇인가요?" },
  { id: "studio_confirm_fee", category: "studio", name: "사진 선택 과정", checkQuestion: "사진을 선택하는 과정과 별도 비용 여부를 알려주세요." },
  { id: "studio_overtime", category: "studio", name: "촬영 시간 연장", checkQuestion: "기본 촬영 시간과 연장 단위·비용은 어떻게 되나요?" },
  { id: "studio_video", category: "studio", name: "촬영 영상", checkQuestion: "촬영 영상이 포함되나요? 별도라면 제공 형식과 가격은 어떻게 되나요?" },
  { id: "studio_prop_costume", category: "studio", name: "소품·의상 대여", checkQuestion: "기본 소품·의상 대여 범위와 추가 대여 비용은 어떻게 되나요?" },
  { id: "studio_photo_table", category: "studio", name: "포토테이블·식전영상", checkQuestion: "포토테이블 또는 식전영상이 포함되나요? 별도라면 가격은 얼마인가요?" },

  { id: "dress_helper_shoot", category: "dress", name: "촬영 드레스 헬퍼", checkQuestion: "촬영일 드레스 헬퍼가 포함되나요? 별도라면 비용과 이용 시간은 어떻게 되나요?" },
  { id: "dress_helper_ceremony", category: "dress", name: "본식 드레스 헬퍼", checkQuestion: "본식 당일 드레스 헬퍼가 포함되나요? 촬영일 헬퍼와 별도인가요?" },
  { id: "dress_fitting_extra", category: "dress", name: "드레스 피팅", checkQuestion: "기본 피팅 횟수와 추가 피팅 비용은 얼마인가요?" },
  { id: "dress_alteration", category: "dress", name: "드레스 수선", checkQuestion: "드레스 수선이 포함되나요? 별도라면 비용 기준은 무엇인가요?" },
  { id: "dress_second", category: "dress", name: "2부 드레스", checkQuestion: "2부 드레스가 포함되나요? 별도 대여 조건과 가격은 어떻게 되나요?" },
  { id: "dress_designate", category: "dress", name: "드레스 라인·지정", checkQuestion: "선택 가능한 드레스 라인과 별도 지정 비용이 붙는 기준은 무엇인가요?" },
  { id: "dress_tuxedo", category: "dress", name: "턱시도", checkQuestion: "신랑 턱시도가 포함되나요? 별도 대여 조건과 가격은 어떻게 되나요?" },
  { id: "dress_innerwear", category: "dress", name: "드레스 이너웨어", checkQuestion: "드레스용 이너웨어가 포함되나요? 별도 준비가 필요하다면 규격과 가격은 어떻게 되나요?" },
  { id: "dress_accessories", category: "dress", name: "베일·글러브·슈즈", checkQuestion: "베일, 글러브, 웨딩슈즈의 포함 범위와 항목별 비용을 알려주세요." },
  { id: "dress_cleaning_deposit", category: "dress", name: "세탁·파손 보증 조건", checkQuestion: "보증금이나 세탁·파손 비용이 있나요? 반환 및 청구 기준은 무엇인가요?" },
  { id: "dress_mini", category: "dress", name: "2차용 미니드레스", checkQuestion: "2차용 미니드레스를 대여할 수 있나요? 조건과 가격은 어떻게 되나요?" },

  { id: "makeup_rehearsal", category: "makeup", name: "리허설 메이크업", checkQuestion: "리허설 메이크업이 포함되나요? 별도라면 가격은 얼마인가요?" },
  { id: "makeup_parents", category: "makeup", name: "혼주 헤어·메이크업", checkQuestion: "혼주 헤어·메이크업은 몇 명까지 포함되나요? 추가 인원당 가격은 얼마인가요?" },
  { id: "makeup_groom", category: "makeup", name: "신랑 헤어·메이크업", checkQuestion: "신랑 헤어·메이크업이 포함되나요?" },
  { id: "makeup_designate", category: "makeup", name: "메이크업 담당자 지정", checkQuestion: "메이크업 담당자를 지정할 수 있나요? 지정 조건과 비용은 무엇인가요?" },
  { id: "makeup_early_start", category: "makeup", name: "메이크업 시간대 비용", checkQuestion: "시작 시간대에 따른 별도 비용이 있나요?" },
  { id: "makeup_hairpiece", category: "makeup", name: "헤어피스", checkQuestion: "헤어피스가 포함되나요? 대여 보증금 또는 구매 비용은 얼마인가요?" },
  { id: "makeup_trip_fee", category: "makeup", name: "출장", checkQuestion: "스튜디오나 예식장 출장 비용이 포함되나요?" },
  { id: "makeup_eyelash", category: "makeup", name: "속눈썹 시술", checkQuestion: "속눈썹 시술이 포함되나요? 별도라면 종류와 가격은 어떻게 되나요?" },
  { id: "makeup_nail", category: "makeup", name: "네일", checkQuestion: "네일 서비스가 포함되나요?" },
  { id: "makeup_corsage", category: "makeup", name: "코르사주·부토니에", checkQuestion: "코르사주와 부토니에가 포함되나요?" },
  { id: "makeup_accessory_rental", category: "makeup", name: "헤어 액세서리", checkQuestion: "티아라, 헤드피스 등 헤어 액세서리의 포함 범위와 대여 비용은 어떻게 되나요?" },

  { id: "common_ceremony_snap", category: "common", name: "본식 스냅 촬영", checkQuestion: "본식 당일 스냅 촬영이 포함되나요? 별도라면 구성과 가격은 어떻게 되나요?" },
  { id: "common_ceremony_original", category: "common", name: "본식 촬영 원본", checkQuestion: "본식 스냅 원본 데이터가 포함되나요?" },
  { id: "common_ceremony_video", category: "common", name: "본식 영상 촬영", checkQuestion: "본식 영상 촬영이 포함되나요? 별도라면 구성과 가격은 어떻게 되나요?" },
  { id: "common_bouquet", category: "common", name: "부케", checkQuestion: "부케가 포함되나요? 촬영용과 본식용은 각각 어떻게 제공되나요?" },
  { id: "common_pyebaek", category: "common", name: "폐백", checkQuestion: "폐백을 진행한다면 의상, 음식, 장소의 포함 범위와 항목별 비용은 어떻게 되나요?" },
  { id: "common_wedding_car", category: "common", name: "웨딩카 장식", checkQuestion: "웨딩카 장식이 포함되나요?" },
  { id: "common_thank_you_gift", category: "common", name: "답례품", checkQuestion: "답례품을 준비한다면 수량, 단가, 배송·보관 조건은 어떻게 되나요?" },
];
