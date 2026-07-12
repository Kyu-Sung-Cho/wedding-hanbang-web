// 업체 상세 + 상품 + 예약 화면
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
  Alert, Modal, TextInput, FlatList, Dimensions, Image, Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import {
  Share2, MapPin, Clock, ChevronDown, ChevronRight,
  ChevronUp, Check, X, CalendarDays, Timer,
  ShieldCheck, WalletCards, Info, FileCheck2, AlertTriangle, Store, Star,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { createMobileAppShareUrl, formatLocalDateOnly } from "@hanbang/shared";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import {
  AppHeader,
  EmptyState,
  IconBadge,
  LoadingState,
  StatusPill,
  Surface,
} from "@/components/ui/AppUI";

const { width: SCREEN_W } = Dimensions.get("window");
const BOOKING_REQUESTS_ENABLED = false as const;

/* ───── helpers ───── */
function formatWon(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.floor(n / 10_000)}만원`;
  return `${n.toLocaleString()}원`;
}

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function formatDateChip(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = DAY_NAMES[d.getDay()];
  return `${String(m).padStart(2, "0")}/${String(day).padStart(2, "0")} (${dow})`;
}

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

const CATEGORY_LABELS: Record<string, string> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  venue: "예식장",
  snap: "스냅",
  hanbok: "한복",
  jewelry: "예물",
  ring: "예물",
  honeymoon: "허니문",
  package: "패키지",
  dvd: "영상",
  suit: "예복",
  invitation: "청첩장",
};

function categoryLabel(category: string | null): string | null {
  if (!category) return null;
  return CATEGORY_LABELS[category] ?? category;
}

function formatPriceRange(vendor: Pick<Vendor, "price_range" | "price_min" | "price_max">): string {
  if (vendor.price_range) return vendor.price_range;
  if (vendor.price_min && vendor.price_max && vendor.price_max > vendor.price_min) {
    return `${formatWon(vendor.price_min)}~${formatWon(vendor.price_max)}`;
  }
  if (vendor.price_min && vendor.price_min > 0) return `${formatWon(vendor.price_min)}부터`;
  return "상품별 확인";
}

/* ───── types ───── */
interface Vendor {
  id: string;
  name: string;
  category: string | null;
  region: string | null;
  description: string | null;
  style_tags: string[] | null;
  business_hours: Record<string, string> | null;
  status: string | null;
  website: string | null;
  thumbnail_url: string | null;
  is_verified: boolean;
  ai_recommend: boolean;
  rating: number | null;
  review_count: number | null;
  price_range: string | null;
  price_min: number | null;
  price_max: number | null;
}

interface Product {
  id: string;
  vendor_id: string;
  name: string;
  price: number;
  original_price: number | null;
  description: string | null;
  includes: string[] | null;
  excludes: string[] | null;
  duration_minutes: number | null;
  is_popular: boolean;
  is_active: boolean;
  images: string[] | null;
}

/* ───── booking steps ───── */
type BookingStep = "date" | "time" | "confirm";

/* ───── main screen ───── */
export default function VendorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [vendorError, setVendorError] = useState<"load" | "not_found" | null>(null);
  const [productsError, setProductsError] = useState(false);
  const [hoursExpanded, setHoursExpanded] = useState(false);

  // 예약 모달 상태
  const [bookingVisible, setBookingVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [bookingStep, setBookingStep] = useState<BookingStep>("date");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [memo, setMemo] = useState("");
  const [availableHours, setAvailableHours] = useState<number[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 다음 30일 날짜 배열
  const next30Days = useMemo(() => {
    const days: Date[] = [];
    const today = new Date();
    for (let i = 1; i <= 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push(d);
    }
    return days;
  }, []);

  /* ── 데이터 로드 ── */
  const loadVendor = useCallback(async () => {
    if (!id) return;
    setVendorError(null);
    try {
      const { data, error } = await supabase
        .from("vendors")
        .select("id, name, category, region, description, style_tags, business_hours, status, website, thumbnail_url, is_verified, ai_recommend, rating, review_count, price_range, price_min, price_max")
        .eq("id", id)
        .single();

      if (error || !data) {
        console.error("업체 로드 오류:", error);
        setVendor(null);
        setVendorError(error?.code === "PGRST116" ? "not_found" : "load");
        return;
      }

      const v = data as Record<string, unknown>;
      setVendor({
        id: String(v.id ?? ""),
        name: String(v.name ?? ""),
        category: v.category ? String(v.category) : null,
        region: v.region ? String(v.region) : null,
        description: v.description ? String(v.description) : null,
        style_tags: Array.isArray(v.style_tags) ? v.style_tags as string[] : null,
        business_hours: v.business_hours && typeof v.business_hours === "object" ? v.business_hours as Record<string, string> : null,
        status: v.status ? String(v.status) : null,
        website: v.website ? String(v.website) : null,
        thumbnail_url: v.thumbnail_url ? String(v.thumbnail_url) : null,
        is_verified: Boolean(v.is_verified),
        ai_recommend: Boolean(v.ai_recommend),
        rating: typeof v.rating === "number" ? v.rating : null,
        review_count: typeof v.review_count === "number" ? v.review_count : null,
        price_range: v.price_range ? String(v.price_range) : null,
        price_min: typeof v.price_min === "number" && v.price_min > 0 ? v.price_min : null,
        price_max: typeof v.price_max === "number" && v.price_max > 0 ? v.price_max : null,
      });
    } catch (err) {
      console.error("업체 로드 오류:", err);
      setVendor(null);
      setVendorError("load");
    }
  }, [id]);

  const loadProducts = useCallback(async () => {
    if (!id) return;
    setProductsError(false);
    try {
      const { data, error } = await supabase
        .from("vendor_products")
        .select("*")
        .eq("vendor_id", id)
        .eq("is_active", true)
        .order("sort_order");

      if (error) {
        console.error("상품 로드 오류:", error);
        setProductsError(true);
        return;
      }

      setProducts(
        (data ?? []).map((r: Record<string, unknown>) => ({
          id: String(r.id ?? ""),
          vendor_id: String(r.vendor_id ?? ""),
          name: String(r.name ?? ""),
          price: typeof r.price === "number" ? r.price : 0,
          original_price: typeof r.original_price === "number" ? r.original_price : null,
          description: r.description ? String(r.description) : null,
          includes: Array.isArray(r.includes) ? r.includes as string[] : null,
          excludes: Array.isArray(r.excludes) ? r.excludes as string[] : null,
          duration_minutes: typeof r.duration_minutes === "number" ? r.duration_minutes : null,
          is_popular: Boolean(r.is_popular),
          is_active: Boolean(r.is_active),
          images: Array.isArray(r.images) ? r.images as string[] : null,
        }))
      );
    } catch (err) {
      console.error("상품 로드 오류:", err);
      setProductsError(true);
    }
  }, [id]);

  const reloadVendorData = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadVendor(), loadProducts()]);
    setLoading(false);
  }, [loadProducts, loadVendor]);

  useEffect(() => {
    void reloadVendorData();
  }, [reloadVendorData]);

  /* ── 예약 슬롯 로드 ── */
  const loadAvailableSlots = useCallback(async (date: Date) => {
    if (!id || !selectedProduct) return;
    setLoadingSlots(true);
    setSlotsError(false);
    setAvailableHours([]);
    try {
      const dateStr = formatLocalDateOnly(date);
      const query = new URLSearchParams({
        date: dateStr,
        productId: selectedProduct.id,
      });
      const response = await apiFetch(
        `/api/vendors/${encodeURIComponent(id)}/availability?${query.toString()}`
      );
      const payload = await response.json().catch(() => null) as {
        error?: string;
        availableHours?: unknown;
      } | null;
      if (!response.ok) throw new Error(payload?.error || "등록된 운영시간을 확인하지 못했습니다.");

      const available = Array.isArray(payload?.availableHours)
        ? payload.availableHours.filter(
            (hour): hour is number => Number.isInteger(hour) && hour >= 0 && hour <= 23
          )
        : [];
      setAvailableHours([...new Set(available)].sort((a, b) => a - b));
    } catch (err) {
      console.error("슬롯 로드 오류:", err);
      setAvailableHours([]);
      setSlotsError(true);
    } finally {
      setLoadingSlots(false);
    }
  }, [id, selectedProduct]);

  /* ── 예약 제출 ── */
  async function submitBooking() {
    if (!BOOKING_REQUESTS_ENABLED) {
      Alert.alert("업체 연결 준비 중", "현재 상담 요청은 업체에 전송되지 않아요.");
      return;
    }
    if (!selectedProduct || !selectedDate || selectedHour === null || !id) return;

    setSubmitting(true);
    try {
      const dateStr = formatLocalDateOnly(selectedDate);
      const timeStr = `${String(selectedHour).padStart(2, "0")}:00`;

      const res = await apiFetch("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          vendorId: id,
          productId: selectedProduct.id,
          date: dateStr,
          time: timeStr,
          memo: memo.trim() || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({} as { error?: string; message?: string; code?: string }));

      if (!res.ok) {
        if (payload.code === "booking_contact_required") {
          Alert.alert(
            "연락처가 필요해요",
            payload.error || "설정에서 휴대폰 번호를 등록해 주세요.",
            [
              { text: "나중에", style: "cancel" },
              { text: "설정으로 이동", onPress: () => router.push("/settings") },
            ],
          );
        } else {
          Alert.alert("상담 요청 실패", payload.error || "다시 시도해주세요.");
        }
        return;
      }

      Alert.alert(
        "상담 요청 접수 완료",
        payload.message || "상담 요청이 접수되었어요. 업체 확인 전에는 예약이 확정되지 않습니다.",
        [
          { text: "계속 보기", style: "cancel", onPress: closeBookingModal },
          {
            text: "상담 요청 내역 보기",
            onPress: () => {
              closeBookingModal();
              router.push("/bookings");
            },
          },
        ],
      );
    } catch (err) {
      console.error("예약 오류:", err);
      Alert.alert("상담 요청 실패", "다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  /* ── 모달 열기/닫기 ── */
  function openBooking(product: Product) {
    if (!BOOKING_REQUESTS_ENABLED) {
      Alert.alert("업체 연결 준비 중", "현재 상담 요청은 업체에 전송되지 않아요.");
      return;
    }
    setSelectedProduct(product);
    setBookingStep("date");
    setSelectedDate(null);
    setSelectedHour(null);
    setMemo("");
    setAvailableHours([]);
    setBookingVisible(true);
  }

  function closeBookingModal() {
    setBookingVisible(false);
    setSelectedProduct(null);
    setBookingStep("date");
    setSelectedDate(null);
    setSelectedHour(null);
    setMemo("");
  }

  /* ── 공유 ── */
  async function handleShare() {
    if (!vendor) return;
    try {
      const url = createMobileAppShareUrl({ kind: "vendor", id: vendor.id });
      await Share.share({
        url,
        message: `${vendor.name} - 웨딩한방에서 확인하세요!\n${url}`,
      });
    } catch {
      // 사용자가 공유 취소
    }
  }

  /* ── 로딩 ── */
  if (loading) {
    return (
      <SafeAreaView style={st.container} edges={["top"]}>
        <LoadingState label="업체 정보를 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  if (!vendor) {
    const couldNotLoad = vendorError === "load";
    return (
      <SafeAreaView style={st.container} edges={["top"]}>
        <AppHeader title="업체 상세" onBack={() => router.back()} />
        <EmptyState
          icon={
            <IconBadge tone="ivory" size={64}>
              <Store size={32} color={colors.textTertiary} />
            </IconBadge>
          }
          title={couldNotLoad ? "업체 정보를 불러오지 못했어요" : "업체 정보를 찾을 수 없어요"}
          description={
            couldNotLoad
              ? "연결을 확인한 뒤 다시 시도해주세요. 저장된 정보가 삭제된 것은 아니에요."
              : "목록으로 돌아가 다른 업체를 확인해보세요"
          }
          action={couldNotLoad ? (
            <Pressable
              style={st.retryBtn}
              onPress={() => void reloadVendorData()}
              accessibilityRole="button"
              accessibilityLabel="업체 정보 다시 불러오기"
            >
              <Text style={st.retryBtnText}>다시 시도</Text>
            </Pressable>
          ) : undefined}
        />
      </SafeAreaView>
    );
  }

  const category = categoryLabel(vendor.category);
  const sortedProducts = [...products].sort((a, b) => a.price - b.price);
  const lowestProduct = sortedProducts.find((product) => product.price > 0) ?? null;
  const priceSummary =
    vendor.price_range || vendor.price_min || vendor.price_max
      ? formatPriceRange(vendor)
      : lowestProduct
        ? `${formatWon(lowestProduct.price)}부터`
        : "상품별 확인";
  const hasVisiblePrice = priceSummary !== "상품별 확인" || products.some((product) => product.price > 0);
  const hasExclusions = products.some((product) => (product.excludes?.length ?? 0) > 0);
  const productCount = products.length;
  const trustTone = vendor.is_verified && hasVisiblePrice ? "success" as const : "warning" as const;

  return (
    <SafeAreaView style={st.container} edges={["top"]}>
      <AppHeader
        title={vendor.name}
        onBack={() => router.back()}
        right={(
          <Pressable onPress={handleShare} hitSlop={12}>
          <Share2 size={22} color={colors.noir[800]} />
          </Pressable>
        )}
      />

      <ScrollView contentContainerStyle={st.scrollContent} showsVerticalScrollIndicator={false}>
        {/* 히어로 썸네일 */}
        {vendor.thumbnail_url ? (
          <Image source={{ uri: vendor.thumbnail_url }} style={st.heroImage} />
        ) : (
          <View style={[st.heroImage, st.heroPlaceholder]}>
            <Text style={st.heroPlaceholderText}>사진 준비중</Text>
          </View>
        )}

        {/* 히어로 정보 */}
        <View style={st.heroSection}>
          <View style={st.heroNameRow}>
            <Text style={st.heroName}>{vendor.name}</Text>
          </View>

          <View style={st.heroBadges}>
            {category && (
              <View style={st.catBadge}>
                <Text style={st.catBadgeText}>{category}</Text>
              </View>
            )}
            {vendor.region && (
              <View style={st.regionBadge}>
                <MapPin size={12} color={colors.textSecondary} />
                <Text style={st.regionText}>{vendor.region}</Text>
              </View>
            )}
          </View>
        </View>

        <Surface style={st.trustCard}>
          <View style={st.trustCardTop}>
            <View style={st.trustTitleBlock}>
              <Text style={st.trustEyebrow}>VENDOR TRUST</Text>
              <Text style={st.trustTitle}>업체 선택 전에 확인할 등록 정보</Text>
            </View>
            <StatusPill
              label={vendor.is_verified && hasVisiblePrice ? "등록 정보 있음" : "직접 확인"}
              tone={trustTone}
            />
          </View>

          <View style={st.trustMetricGrid}>
            <View style={st.trustMetric}>
              <ShieldCheck
                size={18}
                color={vendor.is_verified ? colors.success : colors.textTertiary}
              />
              <Text style={st.trustMetricLabel}>등록 정보</Text>
              <Text style={st.trustMetricValue}>
                {vendor.is_verified ? "확인 표시" : "확인 전"}
              </Text>
            </View>
            <View style={st.trustMetricDivider} />
            <View style={st.trustMetric}>
              <WalletCards
                size={18}
                color={hasVisiblePrice ? colors.rose[500] : colors.textTertiary}
              />
              <Text style={st.trustMetricLabel}>가격</Text>
              <Text style={st.trustMetricValue} numberOfLines={1}>{priceSummary}</Text>
            </View>
            <View style={st.trustMetricDivider} />
            <View style={st.trustMetric}>
              <Star
                size={18}
                color={vendor.rating ? colors.gold.DEFAULT : colors.textTertiary}
                fill={vendor.rating ? colors.gold.DEFAULT : "transparent"}
              />
              <Text style={st.trustMetricLabel}>후기</Text>
              <Text style={st.trustMetricValue}>
                {vendor.rating ? `${vendor.rating.toFixed(1)}${vendor.review_count ? ` · ${vendor.review_count}개` : ""}` : "수집 전"}
              </Text>
            </View>
          </View>

          <View style={st.disclosureBox}>
            <Info size={15} color={colors.textTertiary} />
            <Text style={st.disclosureText}>
              {vendor.ai_recommend ? "탐색 후보로 등록된 업체예요. " : ""}
              등록 상태·가격·상품·후기 표시는 참고 정보이며 품질, 최신 가격, 예약 가능 여부를 보증하지 않아요. 계약 전 업체의 공식 연락처로 직접 확인해 주세요.
            </Text>
          </View>
        </Surface>

        <Surface tone="ivory" style={st.connectionStatusCard}>
          <View style={st.guardHeader}>
            <AlertTriangle size={17} color={colors.gold.DEFAULT} />
            <Text style={st.guardTitle}>업체 연결 준비 중</Text>
          </View>
          <Text style={st.connectionStatusText}>
            현재 상담 요청은 업체에 전송되지 않습니다. 이름·휴대폰 번호·희망 일시·메모도
            새로 저장하거나 업체에 제공하지 않아요. 공개 정보는 참고용이며 과거 요청 내역은 계속 확인할 수 있어요.
          </Text>
          <Pressable
            onPress={() => router.push("/bookings")}
            accessibilityRole="button"
            accessibilityLabel="과거 상담 요청 내역 보기"
            style={st.historyLink}
          >
            <Text style={st.historyLinkText}>과거 상담 요청 내역 보기</Text>
            <ChevronRight size={16} color={colors.rose[500]} />
          </Pressable>
        </Surface>

        <Surface tone="ivory" style={st.bookingGuardCard}>
          <View style={st.guardHeader}>
            <AlertTriangle size={17} color={colors.gold.DEFAULT} />
            <Text style={st.guardTitle}>계약 전 확인</Text>
          </View>
          <View style={st.guardRow}>
            <FileCheck2 size={15} color={colors.textSecondary} />
            <Text style={st.guardText}>
              {productsError
                ? "상품 목록을 불러오지 못했어요. 아래에서 다시 시도해주세요."
                : lowestProduct
                ? `등록 상품 ${productCount}개 · 최저 등록가 상품: ${lowestProduct.name} · ${formatWon(lowestProduct.price)}`
                : "등록된 상품이 없으면 상담 전 가격표를 먼저 요청하세요."}
            </Text>
          </View>
          <View style={st.guardRow}>
            <WalletCards size={15} color={colors.textSecondary} />
            <Text style={st.guardText}>
              {hasExclusions
                ? "불포함 항목이 있는 상품은 추가금 가능성이 있어요."
                : "포함/불포함 항목을 계약서 기준으로 다시 확인하세요."}
            </Text>
          </View>
          <View style={st.guardRow}>
            <CalendarDays size={15} color={colors.textSecondary} />
            <Text style={st.guardText}>
              계약 전 환불, 일정 변경, 원장/담당자 지정 조건을 확인하세요.
            </Text>
          </View>
        </Surface>

        {/* 설명 */}
        {vendor.description && (
          <View style={st.section}>
            <Text style={st.descriptionText}>{vendor.description}</Text>
          </View>
        )}

        {/* 스타일 태그 */}
        {vendor.style_tags && vendor.style_tags.length > 0 && (
          <View style={st.section}>
            <Text style={st.sectionTitle}>스타일</Text>
            <View style={st.tagsRow}>
              {vendor.style_tags.map((tag) => (
                <View key={tag} style={st.tagChip}>
                  <Text style={st.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 영업시간 (접기/펼치기) */}
        {vendor.business_hours && Object.keys(vendor.business_hours).length > 0 && (
          <View style={st.section}>
            <Pressable
              style={st.hoursHeader}
              onPress={() => setHoursExpanded(!hoursExpanded)}
            >
              <View style={st.hoursHeaderLeft}>
                <Clock size={16} color={colors.textSecondary} />
                <Text style={st.sectionTitle}>영업시간</Text>
              </View>
              {hoursExpanded ? (
                <ChevronUp size={20} color={colors.textTertiary} />
              ) : (
                <ChevronDown size={20} color={colors.textTertiary} />
              )}
            </Pressable>
            {hoursExpanded && (
              <View style={st.hoursBody}>
                {Object.entries(vendor.business_hours).map(([day, time]) => (
                  <View key={day} style={st.hoursRow}>
                    <Text style={st.hoursDay}>{day}</Text>
                    <Text style={st.hoursTime}>{time}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* 상품 목록 */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>상품</Text>
          {productsError ? (
            <View style={st.inlineError}>
              <AlertTriangle size={18} color={colors.gold.DEFAULT} />
              <Text style={st.inlineErrorText}>상품 정보를 불러오지 못했어요.</Text>
              <Pressable
                onPress={() => void loadProducts()}
                accessibilityRole="button"
                accessibilityLabel="상품 정보 다시 불러오기"
              >
                <Text style={st.inlineRetryText}>다시 시도</Text>
              </Pressable>
            </View>
          ) : products.length === 0 ? (
            <Text style={st.noProducts}>등록된 상품이 없어요</Text>
          ) : (
            products.map((product) => (
              <View key={product.id} style={st.productCard}>
                {/* 상품 이미지 */}
                {product.images && product.images.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={st.productImagesScroll}
                  >
                    {product.images.map((img, idx) => (
                      <Image key={idx} source={{ uri: img }} style={st.productImage} />
                    ))}
                  </ScrollView>
                )}

                <Text style={st.productName}>{product.name}</Text>

                {/* 가격 */}
                <View style={st.priceRow}>
                  <Text style={st.price}>{formatWon(product.price)}</Text>
                  {product.original_price != null && product.original_price !== product.price && (
                    <Text style={st.originalPrice}>{formatWon(product.original_price)}</Text>
                  )}
                </View>

                {/* 소요시간 */}
                {product.duration_minutes != null && (
                  <View style={st.durationRow}>
                    <Timer size={13} color={colors.textTertiary} />
                    <Text style={st.durationText}>{product.duration_minutes}분 소요</Text>
                  </View>
                )}

                {/* 설명 */}
                {product.description && (
                  <Text style={st.productDesc}>{product.description}</Text>
                )}

                <View style={st.productTrustRow}>
                  <Info size={13} color={colors.textTertiary} />
                  <Text style={st.productTrustText}>
                    포함 {product.includes?.length ?? 0}개
                    {" · "}
                    불포함 {product.excludes?.length ?? 0}개
                    {(product.excludes?.length ?? 0) > 0 ? " · 추가금 확인 필요" : ""}
                  </Text>
                </View>

                {/* 포함 항목 */}
                {product.includes && product.includes.length > 0 && (
                  <View style={st.includesList}>
                    {product.includes.map((item) => (
                      <View key={item} style={st.includeItem}>
                        <Check size={12} color={colors.success} />
                        <Text style={st.includeText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* 불포함 항목 */}
                {product.excludes && product.excludes.length > 0 && (
                  <View style={st.includesList}>
                    {product.excludes.map((item) => (
                      <View key={item} style={st.includeItem}>
                        <X size={12} color={colors.danger} />
                        <Text style={st.excludeText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* 예약 버튼 */}
                <Pressable
                  style={({ pressed }) => [
                    st.bookBtn,
                    !BOOKING_REQUESTS_ENABLED && st.bookBtnDisabled,
                    pressed && BOOKING_REQUESTS_ENABLED && { transform: [{ scale: 0.98 }] },
                  ]}
                  onPress={() => openBooking(product)}
                  disabled={!BOOKING_REQUESTS_ENABLED}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !BOOKING_REQUESTS_ENABLED }}
                >
                  <CalendarDays size={16} color={BOOKING_REQUESTS_ENABLED ? "#fff" : colors.textTertiary} />
                  <Text style={[st.bookBtnText, !BOOKING_REQUESTS_ENABLED && st.bookBtnTextDisabled]}>
                    {BOOKING_REQUESTS_ENABLED ? "상담 예약 요청" : "업체 연결 준비 중"}
                  </Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ───── 예약 모달 ───── */}
      <Modal visible={BOOKING_REQUESTS_ENABLED && bookingVisible} animationType="slide" transparent>
        <View style={st.modalOverlay}>
          <View style={st.modalContainer}>
            <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
              {/* 모달 헤더 */}
              <View style={st.modalHeader}>
                <Pressable onPress={closeBookingModal} hitSlop={12}>
                  <X size={24} color={colors.noir[800]} />
                </Pressable>
                <Text style={st.modalTitle}>상담 예약 요청</Text>
                <View style={{ width: 24 }} />
              </View>

              {/* 단계 인디케이터 */}
              <View style={st.stepsRow}>
                {(["date", "time", "confirm"] as BookingStep[]).map((step, idx) => (
                  <View key={step} style={st.stepItem}>
                    <View style={[
                      st.stepDot,
                      bookingStep === step && st.stepDotActive,
                      (idx < (bookingStep === "date" ? 0 : bookingStep === "time" ? 1 : 2)) && st.stepDotDone,
                    ]}>
                      <Text style={[
                        st.stepNum,
                        (bookingStep === step || idx < (bookingStep === "date" ? 0 : bookingStep === "time" ? 1 : 2)) && st.stepNumActive,
                      ]}>{idx + 1}</Text>
                    </View>
                    <Text style={[
                      st.stepLabel,
                      bookingStep === step && st.stepLabelActive,
                    ]}>
                      {step === "date" ? "날짜" : step === "time" ? "시간" : "확인"}
                    </Text>
                  </View>
                ))}
              </View>

              <ScrollView contentContainerStyle={st.modalBody}>
                {/* Step 1: 날짜 선택 */}
                {bookingStep === "date" && (
                  <View>
                    <Text style={st.modalSectionTitle}>날짜를 선택하세요</Text>
                    <FlatList
                      horizontal
                      data={next30Days}
                      keyExtractor={(d) => d.toISOString()}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingVertical: 8 }}
                      renderItem={({ item: d }) => {
                        const isSelected = selectedDate?.toDateString() === d.toDateString();
                        const isSunday = d.getDay() === 0;
                        return (
                          <Pressable
                            style={[st.dateChip, isSelected && st.dateChipActive]}
                            onPress={() => setSelectedDate(d)}
                          >
                            <Text style={[
                              st.dateChipText,
                              isSelected && st.dateChipTextActive,
                              isSunday && !isSelected && { color: colors.danger },
                            ]}>
                              {formatDateChip(d)}
                            </Text>
                          </Pressable>
                        );
                      }}
                    />
                    <Pressable
                      style={[st.nextBtn, !selectedDate && st.nextBtnDisabled]}
                      disabled={!selectedDate}
                      onPress={() => {
                        if (selectedDate) {
                          loadAvailableSlots(selectedDate);
                          setBookingStep("time");
                        }
                      }}
                    >
                      <Text style={[st.nextBtnText, !selectedDate && st.nextBtnTextDisabled]}>
                        다음
                      </Text>
                    </Pressable>
                  </View>
                )}

                {/* Step 2: 시간 선택 */}
                {bookingStep === "time" && (
                  <View>
                    <Text style={st.modalSectionTitle}>시간을 선택하세요</Text>
                    {selectedDate && (
                      <Text style={st.selectedDateLabel}>
                        {formatDateChip(selectedDate)}
                      </Text>
                    )}
                    {loadingSlots ? (
                      <ActivityIndicator color={colors.rose[500]} style={{ marginTop: 24 }} />
                    ) : slotsError ? (
                      <View style={st.noSlotsContainer}>
                        <Text style={st.noSlotsText}>상담 요청 시간을 불러오지 못했어요</Text>
                        <Pressable
                          style={st.backStepBtn}
                          onPress={() => selectedDate && void loadAvailableSlots(selectedDate)}
                          accessibilityRole="button"
                          accessibilityLabel="상담 요청 시간 다시 불러오기"
                        >
                          <Text style={st.backStepBtnText}>다시 시도</Text>
                        </Pressable>
                      </View>
                    ) : availableHours.length === 0 ? (
                      <View style={st.noSlotsContainer}>
                        <Text style={st.noSlotsText}>상담 요청 가능한 시간이 없어요</Text>
                        <Pressable
                          style={st.backStepBtn}
                          onPress={() => setBookingStep("date")}
                        >
                          <Text style={st.backStepBtnText}>다른 날짜 선택</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={st.timeGrid}>
                        {availableHours.map((h) => {
                          const isSelected = selectedHour === h;
                          return (
                            <Pressable
                              key={h}
                              style={[st.timeChip, isSelected && st.timeChipActive]}
                              onPress={() => setSelectedHour(h)}
                            >
                              <Text style={[st.timeChipText, isSelected && st.timeChipTextActive]}>
                                {formatHour(h)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                    <View style={st.stepBtnsRow}>
                      <Pressable
                        style={st.backStepBtn}
                        onPress={() => { setBookingStep("date"); setSelectedHour(null); }}
                      >
                        <Text style={st.backStepBtnText}>이전</Text>
                      </Pressable>
                      <Pressable
                        style={[st.nextBtn, { flex: 1 }, selectedHour === null && st.nextBtnDisabled]}
                        disabled={selectedHour === null}
                        onPress={() => setBookingStep("confirm")}
                      >
                        <Text style={[st.nextBtnText, selectedHour === null && st.nextBtnTextDisabled]}>
                          다음
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                {/* Step 3: 확인 */}
                {bookingStep === "confirm" && selectedProduct && selectedDate && selectedHour !== null && (
                  <View>
                    <Text style={st.modalSectionTitle}>상담 요청 정보를 확인하세요</Text>

                    <View style={st.confirmCard}>
                      <View style={st.confirmRow}>
                        <Text style={st.confirmLabel}>업체</Text>
                        <Text style={st.confirmValue}>{vendor.name}</Text>
                      </View>
                      <View style={st.confirmDivider} />
                      <View style={st.confirmRow}>
                        <Text style={st.confirmLabel}>상품</Text>
                        <Text style={st.confirmValue}>{selectedProduct.name}</Text>
                      </View>
                      <View style={st.confirmDivider} />
                      <View style={st.confirmRow}>
                        <Text style={st.confirmLabel}>날짜</Text>
                        <Text style={st.confirmValue}>{formatDateChip(selectedDate)}</Text>
                      </View>
                      <View style={st.confirmDivider} />
                      <View style={st.confirmRow}>
                        <Text style={st.confirmLabel}>시간</Text>
                        <Text style={st.confirmValue}>{formatHour(selectedHour)}</Text>
                      </View>
                      <View style={st.confirmDivider} />
                      <View style={st.confirmRow}>
                        <Text style={st.confirmLabel}>금액</Text>
                        <Text style={st.confirmPrice}>{formatWon(selectedProduct.price)}</Text>
                      </View>
                    </View>

                    <View style={st.confirmNotice}>
                      <AlertTriangle size={16} color={colors.gold.DEFAULT} />
                      <Text style={st.confirmNoticeText}>
                        업체와 계약하기 전 포함 {selectedProduct.includes?.length ?? 0}개,
                        불포함 {selectedProduct.excludes?.length ?? 0}개 항목과 환불/변경 조건을 업체와 다시 확인하세요.
                        업체 연결 기능은 준비 중이며 현재 이 정보는 업체에 전송되거나 새로 저장되지 않습니다.
                      </Text>
                    </View>

                    {/* 메모 */}
                    <Text style={st.memoLabel}>메모 (선택)</Text>
                    <TextInput
                      style={st.memoInput}
                      value={memo}
                      onChangeText={setMemo}
                      placeholder="요청사항이 있으시면 적어주세요"
                      placeholderTextColor={colors.textTertiary}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                    />

                    <View style={st.stepBtnsRow}>
                      <Pressable
                        style={st.backStepBtn}
                        onPress={() => setBookingStep("time")}
                      >
                        <Text style={st.backStepBtnText}>이전</Text>
                      </Pressable>
                      <Pressable
                        style={[st.submitBtn, { flex: 1 }, (!BOOKING_REQUESTS_ENABLED || submitting) && { opacity: 0.6 }]}
                        disabled={!BOOKING_REQUESTS_ENABLED || submitting}
                        onPress={submitBooking}
                      >
                        {submitting ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={st.submitBtnText}>
                            {BOOKING_REQUESTS_ENABLED ? "상담 요청 보내기" : "업체 연결 준비 중"}
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                )}
              </ScrollView>
            </SafeAreaView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ───── styles ───── */
const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingBottom: 20 },

  // 헤더
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
    flex: 1,
    textAlign: "center",
    marginHorizontal: 12,
  },

  // 히어로
  heroImage: {
    width: "100%",
    height: 220,
    backgroundColor: colors.ivory[200],
  },
  heroPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  heroPlaceholderText: {
    fontSize: 14,
    color: colors.textTertiary,
    fontFamily: "NotoSansKR_400Regular",
  },
  heroSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
  },
  heroNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  heroName: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },
  heroBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  catBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: colors.rose.glow,
  },
  catBadgeText: { fontSize: 12, color: colors.rose[600], fontWeight: "600" },
  regionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  regionText: { fontSize: 13, color: colors.textSecondary, fontFamily: "NotoSansKR_400Regular" },

  // 신뢰 신호
  trustCard: {
    marginHorizontal: 20,
    marginTop: 14,
    paddingVertical: 18,
  },
  trustCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  trustTitleBlock: { flex: 1, gap: 2 },
  trustEyebrow: {
    fontSize: 10,
    letterSpacing: 0,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textTertiary,
  },
  trustTitle: {
    fontSize: 17,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  trustMetricGrid: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: 16,
    backgroundColor: colors.ivory[100],
    paddingVertical: 12,
  },
  trustMetric: {
    flex: 1,
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 4,
  },
  trustMetricDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  trustMetricLabel: {
    fontSize: 10,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
  trustMetricValue: {
    fontSize: 11,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    textAlign: "center",
  },
  disclosureBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 14,
    paddingTop: 12,
  },
  disclosureText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  bookingGuardCard: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 16,
    gap: 10,
  },
  connectionStatusCard: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 16,
    gap: 10,
  },
  connectionStatusText: {
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  historyLink: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  historyLinkText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[500],
  },
  guardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  guardTitle: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  guardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  guardText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },

  // 섹션
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.noir[800],
    marginBottom: 12,
    fontFamily: "NotoSansKR_400Regular",
  },
  descriptionText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
    fontFamily: "NotoSansKR_400Regular",
  },

  // 스타일 태그
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.ivory[200],
  },
  tagText: { fontSize: 13, color: colors.textSecondary, fontFamily: "NotoSansKR_400Regular" },

  // 영업시간
  hoursHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hoursHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  hoursBody: { marginTop: 12 },
  hoursRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  hoursDay: { fontSize: 14, color: colors.textSecondary, fontFamily: "NotoSansKR_400Regular" },
  hoursTime: { fontSize: 14, color: colors.noir[800], fontFamily: "NotoSansKR_400Regular" },

  // 상품
  retryBtn: {
    marginTop: 16,
    minHeight: 44,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
  },
  retryBtnText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#fff",
  },
  inlineError: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 28,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: colors.ivory[100],
  },
  inlineErrorText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
  },
  inlineRetryText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[600],
    textDecorationLine: "underline",
  },
  noProducts: {
    fontSize: 14,
    color: colors.textTertiary,
    textAlign: "center",
    paddingVertical: 32,
    fontFamily: "NotoSansKR_400Regular",
  },
  productCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  productImagesScroll: { marginBottom: 12 },
  productImage: {
    width: 120,
    height: 90,
    borderRadius: 12,
    marginRight: 8,
    backgroundColor: colors.ivory[200],
  },
  productName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    marginBottom: 8,
    fontFamily: "NotoSansKR_400Regular",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  price: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "CormorantGaramond_600SemiBold",
  },
  originalPrice: {
    fontSize: 14,
    color: colors.textTertiary,
    textDecorationLine: "line-through",
    fontFamily: "CormorantGaramond_400Regular",
  },
  durationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 8,
  },
  durationText: { fontSize: 12, color: colors.textTertiary, fontFamily: "NotoSansKR_400Regular" },
  productDesc: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 10,
    fontFamily: "NotoSansKR_400Regular",
  },
  productTrustRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    backgroundColor: colors.ivory[100],
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  productTrustText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    fontFamily: "NotoSansKR_400Regular",
  },
  includesList: { marginBottom: 8 },
  includeItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 3,
  },
  includeText: { fontSize: 13, color: colors.textSecondary, fontFamily: "NotoSansKR_400Regular" },
  excludeText: { fontSize: 13, color: colors.textTertiary, fontFamily: "NotoSansKR_400Regular" },
  bookBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.noir[800],
    marginTop: 12,
  },
  bookBtnDisabled: {
    backgroundColor: colors.ivory[200],
  },
  bookBtnText: { fontSize: 14, fontWeight: "600", color: "#fff", fontFamily: "NotoSansKR_400Regular" },
  bookBtnTextDisabled: { color: colors.textTertiary },

  // 빈 상태
  emptyContainer: { alignItems: "center", paddingTop: 80 },
  emptyText: { fontSize: 15, color: colors.textTertiary, fontFamily: "NotoSansKR_400Regular" },

  // ───── 모달 ─────
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
    minHeight: "50%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },
  modalBody: {
    padding: 20,
    paddingBottom: 40,
  },
  modalSectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.noir[800],
    marginBottom: 16,
    fontFamily: "NotoSansKR_400Regular",
  },

  // 단계 인디케이터
  stepsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 24,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  stepItem: { alignItems: "center", gap: 4 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.ivory[200],
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotActive: { backgroundColor: colors.noir[800] },
  stepDotDone: { backgroundColor: colors.rose[500] },
  stepNum: { fontSize: 13, fontWeight: "600", color: colors.textTertiary },
  stepNumActive: { color: "#fff" },
  stepLabel: { fontSize: 11, color: colors.textTertiary, fontFamily: "NotoSansKR_400Regular" },
  stepLabelActive: { color: colors.noir[800], fontWeight: "600" },

  // 날짜 칩
  dateChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.ivory[200],
    marginRight: 8,
  },
  dateChipActive: { backgroundColor: colors.noir[800] },
  dateChipText: { fontSize: 13, color: colors.textSecondary, fontFamily: "NotoSansKR_400Regular" },
  dateChipTextActive: { color: "#fff", fontWeight: "600" },

  // 시간 그리드
  timeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
    marginBottom: 16,
  },
  timeChip: {
    width: (SCREEN_W - 40 - 30) / 4,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.ivory[200],
    alignItems: "center",
  },
  timeChipActive: { backgroundColor: colors.noir[800] },
  timeChipText: { fontSize: 14, color: colors.textSecondary, fontFamily: "CormorantGaramond_400Regular" },
  timeChipTextActive: { color: "#fff", fontWeight: "600" },

  selectedDateLabel: {
    fontSize: 14,
    color: colors.rose[500],
    fontWeight: "600",
    marginBottom: 12,
    fontFamily: "NotoSansKR_400Regular",
  },

  noSlotsContainer: { alignItems: "center", paddingTop: 24 },
  noSlotsText: { fontSize: 14, color: colors.textTertiary, marginBottom: 16, fontFamily: "NotoSansKR_400Regular" },

  // 버튼
  nextBtn: {
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    marginTop: 20,
  },
  nextBtnDisabled: { backgroundColor: colors.ivory[200] },
  nextBtnText: { fontSize: 15, fontWeight: "600", color: "#fff", fontFamily: "NotoSansKR_400Regular" },
  nextBtnTextDisabled: { color: colors.textTertiary },

  stepBtnsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  backStepBtn: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  backStepBtnText: { fontSize: 14, fontWeight: "500", color: colors.textSecondary, fontFamily: "NotoSansKR_400Regular" },

  // 확인 카드
  confirmCard: {
    backgroundColor: colors.ivory[100],
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
  },
  confirmRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  confirmDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 10,
  },
  confirmLabel: { fontSize: 14, color: colors.textSecondary, fontFamily: "NotoSansKR_400Regular" },
  confirmValue: { fontSize: 14, fontWeight: "600", color: colors.noir[800], fontFamily: "NotoSansKR_400Regular" },
  confirmPrice: { fontSize: 18, fontWeight: "700", color: colors.noir[800], fontFamily: "CormorantGaramond_600SemiBold" },
  confirmNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 16,
    backgroundColor: "rgba(201, 169, 110, 0.14)",
    padding: 12,
    marginBottom: 18,
  },
  confirmNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: "#7A5A1E",
    fontFamily: "NotoSansKR_400Regular",
  },

  // 메모
  memoLabel: { fontSize: 14, fontWeight: "500", color: colors.textSecondary, marginBottom: 8, fontFamily: "NotoSansKR_400Regular" },
  memoInput: {
    backgroundColor: colors.ivory[100],
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    color: colors.noir[800],
    minHeight: 80,
    fontFamily: "NotoSansKR_400Regular",
  },

  // 예약 요청 버튼
  submitBtn: {
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.rose[500],
    alignItems: "center",
  },
  submitBtnText: { fontSize: 15, fontWeight: "600", color: "#fff", fontFamily: "NotoSansKR_400Regular" },
});
