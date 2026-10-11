import type { ReactNode } from "react";
import { Alert, Linking, StyleSheet, View, type StyleProp, type TextStyle } from "react-native";
import { Text } from "@/components/ui/AppText";
import { colors } from "@hanbang/design-tokens";
import { parseAmoraInline, parseAmoraMessageBody } from "../../lib/amoraMessageBody.mjs";
import { buildMobileSiteUrl, resolveMobileSiteOrigin } from "../../lib/siteUrl.mjs";

async function openReference(href: string) {
  try {
    const url = href.startsWith("/")
      ? buildMobileSiteUrl(href, resolveMobileSiteOrigin(process.env.EXPO_PUBLIC_SITE_URL, { isDevelopment: __DEV__ }))
      : href;
    await Linking.openURL(url);
  } catch {
    Alert.alert("링크를 열지 못했어요", "인터넷 연결을 확인한 뒤 링크를 다시 눌러 주세요. 문제가 계속되면 아모라에게 다른 출처를 요청해 주세요.");
  }
}

/** HTML/WebView나 원격 이미지를 실행하지 않는 본문 전용 렌더러. */
export function AmoraMessageBody({ content, textStyle }: { content: string; textStyle?: StyleProp<TextStyle> }) {
  const inline = (text: string, depth = 0, allowLinks = true): ReactNode[] => parseAmoraInline(text).map((part, index) => (
    <Text
      key={index}
      style={part.type === "link" && allowLinks ? styles.link : part.type === "strong" ? styles.strong : part.type === "emphasis" ? styles.emphasis : undefined}
      accessibilityRole={part.type === "link" && allowLinks ? "link" : undefined}
      accessibilityHint={part.type === "link" && allowLinks ? "누르면 해당 자료를 열어요" : undefined}
      onPress={part.type === "link" && allowLinks ? () => openReference(part.href) : undefined}
    >
      {depth < 16 && (part.type === "strong" || part.type === "emphasis")
        ? inline(part.text, depth + 1, allowLinks)
        : depth < 16 && part.type === "link" && allowLinks ? inline(part.text, depth + 1, false) : part.text}
    </Text>
  ));
  return (
    <View style={styles.body}>
      {parseAmoraMessageBody(content).map((block, index) => {
        if (block.type === "table") return (
          <View key={index} style={styles.table} accessibilityLabel="표">
            {block.rows.length === 0 && <Text selectable style={[textStyle, styles.strong]}>{block.headers.join(" · ")}</Text>}
            {block.rows.map((row, rowIndex) => (
              <View key={rowIndex} style={[styles.tableRow, rowIndex > 0 && styles.divider]}>
                {row.map((cell, cellIndex) => (
                  <Text key={cellIndex} selectable style={textStyle}>
                    <Text style={styles.strong}>{inline(block.headers[cellIndex])}: </Text>{inline(cell)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        );
        if (block.type === "quote") return (
          <View key={index} style={styles.quote}>
            <Text selectable style={textStyle}>{inline(block.text)}</Text>
          </View>
        );
        return <Text key={index} selectable style={[textStyle, block.type === "heading" && styles.heading]}>
          {block.type === "list" ? `${block.marker === "-" || block.marker === "*" || block.marker === "+" ? "•" : block.marker} ` : ""}
          {block.type === "code" ? block.text : inline(block.text)}
        </Text>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10, flexShrink: 1, minWidth: 0 },
  strong: { fontWeight: "700" },
  emphasis: { fontStyle: "italic" },
  link: { color: colors.paper.penDeep, textDecorationLine: "underline" },
  heading: { fontWeight: "700", fontSize: 18, lineHeight: 26 },
  quote: { borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: 12 },
  table: { gap: 0 },
  tableRow: { gap: 4, paddingVertical: 8 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
});
