import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-013 — the web React 19.2 app resolved mobile's React 19.1
// types, breaking clean-install web builds and mobile JSX component types.
// Found by /qa on 2026-07-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-12.md

describe("React type isolation regression", () => {
  it("pins each app to the React type line matching its runtime", () => {
    const webPackage = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    const mobilePackage = JSON.parse(
      readFileSync(join(process.cwd(), "../mobile/package.json"), "utf8")
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

    expect(webPackage.dependencies.react).toBe("19.2.3");
    expect(webPackage.devDependencies["@types/react"]).toBe("19.2.17");
    expect(webPackage.devDependencies["@types/react-dom"]).toBe("19.2.3");
    expect(mobilePackage.dependencies.react).toBe("19.1.0");
    expect(mobilePackage.devDependencies["@types/react"]).toBe("~19.1.0");
  });

  it("keeps Next styled-jsx attributes scoped to the web React module", () => {
    const declaration = readFileSync(
      join(process.cwd(), "src/types/styled-jsx.d.ts"),
      "utf8"
    );

    expect(declaration).toContain('import "react"');
    expect(declaration).toContain('declare module "react"');
    expect(declaration).toContain("jsx?: boolean");
    expect(declaration).toContain("global?: boolean");
  });
});
