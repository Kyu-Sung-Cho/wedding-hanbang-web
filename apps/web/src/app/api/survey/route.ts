import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { answers, otherTexts, completionTimeSeconds } = body;

    if (!answers) {
      return NextResponse.json({ error: '응답 데이터가 없습니다.' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 랭킹 데이터 처리
    const ranking = Array.isArray(answers.q13) ? answers.q13 : [];

    const row = {
      // Screening
      q1_status: answers.q1 ?? null,
      q2_region: answers.q2 ?? null,

      // Section 2
      q3_info_compare: answers.q3 ?? null,
      q4_cost_transparent: answers.q4 ?? null,
      q5_reservation_easy: answers.q5 ?? null,
      q6_price_gap: answers.q6 ?? null,
      q7_pain_points: Array.isArray(answers.q7) ? answers.q7 : null,
      q7_other: otherTexts?.q7 ?? null,

      // Section 3
      q8_planner_usage: answers.q8 ?? null,
      q8_1_planner_satisfaction: answers.q8_1 ?? null,
      q8_2_no_planner_reasons: Array.isArray(answers.q8_2) ? answers.q8_2 : null,
      q8_2_other: otherTexts?.q8_2 ?? null,
      q9_commission_awareness: answers.q9 ?? null,
      q10_transparency_impact: answers.q10 ?? null,

      // Section 4
      q11_main_channel: answers.q11 ?? null,
      q11_other: otherTexts?.q11 ?? null,
      q11_1_channel_satisfaction: answers.q11_1 ?? null,
      q12_dissatisfaction: Array.isArray(answers.q12) ? answers.q12 : null,
      q12_other: otherTexts?.q12 ?? null,

      // Section 5
      q13_feature_rank_1: ranking[0] ?? null,
      q13_feature_rank_2: ranking[1] ?? null,
      q13_feature_rank_3: ranking[2] ?? null,
      q14_ai_expectations: Array.isArray(answers.q14) ? answers.q14 : null,

      // Section 6
      q15_a_fair_price: answers.q15?.q15_a ?? null,
      q15_b_max_price: answers.q15?.q15_b ?? null,
      q16_payment_preference: answers.q16 ?? null,

      // Section 7
      q17_interested_services: Array.isArray(answers.q17) ? answers.q17 : null,
      q17_other: otherTexts?.q17 ?? null,
      q18_lacking_info: answers.q18 ?? null,
      q18_other: otherTexts?.q18 ?? null,

      // Section 8
      q19_usage_intent: answers.q19 ?? null,
      q20_nps: answers.q20 ?? null,
      q21_feedback: answers.q21 ?? null,

      // Section 9
      q22_gender: answers.q22?.q22_gender ?? null,
      q22_age: answers.q22?.q22_age ?? null,
      q22_budget: answers.q22?.q22_budget ?? null,
      q23_contact: answers.q23 ?? null,

      // 메타
      completion_time_seconds: completionTimeSeconds ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
      screen_out: false,
    };

    const { error } = await supabase
      .from('customer_survey_responses')
      .insert(row);

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json(
        { error: '응답 저장에 실패했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Survey API error:', err);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
