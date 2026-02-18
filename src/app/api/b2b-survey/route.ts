import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopType, answers, otherTexts, completionTimeSeconds } = body;

    if (!shopType || !answers) {
      return NextResponse.json(
        { error: '필수 데이터가 없습니다.' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 연락처 데이터 추출
    const contact = answers.contact as Record<string, string> | undefined;

    const row = {
      shop_type: shopType,

      // Section 1: 업체 현황
      q1_shop_subtype: answers.q1 ?? null,
      q1_other: otherTexts?.q1 ?? null,
      q2_years: answers.q2 ?? null,
      q3_employees: answers.q3 ?? null,
      q4_monthly_bookings: answers.q4 ?? null,
      q5_marketing_budget: answers.q5 ?? null,

      // Section 2: 고객 유치
      q6_main_channel: answers.q6 ?? null,
      q7_cost_burden: answers.q7 ?? null,
      q7_1_fair_commission: answers.q7_1 ?? null,
      q8_contract_rate: answers.q8 ?? null,
      q9_pain_points: Array.isArray(answers.q9) ? answers.q9 : null,

      // Section 3: 기존 플랫폼
      q10_platform_issues: Array.isArray(answers.q10) ? answers.q10 : null,
      q11_ai_pre_info: answers.q11 ?? null,
      q12_ai_post_contract_info: answers.q12 ?? null,

      // Section 4: 기능 평가 (리커트)
      q13_feature_score: answers.q13 ?? null,
      q14_feature_score: answers.q14 ?? null,
      q15_feature_score: answers.q15 ?? null,
      q16_feature_score: answers.q16 ?? null,
      q17_feature_score: answers.q17 ?? null,
      q18_feature_score: answers.q18 ?? null,
      q19_feature_score: answers.q19 ?? null, // 메이크업만
      q20_feature_score: answers.q20 ?? null, // 메이크업만

      // 주관식
      q_customer_traits: answers.q_traits ?? null,
      q_business_analytics: answers.q_analytics ?? null,

      // Section 5: 파트너십
      q_partnership_interest: answers.q21 ?? null,
      q_report_price: answers.q21_1 ?? null,
      q_other_requests: answers.q22 ?? null,

      // 연락처
      contact_shop_name: contact?.shop_name ?? null,
      contact_name: contact?.contact_name ?? null,
      contact_info: contact?.contact_info ?? null,

      // 메타
      completion_time_seconds: completionTimeSeconds ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
    };

    const { error } = await supabase
      .from('b2b_survey_responses')
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
    console.error('B2B Survey API error:', err);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
