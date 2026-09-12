import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Text } from "@/components/ui/AppText";
import { ArrowLeft, ChevronRight } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

export const appShadow = {
  shadowColor: colors.stone[900],
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.08,
  shadowRadius: 22,
  elevation: 3,
};

type TextVariant =
  | "eyebrow"
  | "title"
  | "subtitle"
  | "body"
  | "bodyStrong"
  | "caption"
  | "number";

export function AppText({
  children,
  variant = "body",
  style,
  numberOfLines,
}: {
  children: ReactNode;
  variant?: TextVariant;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  return (
    <Text style={[textStyles[variant], style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Surface({
  children,
  tone = "default",
  style,
}: {
  children: ReactNode;
  tone?: "default" | "noir" | "ivory" | "rose";
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[surfaceStyles.base, surfaceStyles[tone], style]}>
      {children}
    </View>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <View style={sectionStyles.header}>
      <View style={sectionStyles.titleBlock}>
        {eyebrow ? <AppText variant="eyebrow">{eyebrow}</AppText> : null}
        <AppText variant="subtitle">{title}</AppText>
      </View>
      {action}
    </View>
  );
}

export function AppHeader({
  title,
  subtitle,
  onBack,
  right,
  sideWidth = 40,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  sideWidth?: number;
}) {
  return (
    <View style={headerStyles.container}>
      <Pressable
        style={[headerStyles.sideButton, { width: sideWidth }]}
        onPress={onBack}
        disabled={!onBack}
        hitSlop={12}
        accessibilityRole={onBack ? "button" : undefined}
        accessibilityLabel="뒤로 가기"
      >
        {onBack ? <ArrowLeft size={22} color={colors.noir[800]} /> : null}
      </Pressable>
      <View style={headerStyles.titleBlock}>
        <AppText variant="subtitle" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={[headerStyles.sideButton, { width: sideWidth }]}>{right}</View>
    </View>
  );
}

export function LoadingState({ label = "불러오는 중이에요" }: { label?: string }) {
  return (
    <View style={loadingStyles.container}>
      <ActivityIndicator color={colors.rose[500]} />
      <AppText variant="caption" style={loadingStyles.label}>
        {label}
      </AppText>
    </View>
  );
}

export function IconBadge({
  children,
  tone = "rose",
  size = 40,
}: {
  children: ReactNode;
  tone?: "noir" | "rose" | "ivory" | "gold";
  size?: number;
}) {
  return (
    <View
      style={[
        badgeStyles.base,
        badgeStyles[tone],
        { width: size, height: size, borderRadius: Math.min(radius.xl, size / 2.8) },
      ]}
    >
      {children}
    </View>
  );
}

export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "rose" | "success" | "warning" | "danger";
}) {
  return (
    <View style={[pillStyles.base, pillStyles[tone]]}>
      <AppText variant="caption" style={pillTextStyles[tone]}>
        {label}
      </AppText>
    </View>
  );
}

export function ActionRow({
  icon,
  title,
  description,
  onPress,
  right,
  disabled,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  onPress?: PressableProps["onPress"];
  right?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        rowStyles.row,
        pressed && !disabled && rowStyles.rowPressed,
        disabled && rowStyles.rowDisabled,
      ]}
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole={onPress ? "button" : undefined}
    >
      {icon ? <View style={rowStyles.iconSlot}>{icon}</View> : null}
      <View style={rowStyles.textBlock}>
        <AppText variant="bodyStrong">{title}</AppText>
        {description ? (
          <AppText variant="caption" style={rowStyles.description}>
            {description}
          </AppText>
        ) : null}
      </View>
      {right ?? <ChevronRight size={16} color={colors.textTertiary} />}
    </Pressable>
  );
}

