import { NextResponse } from "next/server";
import { verifyAdmin, getServiceClient, seedGate } from "@/lib/utils/adminAuth";

// 메이크업샵 시드 데이터 (15곳)
const MAKEUP_SHOPS = [
  // ── 프리미엄 (3곳) ──
  { name: "샤르망 메이크업", location: "서울 강남구", region: "서울", priceMin: 600000, priceMax: 1500000, style: "내추럴", tags: ["내추럴", "강남", "신부주도"], desc: "강남 신사동. 신부 본연의 매력을 살리는 내추럴 메이크업 전문." },
  { name: "더 글로우 살롱", location: "서울 강남구", region: "서울", priceMin: 700000, priceMax: 1700000, style: "글램", tags: ["글램", "광채", "프리미엄"], desc: "압구정. 글로우 스킨과 화사한 글램 룩 전문. 본식 + 리허설 + 폐백 풀세트." },
  { name: "메종 드 보떼", location: "서울 용산구", region: "서울", priceMin: 650000, priceMax: 1600000, style: "클래식", tags: ["클래식", "한남동", "원장직접"], desc: "한남동. 원장 직접 시술 보장. 정통 클래식 신부 메이크업." },

  // ── 중상급 (5곳) ──
  { name: "라뷔드 메이크업", location: "서울 마포구", region: "서울", priceMin: 350000, priceMax: 800000, style: "내추럴", tags: ["홍대", "내추럴", "젊은감각"], desc: "홍대입구. 자연스러우면서 트렌디한 메이크업." },
  { name: "스튜디오 뮤어", location: "서울 송파구", region: "서울", priceMin: 400000, priceMax: 900000, style: "글램", tags: ["잠실", "글램", "포토제닉"], desc: "잠실. 사진 잘 받는 포토제닉 메이크업. 야외 촬영 보정 포함." },
  { name: "더 비유티", location: "서울 서초구", region: "서울", priceMin: 380000, priceMax: 850000, style: "내추럴", tags: ["서초", "양가부모님", "단정"], desc: "서초동. 양가 부모님께 좋은 인상을 주는 단정한 메이크업." },
  { name: "벨라 살롱", location: "경기 성남시", region: "경기", priceMin: 350000, priceMax: 800000, style: "글램", tags: ["분당", "글램", "주차"], desc: "분당 정자동. 차로 가기 편하고 주차 편리." },
  { name: "온더 글래스", location: "서울 종로구", region: "서울", priceMin: 380000, priceMax: 870000, style: "한복특화", tags: ["북촌", "한복", "전통"], desc: "북촌. 한복 메이크업에 특화. 전통 혼례식 신부 인기." },

  // ── 중급 (5곳) ──
  { name: "데일리 뷰티", location: "서울 동작구", region: "서울", priceMin: 250000, priceMax: 600000, style: "내추럴", tags: ["사당", "가성비", "내추럴"], desc: "사당역. 데일리 같은 자연스러운 결과물에 합리적 가격." },
  { name: "스마일 뷰티 살롱", location: "서울 영등포구", region: "서울", priceMin: 280000, priceMax: 650000, style: "글램", tags: ["여의도", "직장인", "퇴근후"], desc: "여의도. 평일 야간 시술 가능. 직장인 신부 환영." },
  { name: "퍼스트 메이크업", location: "경기 수원시", region: "경기", priceMin: 230000, priceMax: 550000, style: "내추럴", tags: ["수원", "경기남부", "넓은공간"], desc: "수원역. 경기남부 가성비 메이크업 1위." },
  { name: "마이 데이", location: "인천 남동구", region: "인천", priceMin: 250000, priceMax: 600000, style: "클래식", tags: ["인천", "구월동", "클래식"], desc: "인천 구월동. 인천 신부 인기 1위 살롱." },
  { name: "리브 메이크업", location: "서울 광진구", region: "서울", priceMin: 280000, priceMax: 650000, style: "글램", tags: ["건대", "글램", "젊은신부"], desc: "건대. 20대 신부에게 인기. 트렌디한 글램 룩." },

  // ── 가성비 (2곳) ──
  { name: "데이지 메이크업", location: "서울 도봉구", region: "서울", priceMin: 150000, priceMax: 350000, style: "심플", tags: ["가성비", "심플", "도봉"], desc: "쌍문역. 단순하지만 결과물 좋은 합리적 메이크업." },
  { name: "프레쉬 메이크업", location: "경기 부천시", region: "경기", priceMin: 170000, priceMax: 400000, style: "내추럴", tags: ["부천", "가성비", "내추럴"], desc: "부천역. 부천/김포권 가성비 메이크업 추천 1위." },
];

