// 업체 탐색 화면 — Supabase 데이터 기반 업체 브라우징
// 정렬, 즐겨찾기, 별점 표시 포함
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator,
  RefreshControl, TextInput, Linking, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  ArrowLeft, Search, MapPin, Store, Plus, BadgeCheck, Star, Heart,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import ErrorRetry from "@/components/ErrorRetry";

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
  rating: number | null;
  min_price: number | null;
  created_at: string | null;
}

type SortKey = "recommended" | "popular" | "newest" | "price_asc";

interface SortOption {
  key: SortKey;
  label: string;
}

const SORT_OPTIONS: SortOption[] = [
  { key: "recommended", label: "추천순" },
  { key: "popular", label: "인기순" },
  { key: "newest", label: "최신순" },
  { key: "price_asc", label: "가격낮은순" },
];

const CATEGORY_FILTERS = [
  "전체", "스튜디오", "드레스", "메이크업", "예식장", "스냅", "한복", "예물", "허니문",
];

/* ───── main screen ───── */
export default function VendorsScreen() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("전체");
  const [selectedSort, setSelectedSort] = useState<SortKey>("recommended");

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
      const { data } = await supabase
        .from("favorites")
        .select("vendor_id")
        .eq("user_id", userId);
      if (data) {
        setFavoriteIds(new Set(data.map((r) => r.vendor_id)));
      }
    } catch (err) {
      console.error("즐겨찾기 로드 오류:", err);
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
      if (isFav) {
        await supabase
          .from("favorites")
          .delete()
          .eq("user_id", userId)
          .eq("vendor_id", vendorId);
      } else {
        await supabase
          .from("favorites")
          .insert({ user_id: userId, vendor_id: vendorId });
      }
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
        .select("id, name, category, region, description, style_tags, business_hours, status, website, thumbnail_url, is_verified, rating, created_at, vendor_products(price)");

      if (selectedCategory !== "전체") {
        query = query.eq("category", selectedCategory);
      }

      if (searchQuery.trim()) {
        query = query.ilike("name", `%${searchQuery.trim()}%`);
      }

      // 정렬 적용
      switch (selectedSort) {
        case "popular":
          query = query.order("rating", { ascending: false, nullsFirst: false });
          break;
        case "newest":
          query = query.order("created_at", { ascending: false });
          break;
        case "recommended":
        case "price_asc":
        default:
          // 추천순/가격순은 name으로 가져온 뒤 클라이언트 정렬
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

      let mapped = (data ?? []).map((r: Record<string, unknown>) => {
        // 상품 최소 가격 계산
        const products = Array.isArray(r.vendor_products) ? r.vendor_products as Array<{ price: number }> : [];
        const prices = products.map((p) => p.price).filter((p) => typeof p === "number" && p > 0);
        const minPrice = prices.length > 0 ? Math.min(...prices) : null;

        return {
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
          rating: typeof r.rating === "number" ? r.rating : null,
          min_price: minPrice,
          created_at: r.created_at ? String(r.created_at) : null,
        };
      });

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

  function openVendorRegister() {
    Linking.openURL("https://hanbang.ai/vendor/register");
  }

  function renderVendor({ item }: { item: Vendor }) {
    const isFav = favoriteIds.has(item.id);

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
              {item.is_verified && (
                <BadgeCheck size={16} color={colors.rose[500]} />
              )}
              {/* 별점 표시 */}
              <View style={s.ratingBadge}>
                <Star
                  size={12}
                  color={item.rating ? colors.gold.DEFAULT : colors.textTertiary}
                  fill={item.rating ? colors.gold.DEFAULT : "transparent"}
                />
                <Text style={[s.ratingText, !item.rating && s.ratingTextNew]}>
                  {item.rating ? item.rating.toFixed(1) : "신규"}
                </Text>
              </View>
            </View>
            {item.category && (
              <View style={s.catBadge}>
                <Text style={s.catBadgeText}>{item.category}</Text>
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

          {/* 설명 */}
          {item.description && (
            <Text style={s.description} numberOfLines={1}>{item.description}</Text>
          )}
        </View>
      </Pressable>
    );
  }

  function renderEmpty() {
    if (loading) return null;
    return (
      <View style={s.emptyContainer}>
        <View style={s.emptyIconWrap}>
          <Store size={36} color={colors.rose[500]} />
        </View>
        <Text style={s.emptyTitle}>등록된 업체가 없어요</Text>
        <Text style={s.emptyHint}>다른 카테고리나 검색어를 시도해보세요</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={s.headerTitle}>업체 탐색</Text>
        <View style={{ width: 24 }} />
      </View>

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
          keyExtractor={(item) => item}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20 }}
          renderItem={({ item: cat }) => (
            <Pressable
              style={[s.filterChip, selectedCategory === cat && s.filterChipActive]}
              onPress={() => setSelectedCategory(cat)}
            >
              <Text
                style={[
                  s.filterChipText,
                  selectedCategory === cat && s.filterChipTextActive,
                ]}
              >
                {cat}
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

      {/* 업체 목록 */}
      {loading ? (
        <ActivityIndicator color={colors.rose[500]} style={{ marginTop: 40 }} />
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

      {/* 하단 업체 등록 버튼 */}
      <View style={s.bottomBar}>
        <Pressable
          style={({ pressed }) => [
            s.registerBtn,
            pressed && { transform: [{ scale: 0.97 }] },
          ]}
          onPress={openVendorRegister}
        >
          <Plus size={18} color={colors.rose[500]} />
          <Text style={s.registerBtnText}>업체 등록하기</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/* ───── styles ───── */
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  },

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

  description: {
    fontSize: 12,
    color: colors.textTertiary,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
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

  // 하단 업체 등록 바
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 20,
    paddingVertical: 12,
    paddingBottom: 32,
  },
  registerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.rose[500],
    backgroundColor: colors.surface,
  },
  registerBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.rose[500],
    fontFamily: "NotoSansKR_400Regular",
  },
});
