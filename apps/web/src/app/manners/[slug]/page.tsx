import type { Metadata } from "next";
import { notFound } from "next/navigation";

import MannersPartView from "@/components/manners/MannersPartView";
import { MANNERS_PARTS } from "@/lib/manners/data";

type Params = { slug: string };

function findPart(slug: string) {
  return MANNERS_PARTS.find((part) => part.slug === slug);
}

export function generateStaticParams(): Params[] {
  return MANNERS_PARTS.map((part) => ({ slug: part.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const part = findPart(slug);
  if (!part) return { title: "결혼 예절 안내 — 웨딩한방" };
  return {
    title: `${part.title} — 웨딩한방`,
    description: part.description,
    alternates: { canonical: `https://hanbang.ai/wedding/manners/${part.slug}` },
  };
}

export default async function MannersPartPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const part = findPart(slug);
  if (!part) notFound();

  return <MannersPartView part={part} />;
}
