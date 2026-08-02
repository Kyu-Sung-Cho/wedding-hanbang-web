import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");
const config = readFileSync(resolve(repositoryRoot, "supabase/config.toml"), "utf8");

describe("Supabase password security configuration", () => {
  it("enforces the canonical user password policy at the Auth server boundary", () => {
    expect(config).toMatch(/^minimum_password_length\s*=\s*8\s*$/mu);
    expect(config).toMatch(
      /^password_requirements\s*=\s*"lower_upper_letters_digits_symbols"\s*$/mu,
    );
  });

  it("requires a recent session or reauthentication for password changes", () => {
    expect(config).toMatch(/^secure_password_change\s*=\s*true\s*$/mu);
  });
});
