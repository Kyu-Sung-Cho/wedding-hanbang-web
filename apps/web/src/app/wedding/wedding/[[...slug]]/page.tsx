import { redirect } from "next/navigation";

type DuplicateWeddingPathPageProps = {
  params?: Promise<{ slug?: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DuplicateWeddingPathPage({
  params,
  searchParams,
}: DuplicateWeddingPathPageProps) {
  const resolvedParams = params ? await params : undefined;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const slug = resolvedParams?.slug ?? [];
  const query = new URLSearchParams();

  Object.entries(resolvedSearchParams ?? {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined) query.append(key, item);
      });
    } else if (value !== undefined) {
      query.set(key, value);
    }
  });

  const suffix = slug.length > 0 ? `/${slug.map(encodeURIComponent).join("/")}` : "";
  const queryString = query.toString();

  redirect(`/wedding${suffix}${queryString ? `?${queryString}` : ""}`);
}
