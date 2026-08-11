import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ChecklistCategoryView from "@/components/app/checklist/ChecklistCategoryView";
import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";

type Params = { categoryKey: string };

function findCategory(categoryKey: string) {
  return Object.hasOwn(CHECKLIST_MAP, categoryKey) ? CHECKLIST_MAP[categoryKey] : null;
}

export function generateStaticParams(): Params[] {
  return CATEGORY_CHECKLISTS.map((category) => ({ categoryKey: category.key }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { categoryKey } = await params;
  const category = findCategory(categoryKey);
  if (!category) return { title: "웨딩 체크리스트 — 웨딩한방" };
  return {
    title: `${category.label} 체크리스트 — 웨딩한방`,
    description: `${category.label} 준비 항목, 실전 팁, 대화 예시와 주의사항을 한 페이지에서 확인하고 저장하세요.`,
    alternates: { canonical: `https://hanbang.ai/wedding/checklist/${categoryKey}` },
  };
}

export default async function ChecklistCategoryPage({ params }: { params: Promise<Params> }) {
  const { categoryKey } = await params;
  if (!findCategory(categoryKey)) notFound();
  return <ChecklistCategoryView categoryKey={categoryKey} />;
}
