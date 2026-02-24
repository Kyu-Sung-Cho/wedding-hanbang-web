import type {
  VendorRow,
  VendorProductRow,
  VendorBookingRow,
  VendorTimeslotRow,
  ProductTimeslotRow,
  VendorMessageRow,
  Vendor,
  VendorProduct,
  Booking,
  TimeSlot,
  VendorMessage,
  VendorCategory,
} from "@/types/vendor.types";

// 카테고리 매핑 (DB 영문 → 프론트엔드 한글)
const CATEGORY_MAP: Record<string, VendorCategory> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  venue: "예식장",
  hanbok: "한복",
  jewelry: "예물",
  honeymoon: "신혼여행",
  other: "기타",
  // 이미 한글인 경우
  "스튜디오": "스튜디오",
  "드레스": "드레스",
  "메이크업": "메이크업",
  "예식장": "예식장",
  "한복": "한복",
  "예물": "예물",
  "신혼여행": "신혼여행",
  "기타": "기타",
};

const CATEGORY_REVERSE_MAP: Record<VendorCategory, string> = {
  "스튜디오": "studio",
  "드레스": "dress",
  "메이크업": "makeup",
  "예식장": "venue",
  "한복": "hanbok",
  "예물": "jewelry",
  "신혼여행": "honeymoon",
  "기타": "other",
};

export function categoryToKorean(dbCategory: string): VendorCategory {
  return CATEGORY_MAP[dbCategory] ?? "기타";
}

export function categoryToDb(category: VendorCategory): string {
  return CATEGORY_REVERSE_MAP[category] ?? category;
}

// ─── Timeslot 매퍼 ───

export function timeslotRowsToSlots(rows: (VendorTimeslotRow | ProductTimeslotRow)[]): TimeSlot[] {
  return rows.map((r) => ({
    day: r.day,
    hour: r.hour,
    available: r.available,
    maxBookings: r.max_bookings,
    currentBookings: (r as unknown as Record<string, unknown>).current_bookings as number ?? 0,
  }));
}

export function slotsToTimeslotInserts(
  slots: TimeSlot[],
  parentId: string,
  type: "vendor" | "product"
): Array<Record<string, unknown>> {
  return slots.map((s) => ({
    [type === "vendor" ? "vendor_id" : "product_id"]: parentId,
    day: s.day,
    hour: s.hour,
    available: s.available,
    max_bookings: s.maxBookings,
  }));
}

// ─── Vendor 매퍼 ───

