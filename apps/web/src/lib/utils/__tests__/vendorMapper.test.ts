import { describe, it, expect } from "vitest";
import {
  categoryToKorean,
  categoryToDb,
  timeslotRowsToSlots,
  slotsToTimeslotInserts,
  vendorRowToVendor,
  vendorToPublicVendor,
  vendorToInsertRow,
  vendorToUpdateRow,
  bookingRowToBooking,
  messageRowToMessage,
} from "../vendorMapper";
import type {
  VendorBookingRow,
  VendorMessageRow,
  VendorRow,
  VendorTimeslotRow,
} from "@/types/vendor.types";

// ─── Fixtures ───

const baseVendorRow: VendorRow = {
  id: "v1",
  owner_id: "owner1",
  name: "샘플 청담 스튜디오",
  category: "studio",
  location: "강남구",
  region: "서울",
  address: "강남대로 123",
  phone: "",
  owner_name: "김원장",
  email: "owner@studio.com",
  description: "고급 웨딩 스튜디오",
  price_range: "300-500만원",
  price_min: 3_000_000,
  price_max: 5_000_000,
  rating: 4.8,
  review_count: 120,
  tags: ["고급", "야외"],
  style_tags: ["모던", "클래식"],
  ai_recommend: true,
  status: "approved",
  business_number: "123-45-67890",
  business_license_url: "/docs/license.pdf",
  business_hours: { mon: "09:00-18:00" },
  notification_settings: { booking: true, message: true, marketing: false },
  commission_rate: null,
  bank_name: null,
  account_number: null,
  account_holder: null,
  website: "https://studio.com",
  instagram: "@studio_official",
  thumbnail_url: "/images/studio.jpg",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

// ─── categoryToKorean ───

describe("categoryToKorean", () => {
  it.each([
    ["studio", "스튜디오"],
    ["dress", "드레스"],
    ["makeup", "메이크업"],
    ["venue", "예식장"],
    ["hanbok", "한복"],
    ["jewelry", "예물"],
    ["honeymoon", "신혼여행"],
    ["other", "기타"],
  ])("maps '%s' → '%s'", (input, expected) => {
    expect(categoryToKorean(input)).toBe(expected);
  });

  it("passes through already-Korean categories", () => {
    expect(categoryToKorean("스튜디오")).toBe("스튜디오");
    expect(categoryToKorean("드레스")).toBe("드레스");
  });

  it("falls back to '기타' for unmapped values", () => {
    expect(categoryToKorean("unknown_category")).toBe("기타");
    expect(categoryToKorean("")).toBe("기타");
  });
});

// ─── categoryToDb ───

describe("categoryToDb", () => {
  it.each([
    ["스튜디오", "studio"],
    ["드레스", "dress"],
    ["예식장", "venue"],
    ["기타", "other"],
  ])("maps '%s' → '%s'", (input, expected) => {
    expect(categoryToDb(input as never)).toBe(expected);
  });
});

// ─── timeslotRowsToSlots ───

describe("timeslotRowsToSlots", () => {
  const row: VendorTimeslotRow = {
    id: "ts1",
    vendor_id: "v1",
    day: 1,
    hour: 10,
    available: true,
    max_bookings: 3,
  };

  it("maps row fields to TimeSlot shape", () => {
    const slots = timeslotRowsToSlots([row]);
    expect(slots[0]).toEqual({
      day: 1,
      hour: 10,
      available: true,
      maxBookings: 3,
      currentBookings: 0,
    });
  });

  it("coerces missing current_bookings to 0", () => {
    const rowNoCurrent = { ...row } as unknown as VendorTimeslotRow;
    const slots = timeslotRowsToSlots([rowNoCurrent]);
    expect(slots[0].currentBookings).toBe(0);
  });

  it("preserves current_bookings when present", () => {
    const rowWithCurrent = { ...row, current_bookings: 2 } as unknown as VendorTimeslotRow;
    const slots = timeslotRowsToSlots([rowWithCurrent]);
    expect(slots[0].currentBookings).toBe(2);
  });

  it("returns empty array for empty input", () => {
    expect(timeslotRowsToSlots([])).toEqual([]);
  });
});

// ─── slotsToTimeslotInserts ───

describe("slotsToTimeslotInserts", () => {
  const slot = { day: 1, hour: 10, available: true, maxBookings: 3, currentBookings: 0 };

  it("uses vendor_id key for vendor type", () => {
    const inserts = slotsToTimeslotInserts([slot], "v1", "vendor");
    expect(inserts[0].vendor_id).toBe("v1");
    expect(inserts[0].product_id).toBeUndefined();
  });

  it("uses product_id key for product type", () => {
    const inserts = slotsToTimeslotInserts([slot], "p1", "product");
    expect(inserts[0].product_id).toBe("p1");
    expect(inserts[0].vendor_id).toBeUndefined();
  });
});

// ─── vendorRowToVendor ───

describe("vendorRowToVendor", () => {
  it("maps all base fields correctly", () => {
    const vendor = vendorRowToVendor(baseVendorRow);
    expect(vendor.id).toBe("v1");
    expect(vendor.name).toBe("샘플 청담 스튜디오");
    expect(vendor.category).toBe("스튜디오");
    expect(vendor.location).toBe("강남구");
    expect(vendor.rating).toBe(4.8);
    expect(vendor.reviewCount).toBe(120);
  });

  it("coerces rating string to number", () => {
    // PG numeric 컬럼이 런타임에 문자열로 내려오는 경우의 방어 동작 검증 — 타입 밖 값이라 캐스트
    const vendor = vendorRowToVendor({ ...baseVendorRow, rating: "3.5" as unknown as number });
    expect(vendor.rating).toBe(3.5);
  });

  it("coerces null rating to 0", () => {
    const vendor = vendorRowToVendor({ ...baseVendorRow, rating: null });
    expect(vendor.rating).toBe(0);
  });

  it("falls back location to region when location is null", () => {
    const vendor = vendorRowToVendor({ ...baseVendorRow, location: null });
    expect(vendor.location).toBe("서울");
  });

  it("falls back region to location when region is null", () => {
    const vendor = vendorRowToVendor({ ...baseVendorRow, region: null });
    expect(vendor.region).toBe("강남구");
  });

  it("returns empty string when both location and region are null", () => {
    const vendor = vendorRowToVendor({ ...baseVendorRow, location: null, region: null });
    expect(vendor.location).toBe("");
  });

  it("defaults tags to [] when null", () => {
    const vendor = vendorRowToVendor({ ...baseVendorRow, tags: null as unknown as string[] });
    expect(vendor.tags).toEqual([]);
  });

  it("defaults styleTags to [] when null", () => {
    const vendor = vendorRowToVendor({ ...baseVendorRow, style_tags: null });
    expect(vendor.styleTags).toEqual([]);
  });

  it("defaults notificationSettings when null", () => {
    const vendor = vendorRowToVendor({
      ...baseVendorRow,
      notification_settings: null as unknown as VendorRow["notification_settings"],
    });
    expect(vendor.notificationSettings).toEqual({ booking: true, message: true, marketing: false });
  });

  it("maps timeslots when provided", () => {
    const ts: VendorTimeslotRow = { id: "ts1", vendor_id: "v1", day: 2, hour: 14, available: true, max_bookings: 2 };
    const vendor = vendorRowToVendor(baseVendorRow, [ts]);
    expect(vendor.timeSlots).toHaveLength(1);
    expect(vendor.timeSlots[0].day).toBe(2);
  });

  it("defaults timeSlots to [] when not provided", () => {
    const vendor = vendorRowToVendor(baseVendorRow);
    expect(vendor.timeSlots).toEqual([]);
  });

  it("omits private owner, identity, document, and settings fields from public responses", () => {
    const vendor = vendorToPublicVendor(vendorRowToVendor(baseVendorRow));
    expect(vendor).not.toHaveProperty("ownerId");
    expect(vendor).not.toHaveProperty("ownerName");
    expect(vendor).not.toHaveProperty("email");
    expect(vendor).not.toHaveProperty("businessNumber");
    expect(vendor).not.toHaveProperty("businessLicenseUrl");
    expect(vendor).not.toHaveProperty("notificationSettings");
  });
});

// ─── vendorToInsertRow ───

describe("vendorToInsertRow", () => {
  it("always sets status to 'pending'", () => {
    const row = vendorToInsertRow({ ownerId: "o1", name: "Test", category: "스튜디오" });
    expect(row.status).toBe("pending");
  });

  it("converts Korean category to DB value", () => {
    const row = vendorToInsertRow({ ownerId: "o1", category: "드레스" });
    expect(row.category).toBe("dress");
  });

  it("falls back region to location", () => {
    const row = vendorToInsertRow({ ownerId: "o1", location: "강남" });
    expect(row.region).toBe("강남");
  });
});

// ─── vendorToUpdateRow ───

describe("vendorToUpdateRow", () => {
  it("only includes defined fields", () => {
    const row = vendorToUpdateRow({ name: "New Name" });
    expect(row.name).toBe("New Name");
    expect(Object.keys(row).length).toBe(1);
  });

  it("does not include undefined fields", () => {
    const row = vendorToUpdateRow({ name: "Test" });
    expect(row.location).toBeUndefined();
    expect(row.phone).toBeUndefined();
  });

  it("includes region from location when location is updated", () => {
    const row = vendorToUpdateRow({ location: "마포구", region: "서울" });
    expect(row.location).toBe("마포구");
    expect(row.region).toBe("서울");
  });

  it("falls back region to location when region is undefined", () => {
    const row = vendorToUpdateRow({ location: "마포구" });
    expect(row.region).toBe("마포구");
  });

  it("returns empty object for no changes", () => {
    expect(vendorToUpdateRow({})).toEqual({});
  });
});

// ─── bookingRowToBooking ───

describe("bookingRowToBooking", () => {
  const baseBookingRow: VendorBookingRow = {
    id: "bk1",
    vendor_id: "v1",
    couple_id: "c1",
    product_id: "p1",
    booking_date: "2026-10-15",
    booking_time: "14:00",
    booking_type: "consultation",
    bride_name: "김신부",
    groom_name: "이신랑",
    contact_phone: "010-1234-5678",
    status: "confirmed",
    contract_status: "signed",
    payment_status: "paid",
    amount: 500_000,
    is_paid: true,
    memo: "특별 요청사항",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
  };

  it("maps all fields correctly", () => {
    const booking = bookingRowToBooking(baseBookingRow);
    expect(booking.id).toBe("bk1");
    expect(booking.brideName).toBe("김신부");
    expect(booking.status).toBe("confirmed");
    expect(booking.amount).toBe(500_000);
    expect(booking.isPaid).toBe(true);
  });

  it("defaults amount to 0 when null", () => {
    const booking = bookingRowToBooking({ ...baseBookingRow, amount: null });
    expect(booking.amount).toBe(0);
  });

  it("defaults isPaid to false when null", () => {
    const booking = bookingRowToBooking({ ...baseBookingRow, is_paid: null as unknown as boolean });
    expect(booking.isPaid).toBe(false);
  });

  it("defaults brideName to '' when null", () => {
    const booking = bookingRowToBooking({ ...baseBookingRow, bride_name: null });
    expect(booking.brideName).toBe("");
  });

  it("includes product fields when provided", () => {
    const booking = bookingRowToBooking({ ...baseBookingRow, product_name: "스탠다드 패키지", product_duration: 120 });
    expect(booking.productName).toBe("스탠다드 패키지");
    expect(booking.productDuration).toBe(120);
  });
});

describe("messageRowToMessage", () => {
  it("accepts non-identifying server provenance without exposing internal metadata", () => {
    const row: VendorMessageRow = {
      id: "40000000-0000-4000-8000-000000000001",
      vendor_id: "20000000-0000-4000-8000-000000000001",
      customer_id: "00000000-0000-4000-8000-000000000001",
      server_provenance_version: 1,
      sender_type: "customer",
      content: "문의합니다",
      is_read: false,
      booking_id: null,
      created_at: "2026-08-02T00:00:00.000Z",
    };

    const message = messageRowToMessage(row);

    expect(message).toEqual({
      id: row.id,
      vendorId: row.vendor_id,
      customerId: row.customer_id,
      senderType: row.sender_type,
      content: row.content,
      isRead: row.is_read,
      bookingId: null,
      createdAt: row.created_at,
    });
    expect(message).not.toHaveProperty("serverProvenanceVersion");
    expect(message).not.toHaveProperty("server_provenance_version");
  });
});
