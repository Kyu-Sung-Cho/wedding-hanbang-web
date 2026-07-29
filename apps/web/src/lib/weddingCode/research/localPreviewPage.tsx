import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Candidate6Prototype } from "./Candidate6Prototype";
import type { Candidate6Form, Candidate6SupportPairOrder } from "./candidate6";

export const metadata: Metadata = {
  title: "오늘 한 마디 · 로컬 연구 미리보기",
  description: "응답을 저장하거나 전송하지 않는 WeddingCode 로컬 연구 프로토타입입니다.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function WeddingCodeResearchPreviewPage({ searchParams }: PageProps) {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.WEDDING_CODE_RESEARCH_PREVIEW !== "true"
  ) {
    notFound();
  }

  const host = (await headers()).get("host")?.toLowerCase() ?? "";
  const hostname = host.startsWith("[") ? host.split("]")[0] + "]" : host.split(":")[0];
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) notFound();

  const params = await searchParams;
  const form: Candidate6Form = params.form === "B" ? "B" : "A";
  const supportPairOrder: Candidate6SupportPairOrder =
    params.supportOrder === "AS_FIRST" ? "AS_FIRST" : "ES_FIRST";
  return <Candidate6Prototype form={form} supportPairOrder={supportPairOrder} />;
}
