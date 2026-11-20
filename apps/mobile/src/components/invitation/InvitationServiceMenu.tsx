import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { palette, typo } from "./invitationStyle";

/**
 * 청첩장 홈 맨 아래 "서비스 메뉴" 줄(2026-11-20 파운더 결정 4). 웹 청첩장 홈의 맨 아래 줄(`LiveFooter`)처럼 13px 글자
 * 링크를 한 줄에 늘어놓고, 넘치면 다음 줄로 넘긴다. 칸 사이는 가로 16·세로 4, 한 칸은 누르기 쉽게 높이 44px 이다.
 * 어느 화면을 여는지는 부르는 쪽(라운지)이 정한다. 이 부품은 이름과 누름만 안다.
 */
export default function InvitationServiceMenu<H extends string>({
  label,
  items,
  onOpen,
}: {
  /** 줄 전체의 이름. 웹 `nav aria-label` 과 같은 말이다. */
  label: string;
  items: readonly { readonly href: H; readonly label: string }[];
  onOpen: (href: H) => void;
}) {
  return (
    <View role="navigation" aria-label={label} style={styles.row}>
      {items.map((item) => (
        <Pressable key={item.href} onPress={() => onOpen(item.href)} accessibilityRole="link" style={styles.link}>
          {({ pressed }) => (
            <Text style={[typo.sans, styles.text, pressed && styles.pressed]}>{item.label}</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4 },
  link: { minHeight: 44, justifyContent: "center" },
  text: { fontSize: 13, color: palette.body },
  // 웹은 마우스를 올리면 먹색에 밑줄이다. 앱은 누르는 동안 같은 모양을 보인다.
  pressed: { color: palette.ink, textDecorationLine: "underline" },
});
