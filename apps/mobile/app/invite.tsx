/**
 * 초대 링크 착지 화면 — `hanbang://invite#WH-XXXX`로 앱이 열렸을 때 여기로 온다.
 *
 * ## 이 화면이 하는 일은 하나다
 *
 * 링크에서 코드를 꺼내 기억해 두고, 그 사람을 지금 서 있어야 할 자리로 보낸다.
 * 여기서 합류를 처리하지 않는 이유는, 합류에는 역할(신부/신랑) 선택이 함께
 * 필요하고 그 화면이 이미 온보딩에 있기 때문이다. 착지 화면이 자기 몫의
 * 입력칸을 또 만들면 같은 일을 두 곳에서 고치게 된다.
 *
 * ## 왜 코드를 `#` 뒤에서 꺼내는가
 *
 * 코드는 커플 공간에 들어오는 열쇠다. 경로나 쿼리에 실으면 서버 접근 로그와
 * 리퍼러에 그대로 쌓인다. 그래서 링크는 `#` 뒤에 코드를 두고
 * (`packages/shared/.../coupleInviteLink.ts`), 여기서는 그 규칙의 정본인
 * `parseCoupleInviteFragment`로만 읽는다.
 *
 * ## 로그인 여부에 따라 갈리지만, 판단은 루트가 한다
 *
 * 로그인한 사람은 루트(`/`)로 보낸다. 온보딩을 마쳤는지, 어디로 가야 하는지는
 * 루트 게이트가 이미 알고 있다 — 여기서 같은 판단을 한 벌 더 쓰면 두 곳이
 * 어긋나는 날이 온다. 로그인하지 않은 사람은 로그인 화면으로 보내고, 로그인이
 * 끝나면 그쪽도 루트로 돌아오므로 같은 길에 합류한다. 코드는 그 왕복 동안
 * 메모리에 남아 있다가 온보딩이 꺼내 쓴다.
 */

import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useLinkingURL } from "expo-linking";
import { colors } from "@hanbang/design-tokens";
import { parseCoupleInviteFragment } from "@hanbang/shared";
import { supabase } from "@/lib/supabase";
import { PrimaryButton } from "@/components/ui/AppUI";
import * as SecureStore from "expo-secure-store";
import { rememberPendingCoupleInviteCode } from "@/lib/pendingCoupleInvite.mjs";

/**
 * 링크 URL이 첫 렌더에 아직 안 와 있을 수 있다. 그 짧은 사이에 "링크가 이상해요"를
 * 먼저 띄우면, 멀쩡한 링크를 누른 사람이 실패 화면을 보고 뒤로 나간다.
 */
const LINK_SETTLE_MS = 500;

type InviteLandingStatus = "resolving" | "unreadable" | "leaving";

export default function InviteLandingScreen() {
  const linkingUrl = useLinkingURL();
  const [status, setStatus] = useState<InviteLandingStatus>("resolving");

  useEffect(() => {
    const code = parseCoupleInviteFragment(linkingUrl);

    if (!code) {
      // 아직 URL이 안 왔을 뿐일 수 있으니 조금 기다렸다가 판정한다.
      const timer = setTimeout(() => setStatus("unreadable"), LINK_SETTLE_MS);
      return () => clearTimeout(timer);
    }

    let active = true;
    setStatus("leaving");
    // 저장까지 한다. 초대받는 사람의 주 경로는 계정이 없는 파트너이고, 가입은 이메일
    // 확인을 강제한다 — 그 사람은 반드시 앱을 나갔다 온다. 메모리에만 두면 그 사이
    // OS가 앱을 회수했을 때 코드가 사라지고, 빈 입력칸만 남는다.
    void rememberPendingCoupleInviteCode(code, { storage: SecureStore });

    (async () => {
      let signedIn = false;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        signedIn = Boolean(session);
      } catch {
        // 세션을 못 물어본 것은 흔한 일이다(지하철, 비행기). 그때는 로그인 화면으로
        // 보낸다 — 이미 로그인돼 있으면 그쪽이 곧바로 통과시킨다.
        signedIn = false;
      }
      if (!active) return;

      router.replace(signedIn ? "/" : "/(auth)/login");
    })();

    return () => {
      active = false;
    };
  }, [linkingUrl]);

  if (status === "unreadable") {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>초대 링크를 읽지 못했어요</Text>
        <Text style={styles.body}>
          링크가 일부만 복사됐을 수 있어요. 파트너가 보낸 초대 코드를 직접 넣어도 똑같이
          합류할 수 있어요.
        </Text>
        <PrimaryButton
          tone="rose"
          style={styles.action}
          onPress={() => router.replace("/")}
        >
          초대 코드 직접 넣기
        </PrimaryButton>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ActivityIndicator color={colors.rose[500]} size="large" />
      <Text style={styles.body}>초대를 확인하고 있어요</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    gap: 14,
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 20,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
  },
  action: {
    width: "100%",
    maxWidth: 320,
    marginTop: 8,
  },
});
