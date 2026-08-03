import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { allQuestions } from '@/app/customersurvey/data/questions';
import { CURRENT_CUSTOMER_SURVEY_CONSENT_VERSION } from '@/lib/survey/consent';

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn(),
  createAdminClient: vi.fn(),
  insert: vi.fn(),
  verifyTurnstile: vi.fn(),
}));

vi.mock('@/utils/rateLimit', () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  getClientIp: () => '203.0.113.8',
  rateLimitKey: () => 'survey:ip-key',
}));

vi.mock('@/lib/turnstile', () => ({
  verifyTurnstile: mocks.verifyTurnstile,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { POST } from './route';

function validAnswers(overrides: Record<string, unknown> = {}) {
  return {
    q1: 1,
    q2: 1,
    q3: 3,
    q4: 3,
    q5: 3,
    q6: 2,
    q7: [1],
    q8: 2,
    q9: 2,
    q10: 3,
    q11: 8,
    q13: ['A', 'B', 'C'],
    q14: [1, 2],
    q15: { q15_a: 9_900, q15_b: 19_900 },
    q16: 3,
    q17: [1, 2],
    q18: 1,
    q19: 2,
    q20: 8,
    q22: {
      q22_gender: '응답 안 함',
      q22_age: '30대',
      q22_budget: '500~700만원',
    },
    ...overrides,
  };
}

function oversizedChunkedRequest(maxBytes: number) {
  let pullCount = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1;
      if (pullCount === 1) controller.enqueue(new Uint8Array(maxBytes));
      else if (pullCount === 2) controller.enqueue(new Uint8Array([1]));
      else controller.enqueue(new Uint8Array(1_000_000));
    },
  }, { highWaterMark: 0 });

  return {
    url: 'https://hanbang.ai/api/survey',
    headers: new Headers({ 'content-type': 'application/json' }),
    body,
  } as unknown as NextRequest;
}

describe('anonymous customer survey privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.insert.mockResolvedValue({ error: null });
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ insert: mocks.insert })),
    });
  });

  it('does not present the retired contact question', () => {
    expect(allQuestions.some((question) => question.id === 'q23')).toBe(false);
  });

  it('rejects an oversized chunked body without Content-Length before CAPTCHA or storage', async () => {
    const request = oversizedChunkedRequest(32 * 1024);
    expect(request.headers.get('content-length')).toBeNull();

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('ignores a forged legacy contact answer at the server boundary', async () => {
    const response = await POST(new NextRequest('https://hanbang.ai/api/survey', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: validAnswers({ q23: 'person@example.com' }),
        otherTexts: {},
        turnstileToken: 'captcha-token',
        consent: true,
        consentVersion: CURRENT_CUSTOMER_SURVEY_CONSENT_VERSION,
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith(
      'captcha-token',
      '203.0.113.8',
      'survey',
      'hanbang.ai',
    );
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    const insertedRow = mocks.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedRow).not.toHaveProperty('q23_contact');
    expect(insertedRow).not.toHaveProperty('user_agent');
    expect(JSON.stringify(insertedRow)).not.toContain('person@example.com');
    expect(insertedRow.survey_consent_version).toBe(CURRENT_CUSTOMER_SURVEY_CONSENT_VERSION);
    expect(typeof insertedRow.survey_consented_at).toBe('string');
  });

  it('rejects missing or stale survey consent before CAPTCHA and storage', async () => {
    for (const consent of [
      {},
      { consent: true, consentVersion: '2026-08-02' },
      { consent: false, consentVersion: CURRENT_CUSTOMER_SURVEY_CONSENT_VERSION },
    ]) {
      vi.clearAllMocks();
      mocks.checkRateLimitPersistent.mockResolvedValue(null);
      const response = await POST(new NextRequest('https://hanbang.ai/api/survey', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: { q1: 1 },
          otherTexts: {},
          turnstileToken: 'captcha-token',
          ...consent,
        }),
      }));

      expect(response.status).toBe(400);
      expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    }
  });

  it('rejects analytics-poisoning values after CAPTCHA but before storage', async () => {
    const response = await POST(new NextRequest('https://hanbang.ai/api/survey', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: validAnswers({ q20: 999 }),
        otherTexts: {},
        turnstileToken: 'captcha-token',
        consent: true,
        consentVersion: CURRENT_CUSTOMER_SURVEY_CONSENT_VERSION,
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.verifyTurnstile).toHaveBeenCalledTimes(1);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    '일반적인 서비스 개선 의견',
    '홍길동 주민등록번호 900101-1234567, 서울 강남구',
  ])('rejects retired anonymous free text before storage: %s', async (q21) => {
    const response = await POST(new NextRequest('https://hanbang.ai/api/survey', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: validAnswers({ q21 }),
        otherTexts: {},
        turnstileToken: 'captcha-token',
        consent: true,
        consentVersion: CURRENT_CUSTOMER_SURVEY_CONSENT_VERSION,
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '개인정보 보호를 위해 현재 설문에서는 자유서술을 받지 않습니다.',
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('never sends retired free-text columns to Supabase', async () => {
    const response = await POST(new NextRequest('https://hanbang.ai/api/survey', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: validAnswers(),
        otherTexts: {},
        turnstileToken: 'captcha-token',
        consent: true,
        consentVersion: CURRENT_CUSTOMER_SURVEY_CONSENT_VERSION,
      }),
    }));

    expect(response.status).toBe(200);
    const insertedRow = mocks.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    for (const column of [
      'q7_other', 'q8_2_other', 'q11_other', 'q12_other',
      'q17_other', 'q18_other', 'q21_feedback',
    ]) {
      expect(insertedRow).not.toHaveProperty(column);
    }
  });
});
