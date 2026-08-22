import { useEffect, useState, type ReactNode } from "react";
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BookOpen, ImageOff, MapPin, Phone, Search } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import {
  getPlaceCardsModel,
  type PlaceCardModel,
  type PlaceSearchToolResult,
} from "./placeCardsModel";

function openExternal(url: string) {
  void Linking.openURL(url).catch(() => undefined);
}

function PlaceImage({ place, index }: { place: PlaceCardModel; index: number }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [place.imageUrl]);

  return (
    <View style={styles.imageFrame}>
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>{index + 1}</Text>
      </View>
      {place.imageUrl && !failed ? (
        <Image
          source={{ uri: place.imageUrl }}
          style={styles.image}
          resizeMode="cover"
          accessibilityLabel={`${place.name} 검색 사진`}
          onError={() => setFailed(true)}
        />
      ) : (
        <View
          style={styles.imageFallback}
          accessible
          accessibilityRole="image"
          accessibilityLabel={
            failed
              ? `${place.name} 사진을 불러오지 못했어요`
              : `${place.name} 사진 정보가 없어요`
          }
        >
          <ImageOff size={22} color={colors.textTertiary} />
          <Text style={styles.imageFallbackText}>
            {failed ? "사진 오류" : "사진 없음"}
          </Text>
        </View>
      )}
    </View>
  );
}

