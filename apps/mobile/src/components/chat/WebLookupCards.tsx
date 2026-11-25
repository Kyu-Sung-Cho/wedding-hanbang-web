import { Linking, Pressable, StyleSheet, View } from "react-native";
import { ExternalLink, Globe, Search } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import {
  getWebLookupPageCard,
  getWebLookupSearchCard,
  WEB_LOOKUP_COPY,
} from "@hanbang/shared/web-lookup-presentation";
import { Text } from "@/components/ui/AppText";

/** `app/(tabs)/chat.tsx` 의 도구 결과와 같은 모양(그 파일 안에만 선언돼 있다). */
interface ToolExecutionResult {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: Record<string, unknown>;
  success: boolean;
  displayMessage: string;
}

/**
 * 찾아보기 카드(앱). 칸과 문장은 웹 카드와 같은 `@hanbang/shared/web-lookup-presentation` 이 정한다.
 * 검색 결과는 네이버 순서 그대로이고 순위 번호·별점·후기를 붙이지 않는다(D-85, D-14 조건).
 */

function openExternal(url: string) {
  void Linking.openURL(url).catch(() => undefined);
}

function Notice({ icon, title, body }: { icon: "search" | "page"; title: string; body: string }) {
  const Icon = icon === "search" ? Search : Globe;
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <Icon size={20} color={colors.rose[500]} />
      <View style={styles.noticeCopy}>
        <Text style={styles.noticeTitle}>{title}</Text>
        <Text style={styles.noticeText}>{body}</Text>
      </View>
    </View>
  );
}

function LinkButton({ label, url, accessibilityLabel }: { label: string; url: string; accessibilityLabel: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      onPress={() => openExternal(url)}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Text style={styles.linkText} numberOfLines={1}>{label}</Text>
      <ExternalLink size={13} color={colors.rose[700]} />
    </Pressable>
  );
}

export function WebLookupSearchCard({ result }: { result: ToolExecutionResult }) {
  const card = getWebLookupSearchCard(result.toolOutput, result.success);
  if (!card) return null;
  if (card.kind !== "results") return <Notice icon="search" title={card.title} body={card.body} />;
  const { columns } = WEB_LOOKUP_COPY;
  return (
    <View style={styles.card} accessibilityLabel={card.title}>
      <View style={styles.header}>
        <Search size={18} color={colors.rose[500]} />
        <View style={styles.noticeCopy}>
          <Text style={styles.noticeTitle}>{card.title}</Text>
          <Text style={styles.caption}>{card.subtitle}</Text>
        </View>
      </View>
      <View style={[styles.row, styles.headRow]}>
        <Text style={[styles.headCell, styles.nameCol]}>{columns.name}</Text>
        <Text style={[styles.headCell, styles.areaCol]}>{columns.area}</Text>
        <Text style={[styles.headCell, styles.pageCol]}>{columns.page}</Text>
      </View>
      {card.rows.map((row) => (
        <View key={row.ref || row.name} style={styles.row}>
          <View style={styles.nameCol}>
            <Text style={styles.name}>{row.name}</Text>
            {row.category || row.telephone ? (
              <Text style={styles.caption}>{[row.category, row.telephone].filter(Boolean).join(" · ")}</Text>
            ) : null}
          </View>
          <Text style={[styles.cell, styles.areaCol]}>{row.area ?? "-"}</Text>
          <View style={styles.pageCol}>
            {row.href ? (
              <LinkButton label={row.hrefLabel ?? columns.page} url={row.href} accessibilityLabel={`${row.name} ${columns.page} 열기`} />
            ) : (
              <Text style={styles.cell}>-</Text>
            )}
            {row.href && !row.readable ? <Text style={styles.caption}>{WEB_LOOKUP_COPY.linkOnly}</Text> : null}
          </View>
        </View>
      ))}
      <View style={styles.footer}>
        <Text style={styles.caption}>{WEB_LOOKUP_COPY.verifyNote}</Text>
        <View style={styles.sourceRow}>
          <Text style={styles.caption}>출처: {WEB_LOOKUP_COPY.sourceName}</Text>
          {card.naverHref ? (
            <LinkButton label={WEB_LOOKUP_COPY.openNaver} url={card.naverHref} accessibilityLabel={WEB_LOOKUP_COPY.openNaver} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function WebLookupPageCard({ result }: { result: ToolExecutionResult }) {
  const card = getWebLookupPageCard(result.toolOutput, result.success);
  if (!card) return null;
  if (card.kind === "failed") return <Notice icon="page" title={card.title} body={card.body} />;
  const { columns } = WEB_LOOKUP_COPY;
  return (
    <View style={styles.card} accessibilityLabel={card.title}>
      <View style={styles.header}>
        <Globe size={18} color={colors.rose[500]} />
        <View style={styles.noticeCopy}>
          <Text style={styles.noticeTitle}>{card.title}</Text>
          {card.pageTitle ? <Text style={styles.noticeText} numberOfLines={1}>{card.pageTitle}</Text> : null}
          {card.subtitle ? <Text style={styles.caption}>{card.subtitle}</Text> : null}
        </View>
      </View>
      <View style={[styles.row, styles.headRow]}>
        <Text style={[styles.headCell, styles.itemCol]}>{columns.item}</Text>
        <Text style={[styles.headCell, styles.priceCol]}>{columns.price}</Text>
      </View>
      {card.priceCell ? (
        <View style={styles.row}>
          <Text style={[styles.cell, styles.itemCol]}>{columns.price}</Text>
          <Text style={[styles.name, styles.priceCol]}>{card.priceCell}</Text>
        </View>
      ) : card.prices.map((price, index) => (
        <View key={`${price.label}-${price.amount}-${index}`} style={styles.row}>
          <Text style={[styles.cell, styles.itemCol]}>{price.label}</Text>
          <View style={styles.priceCol}>
            <Text style={styles.name}>{price.amount}</Text>
            {price.quote ? <Text style={styles.caption}>{price.quote}</Text> : null}
          </View>
        </View>
      ))}
      <View style={styles.footer}>
        <Text style={styles.caption}>{card.note}</Text>
        {card.href ? (
          <LinkButton label={WEB_LOOKUP_COPY.openPage} url={card.href} accessibilityLabel={`${card.domain ?? ""} ${WEB_LOOKUP_COPY.openPage}`.trim()} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden", marginTop: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, paddingBottom: 10 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border },
  headRow: { backgroundColor: colors.ivory[100], paddingVertical: 6 },
  headCell: { fontSize: 11, color: colors.textSecondary, fontWeight: "600" },
  nameCol: { flex: 5 },
  areaCol: { flex: 2 },
  pageCol: { flex: 4 },
  itemCol: { flex: 4 },
  priceCol: { flex: 5 },
  name: { fontSize: 13, lineHeight: 19, color: colors.noir[800], fontWeight: "700" },
  cell: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  caption: { marginTop: 2, fontSize: 11, lineHeight: 16, color: colors.paper.inkFaint },
  link: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 },
  linkText: { flexShrink: 1, fontSize: 12, color: colors.rose[700], fontWeight: "600" },
  pressed: { opacity: 0.72 },
  footer: { gap: 4, paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.ivory[100] },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 8, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  noticeCopy: { flex: 1 },
  noticeTitle: { fontSize: 14, lineHeight: 20, color: colors.noir[800], fontWeight: "700" },
  noticeText: { marginTop: 3, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
});
