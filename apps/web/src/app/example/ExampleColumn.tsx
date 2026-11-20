import type { ReactNode } from "react";

/**
 * 폰 화면을 넓은 화면에서 가운데 480px 단으로 그린다. 390 폭 폰에서는 화면 전체다.
 */
export default function ExampleColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col">{children}</div>;
}
