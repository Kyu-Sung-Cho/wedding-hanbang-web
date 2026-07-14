import { NextResponse } from "next/server";
import { verifyAdmin, getServiceClient, seedGate } from "@/lib/utils/adminAuth";

// 30개 드레스샵 시드 데이터
const DRESS_SHOPS = [
  // ── 프리미엄 (5곳) ──
  { name: "라비앙로제 브라이덜", location: "서울 강남구", region: "서울", priceMin: 3000000, priceMax: 8000000, style: "럭셔리", tags: ["럭셔리", "수입 드레스", "맞춤 제작"], desc: "유럽 수입 드레스와 국내 최고 디자이너 맞춤 제작 전문. 강남 논현동 웨딩거리 플래그십 매장." },
  { name: "그레이스 브라이드", location: "서울 강남구", region: "서울", priceMin: 2500000, priceMax: 7000000, style: "클래식", tags: ["클래식", "Vera Wang", "Oscar de la Renta"], desc: "세계적 디자이너 드레스 국내 독점 입점. 프라이빗 피팅룸에서 1:1 스타일링." },
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
  { name: "비엔나 브라이드", location: "서울 영등포구", region: "서울", priceMin: 1200000, priceMax: 3000000, style: "클래식", tags: ["클래식", "여의도", "직장인"], desc: "여의도 직장인 신부를 위한 평일 야간 피팅 운영. 주말 예약 가능." },
  { name: "라루체 드레스", location: "경기 고양시", region: "경기", priceMin: 1300000, priceMax: 3200000, style: "모던", tags: ["모던", "일산", "주차 편리"], desc: "일산 라페스타 근처. 넓은 주차장과 쾌적한 피팅 환경." },

  // ── 중급 (10곳) ──
  { name: "에덴 브라이덜", location: "서울 관악구", region: "서울", priceMin: 800000, priceMax: 2000000, style: "내추럴", tags: ["가성비", "내추럴", "대학가"], desc: "서울대입구역. 합리적인 가격에 세련된 디자인. 대학원생/사회초년생 신부 환영." },
  { name: "마리엘 웨딩", location: "서울 노원구", region: "서울", priceMin: 700000, priceMax: 1800000, style: "클래식", tags: ["가성비", "클래식", "동북권"], desc: "노원역 앞. 강북/동북권 신부를 위한 접근성 좋은 드레스샵." },
  { name: "쥬얼리 브라이드", location: "경기 수원시", region: "경기", priceMin: 800000, priceMax: 2200000, style: "로맨틱", tags: ["수원", "로맨틱", "경기남부"], desc: "수원역 AK플라자 근처. 경기남부 최대 규모 드레스 컬렉션." },
  { name: "플로라 드레스", location: "경기 부천시", region: "경기", priceMin: 600000, priceMax: 1500000, style: "내추럴", tags: ["가성비", "부천", "심플"], desc: "부천역 도보 5분. 심플하고 깔끔한 드레스를 합리적 가격에." },
  { name: "아이비 브라이덜", location: "인천 남동구", region: "인천", priceMin: 700000, priceMax: 1800000, style: "클래식", tags: ["인천", "클래식", "넓은 매장"], desc: "인천 구월동. 인천/부천 지역 최고 리뷰 드레스샵." },
  { name: "루시아 웨딩", location: "서울 동대문구", region: "서울", priceMin: 900000, priceMax: 2200000, style: "모던", tags: ["동대문", "트렌디", "젊은감각"], desc: "동대문 패션 중심지. 최신 트렌드를 빠르게 반영한 드레스 라인업." },
  { name: "모멘트 드레스", location: "서울 서대문구", region: "서울", priceMin: 800000, priceMax: 2000000, style: "내추럴", tags: ["신촌", "내추럴", "야외웨딩"], desc: "신촌역 근처. 야외/가든 웨딩에 특화된 가볍고 편안한 드레스." },
  { name: "블레스 브라이드", location: "경기 용인시", region: "경기", priceMin: 700000, priceMax: 1800000, style: "클래식", tags: ["용인", "수지", "가성비"], desc: "수지 성복역 근처. 경기 중부권 신부를 위한 알뜰한 선택." },
  { name: "로렌 브라이덜", location: "서울 강서구", region: "서울", priceMin: 800000, priceMax: 2000000, style: "모던", tags: ["마곡", "모던", "신도시"], desc: "마곡나루역. 마곡/김포공항 근처 신혼부부에게 인기." },
  { name: "뮤즈 웨딩", location: "경기 화성시", region: "경기", priceMin: 600000, priceMax: 1600000, style: "로맨틱", tags: ["동탄", "로맨틱", "신도시"], desc: "동탄 신도시. 젊은 신혼부부가 많은 동탄 지역 대표 드레스샵." },

  // ── 가성비 (7곳) ──
  { name: "해피데이 드레스", location: "서울 중랑구", region: "서울", priceMin: 300000, priceMax: 1000000, style: "심플", tags: ["초가성비", "렌탈", "심플"], desc: "면목역. 렌탈 전문. 깔끔한 드레스를 최저가로 제공." },
  { name: "시크릿 가든 드레스", location: "경기 안양시", region: "경기", priceMin: 400000, priceMax: 1200000, style: "내추럴", tags: ["가성비", "안양", "렌탈+구매"], desc: "안양역. 렌탈과 구매 모두 가능. 예산에 맞는 맞춤 상담." },
  { name: "프리티 브라이드", location: "경기 의정부시", region: "경기", priceMin: 350000, priceMax: 1000000, style: "클래식", tags: ["의정부", "경기북부", "가성비"], desc: "의정부역. 경기 북부 지역 가성비 최고 드레스샵." },
  { name: "러블리 웨딩 드레스", location: "인천 부평구", region: "인천", priceMin: 400000, priceMax: 1100000, style: "로맨틱", tags: ["부평", "인천", "가성비"], desc: "부평역 지하상가 근처. 인천 서부 지역 가성비 드레스." },
  { name: "순백의 브라이드", location: "경기 광명시", region: "경기", priceMin: 350000, priceMax: 900000, style: "심플", tags: ["광명", "심플", "미니멀"], desc: "광명사거리역. 군더더기 없는 미니멀 드레스 전문. 스몰웨딩 추천." },
  { name: "웨딩벨 드레스", location: "서울 구로구", region: "서울", priceMin: 400000, priceMax: 1200000, style: "클래식", tags: ["구로", "디지털단지", "직장인"], desc: "구로디지털단지역. 퇴근 후 피팅 가능. 합리적인 가격." },
  { name: "꿈의 드레스", location: "경기 김포시", region: "경기", priceMin: 300000, priceMax: 800000, style: "내추럴", tags: ["김포", "초가성비", "소규모웨딩"], desc: "김포 장기동. 소규모/스몰웨딩 신부를 위한 가장 합리적인 선택." },
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
      description: "가장 인기 있는 베스트셀러 드레스 라인. 기본 수선 포함.",
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
      description: "본식 드레스 1벌 + 기본 수선. 가장 합리적인 선택.",
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
      description: "3벌 풀 패키지 + 악세서리 세트. 가장 인기 있는 상품.",
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
      description: "드레스 1벌 렌탈. 가장 합리적인 가격.",
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
      description: "본식 + 촬영 2벌 렌탈. 가성비 최고 인기 상품.",
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
        description: shop.desc,
        price_range: `${(shop.priceMin / 10000).toLocaleString()}~${(shop.priceMax / 10000).toLocaleString()}만원`,
        price_min: shop.priceMin,
        price_max: shop.priceMax,
        tags: shop.tags,
        style_tags: [shop.style],
        ai_recommend: true,
        status: "approved",
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

// PUT: 모든 드레스샵 타임슬롯 열기
export async function PUT(req: Request) {
  // 인증: 관리자 로그인만 허용. service_role_key 를 HTTP 헤더로 받는 bypass 제거.
  const { authorized } = await verifyAdmin(req);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const gate = seedGate();
  if (gate) return gate;

  const supabaseAdmin = getServiceClient();

  // 1. 모든 approved 드레스샵 조회
  const { data: vendors, error: vendorError } = await supabaseAdmin
    .from("vendors")
    .select("id, name")
    .eq("category", "dress")
    .eq("status", "approved");

  if (vendorError || !vendors) {
    return NextResponse.json({ error: vendorError?.message }, { status: 500 });
  }

  const vendorIds = vendors.map((v) => v.id);
  let updatedSlots = 0;
  let updatedProductSlots = 0;
  const errors: string[] = [];

  // 2. vendor_timeslots: 월~토 10시~19시 전부 열기
  const { data: slotUpdate, error: slotError } = await supabaseAdmin
    .from("vendor_timeslots")
    .update({ available: true, max_bookings: 3 })
    .in("vendor_id", vendorIds)
    .gte("hour", 10)
    .lte("hour", 19)
    .lte("day", 5) // 월~토 (0~5)
    .select("id");

  if (slotError) {
    errors.push(`vendor_timeslots: ${slotError.message}`);
  } else {
    updatedSlots = slotUpdate?.length ?? 0;
  }

  // 일요일도 예약제로 열기 (12~17시)
  const { data: sunUpdate, error: sunError } = await supabaseAdmin
    .from("vendor_timeslots")
    .update({ available: true, max_bookings: 1 })
    .in("vendor_id", vendorIds)
    .eq("day", 6) // 일요일
    .gte("hour", 12)
    .lte("hour", 17)
    .select("id");

  if (sunError) {
    errors.push(`sunday slots: ${sunError.message}`);
  } else {
    updatedSlots += sunUpdate?.length ?? 0;
  }

  // 3. 모든 상품의 product_timeslots도 열기
  const { data: products } = await supabaseAdmin
    .from("vendor_products")
    .select("id")
    .in("vendor_id", vendorIds)
    .eq("is_active", true);

  if (products && products.length > 0) {
    const productIds = products.map((p) => p.id);

    // 월~토 10~19시
    const { data: pSlotUpdate, error: pSlotError } = await supabaseAdmin
      .from("product_timeslots")
      .update({ available: true, max_bookings: 2 })
      .in("product_id", productIds)
      .gte("hour", 10)
      .lte("hour", 19)
      .lte("day", 5)
      .select("id");

    if (pSlotError) {
      errors.push(`product_timeslots: ${pSlotError.message}`);
    } else {
      updatedProductSlots = pSlotUpdate?.length ?? 0;
    }

    // 일요일 12~17시
    const { data: pSunUpdate, error: pSunError } = await supabaseAdmin
      .from("product_timeslots")
      .update({ available: true, max_bookings: 1 })
      .in("product_id", productIds)
      .eq("day", 6)
      .gte("hour", 12)
      .lte("hour", 17)
      .select("id");

    if (pSunError) {
      errors.push(`product sunday: ${pSunError.message}`);
    } else {
      updatedProductSlots += pSunUpdate?.length ?? 0;
    }
  }

  return NextResponse.json({
    success: true,
    summary: `${vendors.length}개 업체, vendor_timeslots ${updatedSlots}개, product_timeslots ${updatedProductSlots}개 열림`,
    vendors: vendors.length,
    updatedSlots,
    updatedProductSlots,
    errors,
  });
}
