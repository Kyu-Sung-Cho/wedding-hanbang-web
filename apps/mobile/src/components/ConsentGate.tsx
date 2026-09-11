import { useEffect, useMemo, useRef, useState } from "react";
import { router, usePathname, useRootNavigationState } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { colors } from "@hanbang/design-tokens";
import type { SignupConsentAccess } from "@hanbang/shared";
import { AppText, PrimaryButton } from "@/components/ui/AppUI";
import { readMobileSignupConsentAccess } from "@/lib/signupConsentAccess";

import { supabase } from "@/lib/supabase";
import {
  MOBILE_CONSENT_ROUTE,
  CONSENT_INTERCEPTION_EXEMPT_PATHS,
  shouldInterceptForConsent,
} from "@/lib/consentInterception";

type Session = { user: { id: string; user_metadata?: unknown } } | null;

/**
 * 어느 문으로 들어와도 동의 관문을 지나게 한다.
 *
 * 판정은 `consentInterception.ts` 에 있고 여기는 배선만 한다 — 왜 필요한지와
 * 무엇을 지나보내는지는 그 파일에 적혀 있다.
 *
 * Stack은 계속 마운트해 내비게이터를 유지하고, 판정 대기·실패 중에는 입력만 막는다.
 */
export default function ConsentGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // 루트 레이아웃은 내비게이터보다 먼저 그려진다. 그 전에 replace 하면 조용히
  // 버려져 **가로채지 못한 채 통과한다.** 준비될 때까지 기다린다.
  const navigationState = useRootNavigationState();
  const [session, setSession] = useState<Session>(null);
  const [result, setResult] = useState<{ scope: object; access?: SignupConsentAccess; error?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const authEpoch = useRef(0);
  const [authGeneration, setAuthGeneration] = useState(0);
  const exempt = CONSENT_INTERCEPTION_EXEMPT_PATHS.includes(pathname.split(/[?#]/u)[0]);
  // 동의 화면에서 복귀할 때 이전 성공·필요 판정을 재사용하지 않는다.
  const scope = useMemo(() => ({ session, exempt, attempt, authGeneration }), [session, exempt, attempt, authGeneration]);
  // onAuthStateChange 는 INITIAL_SESSION 을 곧바로 준다. 그 뒤에 도착한
  // getSession() 결과로 덮어쓰면 방금 로그인·갱신한 값이 옛것으로 되돌아간다.
  const sawAuthEvent = useRef(false);

  useEffect(() => {
    let active = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      sawAuthEvent.current = true;
      authEpoch.current += 1;
      setAuthGeneration(value => value + 1);
      setResult(null);
      setSession(next ?? null);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!active || sawAuthEvent.current) return;
      setSession(data.session ?? null);
    }).catch(() => {
      // 못 읽으면 가로채지 않는다. 모르는 채로 막으면 나갈 길이 없다.
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || exempt) return;
    const controller = new AbortController();
    const epoch = authEpoch.current;
    const current = () => !controller.signal.aborted && epoch === authEpoch.current;
    void readMobileSignupConsentAccess(session.user.id, controller.signal).then(access => {
      if (current()) setResult({ scope, access });
    }).catch(() => {
      if (current()) setResult({ scope, error: true });
    });
    return () => controller.abort();
  }, [session, exempt, scope]);

  useEffect(() => {
    if (!navigationState?.key) return;
    if (result?.scope !== scope || !result.access) return;
    if (!shouldInterceptForConsent({ pathname, session, consentAccess: result.access })) return;
    router.replace(MOBILE_CONSENT_ROUTE);
  }, [navigationState?.key, pathname, session, result, scope]);

  const pending = !!session && !exempt && (result?.scope !== scope || result.access !== "server_verified" && result.access !== "legacy_unverified");
  return <View style={styles.container}>
    <View style={styles.container} pointerEvents={pending ? "none" : "auto"} accessibilityElementsHidden={pending} importantForAccessibility={pending ? "no-hide-descendants" : "auto"}>{children}</View>
    {pending ? <View style={styles.overlay} accessibilityViewIsModal>
      {result?.scope === scope && result.error ? <>
        <AppText>동의 기록을 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.</AppText>
        <PrimaryButton tone="rose" onPress={() => { setResult(null); setAttempt(value => value + 1); }}>다시 확인하기</PrimaryButton>
      </> : <ActivityIndicator />}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.ivory[50], alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
});
