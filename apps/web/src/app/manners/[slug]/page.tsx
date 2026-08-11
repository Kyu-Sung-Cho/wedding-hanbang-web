import type { Metadata } from "next";
import Link from "next/link";
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

  return (
    <>
      <nav aria-label="이동 경로" className="mx-auto w-full max-w-[760px] px-4 pt-6 sm:px-6">
        <Link
          href="/wedding/manners"
          prefetch={false}
          className="text-[13px] font-medium text-[#8F5150] underline underline-offset-2"
        >
          결혼 예절 안내
        </Link>
      </nav>
      <MannersPartView part={part} />
    </>
  );
}
