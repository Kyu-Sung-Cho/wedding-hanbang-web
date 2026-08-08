import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// 운영 DB에 적용할 수 없으므로(봉인) 진짜 Postgres에 실행해 문법과 제약을 확인한다.
const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260806090000_amora_preparation_status.sql",
);

describe("preparation status migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS public;
      CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      INSERT INTO public.profiles DEFAULT VALUES;
    `);
    // postcheck 블록이 여기서 함께 돈다.
    await db.exec(await readFile(migrationPath, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("기존 사용자의 준비를 멈춘 것처럼 만들지 않는다", async () => {
    const result = await db.query<{ preparation_status: string }>(
      "SELECT preparation_status FROM public.profiles",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].preparation_status).toBe("preparing");
  });

  it("세 가지 상태만 받아들인다", async () => {
    for (const status of ["preparing", "paused", "called_off"]) {
      await db.query("UPDATE public.profiles SET preparation_status = $1", [status]);
    }
    await expect(
      db.query("UPDATE public.profiles SET preparation_status = $1", ["wat"]),
    ).rejects.toThrow();
  });

  it("다시 실행해도 깨지지 않는다", async () => {
    await db.exec(await readFile(migrationPath, "utf8"));
    const result = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'profiles_preparation_status_check'",
    );
    expect(result.rows[0].n).toBe(1);
  });
});
