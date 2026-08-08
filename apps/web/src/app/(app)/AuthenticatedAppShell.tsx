import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { verifyDemoSessionToken } from "@/lib/demoSession";
import { createClient } from "@/lib/supabase/server";

import AppClientLayout from "./AppClientLayout";
import DemoModeBanner from "./DemoModeBanner";

export default async function AuthenticatedAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const isDemo = cookieStore.get("demo_mode")?.value === "true"
    && verifyDemoSessionToken(cookieStore.get("demo_session")?.value);

  if (!isDemo) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
  }

  return (
    <AppClientLayout
      banner={isDemo ? <DemoModeBanner /> : null}
      initialDemo={isDemo}
    >
      {children}
    </AppClientLayout>
  );
}
