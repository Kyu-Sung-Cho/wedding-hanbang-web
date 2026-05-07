import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hanbang.ai";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  try {
    const supabase = getServiceClient();
    const { data } = await supabase
      .from("guestbooks")
      .select("bride_name, groom_name, wedding_date, cover_image_url, thank_you_message, is_active")
      .eq("slug", slug)
      .maybeSingle();

    if (!data || !data.is_active) {
      return {
        title: "방명록 | 웨딩한방",
        description: "결혼 방명록",
      };
    }

    const title = `${data.bride_name} ❤️ ${data.groom_name} 결혼 방명록`;
    const description =
      data.thank_you_message?.trim() ||
      `${data.wedding_date} 결혼식. 두 사람에게 따뜻한 한 마디 남겨주세요 🤍`;
    const url = `${SITE_URL}/guestbook/${slug}`;
    const image = data.cover_image_url || `${SITE_URL}/og-image.png`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url,
        siteName: "웨딩한방",
        images: [{ url: image, width: 1200, height: 630, alt: title }],
        type: "website",
        locale: "ko_KR",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [image],
      },
      alternates: {
        canonical: url,
      },
    };
  } catch {
    return {
      title: "방명록 | 웨딩한방",
      description: "결혼 방명록",
    };
  }
}

export default function GuestbookSlugLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
