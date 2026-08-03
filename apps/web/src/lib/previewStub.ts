interface PreviewStubEnv {
  readonly [key: string]: string | undefined;
  NEXT_PUBLIC_PREVIEW_STUB_MODE?: string;
}

export function isPreviewStubMode(env: PreviewStubEnv = process.env): boolean {
  return env.NEXT_PUBLIC_PREVIEW_STUB_MODE === "true";
}

export function assertPreviewStubSupabaseDisabled(
  env: PreviewStubEnv = process.env,
): void {
  if (isPreviewStubMode(env)) {
    throw new Error("Supabase clients are disabled in Preview stub mode");
  }
}
