import type { Metadata } from "next";

export const metadata: Metadata = { title: "아모라가 하는 일 | 웨딩한방" };

export default function AmoraPermissionsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
