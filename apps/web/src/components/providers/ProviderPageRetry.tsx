"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";

export default function ProviderPageRetry({ label = "다시 불러오기" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <Button loading={pending} onClick={() => startTransition(() => router.refresh())}>{label}</Button>;
}
