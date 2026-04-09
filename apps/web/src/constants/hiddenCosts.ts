/**
 * 웨딩 스드메 숨겨진 비용 데이터
 * 출처: 기재부 실태조사 + 한국소비자원 참가격(price.go.kr)
 *
 * 기본 계약금 평균 346만원 → 실제 지불 520만원 (추가금 174만원, +50%)
 * - 원본 데이터 구매: 59.4%
 * - 앨범 추가: 68.1%
 * - 본식 촬영: 67.2%
 * - 헬퍼비: 55.0%
 * - 개별 가격 고지 비율: 34.3%
 * - 현금 결제 유도: 78.1%
 */

export interface HiddenCostItem {
  id: string;
  category: "studio" | "dress" | "makeup" | "common";
  name: string;
  /** 실제 이용/추가 비율 (0~1) — 기재부 실태조사 기반 */
  usageRate: number;
  /** 전국 중위 가격 (만원) */
  nationalPrice: number;
  /** 서울 중위 가격 (만원) */
  seoulPrice: number;
  /** 심각도: critical=없으면 큰일 / high=대부분 추가 / medium=선택적 */
  severity: "critical" | "high" | "medium";
  /** 업체가 위장/숨기는 방식 */
  disguise: string;
  /** 왜 필요한지 설명 */
  reason: string;
  /** 계약 전 확인 질문 */
  checkQuestion: string;
}

