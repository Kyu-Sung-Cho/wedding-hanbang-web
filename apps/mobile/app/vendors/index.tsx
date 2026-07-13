// 업체 탐색 화면 — Supabase 데이터 기반 업체 브라우징
// 정렬, 즐겨찾기, 별점 표시 포함
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, FlatList, StyleSheet, Pressable,
  RefreshControl, TextInput, Image, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  Search, MapPin, Store, Star, Heart,
  ShieldCheck, WalletCards, CalendarCheck, Sparkles, Info, AlertTriangle,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import ErrorRetry from "@/components/ErrorRetry";
import { AppHeader, EmptyState, IconBadge, LoadingState, StatusPill, Surface } from "@/components/ui/AppUI";

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
  price_range: string | null;
  price_min: number | null;
  price_max: number | null;
  min_price: number | null;
  product_count: number;
  created_at: string | null;
  trust_score: number;
}

type SortKey = "info" | "rating" | "newest" | "price_asc";
type VendorTrustInput = Omit<Vendor, "trust_score">;

interface SortOption {
  key: SortKey;
  label: string;
}

interface CategoryFilter {
  key: string;
  label: string;
  values: string[];
}

const SORT_OPTIONS: SortOption[] = [
  { key: "info", label: "정보 많은 순" },
  { key: "rating", label: "등록 평점순" },
  { key: "newest", label: "최신순" },
  { key: "price_asc", label: "가격낮은순" },
];

const CATEGORY_FILTERS: CategoryFilter[] = [
  { key: "all", label: "전체", values: [] },
  { key: "studio", label: "스튜디오", values: ["studio", "스튜디오"] },
  { key: "dress", label: "드레스", values: ["dress", "드레스"] },
  { key: "makeup", label: "메이크업", values: ["makeup", "메이크업"] },
  { key: "venue", label: "예식장", values: ["venue", "예식장"] },
  { key: "snap", label: "스냅", values: ["snap", "스냅"] },
  { key: "hanbok", label: "한복", values: ["hanbok", "한복"] },
  { key: "jewelry", label: "예물", values: ["jewelry", "ring", "예물"] },
  { key: "honeymoon", label: "허니문", values: ["honeymoon", "신혼여행"] },
];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_FILTERS.flatMap((filter) =>
    filter.values.map((value) => [value, filter.label] as const)
  )
);

