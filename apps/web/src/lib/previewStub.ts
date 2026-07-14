export function isPreviewStubMode(): boolean {
  return process.env.NEXT_PUBLIC_PREVIEW_STUB_MODE === "true";
}
