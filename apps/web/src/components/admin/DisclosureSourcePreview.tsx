import Image from "next/image";
import { FileSearch } from "lucide-react";

export type DisclosureSourceFile = {
  label: string;
  signed_url: string;
  preview_text?: string;
};

export function DisclosureSourcePreview({
  source,
  title,
}: {
  source: DisclosureSourceFile;
  title: string;
}) {
  const normalizedLabel = source.label.toLocaleLowerCase("en-US");
  if (normalizedLabel.endsWith(".png")) {
    return (
      <Image
        src={source.signed_url}
        alt={title}
        width={1200}
        height={1600}
        unoptimized
        referrerPolicy="no-referrer"
        className="h-auto w-full object-contain"
      />
    );
  }
  if (normalizedLabel.endsWith(".pdf")) {
    return (
      <iframe
        src={source.signed_url}
        title={`${title} PDF`}
        className="h-[520px] w-full"
        referrerPolicy="no-referrer"
      />
    );
  }
  if (typeof source.preview_text === "string") {
    return (
      <div className="flex h-[520px] min-h-[360px] flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2D3C8] bg-[var(--hb-surface-page)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-wide text-[var(--color-rose-700)]">DERIVED TEXT PREVIEW</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-[var(--hb-text-strong)]">{source.label}</p>
          </div>
          <a
            href={source.signed_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 shrink-0 items-center rounded-[6px] border border-[#C7D1C2] bg-white px-3 text-xs font-bold text-[var(--hb-text-strong)] hover:bg-[#F2F7F3]"
          >
            원본 파일 열기
          </a>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-[var(--hb-text-strong)]">
          {source.preview_text || "파생 텍스트가 비어 있습니다. 원본 파일을 직접 확인해 주세요."}
        </pre>
      </div>
    );
  }
  return (
    <div className="grid min-h-[360px] place-items-center p-8 text-center">
      <div>
        <FileSearch className="mx-auto text-[var(--hb-text-strong)]" aria-hidden="true" />
        <p className="mt-3 font-semibold text-[var(--hb-text-strong)]">{source.label}</p>
        <p className="mt-2 text-sm leading-6 text-[var(--hb-success)]">
          이 형식의 파생 텍스트가 없습니다. 원본 파일을 직접 확인해 주세요.
        </p>
        <a
          href={source.signed_url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-10 items-center rounded-[6px] bg-[var(--hb-primary)] px-4 text-sm font-semibold text-white"
        >
          원본 파일 열기
        </a>
      </div>
    </div>
  );
}