export const HIDDEN_COSTS: HiddenCostItem[] = [
  // ===== 스튜디오 =====
  {
    id: "studio_original_data",
    category: "studio",
    name: "원본 데이터 구매",
    usageRate: 0.594,
    nationalPrice: 30,
    seoulPrice: 38.5,
    severity: "critical",
    disguise: "'보정본 30장 제공'만 명시, 원본(300~500장)은 별도 구매",
    reason: "보정본만으로는 SNS·모바일 초대장·액자 등에 쓸 사진이 부족. 원본이 없으면 추후 재보정도 불가.",
    checkQuestion: "원본 데이터(전체 촬영 사진) 포함인가요? 별도 구매 시 가격은?",
  },
  {
    id: "studio_album_extra",
    category: "studio",
    name: "앨범 페이지 추가",
    usageRate: 0.681,
    nationalPrice: 3.3,
    seoulPrice: 3.3,
    severity: "high",
    disguise: "기본 앨범 10~15페이지, 실제 필요량 20~30페이지. 페이지당 추가 과금.",
    reason: "기본 페이지로는 스튜디오·야외·컨셉별 사진을 다 담을 수 없어 대부분 추가.",
    checkQuestion: "기본 앨범 페이지 수는? 추가 시 페이지당 가격은?",
  },
  {
    id: "studio_retouch_extra",
    category: "studio",
    name: "보정본 추가 구매",
    usageRate: 0.55,
    nationalPrice: 16.5,
    seoulPrice: 13.75,
    severity: "high",
    disguise: "'보정본 30장' 기본 제공이지만 실제로 60~80장 원하는 경우 많음",
    reason: "30장으로는 가족사진·개인컷·커플컷 다 커버 어려움. 추가 보정 시 장당 과금.",
    checkQuestion: "보정본 기본 제공 수량은? 추가 보정 시 장당/세트 가격은?",
  },
  {
    id: "studio_frame_change",
    category: "studio",
    name: "액자 변경/추가",
    usageRate: 0.4,
    nationalPrice: 25,
    seoulPrice: 24.75,
    severity: "medium",
    disguise: "기본 액자가 저품질, 원하는 사이즈·소재로 바꾸면 추가금",
    reason: "기본 제공 액자가 마음에 안 들어 업그레이드하는 경우 많음.",
    checkQuestion: "기본 액자 사이즈/소재는? 변경 시 추가 비용은?",
  },
  {
    id: "studio_early_start",
    category: "studio",
    name: "얼리스타트비",
    usageRate: 0.35,
    nationalPrice: 5,
    seoulPrice: 6.25,
    severity: "medium",
    disguise: "오전 촬영 시 별도 요금 부과, 계약 시 미고지",
    reason: "오전 촬영 희망 시 스태프 조기 출근 수당으로 부과.",
    checkQuestion: "촬영 시작 시간 제한이 있나요? 오전 촬영 시 추가 비용은?",
  },
  {
    id: "studio_designate",
    category: "studio",
    name: "담당자(작가) 지정비",
    usageRate: 0.3,
    nationalPrice: 20,
    seoulPrice: 16.5,
    severity: "medium",
    disguise: "'인기 작가'는 지정비 별도, 기본 계약은 랜덤 배정",
    reason: "포트폴리오 보고 마음에 드는 작가 지정 시 추가 비용.",
    checkQuestion: "촬영 작가 지정 가능한가요? 지정비는?",
  },
  {
    id: "studio_outdoor",
    category: "studio",
    name: "야외촬영 추가",
    usageRate: 0.45,
    nationalPrice: 15,
    seoulPrice: 11,
    severity: "high",
    disguise: "'실내 촬영 기본', 야외는 별도 패키지로 안내",
    reason: "실내 촬영만으로는 다양한 컨셉 사진을 얻기 어려움.",
    checkQuestion: "야외촬영 포함인가요? 별도 시 가격과 포함 사항은?",
  },
  {
    id: "studio_confirm_fee",
    category: "studio",
    name: "컨펌비(사진 선택비)",
    usageRate: 0.35,
    nationalPrice: 8.25,
    seoulPrice: 8.25,
    severity: "medium",
    disguise: "촬영 후 사진 선택 과정에서 별도 비용 부과",
    reason: "촬영 후 본인이 직접 사진을 고르려면 컨펌비 발생.",
    checkQuestion: "사진 선택(컨펌) 과정은 어떻게 되나요? 별도 비용이 있나요?",
  },
  {
    id: "studio_overtime",
    category: "studio",
    name: "촬영 연장비",
    usageRate: 0.4,
    nationalPrice: 10,
    seoulPrice: 12,
    severity: "high",
    disguise: "기본 촬영 시간(2~3시간) 초과 시 30분/1시간 단위 과금",
    reason: "컨셉 변경, 의상 체인지 등으로 기본 시간을 초과하는 경우가 많음.",
    checkQuestion: "기본 촬영 시간은? 연장 시 단위/비용은?",
  },
  {
    id: "studio_video",
    category: "studio",
    name: "촬영 영상(하이라이트/DVD)",
    usageRate: 0.45,
    nationalPrice: 30,
    seoulPrice: 35,
    severity: "high",
    disguise: "사진 촬영 패키지에 영상은 미포함, 별도 상품으로 안내",
    reason: "촬영 비하인드·하이라이트 영상 수요 급증. 사진만으로 아쉬운 경우 많음.",
    checkQuestion: "촬영 영상(하이라이트/DVD) 포함인가요? 별도 시 가격은?",
  },
  {
    id: "studio_prop_costume",
    category: "studio",
    name: "소품/의상 추가 대여",
    usageRate: 0.35,
    nationalPrice: 5,
    seoulPrice: 5.5,
    severity: "medium",
    disguise: "기본 소품 외 특정 컨셉 소품·캐주얼 의상은 추가 대여비",
    reason: "다양한 컨셉 촬영 시 소품·의상 추가 필요.",
    checkQuestion: "소품/의상 대여 범위는? 추가 대여 시 비용은?",
  },
  {
    id: "studio_photo_table",
    category: "studio",
    name: "포토테이블(식전영상)",
    usageRate: 0.5,
    nationalPrice: 15,
    seoulPrice: 17.5,
    severity: "high",
    disguise: "본식 로비에 놓는 사진 전시 테이블, 스튜디오 촬영과 별도",
    reason: "하객 맞이 시 필수적으로 사용하지만 기본 패키지에 미포함.",
    checkQuestion: "포토테이블/식전영상 포함인가요? 별도 시 가격은?",
  },

  // ===== 드레스 =====
  {
    id: "dress_helper_shoot",
    category: "dress",
    name: "헬퍼비 (촬영)",
    usageRate: 0.55,
    nationalPrice: 25,
    seoulPrice: 25,
    severity: "critical",
    disguise: "'드레스 관리'로 모호하게 표기하거나, 아예 계약서에 미기재",
    reason: "촬영 시 드레스 정리·교체를 도와주는 스태프. 없으면 촬영 진행 자체가 어려움.",
    checkQuestion: "촬영 시 드레스 헬퍼 포함인가요? 별도 시 비용은?",
  },
  {
    id: "dress_helper_ceremony",
    category: "dress",
    name: "헬퍼비 (본식)",
    usageRate: 0.55,
    nationalPrice: 25,
    seoulPrice: 25,
    severity: "critical",
    disguise: "촬영 헬퍼와 별도로 본식 당일 헬퍼 추가 과금",
    reason: "본식 당일 드레스 뒷트레인 정리, 입퇴장 보조. 없으면 혼자 드레스 관리해야 함.",
    checkQuestion: "본식 당일 헬퍼 포함인가요? 촬영 헬퍼와 별도인가요?",
  },
  {
    id: "dress_fitting_extra",
    category: "dress",
    name: "추가 피팅비",
    usageRate: 0.45,
    nationalPrice: 5.5,
    seoulPrice: 5.5,
    severity: "high",
    disguise: "1회 피팅 기본, 2회차부터 회당 과금",
    reason: "1회만으로 드레스를 결정하기 어려워 대부분 2~3회 방문.",
    checkQuestion: "기본 피팅 횟수는? 추가 피팅 시 회당 비용은?",
  },
  {
    id: "dress_alteration",
    category: "dress",
    name: "재가봉비(수선비)",
    usageRate: 0.4,
    nationalPrice: 10,
    seoulPrice: 10,
    severity: "high",
    disguise: "체형에 맞게 수선 시 별도 비용, 계약 시 미안내",
    reason: "기성 드레스는 본인 체형에 100% 맞지 않아 수선이 거의 필수.",
    checkQuestion: "드레스 수선(재가봉) 포함인가요? 별도 시 비용은?",
  },
  {
    id: "dress_second",
    category: "dress",
    name: "2부 드레스",
    usageRate: 0.5,
    nationalPrice: 40,
    seoulPrice: 50,
    severity: "high",
    disguise: "'기본 1벌' 제공, 2부(피로연) 드레스는 추가",
    reason: "본식 후 피로연에서 다른 드레스를 입는 경우가 많음.",
    checkQuestion: "2부 드레스 포함인가요? 별도 대여 시 가격은?",
  },
  {
    id: "dress_designate",
    category: "dress",
    name: "드레스 지정비",
    usageRate: 0.3,
    nationalPrice: 100,
    seoulPrice: 82.5,
    severity: "medium",
    disguise: "인기 디자인/신상은 지정비 별도, 기본 라인업에서만 선택 가능",
    reason: "SNS에서 본 특정 디자인을 원하면 지정비가 붙는 경우.",
    checkQuestion: "선택 가능한 드레스 라인업은? 지정비가 붙는 기준은?",
  },
  {
    id: "dress_tuxedo",
    category: "dress",
    name: "턱시도 대여",
    usageRate: 0.6,
    nationalPrice: 20,
    seoulPrice: 23.75,
    severity: "high",
    disguise: "'신부 드레스' 패키지에 신랑 턱시도 미포함",
    reason: "신랑 턱시도도 필요한데 드레스 패키지에 포함 안 되는 경우 많음.",
    checkQuestion: "신랑 턱시도 포함인가요? 별도 대여 시 가격은?",
  },
  {
    id: "dress_innerwear",
    category: "dress",
    name: "속옷/이너웨어(드레스용)",
    usageRate: 0.7,
    nationalPrice: 8,
    seoulPrice: 8,
    severity: "high",
    disguise: "드레스에 맞는 전용 속옷(브라렛, 볼륨패드 등) 별도 구매 안내",
    reason: "드레스 라인에 맞는 전용 이너웨어가 필수. 일반 속옷으로는 실루엣이 안 나옴.",
    checkQuestion: "드레스용 이너웨어(속옷) 포함인가요? 별도 구매 시 가격은?",
  },
  {
    id: "dress_accessories",
    category: "dress",
    name: "베일/글러브/슈즈 등 소품",
    usageRate: 0.6,
    nationalPrice: 10,
    seoulPrice: 12,
    severity: "high",
    disguise: "'드레스 대여'에 베일·글러브·웨딩슈즈 등 소품은 미포함",
    reason: "드레스만으로는 완성이 안 됨. 베일, 글러브, 슈즈는 거의 필수.",
    checkQuestion: "베일/글러브/웨딩슈즈 포함인가요? 각각 별도 비용은?",
  },
  {
    id: "dress_cleaning_deposit",
    category: "dress",
    name: "세탁/파손 보증금",
    usageRate: 0.5,
    nationalPrice: 10,
    seoulPrice: 12,
    severity: "high",
    disguise: "대여 시 보증금 별도, 파손·오염 시 추가 비용 발생",
    reason: "드레스 파손·오염 대비 보증금. 반환 조건이 까다로운 경우도.",
    checkQuestion: "드레스 보증금이 있나요? 반환 조건은?",
  },
  {
    id: "dress_mini",
    category: "dress",
    name: "미니드레스(2차 파티용)",
    usageRate: 0.35,
    nationalPrice: 15,
    seoulPrice: 18,
    severity: "medium",
    disguise: "2차 파티·피로연용 미니드레스는 별도 대여",
    reason: "본식 드레스로 2차 진행이 불편해 미니드레스를 대여하는 경우.",
    checkQuestion: "2차용 미니드레스 대여 가능한가요? 가격은?",
  },

  // ===== 메이크업 =====
  {
    id: "makeup_rehearsal",
    category: "makeup",
    name: "리허설 메이크업",
    usageRate: 0.65,
    nationalPrice: 63,
    seoulPrice: 77,
    severity: "critical",
    disguise: "'본식 메이크업'만 포함, 리허설은 별도 안내",
    reason: "본식 전 사전 테스트. 없이 본식 당일 바로 하면 원하는 결과가 안 나올 위험.",
    checkQuestion: "리허설 메이크업 포함인가요? 별도 시 가격은?",
  },
  {
    id: "makeup_parents",
    category: "makeup",
    name: "혼주(어머니) 메이크업",
    usageRate: 0.6,
    nationalPrice: 26.4,
    seoulPrice: 29.7,
    severity: "high",
    disguise: "신부만 기본, 양가 어머니는 별도 과금",
    reason: "양가 어머니 2명 × 헤어+메이크업. 거의 필수지만 기본 미포함.",
    checkQuestion: "혼주 헤어/메이크업 포함인가요? 몇 분까지? 추가 시 1인당 비용은?",
  },
  {
    id: "makeup_groom",
    category: "makeup",
    name: "신랑 헤어/메이크업",
    usageRate: 0.5,
    nationalPrice: 10,
    seoulPrice: 10.5,
    severity: "high",
    disguise: "'신부 메이크업' 패키지에 신랑은 미포함",
    reason: "촬영·본식에서 신랑도 메이크업이 필요한데 별도 과금.",
    checkQuestion: "신랑 헤어/메이크업 포함인가요?",
  },
  {
    id: "makeup_designate",
    category: "makeup",
    name: "담당자 지정비",
    usageRate: 0.25,
    nationalPrice: 5.5,
    seoulPrice: 5.5,
    severity: "medium",
    disguise: "인기 아티스트 지정 시 추가 비용",
    reason: "리뷰 좋은 특정 아티스트를 원하면 지정비 발생.",
    checkQuestion: "메이크업 아티스트 지정 가능한가요? 비용은?",
  },
  {
    id: "makeup_early_start",
    category: "makeup",
    name: "얼리스타트비",
    usageRate: 0.4,
    nationalPrice: 11,
    seoulPrice: 13.75,
    severity: "medium",
    disguise: "오전 본식 시 새벽 메이크업 필요 → 추가금",
    reason: "오전 11시 본식이면 새벽 5~6시 시작, 조기 출근 수당 부과.",
    checkQuestion: "본식 시간대에 따른 추가 비용(얼리/레이트)이 있나요?",
  },
  {
    id: "makeup_hairpiece",
    category: "makeup",
    name: "헤어피스 구매/보증금",
    usageRate: 0.35,
    nationalPrice: 16,
    seoulPrice: 16,
    severity: "medium",
    disguise: "헤어 스타일에 필요한 헤어피스가 별도 구매 또는 보증금",
    reason: "업스타일 등 특정 헤어에 필요. 대여 시 보증금, 분실 시 구매 전환.",
    checkQuestion: "헤어피스 포함인가요? 대여 보증금 또는 구매 비용은?",
  },
  {
    id: "makeup_trip_fee",
    category: "makeup",
    name: "촬영 출장비",
    usageRate: 0.35,
    nationalPrice: 20,
    seoulPrice: 15,
    severity: "medium",
    disguise: "스튜디오 촬영 시 메이크업 아티스트 출장비 별도",
    reason: "메이크업샵이 아닌 스튜디오에서 진행 시 출장비 발생.",
    checkQuestion: "스튜디오 촬영 시 출장비 포함인가요?",
  },
  {
    id: "makeup_eyelash",
    category: "makeup",
    name: "속눈썹 시술(연장/펌)",
    usageRate: 0.55,
    nationalPrice: 5,
    seoulPrice: 6,
    severity: "high",
    disguise: "메이크업에 속눈썹 시술은 미포함, 별도 시술 안내",
    reason: "촬영·본식 메이크업에 속눈썹 연장/펌이 거의 필수적이나 별도.",
    checkQuestion: "속눈썹 시술(연장/펌) 포함인가요? 별도 시 가격은?",
  },
  {
    id: "makeup_nail",
    category: "makeup",
    name: "네일아트",
    usageRate: 0.5,
    nationalPrice: 8,
    seoulPrice: 10,
    severity: "medium",
    disguise: "메이크업 패키지에 네일은 미포함",
    reason: "반지 컷·손 클로즈업 촬영 시 네일 상태가 중요. 별도 시술 필요.",
    checkQuestion: "웨딩 네일아트 포함인가요?",
  },
  {
    id: "makeup_corsage",
    category: "makeup",
    name: "코르사주/부토니에",
    usageRate: 0.45,
    nationalPrice: 3,
    seoulPrice: 3.5,
    severity: "medium",
    disguise: "메이크업 패키지와 별도로 본식 당일 코르사주 비용 별도",
    reason: "본식 당일 신부 코르사주·신랑 부토니에가 필요.",
    checkQuestion: "코르사주/부토니에 포함인가요?",
  },
  {
    id: "makeup_accessory_rental",
    category: "makeup",
    name: "헤어 악세사리 대여",
    usageRate: 0.4,
    nationalPrice: 5,
    seoulPrice: 6,
    severity: "medium",
    disguise: "티아라, 헤드피스 등 헤어 악세사리는 별도 대여비",
    reason: "헤어 스타일에 따라 악세사리가 필요하나 기본 미포함.",
    checkQuestion: "헤어 악세사리(티아라, 헤드피스 등) 포함인가요? 대여비는?",
  },

  // ===== 공통/본식 =====
  {
    id: "common_ceremony_snap",
    category: "common",
    name: "본식 스냅 촬영",
    usageRate: 0.672,
    nationalPrice: 80,
    seoulPrice: 85,
    severity: "critical",
    disguise: "'스튜디오 촬영' 패키지에 본식 당일 촬영은 미포함",
    reason: "스튜디오 촬영과 본식 촬영은 별개. 본식 당일 순간을 기록하려면 필수.",
    checkQuestion: "본식 당일 스냅 촬영 포함인가요? 별도 시 가격은?",
  },
  {
    id: "common_ceremony_original",
    category: "common",
    name: "본식 촬영 원판 구매",
    usageRate: 0.5,
    nationalPrice: 50,
    seoulPrice: 50,
    severity: "high",
    disguise: "본식 스냅 계약해도 원본은 별도 구매",
    reason: "본식 스냅도 보정본만 제공, 원본(수백 장)은 추가 비용.",
    checkQuestion: "본식 스냅 원본 데이터 포함인가요?",
  },
  {
    id: "common_ceremony_video",
    category: "common",
    name: "본식 영상 촬영",
    usageRate: 0.6,
    nationalPrice: 60,
    seoulPrice: 70,
    severity: "critical",
    disguise: "스냅 촬영과 별도, '사진+영상' 패키지가 아니면 미포함",
    reason: "본식 순간을 영상으로 남기고 싶은 수요 매우 높음. 스냅과 별개 상품.",
    checkQuestion: "본식 영상 촬영 포함인가요? 별도 시 가격은?",
  },
  {
    id: "common_bouquet",
    category: "common",
    name: "부케",
    usageRate: 0.85,
    nationalPrice: 15,
    seoulPrice: 18,
    severity: "critical",
    disguise: "스드메 패키지에 부케는 미포함, 꽃집/플로리스트 별도",
    reason: "촬영·본식 모두 필요하지만 스드메와 별도로 준비해야 하는 항목.",
    checkQuestion: "부케 포함인가요? 촬영용/본식용 별도인가요?",
  },
  {
    id: "common_pyebaek",
    category: "common",
    name: "폐백 대여(의상/음식/장소)",
    usageRate: 0.7,
    nationalPrice: 30,
    seoulPrice: 35,
    severity: "high",
    disguise: "본식 패키지에 폐백은 포함 안 됨, 예식장과도 별도 계약",
    reason: "폐백 의상 대여·음식·장소 등 별도 비용. 예식장에서 별도 청구.",
    checkQuestion: "폐백 포함인가요? 의상/음식/장소 각각 비용은?",
  },
  {
    id: "common_wedding_car",
    category: "common",
    name: "웨딩카 장식",
    usageRate: 0.4,
    nationalPrice: 8,
    seoulPrice: 10,
    severity: "medium",
    disguise: "웨딩카 꽃장식은 별도 비용",
    reason: "웨딩카 이동 시 꽃장식 원하면 추가 비용.",
    checkQuestion: "웨딩카 장식 포함인가요?",
  },
  {
    id: "common_thank_you_gift",
    category: "common",
    name: "답례품",
    usageRate: 0.75,
    nationalPrice: 3,
    seoulPrice: 3.5,
    severity: "medium",
    disguise: "하객용 답례품(떡/초콜릿 등) 별도 준비 필요",
    reason: "하객 1인당 비용은 적지만 수량이 많아 총비용 상당.",
    checkQuestion: "답례품 준비 계획은? 예상 하객 수 기준 예산은?",
  },
];

