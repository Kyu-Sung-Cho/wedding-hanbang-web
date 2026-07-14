interface PreviewStubDeploymentEnv {
  readonly [key: string]: string | undefined;
  VERCEL_ENV?: string;
  NEXT_PUBLIC_PREVIEW_STUB_MODE?: string;
}

export function assertPreviewStubDeployment(
  env: PreviewStubDeploymentEnv = process.env
): void {
  if (
    env.VERCEL_ENV === "production" &&
    env.NEXT_PUBLIC_PREVIEW_STUB_MODE === "true"
  ) {
    throw new Error(
      "NEXT_PUBLIC_PREVIEW_STUB_MODE must never be enabled in Production"
    );
  }
}
