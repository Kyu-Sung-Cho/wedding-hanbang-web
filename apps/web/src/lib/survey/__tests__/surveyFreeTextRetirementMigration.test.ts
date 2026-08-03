// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260803114000_retire_customer_survey_free_text.sql",
  ),
  "utf8",
);

describe("customer survey free-text retirement migration", () => {
  it("redacts legacy text and rejects every future free-text column", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE TABLE public.customer_survey_responses (
          id uuid PRIMARY KEY,
          q7_other text,
          q8_2_other text,
          q11_other text,
          q12_other text,
          q17_other text,
          q18_other text,
          q21_feedback text
        );
        INSERT INTO public.customer_survey_responses (
          id, q7_other, q8_2_other, q11_other, q12_other,
          q17_other, q18_other, q21_feedback
        ) VALUES (
          '10000000-0000-4000-8000-000000000001',
          '홍길동', '900101-1234567', '서울 강남구', '@private_social',
          '110-123-456789', 'person@example.com', '일반 의견'
        );
      `);

      await db.exec(migration);

      expect((await db.query(`
        SELECT q7_other, q8_2_other, q11_other, q12_other,
               q17_other, q18_other, q21_feedback
        FROM public.customer_survey_responses
      `)).rows).toEqual([{
        q7_other: null,
        q8_2_other: null,
        q11_other: null,
        q12_other: null,
        q17_other: null,
        q18_other: null,
        q21_feedback: null,
      }]);

      await expect(db.exec(`
        UPDATE public.customer_survey_responses
        SET q21_feedback = '새 자유서술';
      `)).rejects.toThrow(/customer_survey_responses_free_text_retired/iu);
    } finally {
      await db.close();
    }
  });
});
