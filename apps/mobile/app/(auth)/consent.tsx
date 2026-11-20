// 동의 기록이 없는 계정이 서는 자리 (모바일).
//
// 소셜 로그인은 Supabase 가 계정을 **직접** 만들기 때문에 가입 화면을 거치지
// 않는다. 그 경로로 들어온 사람은 동의 화면을 본 적도, 기록도 없다.
// 웹은 /api/auth/callback 과 AuthenticatedAppShell 에서 막지만, 모바일은
// 다른 콜백(/auth/mobile-callback)을 써서 그 관문에 닿지 않는다.
//
// 그리고 /api/onboarding 은 모든 클라이언트에 동의를 요구한다. 이 화면이
// 없으면 모바일 소셜 사용자는 온보딩 제출에서 "동의해야 시작할 수 있어요"만
// 반복해서 보고 아무것도 할 수 없다.

import { useEffect, useState } from "react";
import { CONTACT } from "@hanbang/shared/constants";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { CheckCircle2, Circle } from "lucide-react-native";
import {
  EMPTY_SIGNUP_CONSENT,
  isPreConsentAccount,
  SIGNUP_CONSENT_ITEMS,
  buildSignupConsentSubmission,
  isSignupConsentAll,
  isSignupConsentComplete,
  setAllSignupConsent,
  type SignupConsentKey,
  type SignupConsentState,
} from "@hanbang/shared";

import {
  InvitationAuthBackground,
  InvitationAuthCard,
  InvitationAuthHeader,
  authAgreement,
  authColors,
  authField,
  authText,
} from "@/components/invitation/InvitationAuthFrame";
import { palette, typo } from "@/components/invitation/invitationStyle";
import { apiFetch } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";

export default function ConsentScreen() {
  // 이 화면에는 두 종류의 사람이 선다 — 방금 소셜로 계정이 만들어진 사람과,
  // 동의를 받기 시작하기 전부터 쓰던 사람. 한쪽에게 맞는 문구가 다른 쪽에게는
  // 거짓이라 갈라 쓴다(웹의 ConsentGateClient 와 같은 판정).
  const [existingAccount, setExistingAccount] = useState(false);
  const [consent, setConsent] = useState<SignupConsentState>(EMPTY_SIGNUP_CONSENT);
  const [submitting, setSubmitting] = useState(false);
  const complete = isSignupConsentComplete(consent);
  const all = isSignupConsentAll(consent);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setExistingAccount(isPreConsentAccount(data.user?.created_at));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(key: SignupConsentKey) {
    setConsent((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSubmit() {
    if (!complete || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/auth/consent", {
        method: "POST",
        body: JSON.stringify(buildSignupConsentSubmission(consent)),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        Alert.alert("알림", data.error ?? "동의를 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
      // 로컬 세션은 옛 메타데이터를 들고 있다. 갱신하지 않으면 루트 게이트가
      // 이 화면으로 다시 돌려보내 무한 루프가 된다.
      await supabase.auth.refreshSession();
      router.replace("/");
    } catch {
      Alert.alert("알림", "네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecline() {
    if (submitting) return;
    try {
      await signOut({ continueOnDecisionPurgeFailure: true });
    } finally {
      router.replace("/(auth)/login");
    }
  }

  // 2026-11-20 파운더 "로그인 페이지도 다 바꿔야": 로그인과 같은 바탕·amora·유리 카드에 넣는다(InvitationAuthFrame).
  // 동의 항목·문장·저장 순서는 그대로이고, 바뀐 것은 겉모양뿐이다. 웹 동의 관문(ConsentGateClient)과 같은 틀이다.
  return (
    <InvitationAuthBackground>
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <InvitationAuthHeader />
        <View style={styles.spacer} />

        <InvitationAuthCard>
        <Text accessibilityRole="header" style={authText.heading}>
          {existingAccount ? "약관 동의를 한 번만 받을게요" : "시작하기 전에 확인해주세요"}
        </Text>
        <Text style={authText.body}>
          {existingAccount
            ? "가입하실 때는 동의를 따로 받지 않았어요. 이용약관과 개인정보 처리방침을 확인해 주시면 쓰시던 그대로 이어집니다. 계정과 기록은 그대로 있어요."
            : "계정은 만들어졌어요. 서비스를 이용하려면 이용약관과 개인정보 처리방침에 동의가 필요해요."}
        </Text>

        <View style={authAgreement.section}>
          <Pressable
            style={authAgreement.row}
            disabled={submitting}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: all }}
            accessibilityLabel="전체 동의"
            onPress={() => setConsent(setAllSignupConsent(!all))}
          >
            {all ? (
              <CheckCircle2 size={24} color={authColors.checked} />
            ) : (
              <Circle size={24} color={authColors.unchecked} />
            )}
            <Text style={authAgreement.allText}>전체 동의</Text>
          </Pressable>

          <View style={authAgreement.divider} />

          {SIGNUP_CONSENT_ITEMS.map((item) => (
            <View key={item.key} style={authAgreement.row}>
              <Pressable
                disabled={submitting}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: consent[item.key] }}
                accessibilityLabel={`${item.required ? "필수" : "선택"} ${item.label}`}
                onPress={() => toggle(item.key)}
              >
                {consent[item.key] ? (
                  <CheckCircle2 size={20} color={authColors.checked} />
                ) : (
                  <Circle size={20} color={authColors.unchecked} />
                )}
              </Pressable>
              <Text style={authAgreement.text}>
                <Text style={item.required ? authAgreement.required : authAgreement.optional}>
                  {item.required ? "[필수]" : "[선택]"}
                </Text>{" "}
                {item.label}
              </Text>
              {item.href ? (
                <Pressable
                  disabled={submitting}
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(`${SITE}${item.href}`)}
                >
                  <Text style={authAgreement.link}>보기</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>

        <Pressable
          style={[authField.primary, (!complete || submitting) && styles.submitBtnDisabled]}
          disabled={!complete || submitting}
          accessibilityRole="button"
          onPress={handleSubmit}
        >
          {submitting ? (
            <ActivityIndicator color={authColors.white} />
          ) : (
            <Text style={authField.primaryText}>동의하고 계속하기</Text>
          )}
        </Pressable>

        {/* 거절할 수 있어야 동의가 동의다. 나가는 길을 준다. */}
        <Pressable
          style={styles.declineBtn}
          disabled={submitting}
          accessibilityRole="button"
          onPress={handleDecline}
        >
          <Text style={styles.declineText}>동의하지 않고 로그아웃</Text>
        </Pressable>

        <Text style={styles.footnote}>
          계정 삭제를 원하시면 로그아웃 후 고객센터({CONTACT.email})로 알려주세요.
        </Text>
        </InvitationAuthCard>
      </ScrollView>
    </SafeAreaView>
    </InvitationAuthBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 12, paddingBottom: 12 },
  spacer: { flexGrow: 1, minHeight: 16 },
  submitBtnDisabled: { opacity: 0.4 },
  declineBtn: { alignItems: "center", paddingVertical: 12 },
  declineText: {
    ...typo.sans,
    fontSize: 13,
    lineHeight: 18,
    color: palette.body,
    textDecorationLine: "underline",
  },
  footnote: {
    ...typo.sans,
    fontSize: 12,
    lineHeight: 20,
    color: palette.muted,
    textAlign: "center",
  },
});
