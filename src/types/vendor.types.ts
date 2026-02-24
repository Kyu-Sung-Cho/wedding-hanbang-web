// DB 스네이크_케이스 → 프론트엔드 camelCase 타입

export type VendorCategory = "스튜디오" | "드레스" | "메이크업" | "예식장" | "한복" | "예물" | "신혼여행" | "기타";
export type VendorStatus = "pending" | "approved" | "rejected";
export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";

// ─── DB Row 타입 (snake_case) ───

export interface VendorRow {
  id: string;
  owner_id: string | null;
  name: string;
  category: string;
  location: string | null;
  region: string | null;
  address: string | null;
  phone: string | null;
  owner_name: string | null;
  email: string | null;
  description: string | null;
  price_range: string | null;
  price_min: number;
  price_max: number;
  rating: number | null;
  review_count: number | null;
  tags: string[];
  style_tags: string[] | null;
  ai_recommend: boolean;
  status: VendorStatus;
  business_number: string | null;
  business_license_url: string | null;
  business_hours: Record<string, string> | null;
  notification_settings: { booking: boolean; message: boolean; marketing: boolean };
  website: string | null;
  instagram: string | null;
  thumbnail_url: string | null;
  commission_rate: number | null;
  created_at: string;
  updated_at: string;
}

export interface VendorProductRow {
  id: string;
  vendor_id: string;
  name: string;
  description: string | null;
  price: number;
  discount_price: number | null;
  original_price: number | null;
  duration: number | null;
  duration_minutes: number | null;
  is_active: boolean;
  is_popular: boolean;
  sort_order: number;
  category_fields: Record<string, unknown>;
  includes: string[];
  excludes: string[] | null;
  images: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorBookingRow {
  id: string;
  vendor_id: string;
  couple_id: string | null;
  product_id: string | null;
  booking_date: string;
  booking_time: string;
  booking_type: string | null;
  bride_name: string | null;
  groom_name: string | null;
  contact_phone: string | null;
  status: BookingStatus;
  amount: number | null;
  is_paid: boolean;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorTimeslotRow {
  id: string;
  vendor_id: string;
  day: number;
  hour: number;
  available: boolean;
  max_bookings: number;
}

export interface ProductTimeslotRow {
  id: string;
  product_id: string;
  day: number;
  hour: number;
  available: boolean;
  max_bookings: number;
}

export interface VendorMessageRow {
  id: string;
  vendor_id: string;
  customer_id: string;
  sender_type: "customer" | "vendor";
  content: string;
  is_read: boolean;
  booking_id: string | null;
  created_at: string;
}

export interface VendorViewRow {
  id: string;
  vendor_id: string;
  viewer_id: string | null;
  created_at: string;
}

export interface VendorReviewRow {
  id: string;
  vendor_id: string;
  product_id: string | null;
  booking_id: string | null;
  customer_id: string;
  rating: number;
  content: string | null;
  images: string[] | null;
  reply: string | null;
  replied_at: string | null;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface VendorFavoriteRow {
  id: string;
  user_id: string;
  vendor_id: string;
  created_at: string;
}

// ─── 프론트엔드 타입 (camelCase) ───

export interface TimeSlot {
  day: number;
  hour: number;
  available: boolean;
  maxBookings: number;
  currentBookings: number;
}

export interface Vendor {
  id: string;
  ownerId: string | null;
  name: string;
  category: VendorCategory;
  location: string;
  region: string;
  address: string;
  phone: string;
  ownerName: string;
  email: string;
  description: string;
  priceRange: string;
  priceMin: number;
  priceMax: number;
  rating: number;
  reviewCount: number;
  tags: string[];
  styleTags: string[];
  aiRecommend: boolean;
  status: VendorStatus;
  businessNumber: string;
  businessLicenseUrl: string;
  businessHours: Record<string, string>;
  notificationSettings: { booking: boolean; message: boolean; marketing: boolean };
  website: string;
  instagram: string;
  thumbnailUrl: string;
  timeSlots: TimeSlot[];
  products: VendorProduct[];
  createdAt: string;
  updatedAt: string;
}

export interface VendorProduct {
  id: string;
  vendorId: string;
  name: string;
  description: string;
  price: number;
  discountPrice?: number;
  duration: number;
  isActive: boolean;
  isPopular: boolean;
  sortOrder: number;
  categoryFields: Record<string, string | number | boolean | string[]>;
  includes: string[];
  excludes: string[];
  images: string[];
  timeSlots: TimeSlot[];
  createdAt: string;
  updatedAt: string;
}

export interface Booking {
  id: string;
  vendorId: string;
  coupleId: string | null;
  productId: string | null;
  bookingDate: string;
  bookingTime: string;
  bookingType: string;
  brideName: string;
  groomName: string;
  contactPhone: string;
  status: BookingStatus;
  amount: number;
  isPaid: boolean;
  memo: string;
  createdAt: string;
  updatedAt: string;
  // 조인 필드
  productName?: string;
  productDuration?: number;
}

export interface VendorMessage {
  id: string;
  vendorId: string;
  customerId: string;
  senderType: "customer" | "vendor";
  content: string;
  isRead: boolean;
  bookingId: string | null;
  createdAt: string;
}

export interface MessageThread {
  vendorId: string;
  customerId: string;
  vendorName: string;
  customerName: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}