export function vendorRowToVendor(
  row: VendorRow,
  timeslots?: VendorTimeslotRow[],
  products?: VendorProduct[]
): Vendor {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    category: categoryToKorean(row.category),
    location: row.location ?? row.region ?? "",
    region: row.region ?? row.location ?? "",
    address: row.address ?? "",
    phone: row.phone ?? "",
    ownerName: row.owner_name ?? "",
    email: row.email ?? "",
    description: row.description ?? "",
    priceRange: row.price_range ?? "",
    priceMin: row.price_min ?? 0,
    priceMax: row.price_max ?? 0,
    rating: Number(row.rating) || 0,
    reviewCount: row.review_count ?? 0,
    tags: row.tags ?? [],
    styleTags: row.style_tags ?? [],
    aiRecommend: row.ai_recommend ?? false,
    status: row.status ?? "pending",
    businessNumber: row.business_number ?? "",
    businessLicenseUrl: row.business_license_url ?? "",
    businessHours: row.business_hours ?? {},
    notificationSettings: row.notification_settings ?? { booking: true, message: true, marketing: false },
    website: row.website ?? "",
    instagram: row.instagram ?? "",
    thumbnailUrl: row.thumbnail_url ?? "",
    timeSlots: timeslots ? timeslotRowsToSlots(timeslots) : [],
    products: products ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function vendorToInsertRow(vendor: Partial<Vendor> & { ownerId: string }): Record<string, unknown> {
  return {
    owner_id: vendor.ownerId,
    name: vendor.name,
    category: vendor.category ? categoryToDb(vendor.category) : undefined,
    location: vendor.location,
    region: vendor.region || vendor.location,
    address: vendor.address,
    phone: vendor.phone,
    owner_name: vendor.ownerName,
    email: vendor.email,
    description: vendor.description,
    price_range: vendor.priceRange,
    price_min: vendor.priceMin,
    price_max: vendor.priceMax,
    tags: vendor.tags,
    business_number: vendor.businessNumber,
    status: "pending",
  };
}

export function vendorToUpdateRow(vendor: Partial<Vendor>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (vendor.name !== undefined) row.name = vendor.name;
  if (vendor.location !== undefined) {
    row.location = vendor.location;
    row.region = vendor.region || vendor.location;
  }
  if (vendor.address !== undefined) row.address = vendor.address;
  if (vendor.phone !== undefined) row.phone = vendor.phone;
  if (vendor.ownerName !== undefined) row.owner_name = vendor.ownerName;
  if (vendor.email !== undefined) row.email = vendor.email;
  if (vendor.description !== undefined) row.description = vendor.description;
  if (vendor.priceRange !== undefined) row.price_range = vendor.priceRange;
  if (vendor.priceMin !== undefined) row.price_min = vendor.priceMin;
  if (vendor.priceMax !== undefined) row.price_max = vendor.priceMax;
  if (vendor.tags !== undefined) row.tags = vendor.tags;
  if (vendor.businessNumber !== undefined) row.business_number = vendor.businessNumber;
  if (vendor.website !== undefined) row.website = vendor.website;
  if (vendor.instagram !== undefined) row.instagram = vendor.instagram;
  if (vendor.notificationSettings !== undefined) row.notification_settings = vendor.notificationSettings;
  return row;
}

// ─── VendorProduct 매퍼 ───

export function productRowToProduct(row: VendorProductRow, timeslots?: ProductTimeslotRow[]): VendorProduct {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    name: row.name,
    description: row.description ?? "",
    price: row.price,
    discountPrice: row.discount_price ?? undefined,
    duration: row.duration_minutes ?? row.duration ?? 60,
    isActive: row.is_active,
    isPopular: row.is_popular,
    sortOrder: row.sort_order,
    categoryFields: (row.category_fields ?? {}) as Record<string, string | number | boolean | string[]>,
    includes: row.includes ?? [],
    excludes: row.excludes ?? [],
    images: row.images ?? [],
    timeSlots: timeslots ? timeslotRowsToSlots(timeslots) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function productToInsertRow(product: Partial<VendorProduct> & { vendorId: string }): Record<string, unknown> {
  return {
    vendor_id: product.vendorId,
    name: product.name,
    description: product.description,
    price: product.price,
    discount_price: product.discountPrice,
    duration_minutes: product.duration,
    is_active: product.isActive ?? true,
    is_popular: product.isPopular ?? false,
    sort_order: product.sortOrder ?? 0,
    category_fields: product.categoryFields ?? {},
    includes: product.includes ?? [],
    images: product.images ?? [],
  };
}

export function productToUpdateRow(product: Partial<VendorProduct>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (product.name !== undefined) row.name = product.name;
  if (product.description !== undefined) row.description = product.description;
  if (product.price !== undefined) row.price = product.price;
  if (product.discountPrice !== undefined) row.discount_price = product.discountPrice;
  if (product.duration !== undefined) row.duration_minutes = product.duration;
  if (product.isActive !== undefined) row.is_active = product.isActive;
  if (product.isPopular !== undefined) row.is_popular = product.isPopular;
  if (product.sortOrder !== undefined) row.sort_order = product.sortOrder;
  if (product.categoryFields !== undefined) row.category_fields = product.categoryFields;
  if (product.includes !== undefined) row.includes = product.includes;
  if (product.images !== undefined) row.images = product.images;
  return row;
}

// ─── Booking 매퍼 ───

export function bookingRowToBooking(row: VendorBookingRow & { product_name?: string; product_duration?: number }): Booking {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    coupleId: row.couple_id,
    productId: row.product_id,
    bookingDate: row.booking_date,
    bookingTime: row.booking_time,
    bookingType: row.booking_type ?? "",
    brideName: row.bride_name ?? "",
    groomName: row.groom_name ?? "",
    contactPhone: row.contact_phone ?? "",
    status: row.status,
    amount: row.amount ?? 0,
    isPaid: row.is_paid ?? false,
    memo: row.memo ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    productName: row.product_name,
    productDuration: row.product_duration,
  };
}

// ─── Message 매퍼 ───

export function messageRowToMessage(row: VendorMessageRow): VendorMessage {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    customerId: row.customer_id,
    senderType: row.sender_type,
    content: row.content,
    isRead: row.is_read,
    bookingId: row.booking_id,
    createdAt: row.created_at,
  };
}