// ===== 레드플래그 정의 =====

export interface RedFlag {
  id: string;
  name: string;
  description: string;
  checkLogic: string; // AI가 판단하는 기준 설명
}

export const RED_FLAGS: RedFlag[] = [
  {
    id: "bait_pricing",
    name: "미끼 가격 의심",
    description: "기본가가 시세 대비 30% 이상 저렴 — 추가금으로 수익을 올리는 구조일 가능성",
    checkLogic: "견적가가 해당 지역 스드메 패키지 중위값 대비 70% 이하",
  },
  {
    id: "essential_as_option",
    name: "필수 항목 '선택' 위장",
    description: "이용률 50% 이상인 항목이 기본 미포함 — 계약 후 추가금 발생 확률 높음",
    checkLogic: "usageRate >= 0.5이고 severity가 critical/high인 항목이 견적에 미포함",
  },
  {
    id: "price_opacity",
    name: "가격 불투명",
    description: "포함 항목이 구체적으로 명시되지 않음 — 개별 가격 고지 비율 전국 34.3%",
    checkLogic: "사용자가 포함 항목을 5개 미만으로 파악하고 있거나, '패키지'로만 안내받음",
  },
  {
    id: "cash_pressure",
    name: "현금 결제 유도",
    description: "현금 할인 또는 카드 수수료 별도 — 78.1%가 현금 결제 유도 경험",
    checkLogic: "견적서에 '현금가', '카드 별도', '현금 할인' 등 표현",
  },
  {
    id: "retouch_trap",
    name: "보정본 함정",
    description: "'보정본 N장 제공'만 있고 원본/추가 보정 가격 미명시",
    checkLogic: "'보정본 제공'은 있지만 원본 관련 언급 없음",
  },
  {
    id: "album_trap",
    name: "앨범 함정",
    description: "기본 앨범 페이지 수 미명시 — 추후 페이지 추가비 발생",
    checkLogic: "'앨범 포함'만 있고 페이지 수 명시 없음",
  },
  {
    id: "no_contract_cap",
    name: "추가금 상한 없음",
    description: "계약서에 총 추가금 상한이 없어 비용이 무한히 늘어날 수 있음",
    checkLogic: "계약서에 추가금 상한 또는 총비용 상한 조항 없음",
  },
];