function generateMakeupProducts(shop: typeof MAKEUP_SHOPS[0]) {
  const { priceMin, priceMax } = shop;
  const range = priceMax - priceMin;
  const products = [];

  if (priceMax >= 1000000) {
    // 프리미엄
    products.push({
      name: "본식 단독",
      description: "본식 메이크업 + 헤어. 시간 1시간 30분 기준.",
      price: priceMin,
      original_price: null,
      discount_price: null,
      is_popular: false,
      sort_order: 1,
      duration_minutes: 90,
      includes: ["본식 메이크업", "본식 헤어", "픽서 + 보정 키트"],
      excludes: ["리허설 별도", "혼주 별도"],
      category_fields: { shoot: false, retouch_kit: true },
    });
    products.push({
      name: "본식+리허설 패키지",
      description: "리허설 + 본식. 가장 인기.",
      price: Math.round(priceMin + range * 0.4),
      original_price: Math.round((priceMin + range * 0.4) * 1.1),
      discount_price: null,
      is_popular: true,
      sort_order: 2,
      duration_minutes: 180,
      includes: ["리허설 1회", "본식 메이크업+헤어", "픽서 + 보정 키트"],
      excludes: ["혼주 별도(15만원)", "출장비 별도"],
      category_fields: { rehearsal: 1, retouch_kit: true },
    });
    products.push({
      name: "올인원 풀패키지",
      description: "리허설 + 본식 + 폐백 + 혼주 2명. 풀세트.",
      price: priceMax,
      original_price: Math.round(priceMax * 1.1),
      discount_price: null,
      is_popular: true,
      sort_order: 3,
      duration_minutes: 240,
      includes: ["리허설", "본식+폐백", "혼주 메이크업 2명", "출장 포함", "보정 풀키트"],
      excludes: null,
      category_fields: { rehearsal: 1, ceremony: 2, parents: 2 },
    });
  } else if (priceMax >= 600000) {
    // 중상급
    products.push({
      name: "본식 단독",
      description: "본식 메이크업 + 헤어. 합리적 입문 옵션.",
      price: priceMin,
      original_price: null,
      discount_price: null,
      is_popular: false,
      sort_order: 1,
      duration_minutes: 90,
      includes: ["본식 메이크업+헤어"],
      excludes: ["리허설 별도", "혼주 별도", "출장비 별도"],
      category_fields: { shoot: false },
    });
    products.push({
      name: "본식+리허설",
      description: "리허설 1회 포함. 가장 인기.",
      price: Math.round(priceMin + range * 0.5),
      original_price: Math.round((priceMin + range * 0.5) * 1.1),
      discount_price: null,
      is_popular: true,
      sort_order: 2,
      duration_minutes: 180,
      includes: ["리허설 1회", "본식 메이크업+헤어", "픽서"],
      excludes: ["혼주 별도(10만원)"],
      category_fields: { rehearsal: 1 },
    });
    products.push({
      name: "본식+리허설+혼주 패키지",
      description: "혼주 메이크업 2명 포함. 양가 한 번에 해결.",
      price: priceMax,
      original_price: null,
      discount_price: null,
      is_popular: true,
      sort_order: 3,
      duration_minutes: 240,
      includes: ["리허설", "본식+헤어", "혼주 메이크업 2명"],
      excludes: ["출장비 별도(5만원)"],
      category_fields: { rehearsal: 1, parents: 2 },
    });
  } else {
    // 가성비
    products.push({
      name: "본식 단독",
      description: "본식 메이크업+헤어. 가장 합리적.",
      price: priceMin,
      original_price: null,
      discount_price: null,
      is_popular: true,
      sort_order: 1,
      duration_minutes: 90,
      includes: ["본식 메이크업+헤어"],
      excludes: ["리허설 별도", "혼주 별도"],
      category_fields: { shoot: false },
    });
    products.push({
      name: "본식+리허설",
      description: "리허설 1회 + 본식.",
      price: priceMax,
      original_price: Math.round(priceMax * 1.15),
      discount_price: null,
      is_popular: true,
      sort_order: 2,
      duration_minutes: 180,
      includes: ["리허설 1회", "본식+헤어"],
      excludes: ["혼주 별도(8만원)"],
      category_fields: { rehearsal: 1 },
    });
  }

  return products;
}

const DEFAULT_HOURS = {
  mon: "06:00-20:00",
  tue: "06:00-20:00",
  wed: "06:00-20:00",
  thu: "06:00-20:00",
  fri: "06:00-20:00",
  sat: "05:00-20:00",
  sun: "05:00-18:00",
};

function generateTimeslots(vendorId: string) {
  const slots = [];
  for (let day = 0; day <= 6; day++) {
    for (let hour = 6; hour <= 20; hour++) {
      // 주말은 새벽~오후 본식 메이크업 + 평일은 리허설용 시간
      const isWeekend = day === 5 || day === 6;
      const available = isWeekend ? hour >= 5 && hour <= 19 : hour >= 10 && hour <= 19;
      slots.push({
        vendor_id: vendorId,
        day,
        hour,
        available,
        max_bookings: available ? (isWeekend && hour < 10 ? 4 : 2) : 0,
      });
    }
  }
  return slots;
}

export async function POST(req: Request) {
  // 인증: 관리자 로그인만 허용. 이전엔 x-service-key 헤더로 service_role_key 를
  // 직접 전달하는 bypass 가 있었으나, DB 루트 시크릿을 HTTP 토큰으로 쓰는 안티패턴
  // 이므로 제거. service_role 은 서버 사이드 admin client 에서만 사용.
  const { authorized } = await verifyAdmin(req);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const gate = seedGate();
  if (gate) return gate;

  const supabaseAdmin = getServiceClient();

  const results = { vendors: 0, products: 0, timeslots: 0, errors: [] as string[] };

  for (const shop of MAKEUP_SHOPS) {
    const { data: vendor, error: vendorError } = await supabaseAdmin
      .from("vendors")
      .insert({
        name: shop.name,
        category: "makeup",
        location: shop.location,
        region: shop.region,
        address: `${shop.location} ${Math.floor(Math.random() * 200) + 1}번지`,
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

    const products = generateMakeupProducts(shop);
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
    summary: `메이크업 ${results.vendors}개, 상품 ${results.products}개, 타임슬롯 ${results.timeslots}개 생성`,
    ...results,
  });
}
