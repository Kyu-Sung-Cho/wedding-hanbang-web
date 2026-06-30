// 네트워크 에러 시 "다시 시도" UI
import { StyleSheet } from "react-native";
import { WifiOff, RefreshCw } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { EmptyState, IconBadge, PrimaryButton } from "@/components/ui/AppUI";

interface Props {
  message?: string;
  onRetry: () => void;
}

export default function ErrorRetry({ message, onRetry }: Props) {
  return (
    <EmptyState
      icon={
        <IconBadge tone="ivory" size={64}>
          <WifiOff size={28} color={colors.textSecondary} />
        </IconBadge>
      }
      title="잠시 연결이 불안정해요"
      description={message ?? "데이터를 불러올 수 없어요"}
      action={
        <PrimaryButton
          tone="noir"
          icon={<RefreshCw size={16} color="#FFF" />}
          onPress={onRetry}
          style={styles.retryButton}
        >
          다시 시도
        </PrimaryButton>
      }
    />
  );
}

const styles = StyleSheet.create({
  retryButton: {
    minWidth: 148,
  },
});
