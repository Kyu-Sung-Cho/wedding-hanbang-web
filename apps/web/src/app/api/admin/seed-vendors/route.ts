import { NextResponse } from "next/server";
import { verifyAdmin, getServiceClient, seedGate } from "@/lib/utils/adminAuth";

// 30개 드레스샵 시드 데이터
const DRESS_SHOPS = [
  // ── 프리미엄 (5곳) ──
  { name: "라비앙로제 브라이덜", location: "서울 강남구", region: "서울", priceMin: 3000000, priceMax: 8000000, style: "럭셔리", tags: ["럭셔리", "수입 드레스", "맞춤 제작"], desc: "수입 드레스 스타일과 맞춤 제작 콘셉트를 보여주는 운영 테스트용 예시." },
  { name: "그레이스 브라이드", location: "서울 강남구", region: "서울", priceMin: 2500000, priceMax: 7000000, style: "클래식", tags: ["클래식", "디자이너 스타일"], desc: "디자이너 드레스 스타일과 1:1 안내 화면을 보여주는 운영 테스트용 예시." },
  { name: "메종 드 마리에", location: "서울 서초구", region: "서울", priceMin: 3500000, priceMax: 10000000, style: "럭셔리", tags: ["오트쿠튀르", "맞춤 제작", "프리미엄"], desc: "프랑스 오트쿠튀르 기법의 완전 맞춤 드레스. 3개월 제작 기간, 3회 피팅 포함." },
  { name: "블루밍 브라이덜 살롱", location: "서울 강남구", region: "서울", priceMin: 2800000, priceMax: 6500000, style: "모던", tags: ["모던", "미니멀", "디자이너"], desc: "국내 신진 디자이너 드레스 큐레이션. 트렌디하고 세련된 모던 브라이드를 위한 공간." },
  { name: "르블랑 웨딩", location: "서울 용산구", region: "서울", priceMin: 2500000, priceMax: 5500000, style: "로맨틱", tags: ["로맨틱", "레이스", "프리미엄"], desc: "이태원 감성의 프리미엄 드레스 부티크. 섬세한 레이스와 비즈 디테일 전문." },

  // ── 중상급 (8곳) ──
  { name: "소피아 브라이덜", location: "서울 마포구", region: "서울", priceMin: 1500000, priceMax: 3500000, style: "클래식", tags: ["클래식", "A라인", "다양한 사이즈"], desc: "홍대입구역 5분. 100벌 이상의 다양한 사이즈와 스타일 보유." },
  { name: "아뜰리에 루이", location: "서울 성동구", region: "서울", priceMin: 1800000, priceMax: 4000000, style: "모던", tags: ["모던", "성수동", "트렌디"], desc: "성수동 핫플레이스 내 위치. 인스타 감성의 모던한 드레스 컬렉션." },
  { name: "벨라도나 드레스", location: "서울 강남구", region: "서울", priceMin: 1500000, priceMax: 3800000, style: "로맨틱", tags: ["로맨틱", "공주풍", "볼가운"], desc: "논현동 웨딩거리. 로맨틱한 볼가운과 공주풍 드레스 전문." },
  { name: "더 브라이드 서울", location: "서울 중구", region: "서울", priceMin: 1200000, priceMax: 3000000, style: "내추럴", tags: ["내추럴", "가든웨딩", "심플"], desc: "명동 중심. 가든웨딩과 스몰웨딩에 어울리는 심플하고 자연스러운 드레스." },
  { name: "리안 브라이덜", location: "경기 성남시", region: "경기", priceMin: 1500000, priceMax: 3500000, style: "클래식", tags: ["클래식", "판교", "넓은 매장"], desc: "판교 테크노밸리 근처. 200평 대형 매장에 150벌 이상 보유." },
  { name: "로즈마리 웨딩", location: "서울 송파구", region: "서울", priceMin: 1800000, priceMax: 4200000, style: "로맨틱", tags: ["로맨틱", "잠실", "커스텀"], desc: "잠실역 도보 3분. 반맞춤 서비스로 체형에 맞는 수선 포함." },
  { name: "비엔나 브라이드", location: "서울 영등포구", region: "서울", priceMin: 1200000, priceMax: 3000000, style: "클래식", tags: ["클래식", "여의도", "직장인"], desc: "평일 야간 운영시간 표기를 시험하기 위한 운영 테스트용 예시." },
  { name: "라루체 드레스", location: "경기 고양시", region: "경기", priceMin: 1300000, priceMax: 3200000, style: "모던", tags: ["모던", "일산", "주차 편리"], desc: "일산 라페스타 근처. 넓은 주차장과 쾌적한 피팅 환경." },

  // ── 중급 (10곳) ──
  { name: "에덴 브라이덜", location: "서울 관악구", region: "서울", priceMin: 800000, priceMax: 2000000, style: "내추럴", tags: ["가성비", "내추럴", "대학가"], desc: "서울대입구역. 합리적인 가격에 세련된 디자인. 대학원생/사회초년생 신부 환영." },
  { name: "마리엘 웨딩", location: "서울 노원구", region: "서울", priceMin: 700000, priceMax: 1800000, style: "클래식", tags: ["가성비", "클래식", "동북권"], desc: "노원역 앞. 강북/동북권 신부를 위한 접근성 좋은 드레스샵." },
  { name: "쥬얼리 브라이드", location: "경기 수원시", region: "경기", priceMin: 800000, priceMax: 2200000, style: "로맨틱", tags: ["수원", "로맨틱", "경기남부"], desc: "경기 남부의 로맨틱 스타일을 보여주는 운영 테스트용 예시." },
  { name: "플로라 드레스", location: "경기 부천시", region: "경기", priceMin: 600000, priceMax: 1500000, style: "내추럴", tags: ["가성비", "부천", "심플"], desc: "부천역 도보 5분. 심플하고 깔끔한 드레스를 합리적 가격에." },
  { name: "아이비 브라이덜", location: "인천 남동구", region: "인천", priceMin: 700000, priceMax: 1800000, style: "클래식", tags: ["인천", "클래식", "넓은 매장"], desc: "인천 지역 클래식 스타일을 보여주는 운영 테스트용 예시." },
  { name: "루시아 웨딩", location: "서울 동대문구", region: "서울", priceMin: 900000, priceMax: 2200000, style: "모던", tags: ["동대문", "트렌디", "젊은감각"], desc: "동대문 패션 중심지. 최신 트렌드를 빠르게 반영한 드레스 라인업." },
  { name: "모멘트 드레스", location: "서울 서대문구", region: "서울", priceMin: 800000, priceMax: 2000000, style: "내추럴", tags: ["신촌", "내추럴", "야외웨딩"], desc: "신촌역 근처. 야외/가든 웨딩에 특화된 가볍고 편안한 드레스." },
  { name: "블레스 브라이드", location: "경기 용인시", region: "경기", priceMin: 700000, priceMax: 1800000, style: "클래식", tags: ["용인", "수지", "가성비"], desc: "수지 성복역 근처. 경기 중부권 신부를 위한 알뜰한 선택." },
  { name: "로렌 브라이덜", location: "서울 강서구", region: "서울", priceMin: 800000, priceMax: 2000000, style: "모던", tags: ["마곡", "모던", "신도시"], desc: "서울 강서 지역의 모던 스타일을 보여주는 운영 테스트용 예시." },
  { name: "뮤즈 웨딩", location: "경기 화성시", region: "경기", priceMin: 600000, priceMax: 1600000, style: "로맨틱", tags: ["동탄", "로맨틱", "신도시"], desc: "동탄 신도시. 젊은 신혼부부가 많은 동탄 지역 대표 드레스샵." },

  // ── 가성비 (7곳) ──
  { name: "해피데이 드레스", location: "서울 중랑구", region: "서울", priceMin: 300000, priceMax: 1000000, style: "심플", tags: ["가성비", "렌탈", "심플"], desc: "심플한 렌탈 구성을 보여주는 운영 테스트용 예시." },
  { name: "시크릿 가든 드레스", location: "경기 안양시", region: "경기", priceMin: 400000, priceMax: 1200000, style: "내추럴", tags: ["가성비", "안양", "렌탈+구매"], desc: "안양역. 렌탈과 구매 모두 가능. 예산에 맞는 맞춤 상담." },
  { name: "프리티 브라이드", location: "경기 의정부시", region: "경기", priceMin: 350000, priceMax: 1000000, style: "클래식", tags: ["의정부", "경기북부", "가성비"], desc: "경기 북부의 클래식 구성을 보여주는 운영 테스트용 예시." },
  { name: "러블리 웨딩 드레스", location: "인천 부평구", region: "인천", priceMin: 400000, priceMax: 1100000, style: "로맨틱", tags: ["부평", "인천", "가성비"], desc: "부평역 지하상가 근처. 인천 서부 지역 가성비 드레스." },
  { name: "순백의 브라이드", location: "경기 광명시", region: "경기", priceMin: 350000, priceMax: 900000, style: "심플", tags: ["광명", "심플", "미니멀"], desc: "광명사거리역. 군더더기 없는 미니멀 드레스 전문. 스몰웨딩 추천." },
  { name: "웨딩벨 드레스", location: "서울 구로구", region: "서울", priceMin: 400000, priceMax: 1200000, style: "클래식", tags: ["구로", "디지털단지", "직장인"], desc: "구로디지털단지역. 퇴근 후 피팅 가능. 합리적인 가격." },
  { name: "꿈의 드레스", location: "경기 김포시", region: "경기", priceMin: 300000, priceMax: 800000, style: "내추럴", tags: ["김포", "가성비", "소규모웨딩"], desc: "소규모 웨딩용 내추럴 구성을 보여주는 운영 테스트용 예시." },
];