export function PrimaryButton({
  children,
  icon,
  tone = "noir",
  style,
  ...props
}: PressableProps & {
  children: ReactNode;
  icon?: ReactNode;
  tone?: "noir" | "rose" | "ghost";
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [
        buttonStyles.base,
        buttonStyles[tone],
        pressed && buttonStyles.pressed,
        props.disabled && buttonStyles.disabled,
        style,
      ]}
      accessibilityRole="button"
    >
      {icon}
      <AppText
        variant="bodyStrong"
        style={tone === "ghost" ? buttonStyles.ghostText : buttonStyles.solidText}
      >
        {children}
      </AppText>
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <View style={emptyStyles.container}>
      {icon ? <View style={emptyStyles.icon}>{icon}</View> : null}
      <AppText variant="subtitle" style={emptyStyles.title}>
        {title}
      </AppText>
      {description ? (
        <AppText variant="body" style={emptyStyles.description}>
          {description}
        </AppText>
      ) : null}
      {action}
    </View>
  );
}

const textStyles = StyleSheet.create({
  eyebrow: {
    fontSize: 11,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textTertiary,
  },
  title: {
    fontSize: 30,
    lineHeight: 38,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
  },
  subtitle: {
    fontSize: 18,
    lineHeight: 26,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  body: {
    fontSize: 15,
    lineHeight: 23,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  bodyStrong: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  caption: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
  number: {
    fontSize: 44,
    lineHeight: 50,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: colors.noir[800],
  },
});

const surfaceStyles = StyleSheet.create({
  base: {
    borderRadius: radius["2xl"],
    padding: spacing[5],
    borderWidth: 1,
    borderColor: colors.border,
    ...appShadow,
  },
  default: {
    backgroundColor: colors.surface,
  },
  noir: {
    backgroundColor: colors.noir[800],
    borderColor: colors.noir.soft,
  },
  ivory: {
    backgroundColor: colors.ivory[100],
    borderColor: colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  rose: {
    backgroundColor: colors.rose.glow,
    borderColor: colors.rose.pale,
    shadowOpacity: 0,
    elevation: 0,
  },
});

const sectionStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  titleBlock: {
    gap: spacing[1],
  },
});

const headerStyles = StyleSheet.create({
  container: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sideButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[8],
  },
  label: {
    textAlign: "center",
  },
});

const badgeStyles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
  noir: {
    backgroundColor: colors.noir[800],
  },
  rose: {
    backgroundColor: colors.rose.glow,
  },
  ivory: {
    backgroundColor: colors.ivory[200],
  },
  gold: {
    backgroundColor: colors.gold.light,
  },
});

const pillStyles = StyleSheet.create({
  base: {
    borderRadius: radius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
  },
  neutral: {
    backgroundColor: colors.ivory[200],
  },
  rose: {
    backgroundColor: colors.rose.glow,
  },
  success: {
    backgroundColor: "rgba(34, 197, 94, 0.12)",
  },
  warning: {
    backgroundColor: "rgba(201, 169, 110, 0.18)",
  },
  danger: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
});

const pillTextStyles = StyleSheet.create({
  neutral: {
    color: colors.textSecondary,
  },
  rose: {
    color: colors.rose[600],
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: "#8A6A28",
  },
  danger: {
    color: colors.danger,
  },
});

const rowStyles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[3],
  },
  rowPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  rowDisabled: {
    opacity: 0.5,
  },
  iconSlot: {
    width: 36,
    alignItems: "center",
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  description: {
    color: colors.textSecondary,
  },
});

const buttonStyles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radius.xl,
    paddingHorizontal: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
  },
  noir: {
    backgroundColor: colors.noir[800],
  },
  rose: {
    backgroundColor: colors.rose[500],
  },
  ghost: {
    backgroundColor: colors.ivory[100],
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.98 }],
  },
  disabled: {
    opacity: 0.45,
  },
  solidText: {
    color: "#FFFFFF",
  },
  ghostText: {
    color: colors.noir[800],
  },
});

const emptyStyles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[8],
  },
  icon: {
    marginBottom: spacing[4],
  },
  title: {
    textAlign: "center",
    marginBottom: spacing[2],
  },
  description: {
    textAlign: "center",
    marginBottom: spacing[5],
  },
});
