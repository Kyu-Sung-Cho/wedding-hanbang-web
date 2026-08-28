"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  EMPTY_SIGNUP_CONSENT,
  buildSignupConsentSubmission,
  isSignupConsentComplete,
  type SignupConsentState,
} from "@hanbang/shared";

import SignupConsent from "@/components/auth/SignupConsent";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { CONTACT } from "@/lib/constants/contact";

type ConsentGateClientProps = Readonly<{
  /** 동의를 마친 뒤 돌아갈 곳. 서버가 같은 출처인지 확인한 값이다. */
  destination: string;
  /** 동의를 받기 시작하기 전부터 쓰던 계정인가. 문구가 갈린다. */
  existingAccount: boolean;
}>;

export default function ConsentGateClient({
  destination,
  existingAccount,
}: ConsentGateClientProps) {
  const router = useRouter();
  const [consent, setConsent] = useState<SignupConsentState>(EMPTY_SIGNUP_CONSENT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const complete = isSignupConsentComplete(consent);

  async function handleSubmit() {
    if (!complete || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSignupConsentSubmission(consent)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "동의를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      // 세션이 옛 메타데이터를 들고 있으면 관문이 계속 이 화면으로 돌려보내
      // **무한 루프**가 된다. 서버의 getUser() 는 Auth 서버에 물어 최신값을
      // 받지만, 클라이언트 세션까지 함께 갱신해 두는 편이 안전하다.
      try {
        await createClient().auth.refreshSession();
      } catch {
        // 갱신에 실패해도 서버 판정은 최신값을 본다. 진행한다.
      }
      router.replace(destination);
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    try {
      await createClient().auth.signOut();
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <main className="min-h-screen bg-[var(--hb-surface-page)] px-5 py-16">
      <div className="mx-auto w-full max-w-[420px]">
        {/* 이 화면에는 두 종류의 사람이 선다. 한쪽에게 맞는 문구가 다른 쪽에게는
            거짓이 되므로 갈라 쓴다.

            - 방금 소셜 로그인으로 계정이 만들어진 사람: "가입"이라고 부르면 방금
              한 일을 부정하는 말이 된다. 무엇이 남았는지만 말한다.
            - 동의를 받기 시작하기 전부터 쓰던 사람: 몇 달째 쓰던 서비스가 갑자기
              동의를 요구하는 것이라, **왜 지금인지**를 먼저 말하지 않으면
              자기 계정에 문제가 생긴 것으로 읽힌다. */}
        {existingAccount ? (
          <>
            <h1 className="text-[22px] font-semibold text-[var(--hb-text-strong)]">
              약관 동의를 한 번만 받을게요
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--hb-text-body)]">
              가입하실 때는 동의를 따로 받지 않았어요. 이용약관과 개인정보 처리방침을
              확인해 주시면 쓰시던 그대로 이어집니다. 계정과 기록은 그대로 있어요.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[22px] font-semibold text-[var(--hb-text-strong)]">
              시작하기 전에 확인해 주세요
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--hb-text-body)]">
              계정은 만들어졌어요. 서비스를 이용하려면 이용약관과 개인정보 처리방침에
              동의가 필요해요.
            </p>
          </>
        )}

        <div className="mt-6">
          <SignupConsent value={consent} onChange={setConsent} disabled={submitting} />
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-[13px] text-[#9A6B62]">
            {error}
          </p>
        ) : null}

        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={submitting}
          disabled={!complete}
          onClick={handleSubmit}
          className="mt-6"
        >
          {submitting ? "저장 중..." : "동의하고 계속하기"}
        </Button>

        {/* 동의하지 않을 자유가 있어야 동의가 동의다. 나가는 길을 준다. */}
        <Button
          variant="ghost"
          size="md"
          fullWidth
          disabled={submitting}
          onClick={handleSignOut}
          className="mt-3 font-normal underline underline-offset-2"
        >
          동의하지 않고 로그아웃
        </Button>

        <p className="mt-6 text-[12px] leading-relaxed text-[var(--hb-text-muted)]">
          계정 삭제를 원하시면 로그아웃 후 고객센터({CONTACT.email})로 알려주세요.
        </p>
      </div>
    </main>
  );
}
