import { createClient } from "@/lib/supabase/client";
import { Vendor, VendorProduct, VendorImage, VendorFilter, VendorWithDetails } from "@/types/vendor.types";

// 업체 목록 조회 (필터 포함)
export async function getVendors(filter?: VendorFilter): Promise<Vendor[]> {
  const supabase = createClient();

  let query = supabase
    .from("vendors")
    .select("*")
    .order("rating", { ascending: false });

  if (filter?.category) {
    query = query.eq("category", filter.category);
  }
  if (filter?.region) {
    query = query.eq("region", filter.region);
  }
  if (filter?.isFixedPrice !== undefined) {
    query = query.eq("is_fixed_price", filter.isFixedPrice);
  }

  const { data, error } = await query;

  if (error) {
    console.error("업체 조회 실패:", error);
    return [];
  }

  let vendors = (data || []) as Vendor[];

  // 스타일 태그 필터 (클라이언트 사이드)
  if (filter?.styleTags && filter.styleTags.length > 0) {
    vendors = vendors.filter((v) =>
      filter.styleTags!.some((tag) => v.style_tags?.includes(tag))
    );
  }

  return vendors;
}

// 키워드 검색
export async function searchVendors(keyword: string): Promise<Vendor[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .or(`name.ilike.%${keyword}%,description.ilike.%${keyword}%`)
    .order("rating", { ascending: false });

  if (error) {
    console.error("업체 검색 실패:", error);
    return [];
  }
  return (data || []) as Vendor[];
}

// 업체 상세 조회 (상품 + 이미지 포함)
export async function getVendorDetail(vendorId: string): Promise<VendorWithDetails | null> {
  const supabase = createClient();

  const [vendorRes, productsRes, imagesRes] = await Promise.all([
    supabase.from("vendors").select("*").eq("id", vendorId).single(),
    supabase.from("vendor_products").select("*").eq("vendor_id", vendorId).order("sort_order"),
    supabase.from("vendor_images").select("*").eq("vendor_id", vendorId).order("sort_order"),
  ]);

  if (vendorRes.error || !vendorRes.data) {
    console.error("업체 상세 조회 실패:", vendorRes.error);
    return null;
  }

  return {
    ...(vendorRes.data as Vendor),
    products: (productsRes.data || []) as VendorProduct[],
    images: (imagesRes.data || []) as VendorImage[],
  };
}

// 즐겨찾기 조회
export async function getFavoriteVendors(userId: string): Promise<Vendor[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("vendor_favorites")
    .select("vendor_id, vendors(*)")
    .eq("user_id", userId);

  if (error) {
    console.error("즐겨찾기 조회 실패:", error);
    return [];
  }

  return (data || [])
    .map((row) => row.vendors as unknown as Vendor)
    .filter(Boolean);
}

// 즐겨찾기 추가
export async function addFavoriteVendor(userId: string, vendorId: string) {
  const supabase = createClient();

  const { error } = await supabase
    .from("vendor_favorites")
    .insert({ user_id: userId, vendor_id: vendorId });

  if (error) {
    console.error("즐겨찾기 추가 실패:", error);
    return false;
  }
  return true;
}

// 즐겨찾기 제거
export async function removeFavoriteVendor(userId: string, vendorId: string) {
  const supabase = createClient();

  const { error } = await supabase
    .from("vendor_favorites")
    .delete()
    .eq("user_id", userId)
    .eq("vendor_id", vendorId);

  if (error) {
    console.error("즐겨찾기 제거 실패:", error);
    return false;
  }
  return true;
}

// 즐겨찾기 여부 확인
export async function isFavoriteVendor(userId: string, vendorId: string): Promise<boolean> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("vendor_favorites")
    .select("id")
    .eq("user_id", userId)
    .eq("vendor_id", vendorId)
    .single();

  if (error) return false;
  return !!data;
}
