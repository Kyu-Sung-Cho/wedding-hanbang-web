// 업체 탐색 화면 — 네이티브 업체 브라우징
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator,
  RefreshControl, TextInput, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  ArrowLeft, Search, Star, MapPin, ExternalLink, Store,
  DollarSign, Plus,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

const SITE_URL = "https://hanbang.ai";

/* ───── types ───── */
interface Vendor {
  id: string;
  name: string;
  category: string | null;
  region: string | null;
  rating: number | null;
  phone: string | null;
  address: string | null;
  description: string | null;
  price_range: string | null;
}

const CATEGORY_FILTERS = [
  "전체", "스튜디오", "드레스", "메이크업", "예식장", "스냅", "한복", "예물", "허니문",
];

/* ───── main screen ───── */
export default function VendorsScreen() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("전체");
  const [hasTable, setHasTable] = useState(true);

  const loadVendors = useCallback(async () => {
    try {
      let query = supabase
        .from("vendors")
        .select("*")
        .order("name");

      if (selectedCategory !== "전체") {
        query = query.eq("category", selectedCategory);
      }

      if (searchQuery.trim()) {
        query = query.ilike("name", `%${searchQuery.trim()}%`);
      }

      const { data, error } = await query;

      if (error) {
        // 테이블이 없는 경우
        if (error.code === "42P01" || error.message.includes("does not exist")) {
          setHasTable(false);
          setVendors([]);
          return;
        }
        console.error("업체 로드 오류:", error);
        return;
      }

      setHasTable(true);
      setVendors(
        (data ?? []).map((r: Record<string, unknown>) => ({
          id: String(r.id ?? ""),
          name: String(r.name ?? ""),
          category: r.category ? String(r.category) : null,
          region: r.region ? String(r.region) : null,
          rating: typeof r.rating === "number" ? r.rating : null,
          phone: r.phone ? String(r.phone) : null,
          address: r.address ? String(r.address) : null,
          description: r.description ? String(r.description) : null,
          price_range: r.price_range ? String(r.price_range) : null,
        }))
      );
    } catch (err) {
      console.error("업체 로드 오류:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchQuery, selectedCategory]);

  useEffect(() => { loadVendors(); }, [loadVendors]);

  function openVendorDetail(vendor: Vendor) {
    const url = `${SITE_URL}/vendors/${vendor.id}`;
    Linking.openURL(url).catch(() => {
      // 웹뷰 폴백 — 상세 정보 알림
      const info = [
        vendor.category ? `카테고리: ${vendor.category}` : null,
        vendor.region ? `지역: ${vendor.region}` : null,
        vendor.address ? `주소: ${vendor.address}` : null,
        vendor.phone ? `연락처: ${vendor.phone}` : null,
        vendor.rating ? `평점: ${vendor.rating}점` : null,
        vendor.price_range ? `가격대: ${vendor.price_range}` : null,
        vendor.description ? `\n${vendor.description}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      // fallback: 단순 정보 표시는 하지 않고 에러 무시
    });
  }

  function openWebVendors() {
    Linking.openURL(`${SITE_URL}/vendors`);
  }

  function openVendorRegister() {
    Linking.openURL(`${SITE_URL}/vendor/register`);
  }

  function renderStars(rating: number | null) {
    if (rating == null) return null;
    const full = Math.floor(rating);
    const stars: React.ReactNode[] = [];
    for (let i = 0; i < 5; i++) {
      stars.push(
        <Star
          key={i}
          size={12}
          color={i < full ? colors.gold.DEFAULT : colors.ivory[200]}
          fill={i < full ? colors.gold.DEFAULT : "transparent"}
        />
      );
    }
    return <View style={vstyles.stars}>{stars}</View>;
  }

  function renderVendor({ item }: { item: Vendor }) {
    return (
      <Pressable
        style={({ pressed }) => [
          vstyles.card,
          pressed && { transform: [{ scale: 0.98 }] },
        ]}
        onPress={() => openVendorDetail(item)}
      >
        <View style={vstyles.cardTop}>
          <Text style={vstyles.vendorName} numberOfLines={1}>{item.name}</Text>
          {item.category && (
            <View style={vstyles.catBadge}>
              <Text style={vstyles.catBadgeText}>{item.category}</Text>
            </View>
          )}
        </View>

        <View style={vstyles.cardMiddle}>
          {item.region && (
            <View style={vstyles.metaRow}>
              <MapPin size={13} color={colors.textTertiary} />
              <Text style={vstyles.metaText}>{item.region}</Text>
            </View>
          )}
          {item.price_range && (
            <View style={vstyles.metaRow}>
              <DollarSign size={13} color={colors.textTertiary} />
              <Text style={vstyles.metaText}>{item.price_range}</Text>
            </View>
          )}
        </View>

        <View style={vstyles.cardBottom}>
          <View style={vstyles.ratingRow}>
            {renderStars(item.rating)}
            {item.rating != null && (
              <Text style={vstyles.ratingText}>{item.rating.toFixed(1)}</Text>
            )}
          </View>
          <ExternalLink size={14} color={colors.textTertiary} />
        </View>

        {item.description && (
          <Text style={vstyles.description} numberOfLines={2}>{item.description}</Text>
        )}
      </Pressable>
    );
  }

  function renderEmpty() {
    if (loading) return null;

    if (!hasTable || vendors.length === 0) {
      return (
        <View style={vstyles.emptyContainer}>
          <View style={vstyles.emptyIconWrap}>
            <Store size={36} color={colors.rose[500]} />
          </View>
          <Text style={vstyles.emptyTitle}>
            {!hasTable
              ? "업체 정보가 준비 중이에요"
              : "검색 결과가 없어요"}
          </Text>
          <Text style={vstyles.emptyHint}>
            {!hasTable
              ? "웹에서 먼저 확인해보세요"
              : "다른 카테고리나 검색어를 시도해보세요"}
          </Text>
          {!hasTable && (
            <Pressable
              style={({ pressed }) => [
                vstyles.webLinkBtn,
                pressed && { transform: [{ scale: 0.97 }] },
              ]}
              onPress={openWebVendors}
            >
              <ExternalLink size={16} color="#fff" />
              <Text style={vstyles.webLinkBtnText}>웹에서 확인하기</Text>
            </Pressable>
          )}
        </View>
      );
    }

    return null;
  }

  function renderFooter() {
    if (vendors.length === 0) return null;
    return (
      <View style={vstyles.footerContainer}>
        <Text style={vstyles.footerCount}>
          {vendors.length}개 업체
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={vstyles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={vstyles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={vstyles.headerTitle}>업체 탐색</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* 검색바 */}
      <View style={vstyles.searchBar}>
        <Search size={18} color={colors.textTertiary} />
        <TextInput
          style={vstyles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="업체명으로 검색하세요"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {/* 카테고리 필터 칩 */}
      <View style={vstyles.filterRow}>
        <FlatList
          horizontal
          data={CATEGORY_FILTERS}
          keyExtractor={(item) => item}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20 }}
          renderItem={({ item: cat }) => (
            <Pressable
              style={[vstyles.filterChip, selectedCategory === cat && vstyles.filterChipActive]}
              onPress={() => setSelectedCategory(cat)}
            >
              <Text
                style={[
                  vstyles.filterChipText,
                  selectedCategory === cat && vstyles.filterChipTextActive,
                ]}
              >
                {cat}
              </Text>
            </Pressable>
          )}
        />
      </View>

      {/* 업체 목록 */}
      {loading ? (
        <ActivityIndicator color={colors.rose[500]} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={vendors}
          keyExtractor={(item) => item.id}
          renderItem={renderVendor}
          contentContainerStyle={vstyles.listContent}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadVendors(); }}
              tintColor={colors.rose[500]}
            />
          }
        />
      )}

      {/* 하단 업체 등록 버튼 */}
      <View style={vstyles.bottomBar}>
        <Pressable
          style={({ pressed }) => [
            vstyles.registerBtn,
            pressed && { transform: [{ scale: 0.97 }] },
          ]}
          onPress={openVendorRegister}
        >
          <Plus size={18} color={colors.rose[500]} />
          <Text style={vstyles.registerBtnText}>업체 등록하기</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const vstyles = StyleSheet.create({
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
  },

  // 카테고리 필터
  filterRow: { marginBottom: 12 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.ivory[200],
    marginRight: 8,
  },
  filterChipActive: { backgroundColor: colors.noir[800] },
  filterChipText: { fontSize: 13, color: colors.textSecondary },
  filterChipTextActive: { color: "#fff", fontWeight: "600" },

  // 목록
  listContent: { padding: 20, paddingTop: 4, paddingBottom: 100 },

  // 카드
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  vendorName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    flex: 1,
    marginRight: 8,
  },
  catBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: colors.rose.glow,
  },
  catBadgeText: { fontSize: 11, color: colors.rose[600], fontWeight: "600" },

  cardMiddle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 8,
  },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, color: colors.textTertiary },
  stars: { flexDirection: "row", gap: 2 },
  ratingText: { fontSize: 13, fontWeight: "700", color: colors.gold.DEFAULT },
  description: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 10,
    lineHeight: 18,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
  },
  emptyHint: {
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: "center",
    marginBottom: 20,
  },
  webLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.rose[500],
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  webLinkBtnText: { fontSize: 14, fontWeight: "600", color: "#fff" },

  // 푸터
  footerContainer: {
    alignItems: "center",
    paddingVertical: 16,
  },
  footerCount: {
    fontSize: 12,
    color: colors.textTertiary,
  },

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
  },
});
