import { redirect } from "next/navigation";

import ChecklistContent from "@/components/app/checklist/ChecklistContent";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { weddingPath } from "@/lib/weddingPaths";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ChecklistPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolved = await searchParams;
  const requestedCategory = Array.isArray(resolved.category)
    ? resolved.category[0]
    : resolved.category;

  if (requestedCategory && Object.hasOwn(CHECKLIST_MAP, requestedCategory)) {
    const remaining = new URLSearchParams();
    for (const [key, value] of Object.entries(resolved)) {
      if (key === "category" || value === undefined) continue;
      for (const entry of Array.isArray(value) ? value : [value]) remaining.append(key, entry);
    }
    const suffix = remaining.size > 0 ? `?${remaining.toString()}` : "";
    redirect(`${weddingPath(`/checklist/${requestedCategory}`)}${suffix}`);
  }

  return <ChecklistContent />;
}
