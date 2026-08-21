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

type ConsentGateClientProps = Readonly<{
  /** 동의를 마친 뒤 돌아갈 곳. 서버가 같은 출처인지 확인한 값이다. */
  destination: string;
}>;

export default function ConsentGateClient({ destination }: ConsentGateClientProps) {
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
    <main className="min-h-screen bg-[#FBF8F2] px-5 py-16">
      <div className="mx-auto w-full max-w-[420px]">
        <h1 className="text-[22px] font-semibold text-[#263832]">
          시작하기 전에 확인해 주세요
        </h1>
        {/* 이 사람은 소셜 로그인으로 계정이 이미 만들어진 상태다. "가입" 이라고
            부르면 방금 한 일을 부정하는 말이 된다. 무엇이 남았는지만 말한다. */}
        <p className="mt-3 text-[14px] leading-relaxed text-[#4E6A62]">
          계정은 만들어졌어요. 서비스를 이용하려면 이용약관과 개인정보 처리방침에
          동의가 필요해요.
        </p>

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

        <p className="mt-6 text-[12px] leading-relaxed text-[#928980]">
          계정 삭제를 원하시면 로그아웃 후 고객센터(support@hanbang.ai)로 알려주세요.
        </p>
      </div>
    </main>
  );
}
