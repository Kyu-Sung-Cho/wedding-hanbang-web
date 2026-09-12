import { StyleSheet, View, type StyleProp, type TextStyle } from "react-native";
import { Text } from "@/components/ui/AppText";
import { colors } from "@hanbang/design-tokens";
import { parseAmoraInline, parseAmoraMessageBody } from "../../lib/amoraMessageBody.mjs";

/** HTML/WebView나 원격 이미지를 실행하지 않는 본문 전용 렌더러. */
export function AmoraMessageBody({ content, textStyle }: { content: string; textStyle?: StyleProp<TextStyle> }) {
  const inline = (text: string) => parseAmoraInline(text).map((part, index) => (
    <Text key={index} style={part.type === "strong" ? styles.strong : part.type === "emphasis" ? styles.emphasis : undefined}>
      {part.text}{part.type === "link" ? ` (${part.href})` : ""}
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
  heading: { fontWeight: "700", fontSize: 18, lineHeight: 26 },
  quote: { borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: 12 },
  table: { gap: 0 },
  tableRow: { gap: 4, paddingVertical: 8 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
});