// ===== 투명도 점수 계산 =====

export interface TransparencyScore {
  score: number;         // 0~100
  grade: "A" | "B" | "C" | "D" | "F";
  missingCritical: HiddenCostItem[];
  missingHigh: HiddenCostItem[];
  missingMedium: HiddenCostItem[];
  redFlags: RedFlag[];
  estimatedHiddenCost: number;  // 예상 추가금 (만원)
  estimatedTotal: number;       // 예상 실제 총비용 (만원)
}

export function getGradeFromScore(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

// 카테고리별 숨겨진 비용 가져오기
export function getHiddenCostsByCategory(category: "studio" | "dress" | "makeup" | "common"): HiddenCostItem[] {
  return HIDDEN_COSTS.filter((item) => item.category === category);
}

// 심각도별 숨겨진 비용 가져오기
export function getCriticalHiddenCosts(): HiddenCostItem[] {
  return HIDDEN_COSTS.filter((item) => item.severity === "critical");
}

// 예상 추가금 계산 (빠진 항목 기반)
export function estimateHiddenCosts(
  missingItems: HiddenCostItem[],
  scope: "national" | "seoul" = "national"
): number {
  return missingItems.reduce((total, item) => {
    const price = scope === "seoul" ? item.seoulPrice : item.nationalPrice;
    // 이용률 가중 평균: 실제로 추가할 확률 × 가격
    return total + price * item.usageRate;
  }, 0);
}

// AI 프롬프트용 숨겨진 비용 요약
export function getHiddenCostContext(): string {
  const critical = HIDDEN_COSTS.filter((i) => i.severity === "critical");
  const high = HIDDEN_COSTS.filter((i) => i.severity === "high");

  const criticalLines = critical.map((i) =>
    `  - ${i.name} (${i.category}): 전국 ${i.nationalPrice}만원/서울 ${i.seoulPrice}만원, 이용률 ${Math.round(i.usageRate * 100)}% — ${i.disguise}`
  ).join("\n");

  const highLines = high.map((i) =>
    `  - ${i.name} (${i.category}): 전국 ${i.nationalPrice}만원/서울 ${i.seoulPrice}만원, 이용률 ${Math.round(i.usageRate * 100)}%`
  ).join("\n");

  const redFlagLines = RED_FLAGS.map((f) => `  - ${f.name}: ${f.description}`).join("\n");

  return `## 숨겨진 비용 데이터 (기재부 실태조사 + 소비자원)

기본 계약금 평균 346만원 → 실제 지불 520만원 (추가금 174만원, +50%)

### 🚨 필수급 항목 (이용률 55%↑, 미포함 시 거의 확실히 추가)
${criticalLines}

### ⚠️ 높은 이용률 항목 (이용률 35~55%, 대부분 추가)
${highLines}

### 레드플래그
${redFlagLines}

### 견적 분석 규칙
1. 사용자가 견적/가격을 언급하면 → 포함 항목을 파악하고 빠진 필수 항목 안내
2. 각 빠진 항목에: 예상 가격 + 이용률 + 왜 필요한지 + 계약 전 확인 질문
3. 예상 실제 총비용 = 견적가 + 빠진 항목들의 (가격 × 이용률) 합계
4. 기본가가 시세 대비 30%↓ → 미끼 가격 경고
5. 출처: "기재부 실태조사" 또는 "소비자원 참가격" 명시`;
}
