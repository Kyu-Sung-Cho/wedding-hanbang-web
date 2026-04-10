// 업체 탐색 화면
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator,
  RefreshControl, TextInput, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, Search, Star, MapPin } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

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
        // 테이블 없는 경우
        if (error.code === "42P01" || error.message.includes("does not exist")) {
          setHasTable(false);
          setVendors([]);
          return;
        }
        console.error("Vendors load error:", error);
        return;
      }

      setHasTable(true);
      setVendors(
        (data ?? []).map((r) => ({
          id: r.id,
          name: r.name ?? "",
          category: r.category ?? null,
          region: r.region ?? null,
          rating: r.rating ?? null,
          phone: r.phone ?? null,
          address: r.address ?? null,
          description: r.description ?? null,
        }))
      );
    } catch (err) {
      console.error("Vendors load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchQuery, selectedCategory]);

  useEffect(() => { loadVendors(); }, [loadVendors]);

  function showVendorDetail(vendor: Vendor) {
    const info = [
      vendor.category ? `카테고리: ${vendor.category}` : null,
      vendor.region ? `지역: ${vendor.region}` : null,
      vendor.address ? `주소: ${vendor.address}` : null,
      vendor.phone ? `연락처: ${vendor.phone}` : null,
      vendor.rating ? `평점: ${vendor.rating}점` : null,
      vendor.description ? `\n${vendor.description}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    Alert.alert(vendor.name, info || "상세 정보가 없어요");
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
        style={({ pressed }) => [vstyles.card, pressed && { opacity: 0.85 }]}
        onPress={() => showVendorDetail(item)}
      >
        <View style={vstyles.cardTop}>
          <Text style={vstyles.vendorName}>{item.name}</Text>
          {item.category && (
            <View style={vstyles.catBadge}>
              <Text style={vstyles.catBadgeText}>{item.category}</Text>
            </View>
          )}
        </View>
        <View style={vstyles.cardBottom}>
          {item.region && (
            <View style={vstyles.metaRow}>
              <MapPin size={12} color={colors.textTertiary} />
              <Text style={vstyles.metaText}>{item.region}</Text>
            </View>
          )}
          {renderStars(item.rating)}
          {item.rating != null && (
            <Text style={vstyles.ratingText}>{item.rating.toFixed(1)}</Text>
          )}
        </View>
        {item.description && (
          <Text style={vstyles.description} numberOfLines={2}>{item.description}</Text>
        )}
      </Pressable>
    );
  }

  function renderEmpty() {
    if (loading) return null;
    if (!hasTable) {
      return (
        <View style={vstyles.emptyContainer}>
          <Text style={vstyles.emptyText}>업체 정보가 곧 추가될 예정이에요</Text>
        </View>
      );
    }
    return (
      <View style={vstyles.emptyContainer}>
        <Text style={vstyles.emptyText}>등록된 업체가 없어요</Text>
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
          placeholder="업체명 검색"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="search"
        />
      </View>

      {/* 카테고리 필터 */}
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadVendors(); }}
              tintColor={colors.rose[500]}
            />
          }
        />
      )}
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
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.noir[800] },

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
  filterChipTextActive: { color: "#fff" },

  // 목록
  listContent: { padding: 20, paddingTop: 4, paddingBottom: 40 },

  // 카드
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  vendorName: { fontSize: 16, fontWeight: "600", color: colors.noir[800], flex: 1 },
  catBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: colors.ivory[200],
  },
  catBadgeText: { fontSize: 11, color: colors.textSecondary, fontWeight: "500" },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, color: colors.textTertiary },
  stars: { flexDirection: "row", gap: 2 },
  ratingText: { fontSize: 12, fontWeight: "600", color: colors.gold.DEFAULT },
  description: { fontSize: 12, color: colors.textTertiary, marginTop: 8, lineHeight: 18 },

  // 빈 상태
  emptyContainer: { alignItems: "center", paddingTop: 80 },
  emptyText: { fontSize: 16, fontWeight: "500", color: colors.textTertiary },
});
