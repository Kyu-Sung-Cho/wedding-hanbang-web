import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { hasRecordedSignupConsent } from "@hanbang/shared";

import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/server";

import ProviderShell, { ProviderHeading } from "./ProviderShell";
import ProviderPageRetry from "./ProviderPageRetry";

type ProviderAccountGateProps = {
  destination: "/business/register" | "/business/inquiry" | "/provider";
  children: ReactNode;
};

export default async function ProviderAccountGate({ destination, children }: ProviderAccountGateProps) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  const search = new URLSearchParams({ redirect: destination });
  if (!user) redirect(`/login?${search}`);
  if (!hasRecordedSignupConsent(user.app_metadata)) redirect(`/consent?${search}`);
  if (!user.email || !user.email_confirmed_at) {
    return (
      <ProviderShell active="provider">
        <ProviderHeading title="계정 이메일 확인이 필요해요">
          <p>등록 신청과 문의에는 확인된 계정 이메일을 사용합니다. 가입할 때 받은 인증 메일을 확인한 뒤 이 페이지로 돌아와 주세요.</p>
        </ProviderHeading>
        <div className="flex flex-wrap gap-3">
          <ProviderPageRetry label="이메일 확인 후 다시 불러오기" />
          <Button href="/business">참여 안내로 돌아가기</Button>
        </div>
      </ProviderShell>
    );
  }
  return children;
}