// 상품 템플릿 (가격대별)
function generateProducts(shop: typeof DRESS_SHOPS[0]) {
  const { priceMin, priceMax } = shop;
  const range = priceMax - priceMin;
  const products = [];

  if (priceMax >= 3000000) {
    // 프리미엄/중상급 업체
    products.push({
      name: "시그니처 컬렉션",
      description: "기본 수선 포함 여부를 보여주는 예시 드레스 구성.",
      price: priceMin,
      original_price: Math.round(priceMin * 1.15),
      discount_price: null,
      is_popular: true,
      sort_order: 1,
      duration_minutes: 90,
      includes: ["드레스 1벌 선택", "기본 수선 포함", "속치마/글러브 대여", "피팅 2회"],
      excludes: ["베일 별도", "슈즈 별도", "추가 수선 비용 별도"],
      category_fields: { dress_count: 1, fitting_count: 2, alteration: "기본 수선" },
    });
    products.push({
      name: "프리미엄 패키지",
      description: "본식 드레스 + 촬영 드레스 2벌 풀 패키지. 프리미엄 수선 포함.",
      price: Math.round(priceMin + range * 0.4),
      original_price: Math.round((priceMin + range * 0.4) * 1.1),
      discount_price: null,
      is_popular: false,
      sort_order: 2,
      duration_minutes: 120,
      includes: ["드레스 2벌 선택 (본식+촬영)", "프리미엄 수선 포함", "속치마/글러브/베일 대여", "피팅 3회", "드레스 보관 서비스"],
      excludes: ["슈즈 별도"],
      category_fields: { dress_count: 2, fitting_count: 3, alteration: "프리미엄 수선" },
    });
    products.push({
      name: "럭셔리 올인원",
      description: "본식+촬영+2부 드레스 3벌 + 악세서리 풀세트. VIP 전담 스타일리스트.",
      price: Math.round(priceMin + range * 0.75),
      original_price: null,
      discount_price: null,
      is_popular: false,
      sort_order: 3,
      duration_minutes: 180,
      includes: ["드레스 3벌 선택 (본식+촬영+2부)", "완전 맞춤 수선", "베일+티아라+글러브+속치마 풀세트", "피팅 무제한", "VIP 전담 스타일리스트", "웨딩 당일 드레스 케어"],
      excludes: null,
      category_fields: { dress_count: 3, fitting_count: -1, alteration: "완전 맞춤" },
    });
    // 단품 옵션
    products.push({
      name: "촬영 드레스 단품",
      description: "스튜디오/야외 촬영 전용 드레스 1벌.",
      price: Math.round(priceMin * 0.6),
      original_price: null,
      discount_price: null,
      is_popular: false,
      sort_order: 4,
      duration_minutes: 60,
      includes: ["촬영 드레스 1벌", "기본 수선", "피팅 1회"],
      excludes: ["악세서리 별도", "본식 드레스와 별도 계약"],
      category_fields: { dress_count: 1, fitting_count: 1, alteration: "기본 수선" },
    });
  } else if (priceMax >= 1500000) {
    // 중급 업체
    products.push({
      name: "베이직 패키지",
      description: "본식 드레스 1벌 + 기본 수선을 가정한 예시 구성.",
      price: priceMin,
      original_price: null,
      discount_price: null,
      is_popular: true,
      sort_order: 1,
      duration_minutes: 60,
      includes: ["드레스 1벌 선택", "기본 수선", "속치마 대여", "피팅 1회"],
      excludes: ["베일/글러브 별도", "추가 수선 비용 별도"],
      category_fields: { dress_count: 1, fitting_count: 1, alteration: "기본 수선" },
    });
    products.push({
      name: "스탠다드 패키지",
      description: "본식 + 촬영 드레스 2벌. 악세서리 기본 포함.",
      price: Math.round(priceMin + range * 0.45),
      original_price: Math.round((priceMin + range * 0.45) * 1.1),
      discount_price: null,
      is_popular: true,
      sort_order: 2,
      duration_minutes: 90,
      includes: ["드레스 2벌 선택", "기본 수선 포함", "속치마/글러브 대여", "피팅 2회"],
      excludes: ["베일 별도 (5만원)", "추가 수선 별도"],
      category_fields: { dress_count: 2, fitting_count: 2, alteration: "기본 수선" },
    });
    products.push({
      name: "프리미엄 패키지",
      description: "3벌 패키지 + 액세서리 세트를 가정한 예시 구성.",
      price: priceMax,
      original_price: Math.round(priceMax * 1.15),
      discount_price: null,
      is_popular: false,
      sort_order: 3,
      duration_minutes: 120,
      includes: ["드레스 3벌 선택", "수선 포함", "베일+글러브+속치마 세트", "피팅 3회", "당일 드레스 전달"],
      excludes: null,
      category_fields: { dress_count: 3, fitting_count: 3, alteration: "포함" },
    });
  } else {
    // 가성비 업체
    products.push({
      name: "렌탈 베이직",
      description: "드레스 1벌 렌탈을 가정한 예시 구성.",
      price: priceMin,
      original_price: null,
      discount_price: null,
      is_popular: true,
      sort_order: 1,
      duration_minutes: 60,
      includes: ["드레스 1벌 렌탈", "기본 수선", "피팅 1회"],
      excludes: ["악세서리 별도", "추가 수선 별도"],
      category_fields: { dress_count: 1, fitting_count: 1, alteration: "기본", type: "렌탈" },
    });
    products.push({
      name: "렌탈 스탠다드",
      description: "본식 + 촬영 2벌 렌탈을 가정한 예시 구성.",
      price: Math.round(priceMin + range * 0.5),
      original_price: Math.round((priceMin + range * 0.5) * 1.15),
      discount_price: null,
      is_popular: true,
      sort_order: 2,
      duration_minutes: 90,
      includes: ["드레스 2벌 렌탈", "기본 수선", "속치마 대여", "피팅 2회"],
      excludes: ["베일/글러브 별도 (3만원)"],
      category_fields: { dress_count: 2, fitting_count: 2, alteration: "기본", type: "렌탈" },
    });
    products.push({
      name: "풀 패키지",
      description: "3벌 렌탈 + 악세서리 포함. 올인원 구성.",
      price: priceMax,
      original_price: Math.round(priceMax * 1.2),
      discount_price: null,
      is_popular: false,
      sort_order: 3,
      duration_minutes: 120,
      includes: ["드레스 3벌 렌탈", "수선 포함", "속치마/글러브 세트", "피팅 2회"],
      excludes: ["베일 별도 (3만원)"],
      category_fields: { dress_count: 3, fitting_count: 2, alteration: "포함", type: "렌탈" },
    });
    // 구매 옵션
    products.push({
      name: "드레스 구매",
      description: "마음에 드는 드레스를 직접 구매. 렌탈 대비 추가 비용.",
      price: Math.round(priceMax * 1.3),
      original_price: null,
      discount_price: null,
      is_popular: false,
      sort_order: 4,
      duration_minutes: 90,
      includes: ["드레스 1벌 구매", "맞춤 수선 포함", "드레스 보관 박스", "피팅 2회"],
      excludes: ["악세서리 별도"],
      category_fields: { dress_count: 1, fitting_count: 2, alteration: "맞춤", type: "구매" },
    });
  }

  return products;
}

