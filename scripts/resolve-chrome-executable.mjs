import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function platformCandidates() {
  if (process.platform === "win32") {
    return [
      process.env.PROGRAMFILES &&
        path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
      process.env["PROGRAMFILES(X86)"] &&
        path.join(process.env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
      process.env.LOCALAPPDATA &&
        path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    ];
  }

  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}

export function resolveChromeExecutablePath() {
  const candidates = [process.env.CHROME_PATH, ...platformCandidates()].filter(Boolean);
  const executablePath = candidates.find((candidate) => existsSync(candidate));
  if (executablePath) return executablePath;

  throw new Error(
    "Chrome/Chromium executable not found. Install Chrome or set CHROME_PATH to its absolute executable path."
  );
}