function formatWon(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString()}만원`;
  return `${n.toLocaleString()}원`;
}

function categoryLabel(category: string | null): string | null {
  if (!category) return null;
  return CATEGORY_LABELS[category] ?? category;
}

function getDisplayPrice(vendor: Pick<Vendor, "min_price" | "price_range" | "price_min">): string {
  if (vendor.min_price && vendor.min_price > 0) return `${formatWon(vendor.min_price)}부터`;
  if (vendor.price_range) return vendor.price_range;
  if (vendor.price_min && vendor.price_min > 0) return `${formatWon(vendor.price_min)}부터`;
  return "문의 필요";
}

function scoreVendorTrust(vendor: VendorTrustInput): number {
  let score = 0;
  if (vendor.status === "approved") score += 20;
  if (vendor.is_verified) score += 25;
  if (vendor.min_price || vendor.price_range || vendor.price_min) score += 20;
  if (vendor.product_count > 0) score += 15;
  if (vendor.region) score += 5;
  return Math.min(score, 100);
}

function getTrustStatus(score: number): { label: string; tone: "success" | "rose" | "warning" } {
  if (score >= 75) return { label: "정보 항목 많음", tone: "success" };
  if (score >= 55) return { label: "정보 일부 있음", tone: "rose" };
  return { label: "직접 확인 필요", tone: "warning" };
}

/* ───── main screen ───── */
export default function VendorsScreen() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [favoriteError, setFavoriteError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedSort, setSelectedSort] = useState<SortKey>("info");

  // 즐겨찾기 상태 (vendor_id Set)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [userId, setUserId] = useState<string | null>(null);
  const favoriteSyncing = useRef<Set<string>>(new Set());

  // 현재 유저 ID 가져오기
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
    })();
  }, []);

  // 즐겨찾기 목록 로드
  const loadFavorites = useCallback(async () => {
    if (!userId) return;
    try {
      setFavoriteError(false);
      const response = await apiFetch("/api/favorites");
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(body.vendorIds)) {
        throw new Error(body.error ?? "즐겨찾기 목록을 불러오지 못했습니다.");
      }
      setFavoriteIds(new Set(body.vendorIds.filter((id: unknown): id is string => typeof id === "string")));
    } catch (err) {
      console.error("즐겨찾기 로드 오류:", err);
      setFavoriteError(true);
    }
  }, [userId]);

  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  // 즐겨찾기 토글 (optimistic UI)
  const toggleFavorite = useCallback(async (vendorId: string) => {
    if (!userId) return;
    // 중복 요청 방지
    if (favoriteSyncing.current.has(vendorId)) return;
    favoriteSyncing.current.add(vendorId);

    const isFav = favoriteIds.has(vendorId);

    // 옵티미스틱 업데이트
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFav) {
        next.delete(vendorId);
      } else {
        next.add(vendorId);
      }
      return next;
    });

    try {
      const response = await apiFetch("/api/favorites", {
        method: "POST",
        body: JSON.stringify({ vendorId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.isFavorite !== "boolean") {
        throw new Error(body.error ?? "즐겨찾기를 저장하지 못했습니다.");
      }
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (body.isFavorite) next.add(vendorId);
        else next.delete(vendorId);
        return next;
      });
    } catch (err) {
      console.error("즐겨찾기 동기화 오류:", err);
      // 실패 시 롤백
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (isFav) {
          next.add(vendorId);
        } else {
          next.delete(vendorId);
        }
        return next;
      });
      Alert.alert("즐겨찾기를 저장하지 못했어요", "연결을 확인하고 다시 시도해주세요.");
    } finally {
      favoriteSyncing.current.delete(vendorId);
    }
  }, [userId, favoriteIds]);

  const loadVendors = useCallback(async () => {
    try {
      setError(false);

      // 기본 select에 rating, created_at 추가, 최소 상품가격은 서브쿼리
      let query = supabase
        .from("vendors")
        .select("id, name, category, region, description, style_tags, business_hours, status, website, thumbnail_url, is_verified, ai_recommend, rating, price_range, price_min, price_max, created_at, vendor_products(price, is_active)")
        .eq("status", "approved");

      const categoryFilter = CATEGORY_FILTERS.find((filter) => filter.key === selectedCategory);
      if (categoryFilter && categoryFilter.values.length > 0) {
        query = query.in("category", categoryFilter.values);
      }

      if (searchQuery.trim()) {
        query = query.ilike("name", `%${searchQuery.trim()}%`);
      }

      // 정렬 적용
      switch (selectedSort) {
        case "rating":
          query = query.order("rating", { ascending: false, nullsFirst: false });
          break;
        case "newest":
          query = query.order("created_at", { ascending: false });
          break;
        case "info":
        case "price_asc":
        default:
          // 정보 항목순/가격순은 name으로 가져온 뒤 클라이언트 정렬
          query = query.order("name");
          break;
      }

      const { data, error: queryError } = await query;

      if (queryError) {
        console.error("업체 로드 오류:", queryError);
        setVendors([]);
        setError(true);
        return;
      }

      const mapped = (data ?? []).map((r: Record<string, unknown>) => {
        // 상품 최소 가격 계산
        const products = Array.isArray(r.vendor_products) ? r.vendor_products as Array<{ price: number; is_active?: boolean }> : [];
        const activeProducts = products.filter((p) => p.is_active !== false);
        const prices = activeProducts.map((p) => p.price).filter((p) => typeof p === "number" && p > 0);
        const explicitMinPrice = typeof r.price_min === "number" && r.price_min > 0 ? r.price_min : null;
        const minPrice = prices.length > 0 ? Math.min(...prices) : explicitMinPrice;

        const vendor: VendorTrustInput = {
          id: String(r.id ?? ""),
          name: String(r.name ?? ""),
          category: r.category ? String(r.category) : null,
          region: r.region ? String(r.region) : null,
          description: r.description ? String(r.description) : null,
          style_tags: Array.isArray(r.style_tags) ? r.style_tags as string[] : null,
          business_hours: r.business_hours && typeof r.business_hours === "object" ? r.business_hours as Record<string, string> : null,
          status: r.status ? String(r.status) : null,
          website: r.website ? String(r.website) : null,
          thumbnail_url: r.thumbnail_url ? String(r.thumbnail_url) : null,
          is_verified: Boolean(r.is_verified),
          ai_recommend: Boolean(r.ai_recommend),
          rating: typeof r.rating === "number" ? r.rating : null,
          price_range: r.price_range ? String(r.price_range) : null,
          price_min: explicitMinPrice,
          price_max: typeof r.price_max === "number" && r.price_max > 0 ? r.price_max : null,
          min_price: minPrice,
          product_count: activeProducts.length,
          created_at: r.created_at ? String(r.created_at) : null,
        };

        return {
          ...vendor,
          trust_score: scoreVendorTrust(vendor),
        };
      });

      if (selectedSort === "info") {
        mapped.sort((a, b) => (
          b.trust_score - a.trust_score
          || a.name.localeCompare(b.name)
        ));
      }

      // 가격낮은순 클라이언트 정렬 (null은 뒤로)
      if (selectedSort === "price_asc") {
        mapped.sort((a, b) => {
          if (a.min_price === null && b.min_price === null) return 0;
          if (a.min_price === null) return 1;
          if (b.min_price === null) return -1;
          return a.min_price - b.min_price;
        });
      }

      setVendors(mapped);
    } catch (err) {
      console.error("업체 로드 오류:", err);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchQuery, selectedCategory, selectedSort]);

  useEffect(() => { loadVendors(); }, [loadVendors]);

  const verifiedCount = vendors.filter((vendor) => vendor.is_verified).length;
  const priceKnownCount = vendors.filter((vendor) => getDisplayPrice(vendor) !== "문의 필요").length;
  const curatedCount = vendors.filter((vendor) => vendor.ai_recommend).length;

  function renderVendor({ item }: { item: Vendor }) {
    const isFav = favoriteIds.has(item.id);
    const category = categoryLabel(item.category);
    const trustStatus = getTrustStatus(item.trust_score);
    const priceLabel = getDisplayPrice(item);
    const hasRegisteredProducts = item.product_count > 0;

    return (
      <Pressable
        style={({ pressed }) => [
          s.card,
          pressed && { transform: [{ scale: 0.98 }] },
        ]}
        onPress={() => router.push({ pathname: "/vendors/[id]", params: { id: item.id } })}
      >
        {/* 썸네일 + 즐겨찾기 버튼 */}
        <View>
          {item.thumbnail_url ? (
            <Image source={{ uri: item.thumbnail_url }} style={s.thumbnail} />
          ) : (
            <View style={[s.thumbnail, s.thumbnailPlaceholder]}>
              <Store size={28} color={colors.textTertiary} />
            </View>
          )}

          <View style={s.imageBadges}>
            {item.ai_recommend ? (
              <View style={s.imageBadge}>
                <Sparkles size={12} color={colors.noir[800]} />
                <Text style={s.imageBadgeText}>탐색 후보</Text>
              </View>
            ) : null}
            {item.is_verified ? (
              <View style={s.imageBadge}>
                <ShieldCheck size={12} color={colors.noir[800]} />
                <Text style={s.imageBadgeText}>정보 확인 표시</Text>
              </View>
            ) : null}
          </View>

          {/* 즐겨찾기 하트 버튼 */}
          <Pressable
            style={({ pressed }) => [
              s.heartBtn,
              pressed && { transform: [{ scale: 0.85 }] },
            ]}
            onPress={(e) => {
              e.stopPropagation();
              toggleFavorite(item.id);
            }}
            hitSlop={8}
          >
            <Heart
              size={20}
              color={isFav ? colors.rose[500] : colors.surface}
              fill={isFav ? colors.rose[500] : "transparent"}
              strokeWidth={isFav ? 0 : 2}
              style={!isFav ? { opacity: 0.9 } : undefined}
            />
          </Pressable>
        </View>

        <View style={s.cardBody}>
          {/* 상단: 이름 + 별점 + 카테고리 배지 */}
          <View style={s.cardTop}>
            <View style={s.nameRow}>
              <Text style={s.vendorName} numberOfLines={1}>{item.name}</Text>
              {/* 별점 표시 */}
              <View style={s.ratingBadge}>
                <Star
                  size={12}
                  color={item.rating ? colors.gold.DEFAULT : colors.textTertiary}
                  fill={item.rating ? colors.gold.DEFAULT : "transparent"}
                />
                <Text style={[s.ratingText, !item.rating && s.ratingTextNew]}>
                  {item.rating ? `등록 ${item.rating.toFixed(1)}` : "평점 없음"}
                </Text>
              </View>
            </View>
            {category && (
              <View style={s.catBadge}>
                <Text style={s.catBadgeText}>{category}</Text>
              </View>
            )}
          </View>

          {/* 지역 */}
          {item.region && (
            <View style={s.metaRow}>
              <MapPin size={13} color={colors.textTertiary} />
              <Text style={s.metaText}>{item.region}</Text>
            </View>
          )}

          {/* 스타일 태그 */}
          {item.style_tags && item.style_tags.length > 0 && (
            <View style={s.tagsRow}>
              {item.style_tags.slice(0, 4).map((tag) => (
                <View key={tag} style={s.tagChip}>
                  <Text style={s.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={s.trustGrid}>
            <View style={s.trustItem}>
              <ShieldCheck size={15} color={item.is_verified ? colors.success : colors.textTertiary} />
              <Text style={s.trustLabel}>등록 정보</Text>
              <Text style={s.trustValue}>{item.is_verified ? "확인 표시" : "확인 전"}</Text>
            </View>
            <View style={s.trustDivider} />
            <View style={s.trustItem}>
              <WalletCards size={15} color={priceLabel !== "문의 필요" ? colors.rose[500] : colors.textTertiary} />
              <Text style={s.trustLabel}>가격</Text>
              <Text style={s.trustValue} numberOfLines={1}>{priceLabel}</Text>
            </View>
            <View style={s.trustDivider} />
            <View style={s.trustItem}>
              <CalendarCheck size={15} color={hasRegisteredProducts ? colors.gold.DEFAULT : colors.textTertiary} />
              <Text style={s.trustLabel}>상품</Text>
              <Text style={s.trustValue}>{hasRegisteredProducts ? `등록 ${item.product_count}개` : "등록 전"}</Text>
            </View>
          </View>

          {/* 설명 */}
          {item.description && (
            <Text style={s.description} numberOfLines={1}>{item.description}</Text>
          )}

          <View style={s.disclosureRow}>
            <Info size={13} color={colors.textTertiary} />
            <Text style={s.disclosureText} numberOfLines={2}>
              정보 많은 순은 등록 상태와 공개 가격·상품 항목만 비교해요. 평점은 등록 값이며 출처·최신성을 확인하지 않았어요.
            </Text>
            <StatusPill label={trustStatus.label} tone={trustStatus.tone} />
          </View>
        </View>
      </Pressable>
    );
  }

  function renderEmpty() {
    if (loading) return null;
    return (
      <EmptyState
        icon={
          <IconBadge tone="rose" size={64}>
            <Store size={34} color={colors.rose[500]} />
          </IconBadge>
        }
        title="조건에 맞는 업체가 없어요"
        description="다른 카테고리나 검색어를 시도해보세요"
      />
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <AppHeader
        title="업체 탐색"
        subtitle="공개 가격과 등록 정보를 먼저 봐요"
        onBack={() => router.back()}
      />

      {/* 검색바 */}
      <View style={s.searchBar}>
        <Search size={18} color={colors.textTertiary} />
        <TextInput
          style={s.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="업체명으로 검색하세요"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {/* 카테고리 필터 칩 */}
      <View style={s.filterRow}>
        <FlatList
          horizontal
          data={CATEGORY_FILTERS}
          keyExtractor={(item) => item.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20 }}
          renderItem={({ item: cat }) => (
            <Pressable
              style={[s.filterChip, selectedCategory === cat.key && s.filterChipActive]}
              onPress={() => setSelectedCategory(cat.key)}
            >
              <Text
                style={[
                  s.filterChipText,
                  selectedCategory === cat.key && s.filterChipTextActive,
                ]}
              >
                {cat.label}
              </Text>
            </Pressable>
          )}
        />
      </View>

      {/* 정렬 옵션 칩 */}
      <View style={s.sortRow}>
        <FlatList
          horizontal
          data={SORT_OPTIONS}
          keyExtractor={(item) => item.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20 }}
          renderItem={({ item: opt }) => (
            <Pressable
              style={[s.sortChip, selectedSort === opt.key && s.sortChipActive]}
              onPress={() => setSelectedSort(opt.key)}
            >
              <Text
                style={[
                  s.sortChipText,
                  selectedSort === opt.key && s.sortChipTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          )}
        />
      </View>

      {favoriteError && !loading && !error ? (
        <Pressable
          style={({ pressed }) => [s.favoriteWarning, pressed && s.favoriteWarningPressed]}
          onPress={loadFavorites}
          accessibilityRole="button"
          accessibilityLabel="저장된 즐겨찾기 다시 불러오기"
        >
          <AlertTriangle size={16} color={colors.danger} />
          <Text style={s.favoriteWarningText}>저장된 즐겨찾기를 불러오지 못했어요</Text>
          <Text style={s.favoriteWarningAction}>다시 시도</Text>
        </Pressable>
      ) : null}

      {!loading && !error && (
        <Surface style={s.trustPanel}>
          <View style={s.trustPanelTop}>
            <View style={s.trustPanelIcon}>
              <ShieldCheck size={18} color={colors.rose[500]} />
            </View>
            <View style={s.trustPanelCopy}>
              <Text style={s.trustPanelEyebrow}>INFORMATION FIRST</Text>
              <Text style={s.trustPanelTitle}>광고보다 공개된 정보를 먼저 봐요</Text>
              <Text style={s.trustPanelText}>
                정보 많은 순은 등록 상태와 공개 가격·상품 항목만 비교합니다. 품질, 최신 가격, 예약 가능 여부를 보증하지 않아요.
              </Text>
            </View>
            <StatusPill label="광고비 정렬 아님" tone="neutral" />
          </View>
          <View style={s.trustStatsRow}>
            <View style={s.trustStat}>
              <Text style={s.trustStatValue}>{verifiedCount}</Text>
              <Text style={s.trustStatLabel}>확인 표시</Text>
            </View>
            <View style={s.trustStat}>
              <Text style={s.trustStatValue}>{priceKnownCount}</Text>
              <Text style={s.trustStatLabel}>가격 공개</Text>
            </View>
            <View style={s.trustStat}>
              <Text style={s.trustStatValue}>{curatedCount}</Text>
              <Text style={s.trustStatLabel}>탐색 후보</Text>
            </View>
          </View>
        </Surface>
      )}

      {/* 업체 목록 */}
      {loading ? (
        <LoadingState label="업체 정보를 불러오고 있어요" />
      ) : error ? (
        <ErrorRetry
          message="업체 목록을 불러올 수 없어요"
          onRetry={() => { setLoading(true); loadVendors(); }}
        />
      ) : (
        <FlatList
          data={vendors}
          keyExtractor={(item) => item.id}
          renderItem={renderVendor}
          extraData={favoriteIds}
          contentContainerStyle={s.listContent}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={10}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={
            vendors.length > 0 ? (
              <View style={s.footerContainer}>
                <Text style={s.footerCount}>{vendors.length}개 업체</Text>
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadFavorites(); loadVendors(); }}
              tintColor={colors.rose[500]}
            />
          }
        />
      )}

    </SafeAreaView>
  );
}

/* ───── styles ───── */
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // 검색바
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.noir[800],
    padding: 0,
    fontFamily: "NotoSansKR_400Regular",
  },

  // 카테고리 필터
  filterRow: { marginBottom: 8 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.ivory[200],
    marginRight: 8,
  },
  filterChipActive: { backgroundColor: colors.noir[800] },
  filterChipText: { fontSize: 13, color: colors.textSecondary, fontFamily: "NotoSansKR_400Regular" },
  filterChipTextActive: { color: "#fff", fontWeight: "600" },

  // 정렬 옵션
  sortRow: { marginBottom: 12 },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: 8,
  },
  sortChipActive: {
    borderColor: colors.rose[500],
    backgroundColor: colors.rose.glow,
  },
  sortChipText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontFamily: "NotoSansKR_400Regular",
  },
  sortChipTextActive: {
    color: colors.rose[600],
    fontWeight: "600",
  },
  favoriteWarning: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "rgba(239, 68, 68, 0.08)",
  },
  favoriteWarningPressed: { opacity: 0.78 },
  favoriteWarningText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  favoriteWarningAction: {
    fontSize: 12,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.danger,
  },

  trustPanel: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 16,
  },
  trustPanelTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  trustPanelIcon: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.rose.glow,
  },
  trustPanelCopy: {
    flex: 1,
    gap: 2,
  },
  trustPanelEyebrow: {
    fontSize: 10,
    letterSpacing: 0,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textTertiary,
  },
  trustPanelTitle: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  trustPanelText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  trustStatsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },
  trustStat: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: colors.ivory[100],
    paddingVertical: 10,
    alignItems: "center",
    gap: 2,
  },
  trustStatValue: {
    fontSize: 20,
    lineHeight: 24,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: colors.noir[800],
  },
  trustStatLabel: {
    fontSize: 11,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },

  // 목록
  listContent: { padding: 20, paddingTop: 4, paddingBottom: 100 },

  // 카드
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    marginBottom: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  thumbnail: {
    width: "100%",
    height: 140,
    backgroundColor: colors.ivory[200],
  },
  thumbnailPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  imageBadges: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 54,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  imageBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  imageBadgeText: {
    fontSize: 11,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },

  // 즐겨찾기 하트 버튼
  heartBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },

  cardBody: {
    padding: 16,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  vendorName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "NotoSansKR_400Regular",
  },

  // 별점 배지
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginLeft: 2,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.gold.DEFAULT,
    fontFamily: "NotoSansKR_400Regular",
  },
  ratingTextNew: {
    color: colors.textTertiary,
    fontWeight: "400",
  },

  catBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: colors.rose.glow,
  },
  catBadgeText: { fontSize: 11, color: colors.rose[600], fontWeight: "600" },

  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8 },
  metaText: { fontSize: 12, color: colors.textTertiary, fontFamily: "NotoSansKR_400Regular" },

  // 스타일 태그
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.ivory[200],
  },
  tagText: { fontSize: 11, color: colors.textSecondary, fontFamily: "NotoSansKR_400Regular" },

  trustGrid: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: 14,
    backgroundColor: colors.ivory[100],
    paddingVertical: 10,
    marginBottom: 10,
  },
  trustItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 4,
  },
  trustDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  trustLabel: {
    fontSize: 10,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
  trustValue: {
    fontSize: 11,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    textAlign: "center",
  },

  description: {
    fontSize: 12,
    color: colors.textTertiary,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    marginBottom: 10,
  },
  disclosureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  disclosureText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },

  // 빈 상태
  emptyContainer: {
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.noir[800],
    marginBottom: 8,
    fontFamily: "NotoSansKR_400Regular",
  },
  emptyHint: {
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: "center",
    fontFamily: "NotoSansKR_400Regular",
  },

  // 푸터
  footerContainer: { alignItems: "center", paddingVertical: 16 },
  footerCount: { fontSize: 12, color: colors.textTertiary },

});
