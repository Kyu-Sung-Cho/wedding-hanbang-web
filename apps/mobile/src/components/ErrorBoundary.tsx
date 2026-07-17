// 앱 전역 에러 경계 — JS 크래시 시 폴백 UI 표시
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { Sentry } from "@/lib/sentry";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    Sentry.withScope((scope) => {
      scope.setContext("react", { componentStack: errorInfo.componentStack });
      Sentry.captureException(error);
    });

    if (__DEV__) {
      console.error("[ErrorBoundary] 앱 크래시:", error);
      console.error("[ErrorBoundary] 컴포넌트 스택:", errorInfo.componentStack);
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <AlertTriangle
            size={48}
            color={colors.rose[500]}
            strokeWidth={1.5}
          />
          <Text style={styles.title}>문제가 발생했어요</Text>
          <Text style={styles.message}>
            예상치 못한 오류가 발생했습니다.{"\n"}
            잠시 후 다시 시도해주세요.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={this.handleReset}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    paddingHorizontal: 32,
  },
  title: {
    fontFamily: "NotoSansKR_600SemiBold",
    fontSize: 20,
    color: colors.textPrimary,
    marginTop: 20,
    marginBottom: 8,
  },
  message: {
    fontFamily: "NotoSansKR_400Regular",
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  button: {
    backgroundColor: colors.rose[500],
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    fontFamily: "NotoSansKR_500Medium",
    fontSize: 15,
    color: "#FFFFFF",
  },
});