// 기본 영업시간
const DEFAULT_HOURS = {
  mon: "11:00-20:00",
  tue: "11:00-20:00",
  wed: "11:00-20:00",
  thu: "11:00-20:00",
  fri: "11:00-20:00",
  sat: "10:00-19:00",
  sun: "예약제",
};

// 타임슬롯 생성 (월~토 11시~19시)
function generateTimeslots(vendorId: string) {
  const slots = [];
  for (let day = 0; day <= 6; day++) {
    for (let hour = 9; hour <= 20; hour++) {
      const available = day <= 5 && hour >= 11 && hour <= 19; // 월~토 11-19시
      slots.push({
        vendor_id: vendorId,
        day,
        hour,
        available,
        max_bookings: available ? 2 : 0,
      });
    }
  }
  return slots;
}

export async function POST(req: Request) {
  // 인증: 관리자 로그인만 허용. service_role_key 를 HTTP 헤더로 받는 bypass 제거.
  const { authorized } = await verifyAdmin(req);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const gate = seedGate();
  if (gate) return gate;
  const supabaseAdmin = getServiceClient();

  const results = { vendors: 0, products: 0, timeslots: 0, errors: [] as string[] };

  for (const shop of DRESS_SHOPS) {
    // 1. 업체 생성
    const { data: vendor, error: vendorError } = await supabaseAdmin
      .from("vendors")
      .insert({
        name: shop.name,
        category: "dress",
        location: shop.location,
        region: shop.region,
        address: `${shop.location} 웨딩거리 ${Math.floor(Math.random() * 200) + 1}`,
        phone: `02-${String(Math.floor(Math.random() * 9000) + 1000)}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        description: `[운영 테스트용 합성 데이터] ${shop.desc}`,
        price_range: `${(shop.priceMin / 10000).toLocaleString()}~${(shop.priceMax / 10000).toLocaleString()}만원`,
        price_min: shop.priceMin,
        price_max: shop.priceMax,
        tags: shop.tags,
        style_tags: [shop.style],
        // 합성 데이터는 실제 업체처럼 공개·추천하지 않는다.
        ai_recommend: false,
        status: "pending",
        business_hours: DEFAULT_HOURS,
        notification_settings: { booking: true, message: true, marketing: false },
      })
      .select("id")
      .single();

    if (vendorError) {
      results.errors.push(`업체 ${shop.name}: ${vendorError.message}`);
      continue;
    }

    results.vendors++;

    // 2. 상품 생성
    const products = generateProducts(shop);
    for (const product of products) {
      const { error: productError } = await supabaseAdmin
        .from("vendor_products")
        .insert({
          vendor_id: vendor.id,
          ...product,
          // 합성 데이터에 실제 인기도 신호를 부여하지 않는다.
          is_popular: false,
          is_active: true,
          images: [],
        });

      if (productError) {
        results.errors.push(`상품 ${shop.name}/${product.name}: ${productError.message}`);
      } else {
        results.products++;
      }
    }

    // 3. 타임슬롯 생성
    const timeslots = generateTimeslots(vendor.id);
    const { error: slotError } = await supabaseAdmin
      .from("vendor_timeslots")
      .insert(timeslots);

    if (slotError) {
      results.errors.push(`타임슬롯 ${shop.name}: ${slotError.message}`);
    } else {
      results.timeslots += timeslots.length;
    }
  }

  return NextResponse.json({
    success: true,
    summary: `업체 ${results.vendors}개, 상품 ${results.products}개, 타임슬롯 ${results.timeslots}개 생성`,
    ...results,
  });
}

// PUT: 과거의 일괄 타임슬롯 복구 엔드포인트는 실제 업체까지 덮어쓸 수 있어 폐기했다.
export async function PUT(req: Request) {
  // 인증: 관리자 로그인만 허용. service_role_key 를 HTTP 헤더로 받는 bypass 제거.
  const { authorized } = await verifyAdmin(req);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const gate = seedGate();
  if (gate) return gate;
  getServiceClient();

  return NextResponse.json({
    error: "일괄 타임슬롯 시드 복구는 안전상 비활성화되었습니다.",
  }, { status: 410 });
}
