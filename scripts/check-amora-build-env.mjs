#!/usr/bin/env node

// Local and preview builds do not carry production-only secrets. The actual
// Vercel production builder does, so enforce the full boolean-only release
// contract there before Next.js can produce a deployable artifact.
if (process.env.VERCEL_ENV !== "production") {
  console.log(
    `[amora-build-env] skipped for ${process.env.VERCEL_ENV || "local"}`,
  );
} else {
  await import("./check-amora-production-env.mjs");
}
