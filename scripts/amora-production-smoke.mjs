#!/usr/bin/env node

import { randomUUID } from "node:crypto";

const args = new Set(process.argv.slice(2));
const baseUrlArg = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--base-url="));
const baseUrl = new URL(baseUrlArg?.slice("--base-url=".length) || "https://hanbang.ai");

if (baseUrl.hostname === "hanbang.ai" && !args.has("--allow-production")) {
  throw new Error("Refusing production smoke without --allow-production");
}
if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") {
  throw new Error("Smoke target must use HTTPS (except localhost)");
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 180_000);

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function parseSse(text) {
  const events = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const dataLine = block
      .split(/\r?\n/)
      .find((line) => line.startsWith("data: "));
    if (!dataLine) continue;
    try {
      events.push(JSON.parse(dataLine.slice(6)));
    } catch {
      events.push({ type: "malformed" });
    }
  }
  return events;
}

try {
  const demoResponse = await fetch(new URL("/api/demo/start", baseUrl), {
    method: "POST",
    signal: controller.signal,
  });
  const cookie = cookieHeader(demoResponse);
  if (!demoResponse.ok || !cookie) {
    console.log(JSON.stringify({
      pass: false,
      stage: "demo_session",
      status: demoResponse.status,
      cookiePresent: Boolean(cookie),
    }));
    process.exitCode = 1;
  } else {
    const clientRequestId = randomUUID();
    const response = await fetch(new URL("/api/chat", baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: "스튜디오 계약 전에 꼭 확인할 항목 한 가지만 짧게 알려줘.",
          },
        ],
        coupleId: "demo-couple",
        senderName: "체험 사용자",
        senderRole: "bride",
        weddingContext: {
          weddingDate: null,
          budget: 0,
          venue: null,
          progress: {},
        },
        isDemo: true,
        clientRequestId,
        visibility: "shared",
        requestKind: "chat",
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    const events = parseSse(raw);
    const done = [...events].reverse().find((event) => event.type === "done");
    const error = events.find((event) => event.type === "error");
    const pass = response.ok
      && typeof done?.fullContent === "string"
      && done.fullContent.trim().length > 0
      && !error;

    console.log(JSON.stringify({
      pass,
      stage: "chat",
      status: response.status,
      eventTypes: [...new Set(events.map((event) => event.type))],
      responseChars:
        typeof done?.fullContent === "string" ? done.fullContent.length : 0,
      errorCode: typeof error?.code === "string" ? error.code : null,
    }));
    process.exitCode = pass ? 0 : 1;
  }
} catch (error) {
  console.log(JSON.stringify({
    pass: false,
    stage: "network",
    errorType: error instanceof Error ? error.name : "unknown",
  }));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
