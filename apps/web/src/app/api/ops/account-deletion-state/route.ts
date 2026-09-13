import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRIVATE_NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "Pragma": "no-cache",
  "Expires": "0",
  "Vary": "Authorization",
} as const;

/** 운영 설정 관측만 수행한다. 삭제 접수·작업 실행·DB 조회와 연결하지 않는다. */
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  const suppliedBytes = Buffer.from(authorization ?? "");
  let authenticated = false;
  if (authorization && /^Bearer [A-Za-z0-9._~+/-]+=*$/.test(authorization)) {
    for (const expected of [process.env.ACCOUNT_DELETION_STATE_SECRET, process.env.CRON_SECRET]) {
      if (!expected || !/^[A-Za-z0-9._~+/-]+=*$/.test(expected)) continue;
      const expectedBytes = Buffer.from(`Bearer ${expected}`);
      const matches = suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
      authenticated = matches || authenticated;
    }
  }
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_NO_STORE });
  }

  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  return NextResponse.json({
    commit: typeof commit === "string" && /^[0-9a-f]{40}$/i.test(commit) ? commit.toLowerCase() : null,
    observedAt: new Date().toISOString(),
    flags: {
      ACCOUNT_DELETION_INTAKE_ENABLED: process.env.ACCOUNT_DELETION_INTAKE_ENABLED === "true",
      ACCOUNT_DELETION_CRON_ENABLED: process.env.ACCOUNT_DELETION_CRON_ENABLED === "true",
    },
  }, { headers: PRIVATE_NO_STORE });
}