function ExternalAction({
  label,
  accessibilityLabel,
  url,
  icon,
}: {
  label: string;
  accessibilityLabel: string;
  url: string;
  icon: ReactNode;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="외부 브라우저에서 열립니다"
      onPress={() => openExternal(url)}
    >
      {icon}
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function PlaceCard({ place, index }: { place: PlaceCardModel; index: number }) {
  const primaryUrl = place.searchUrl ?? place.mapsUrl ?? place.blogSearchUrl;
  const actions = [
    place.searchUrl
      ? {
        key: "search",
        label: "네이버 검색",
        accessibilityLabel: `${place.name} 네이버 검색 열기`,
        url: place.searchUrl,
        icon: <Search size={15} color={colors.noir[800]} />,
      }
      : null,
    place.mapsUrl
      ? {
        key: "map",
        label: "지도",
        accessibilityLabel: `${place.name} 네이버 지도 열기`,
        url: place.mapsUrl,
        icon: <MapPin size={15} color={colors.noir[800]} />,
      }
      : null,
    place.blogSearchUrl
      ? {
        key: "blog",
        label: "블로그",
        accessibilityLabel: `${place.name} 네이버 블로그 검색 열기`,
        url: place.blogSearchUrl,
        icon: <BookOpen size={15} color={colors.noir[800]} />,
      }
      : null,
  ].filter((action): action is NonNullable<typeof action> => action !== null);

  return (
    <View style={styles.card}>
      <Pressable
        disabled={!primaryUrl}
        style={({ pressed }) => [styles.placeMain, pressed && styles.pressed]}
        accessibilityRole={primaryUrl ? "link" : undefined}
        accessibilityLabel={
          primaryUrl
            ? `${place.name} 네이버에서 바로 검색`
            : `${place.name} 장소 정보`
        }
        accessibilityHint={primaryUrl ? "외부 브라우저에서 열립니다" : undefined}
        onPress={() => {
          if (primaryUrl) openExternal(primaryUrl);
        }}
      >
        <PlaceImage place={place} index={index} />
        <View style={styles.placeDetails}>
          <Text style={styles.placeName} numberOfLines={2}>{place.name}</Text>
          <View style={styles.categoryPill}>
            <Text style={styles.categoryText} numberOfLines={1}>{place.category}</Text>
          </View>
          <View style={styles.addressRow}>
            <MapPin size={14} color={colors.textTertiary} />
            <Text style={styles.addressText} numberOfLines={3}>{place.address}</Text>
          </View>
          {place.description ? (
            <Text style={styles.descriptionText} numberOfLines={3}>{place.description}</Text>
          ) : null}
          {place.telephone ? (
            <View style={styles.detailRow}>
              <Phone size={13} color={colors.textTertiary} />
              <Text style={styles.detailText} numberOfLines={1}>전화 {place.telephone}</Text>
            </View>
          ) : null}
          {place.blogReviewCount !== null && place.blogReviewCount > 0 ? (
            <View style={styles.detailRow}>
              <BookOpen size={13} color={colors.textTertiary} />
              <Text style={styles.detailText}>블로그 검색 {place.blogReviewCount.toLocaleString()}건</Text>
            </View>
          ) : null}
          {place.blogSnippet ? (
            <Text style={styles.blogSnippetText} numberOfLines={2}>
              “{place.blogSnippet}”
            </Text>
          ) : null}
          {place.priceRange || place.hasPrivateRoom ? (
            <View style={styles.blogMentionRow}>
              <Text style={styles.blogMentionSource}>블로그 언급</Text>
              {place.priceRange ? (
                <Text style={styles.blogMentionText}>가격 {place.priceRange}</Text>
              ) : null}
              {place.hasPrivateRoom ? (
                <Text style={styles.blogMentionText}>룸 언급 있음</Text>
              ) : null}
            </View>
          ) : null}
          {place.priceRange || place.hasPrivateRoom ? (
            <Text style={styles.sourceNote}>
              가격·룸은 검색 문구 기반 참고 정보예요. 최신 정보는 매장에 확인해 주세요.
            </Text>
          ) : null}
          {primaryUrl ? <Text style={styles.tapHint}>눌러서 네이버에서 보기</Text> : null}
        </View>
      </Pressable>

      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <ExternalAction
              key={action.key}
              label={action.label}
              accessibilityLabel={action.accessibilityLabel}
              url={action.url}
              icon={action.icon}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function PlaceCards({ result }: { result: PlaceSearchToolResult }) {
  const model = getPlaceCardsModel(result);

  if (model.state === "handoff") {
    const primaryUrl = model.searchUrl ?? model.mapsUrl;
    return (
      <View style={styles.handoffCard} accessibilityLiveRegion="polite">
        <Pressable
          disabled={!primaryUrl}
          style={({ pressed }) => [styles.handoffMain, pressed && styles.pressed]}
          accessibilityRole={primaryUrl ? "link" : undefined}
          accessibilityLabel={`${model.query ?? "장소"} 네이버 검색에서 보기`}
          accessibilityHint="외부 브라우저에서 엽니다"
          onPress={() => {
            if (primaryUrl) openExternal(primaryUrl);
          }}
        >
          <View style={styles.handoffIcon}>
            <Search size={21} color="#218A00" />
          </View>
          <View style={styles.noticeCopy}>
            <Text style={styles.noticeTitle}>
              {model.query ? `‘${model.query}’ 네이버™에서 바로 보기` : "네이버™에서 바로 검색하기"}
            </Text>
            <Text style={styles.noticeText}>{model.message}</Text>
            <Text style={styles.handoffLink}>네이버 검색 열기</Text>
          </View>
        </Pressable>
        {model.mapsUrl ? (
          <ExternalAction
            label="네이버 지도에서 보기"
            accessibilityLabel={`${model.query ?? "장소"} 네이버 지도에서 보기`}
            url={model.mapsUrl}
            icon={<MapPin size={15} color={colors.noir[800]} />}
          />
        ) : null}
        <Text style={styles.trademarkNote}>네이버™는 NAVER®의 등록상표입니다.</Text>
      </View>
    );
  }

  if (model.state === "error") {
    return (
      <View
        style={[styles.notice, styles.errorNotice]}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        <MapPin size={20} color={colors.danger} />
        <View style={styles.noticeCopy}>
          <Text style={[styles.noticeTitle, styles.errorTitle]}>장소 검색을 완료하지 못했어요</Text>
          <Text style={styles.noticeText}>{model.message}</Text>
        </View>
      </View>
    );
  }

  if (model.state === "empty") {
    return (
      <View style={styles.notice} accessibilityLiveRegion="polite">
        <MapPin size={20} color={colors.rose[500]} />
        <View style={styles.noticeCopy}>
          <Text style={styles.noticeTitle}>검색된 장소가 없어요</Text>
          <Text style={styles.noticeText}>{model.message}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {model.query ? (
        <View style={styles.queryRow}>
          <MapPin size={15} color={colors.rose[500]} />
          <Text style={styles.queryText} numberOfLines={2}>
            ‘{model.query}’ 네이버™ 검색 결과
          </Text>
        </View>
      ) : null}
      {model.places.map((place, index) => (
        <PlaceCard key={place.id} place={place} index={index} />
      ))}
      <Text style={styles.providerNote}>
        장소 정보는 네이버 지역 검색, 사진은 네이버 이미지 검색 결과예요. 최신 정보는 네이버 또는 매장에 확인해 주세요. 네이버™는 NAVER®의 등록상표입니다.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10, marginTop: 8 },
  queryRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  queryText: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.textSecondary, fontWeight: "600" },
  providerNote: { paddingHorizontal: 4, fontSize: 10, lineHeight: 15, color: colors.textTertiary },
  card: { overflow: "hidden", borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  placeMain: { minHeight: 120, flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 12 },
  pressed: { opacity: 0.72 },
  imageFrame: { width: 94, height: 94, overflow: "hidden", borderRadius: 12, backgroundColor: colors.ivory[100] },
  image: { width: "100%", height: "100%" },
  imageFallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: 5, padding: 8 },
  imageFallbackText: { fontSize: 10, color: colors.textTertiary },
  rankBadge: { position: "absolute", left: 6, top: 6, zIndex: 1, minWidth: 24, height: 24, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: colors.surface },
  rankText: { fontSize: 12, color: colors.rose[500], fontWeight: "700" },
  placeDetails: { flex: 1, minWidth: 0 },
  placeName: { fontSize: 16, lineHeight: 22, color: colors.noir[800], fontWeight: "700" },
  categoryPill: { alignSelf: "flex-start", maxWidth: "100%", marginTop: 6, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.rose.glow },
  categoryText: { fontSize: 11, color: colors.rose[600], fontWeight: "600" },
  addressRow: { flexDirection: "row", alignItems: "flex-start", gap: 5, marginTop: 8 },
  addressText: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  blogSnippetText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    fontStyle: "italic",
  },
  descriptionText: { marginTop: 7, fontSize: 11, lineHeight: 17, color: colors.textSecondary },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  detailText: { flex: 1, fontSize: 11, lineHeight: 16, color: colors.textSecondary },
  blogMentionRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5, marginTop: 7 },
  blogMentionSource: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.ivory[200], fontSize: 10, color: colors.textTertiary, fontWeight: "600" },
  blogMentionText: { fontSize: 10, lineHeight: 15, color: colors.textSecondary },
  sourceNote: { marginTop: 4, fontSize: 10, lineHeight: 15, color: colors.textTertiary },
  tapHint: { marginTop: 6, fontSize: 10, color: colors.textTertiary },
  actions: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border },
  action: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 4, paddingVertical: 10 },
  actionText: { fontSize: 11, color: colors.noir[800], fontWeight: "600" },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 8, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  errorNotice: { borderColor: colors.rose.light, backgroundColor: colors.rose.glow },
  noticeCopy: { flex: 1 },
  noticeTitle: { fontSize: 14, lineHeight: 20, color: colors.noir[800], fontWeight: "700" },
  errorTitle: { color: colors.danger },
  noticeText: { marginTop: 3, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  handoffCard: { overflow: "hidden", marginTop: 8, borderRadius: 16, borderWidth: 1, borderColor: "#DCE8DA", backgroundColor: colors.surface },
  handoffMain: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14 },
  handoffIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: "rgba(45, 180, 0, 0.10)" },
  handoffLink: { marginTop: 7, fontSize: 12, lineHeight: 18, color: "#218A00", fontWeight: "700" },
  trademarkNote: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 12, paddingVertical: 7, fontSize: 9, lineHeight: 13, color: colors.textTertiary },
});
