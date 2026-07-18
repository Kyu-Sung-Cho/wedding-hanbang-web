# 웨딩한방 업체 데이터 확보 & 결제 시스템 전략서

> 작성일: 2026-03-21
> 대상: hanbang.ai 웨딩 플랫폼
> 목적: 스드메 업체 데이터 확보 방안 + 에스크로 결제 시스템 구축 로드맵

> [!WARNING]
> 이 문서는 2026-03-21 시점의 탐색 아이디어를 보존한 역사 문서이며 현재 구현 지시서가 아닙니다. 크롤링, 외부 소개문·사진 저장, 유료 상단 노출, 광고·수수료에 따른 아모라 우선 추천 제안은 2026-07-18 현행 정책에서 금지됩니다. 현재 업체 데이터·공시 적재·추천의 단일 운영 기준은 [`VENDOR_DISCLOSURE_PIPELINE_V2_2026-07-18.md`](./operations/VENDOR_DISCLOSURE_PIPELINE_V2_2026-07-18.md)입니다. 이 문서의 시장 수치, PG 수수료, 법률 해석, API 예시는 최신성 검증을 거치지 않았으므로 사업·법률·결제 결정을 내리기 전에 각 공식 기관과 전문가에게 다시 확인해야 합니다.

---

## 목차

1. [스드메 업체 데이터 확보 전략](#1-스드메-업체-데이터-확보-전략)
   - 1.1 한국 웨딩 업체 시장 현황
   - 1.2 데이터 확보 방법 5가지
   - 1.3 시드 데이터 구조 설계
   - 1.4 업체 온보딩 프로세스
   - 1.5 법적 고려사항
2. [결제/에스크로 시스템](#2-결제에스크로-시스템)
   - 2.1 한국 PG사 완전 비교
   - 2.2 에스크로 결제 상세 설계
   - 2.3 정산 시스템
   - 2.4 법적 요구사항
   - 2.5 기술 구현 가이드
3. [수익 모델 상세](#3-수익-모델-상세)
4. [실행 로드맵](#4-실행-로드맵)
5. [리스크 및 대응 방안](#5-리스크-및-대응-방안)

---

## 1. 스드메 업체 데이터 확보 전략

### 1.1 한국 웨딩 업체 시장 현황

#### 시장 규모

| 항목 | 수치 |
|------|------|
| 연간 혼인 건수 (2025년 기준) | 약 19~20만 건 |
| 웨딩 시장 규모 | 약 10~15조 원 |
| 스드메 평균 지출 | 약 300~600만 원 |
| 스드메 업체 수 (전국 추정) | 약 3,000~5,000개 |

#### 지역별 주요 업체 분포

| 지역 | 스튜디오 | 드레스 | 메이크업 | 특징 |
|------|---------|--------|---------|------|
| **서울 강남/서초** | 150+ | 80+ | 60+ | 프리미엄 가격대, 트렌드 선도 |
| **서울 논현/청담** | 100+ | 120+ | 40+ | 드레스 밀집 지역 (논현 웨딩거리) |
| **서울 기타** | 200+ | 100+ | 80+ | 다양한 가격대 |
| **경기/인천** | 300+ | 150+ | 100+ | 가성비 위주 |
| **부산** | 100+ | 60+ | 40+ | 해운대/서면 중심 |
| **대구/대전/광주** | 각 50~80 | 각 30~50 | 각 20~30 | 지역 로컬 업체 위주 |

#### 기존 플랫폼 현황

| 플랫폼 | 등록 업체 수 | 수수료 | 특징 |
|--------|------------|--------|------|
| **아이웨딩** | 5,000+ | 건당 5~10% | 국내 최대, 오래됨, UI 노후 |
| **웨딩북** | 3,000+ | 월 구독 + 수수료 | 모바일 중심, 젊은 층 타겟 |
| **더웨딩** | 2,000+ | 광고 + 수수료 | 후기 중심 |
| **웨딩의여신** | 1,000+ | 광고 기반 | 커뮤니티 강점 |
| **결혼준비 카페 (네이버)** | - | 없음 | 비공식이지만 영향력 큼 |

**웨딩한방의 차별점**: AI가 개인화된 추천을 해준다는 점. 기존 플랫폼은 리스트 나열 → 사용자가 직접 비교. 우리는 아모라가 예산, 스타일, 위치, 일정을 종합해서 맞춤 추천.

---

### 1.2 데이터 확보 방법 5가지

#### 방법 1: 공개 API를 통한 시드 데이터 수집

**목적**: 서비스 초기에 비어보이지 않도록 기본 업체 정보 채우기

##### 네이버 플레이스 검색 API

```
활용 데이터:
- 업체명
- 카테고리 (웨딩스튜디오, 웨딩드레스, 웨딩메이크업)
- 주소 + 좌표
- 전화번호
- 영업시간
- 네이버 평점 + 리뷰 수
- 대표 이미지 (링크)

API 엔드포인트:
- 네이버 검색 API (blog, local): https://openapi.naver.com/v1/search/local
- 검색어 예시: "강남 웨딩스튜디오", "논현 웨딩드레스", "서울 웨딩메이크업"

제한사항:
- 일 25,000건 호출 가능 (무료)
- 검색 결과당 최대 5개 (페이징으로 확장)
- 상세 정보(가격, 포트폴리오)는 없음
- 네이버 이용약관 확인 필요
```

##### 카카오 로컬 API

```
활용 데이터:
- 업체명, 카테고리, 주소, 전화번호
- 카카오맵 평점
- 카테고리 코드로 정확한 필터링 가능

API 엔드포인트:
- https://dapi.kakao.com/v2/local/search/keyword
- 카테고리 그룹 코드: "SW8" (웨딩) 등

장점:
- 일 300,000건 (무료)
- 카테고리 정확도 높음
- 좌표 기반 반경 검색 가능
```

##### Google Places API

```
활용 데이터:
- 업체명, 주소, 전화번호, 웹사이트
- Google 평점 + 리뷰
- 영업시간, 사진

비용:
- 월 $200 무료 크레딧
- 이후 건당 $0.017~$0.032

장점:
- 글로벌 데이터, 외국인 리뷰 포함
- Place Details로 상세 정보

단점:
- 한국 웨딩 업체 커버리지가 네이버보다 낮음
```

##### 실행 계획

```
Step 1: 네이버 + 카카오 API로 주요 도시 웨딩 업체 크롤링
        - 서울 25개 구 × 3 카테고리 = 75개 검색
        - 경기 주요 시 20개 × 3 = 60개 검색
        - 부산/대구/대전/광주/제주 × 3 = 15개 검색
        → 예상 수집: 500~1,000개 업체 기본 정보

Step 2: 중복 제거 (이름 + 주소 기반 매칭)
        → 예상 고유 업체: 300~600개

Step 3: DB에 시드 데이터 저장
        - status: 'unverified' (미인증 업체)
        - 사용자에게는 "기본 정보만 제공, 상세 정보는 업체 인증 후"로 표시

Step 4: 인증된 파트너 업체는 별도 배지 표시
        → 사용자 신뢰도 확보 + 업체 입점 유인
```

---

#### 방법 2: 웨딩 박람회 직접 영업

##### 주요 웨딩 박람회

| 박람회 | 시기 | 장소 | 참가 업체 수 | 참가 비용 |
|--------|------|------|------------|----------|
| **서울웨딩박람회** | 매월 | 코엑스/세텍 | 200~300 | 부스 100~300만원 |
| **부산웨딩박람회** | 분기 | 벡스코 | 100~150 | 부스 50~150만원 |
| **웨딩페어코리아** | 반기 | aT센터 | 150~200 | 부스 80~200만원 |
| **네이버 웨딩박람회** | 온라인 | 네이버 | 100+ | 협의 |

##### 박람회 참가 전략

```
방법 A: 부스 참가 (비용 높음, 효과 큼)
- 부스 설치: "AI 웨딩 플래너" 체험 부스
- 고객 → 아모라 데모 체험 → 사전등록 유도
- 업체 → 입점 제안 (현장에서 QR로 바로 가입)
- 비용: 100~300만원/회
- 예상 성과: 업체 20~50곳 컨택, 고객 200~500명

방법 B: 방문자로 참가 (비용 없음, 효과 중간)
- 입장권만 구매 (1~2만원)
- 각 부스 돌면서 업체 명함 수집
- 박람회 후 이메일/전화로 B2B 제안
- 예상 성과: 업체 50~100곳 컨택

방법 C: 미디어/스폰서 참가
- 박람회 주최측에 미디어 파트너 제안
- "참가 업체 무료 AI 프로필 생성" 서비스
- 업체에게 가치를 먼저 제공 → 자연스러운 입점
```

##### 업체 영업 피치

```
"안녕하세요, AI 웨딩 플래너 '웨딩한방'입니다.

저희 플랫폼에서는 AI가 예비 부부의 예산, 스타일, 일정을 분석해서
딱 맞는 업체를 추천해드립니다.

기존 플랫폼과 다른 점:
✅ AI 맞춤 추천 → 적합한 고객만 연결 (허수 문의 감소)
✅ 에스크로 결제 → 노쇼/환불 분쟁 최소화
✅ 3개월 무료 → 리스크 없이 시작

현재 사전등록 고객 OOO명이 업체 추천을 기다리고 있습니다.
지금 입점하시면 초기 파트너로 상단 노출 혜택을 드립니다."
```

---

#### 방법 3: 업체 자발적 입점 시스템

##### 현재 이미 있는 인프라 활용

웨딩한방에는 이미 `/vendor/login`, B2B 설문 시스템이 있음.

```
업체 입점 플로우:
1. hanbang.ai/vendor → 업체용 랜딩페이지
2. "무료 입점 신청" 클릭
3. 기본 정보 입력 (업체명, 카테고리, 지역, 연락처)
4. 사업자등록증 업로드 (인증용)
5. 포트폴리오 사진 업로드
6. 가격 정보 입력 (가격대 범위)
7. 검수 → 승인 → 프로필 공개

업체에게 제공하는 가치:
- 무료 AI 프로필 페이지 (SEO 최적화)
- 아모라가 맞춤 고객을 추천
- 예약/문의 관리 대시보드
- 리뷰/평점 관리
- 월간 인사이트 리포트 (조회수, 문의 수, 예약 전환율)
```

##### 자발적 입점을 유도하는 방법

```
1. SEO 전략
   - "강남 웨딩스튜디오 추천", "2026 드레스 가격" 등 키워드로
     hanbang.ai가 검색 상위에 노출
   - 업체 입장에서 "여기에 등록하면 검색 노출에 유리하겠다"

2. 콘텐츠 마케팅
   - "2026 스드메 트렌드 리포트" 발행
   - 업체 인터뷰/소개 콘텐츠
   - 업체에게 "저희가 소개 콘텐츠를 만들어드릴게요" 제안

3. 초기 인센티브
   - 처음 100개 업체: 영구 수수료 50% 할인
   - 처음 50개 업체: "오리지널 파트너" 배지
   - 3개월 무료 후 월 5만원 또는 건당 3%

4. 기존 고객 활용
   - 고객이 채팅에서 "○○ 스튜디오 계약했어" 언급
   - → 해당 업체에 "고객분이 저희 플랫폼에서 추천받아 계약하셨어요" 연락
   - → 자연스러운 입점 유도
```

---

#### 방법 4: 크롤링 + 데이터 어그리게이션

##### 수집 가능한 공개 소스

| 소스 | 수집 가능 데이터 | 법적 리스크 |
|------|-----------------|-----------|
| 네이버 블로그/카페 | 업체 후기, 가격 정보 | 중 (저작권 주의) |
| 인스타그램 | 포트폴리오 사진, 해시태그 | 중 (API 정책) |
| 업체 자체 웹사이트 | 가격표, 포트폴리오, 연락처 | 낮음 (공개 정보) |
| 네이버 플레이스 | 리뷰, 평점, 기본정보 | 낮음 (공개 정보) |
| 공정거래위원회 | 사업자 정보 | 없음 (공공 데이터) |

##### 크롤링 시 주의사항

```
반드시 준수:
1. robots.txt 확인 및 준수
2. 과도한 요청 금지 (1초에 1건 이하)
3. 개인정보(대표자 주민번호 등) 절대 수집 금지
4. 수집 후 업체에 고지 및 삭제 요청 시 즉시 삭제
5. 수집 데이터는 업체 동의 전까지 내부 참고용으로만 사용

권장 접근법:
- 공개 API(네이버/카카오)로 기본 정보 수집 → 합법
- 업체 웹사이트의 공개 가격표/포트폴리오 → 참고용
- 실제 서비스에 노출할 때는 업체 동의 필수
```

---

#### 방법 5: 사용자 생성 데이터 (UGC) 활용

```
아모라 채팅에서 자연스럽게 데이터 축적:

사용자: "어제 아이린 스튜디오에서 촬영했어"
아모라: "촬영 잘 되셨나요? 혹시 다른 분들을 위해
        간단한 후기를 남겨주실 수 있나요?"

→ 리뷰 데이터 축적
→ 해당 업체 정보 자동 등록 (미인증 상태)
→ 리뷰가 3개 이상 쌓이면 업체에 "고객들이 좋은 후기를 남겨주셨어요" 알림
→ 업체 입점 유도
```

##### UGC 데이터 활용 구조

```
chat_messages에서 업체 언급 감지
    ↓
vendors 테이블에 자동 등록 (status: 'user_mentioned')
    ↓
같은 업체 언급 3회 이상 → status: 'popular_unverified'
    ↓
업체에 연락 → 입점 제안
    ↓
업체 가입 → status: 'verified'
    ↓
포트폴리오/가격 직접 관리 → status: 'premium_partner'
```

---

### 1.3 시드 데이터 구조 설계

#### vendors 테이블 확장

```sql
-- 기존 vendors 테이블에 추가할 컬럼들
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS
  -- 기본 정보
  business_number TEXT,              -- 사업자등록번호
  representative_name TEXT,          -- 대표자명
  establishment_date DATE,           -- 설립일

  -- 상세 카테고리
  sub_category TEXT[],               -- ['야외촬영', '스냅', '본식DVD']
  style_tags TEXT[],                 -- ['모던', '클래식', '자연스러운']

  -- 가격 정보
  price_range_min INTEGER,           -- 최소 가격 (원)
  price_range_max INTEGER,           -- 최대 가격 (원)
  price_packages JSONB,              -- 패키지 상세
  -- 예: [{"name": "베이직", "price": 800000, "includes": ["원판 200장", "보정 30장"]}, ...]

  -- 위치
  address_detail TEXT,               -- 상세 주소
  latitude DECIMAL(10,7),            -- 위도
  longitude DECIMAL(10,7),           -- 경도
  nearest_station TEXT,              -- 가장 가까운 지하철역
  parking_available BOOLEAN,         -- 주차 가능 여부

  -- 포트폴리오
  portfolio_images TEXT[],           -- 포트폴리오 이미지 URL 배열
  portfolio_video_url TEXT,          -- 포트폴리오 영상 URL
  instagram_url TEXT,                -- 인스타그램
  website_url TEXT,                  -- 웹사이트
  blog_url TEXT,                     -- 네이버 블로그

  -- 운영 정보
  operating_hours JSONB,             -- {"mon": "10:00-19:00", "tue": "10:00-19:00", ...}
  closed_days TEXT[],                -- ['일요일', '공휴일']
  reservation_required BOOLEAN,      -- 예약 필수 여부
  lead_time_days INTEGER,            -- 최소 예약 필요 기간 (일)

  -- 평가
  average_rating DECIMAL(2,1),       -- 평균 평점 (4.5)
  review_count INTEGER DEFAULT 0,    -- 리뷰 수
  naver_rating DECIMAL(2,1),         -- 네이버 평점
  kakao_rating DECIMAL(2,1),         -- 카카오 평점

  -- 인증/상태
  verification_status TEXT DEFAULT 'unverified',
  -- 'unverified' | 'user_mentioned' | 'contacted' | 'verified' | 'premium_partner'
  verification_date TIMESTAMPTZ,
  business_license_url TEXT,         -- 사업자등록증 이미지

  -- 메타
  data_source TEXT,                  -- 'api_naver' | 'api_kakao' | 'manual' | 'user_mention' | 'self_register'
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  featured BOOLEAN DEFAULT false,    -- 상단 노출 (유료)
  partner_since TIMESTAMPTZ          -- 파트너 시작일
);

-- 인덱스
CREATE INDEX idx_vendors_category ON vendors(category);
CREATE INDEX idx_vendors_region ON vendors(region);
CREATE INDEX idx_vendors_status ON vendors(verification_status);
CREATE INDEX idx_vendors_rating ON vendors(average_rating DESC);
CREATE INDEX idx_vendors_location ON vendors USING gist(
  ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
);
```

#### vendor_reviews 테이블 (신규)

```sql
CREATE TABLE vendor_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- 평가
  overall_rating INTEGER CHECK (overall_rating BETWEEN 1 AND 5),
  quality_rating INTEGER CHECK (quality_rating BETWEEN 1 AND 5),    -- 퀄리티
  price_rating INTEGER CHECK (price_rating BETWEEN 1 AND 5),        -- 가격 대비 만족
  service_rating INTEGER CHECK (service_rating BETWEEN 1 AND 5),    -- 서비스/친절도

  -- 내용
  content TEXT NOT NULL,
  pros TEXT,                    -- 장점
  cons TEXT,                    -- 단점

  -- 상세
  visit_date DATE,              -- 방문/이용 날짜
  package_used TEXT,            -- 이용한 패키지명
  actual_price INTEGER,         -- 실제 결제 금액

  -- 사진
  review_images TEXT[],         -- 리뷰 사진 URL 배열

  -- 메타
  is_verified_purchase BOOLEAN DEFAULT false,  -- 웨딩한방에서 예약한 건인지
  helpful_count INTEGER DEFAULT 0,
  report_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',  -- 'active' | 'hidden' | 'reported'

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE vendor_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read all reviews" ON vendor_reviews FOR SELECT USING (status = 'active');
CREATE POLICY "Users can write own reviews" ON vendor_reviews FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can edit own reviews" ON vendor_reviews FOR UPDATE USING (auth.uid() = user_id);
```

#### vendor_packages 테이블 (신규)

```sql
CREATE TABLE vendor_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,

  name TEXT NOT NULL,             -- 패키지명 (예: "프리미엄 웨딩 촬영")
  description TEXT,               -- 설명
  price INTEGER NOT NULL,         -- 가격 (원)
  discount_price INTEGER,         -- 할인 가격

  includes JSONB,                 -- 포함 항목
  -- 예: ["원판 300장", "보정 50장", "앨범 1권", "액자 2개"]

  duration_minutes INTEGER,       -- 소요 시간 (분)
  max_persons INTEGER,            -- 최대 인원

  -- 예약 관련
  available_dates JSONB,          -- 예약 가능 요일/시간
  blackout_dates DATE[],          -- 예약 불가 날짜

  is_popular BOOLEAN DEFAULT false,  -- 인기 패키지 표시
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 1.4 업체 온보딩 프로세스

```
┌─────────────────────────────────────────────────┐
│  업체 온보딩 프로세스 (Self-Service)             │
├─────────────────────────────────────────────────┤
│                                                 │
│  1. hanbang.ai/vendor 접속                      │
│     └→ "무료 입점 신청" 클릭                     │
│                                                 │
│  2. 기본 정보 입력 (5분)                         │
│     ├→ 업체명, 카테고리(스/드/메)                │
│     ├→ 지역, 주소                               │
│     ├→ 대표 연락처, 이메일                       │
│     └→ 대표 이미지 1장                          │
│                                                 │
│  3. 사업자 인증 (2분)                            │
│     ├→ 사업자등록번호 입력                       │
│     ├→ 국세청 API로 자동 진위 확인               │
│     └→ 사업자등록증 사본 업로드                   │
│                                                 │
│  4. 상세 프로필 작성 (10분, 나중에 해도 됨)      │
│     ├→ 포트폴리오 사진 (최대 30장)               │
│     ├→ 패키지/가격 정보                          │
│     ├→ 스타일 태그 선택                          │
│     ├→ 영업시간, 휴무일                          │
│     └→ SNS 링크                                 │
│                                                 │
│  5. 검수 (웨딩한방 내부, 1~2 영업일)             │
│     ├→ 사업자 진위 확인                          │
│     ├→ 포트폴리오 적절성 확인                    │
│     └→ 가격 정보 합리성 확인                     │
│                                                 │
│  6. 승인 → 프로필 공개                           │
│     ├→ 업체 대시보드 접근 가능                   │
│     ├→ 아모라 추천 대상에 포함                   │
│     └→ "인증 업체" 배지 표시                     │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

### 1.5 법적 고려사항

#### 개인정보보호법

```
수집 시:
- 업체 정보(상호명, 사업자번호, 주소)는 사업자 정보이므로 개인정보 아님
- 대표자 이름, 연락처는 개인정보 → 수집 동의 필요
- 업체 가입 시 개인정보 수집·이용 동의서 받기

표시 시:
- 사업자 정보(상호명, 주소, 사업자번호)는 공개 가능 (전자상거래법)
- 대표자 개인 연락처는 업체 동의 없이 공개 금지
- 리뷰에 개인 식별 정보 포함 시 블라인드 처리
```

#### 전자상거래법

```
통신판매중개자 의무 (웨딩한방 = 중개자):
1. 통신판매중개자임을 명확히 고지
2. 실제 판매자(업체) 정보를 소비자에게 제공
3. 중개 수수료 구조 투명하게 공개
4. 소비자 피해 시 중개자 연대 책임 가능성 → 이용약관에 면책 조항 필요
```

#### 공정거래법

```
- 리뷰 조작 금지 (가짜 리뷰, 별점 조작)
- 광고성 콘텐츠 명확히 표시 ("광고", "제휴" 표시)
- 업체 순위/추천 기준 투명하게 공개
- 특정 업체 부당하게 우대/차별 금지
```

---

## 2. 결제/에스크로 시스템

### 2.1 한국 PG사 완전 비교

#### 포트원 (PortOne, 구 아임포트)

```
역할: 멀티PG 통합 API (PG사가 아닌 PG 어그리게이터)
       → 하나의 API로 여러 PG사 연동

특징:
- REST API + JavaScript SDK
- Next.js 공식 지원
- 무료 (포트원 자체 수수료 없음, PG사 수수료만 부과)
- 테스트 환경 무료 제공
- 에스크로, 정기결제, 해외결제 등 모든 기능 통합

연동 가능 PG사:
- 토스페이먼츠
- NHN KCP
- 나이스페이
- 다날
- 카카오페이
- 네이버페이
- 등 20개+

API 구조:
  POST /payments/prepare     → 결제 준비
  POST /payments/{id}/pay    → 결제 실행
  GET  /payments/{id}        → 결제 조회
  POST /payments/{id}/cancel → 결제 취소
  POST /escrows/confirm      → 에스크로 구매 확인
  POST /escrows/reject       → 에스크로 구매 거절

Next.js 연동:
  npm install @portone/browser-sdk

장점:
- PG사 변경 시 코드 수정 최소화
- 관리자 콘솔에서 모든 PG 거래 통합 관리
- 웹훅으로 결제 상태 실시간 알림

단점:
- 포트원 서버 장애 시 전체 결제 불가
- PG사 직접 연동 대비 약간의 레이턴시
```

#### 토스페이먼츠

```
역할: PG사 (직접 결제 처리)

수수료:
- 카드: 2.5~3.5% (매출 규모에 따라)
- 간편결제(토스페이): 2.3~3%
- 가상계좌: 건당 300원
- 에스크로: 추가 수수료 없음 (기본 수수료에 포함)

에스크로 지원:
- 가상계좌 에스크로: 지원
- 카드 에스크로: 지원 (일부 카드사)
- 간편결제 에스크로: 지원

가입 요건:
- 사업자등록증
- 통신판매업 신고증
- 대표자 신분증
- 심사 기간: 3~5 영업일

API:
- REST API + JavaScript SDK
- Next.js 가이드 문서 있음
- 테스트 키 즉시 발급

  POST /v1/payments/confirm              → 결제 승인
  GET  /v1/payments/{paymentKey}         → 결제 조회
  POST /v1/payments/{paymentKey}/cancel  → 결제 취소
  POST /v1/payments/{paymentKey}/escrow/complete → 에스크로 완료

장점:
- API 문서 품질 최고
- 대시보드 UI 직관적
- 스타트업 친화적 (심사 관대)
- 실시간 정산 가능 (D+1)

단점:
- 대형 가맹점 대비 수수료 약간 높음
```

#### NHN KCP

```
역할: PG사 (국내 점유율 1위급)

수수료:
- 카드: 2.2~3.3%
- 가상계좌: 건당 200~300원
- 에스크로: 기본 수수료에 포함

에스크로 특화:
- 국내 에스크로 결제 점유율 높음
- 배송/서비스 완료 확인 프로세스 체계적
- 자동 구매확인 (14일 후) 설정 가능

장점:
- 에스크로 안정성 높음
- 대규모 거래 처리 경험
- PG 업계 레퍼런스 풍부

단점:
- API 문서가 토스 대비 덜 깔끔
- 가입/심사 과정이 다소 느림
- 관리자 페이지 UI 오래됨
```

#### 나이스페이

```
역할: PG사

수수료:
- 카드: 2.3~3.3%
- 에스크로: 기본 수수료에 포함

특징:
- 대형 가맹점 위주
- 안정성 높음
- 에스크로 지원

장단점:
- 장점: 안정적, 대량 거래에 강함
- 단점: 소규모 스타트업 심사 어려울 수 있음
```

#### 간편결제 (카카오페이, 네이버페이, 토스페이)

```
카카오페이:
- 수수료: 2~3%
- 에스크로: 별도 연동 필요
- 장점: 카카오 사용자 기반 넓음, 알림톡 연동
- 단점: 에스크로 자체 지원 약함

네이버페이:
- 수수료: 2~3.5%
- 에스크로: 네이버페이 자체 에스크로 내장
- 장점: 네이버 쇼핑 연동, 에스크로 잘 됨
- 단점: 네이버 생태계 의존

토스페이:
- 수수료: 2.3~3%
- 에스크로: 토스페이먼츠 에스크로 연동
- 장점: 사용 편의성 최고, 20대 사용률 높음
- 단점: 단독 PG로는 부족
```

#### 최종 추천 조합

```
┌───────────────────────────────────────┐
│  추천: 포트원 + 토스페이먼츠 (메인)    │
│        + 카카오페이 + 네이버페이 (보조) │
└───────────────────────────────────────┘

이유:
1. 포트원으로 감싸면 → 코드 1번 작성, PG 여러 개 연동
2. 토스페이먼츠가 메인 → API 품질, 에스크로, 정산 우수
3. 카카오페이/네이버페이는 사용자 선호도 높음 → 전환율 향상
4. 나중에 KCP나 나이스페이 추가도 포트원 설정만 변경하면 끝
```

---

### 2.2 에스크로 결제 상세 설계

#### 전체 플로우

```
┌──────────────────────────────────────────────────────────────┐
│                    에스크로 결제 전체 플로우                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  [1. 예약 단계]                                               │
│  고객 → 업체 선택 → 패키지 선택 → 날짜 선택                    │
│       → 결제 수단 선택 → "에스크로 결제" 안내 표시              │
│       → 결제 진행                                             │
│                                                              │
│  [2. 결제 단계]                                               │
│  PG사 결제 → 성공 → 에스크로 계좌에 금액 보관                   │
│  고객 상태: "결제 완료 (에스크로 보관 중)"                       │
│  업체 상태: "새 예약 접수됨"                                    │
│                                                              │
│  [3. 업체 확인 단계] (24시간 이내)                              │
│  업체 → 예약 확인/거절                                         │
│  확인 → 고객에게 "예약 확정" 알림                               │
│  거절 → 고객에게 전액 환불 + "예약 거절됨" 알림                  │
│                                                              │
│  [4. 서비스 이행 단계]                                         │
│  서비스 날짜 도래 → 업체가 서비스 제공                           │
│  (스튜디오 촬영, 드레스 피팅, 메이크업 시술 등)                   │
│                                                              │
│  [5. 구매 확인 단계] (서비스 후 7일 이내)                       │
│  고객에게 "서비스에 만족하셨나요?" 알림                           │
│                                                              │
│  ┌─ "확인" → 에스크로 해제 → 업체에 정산                        │
│  │                                                           │
│  ├─ "불만" → 분쟁 조정 절차 시작                                │
│  │   ├→ 웨딩한방 중재 (3일)                                    │
│  │   ├→ 합의 → 부분 환불 or 전액 환불 or 전액 정산              │
│  │   └→ 미합의 → 소비자원 안내                                 │
│  │                                                           │
│  └─ 7일 무응답 → 자동 구매 확인 → 업체 정산                     │
│                                                              │
│  [6. 정산 단계]                                               │
│  에스크로 해제 → 수수료 차감 → 업체 계좌 입금                    │
│  정산 주기: 구매 확인 후 D+3 (영업일 기준)                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### 상태 머신

```
예약 상태 (reservation_status):

  PENDING_PAYMENT    결제 대기
       ↓
  PAYMENT_HELD       에스크로 보관 중
       ↓
  ┌─ CONFIRMED       업체 확인 완료
  │      ↓
  │  SERVICE_DATE    서비스 날짜 도래
  │      ↓
  │  ┌─ COMPLETED    구매 확인 (고객 확인 or 자동)
  │  │      ↓
  │  │  SETTLED      업체 정산 완료
  │  │
  │  └─ DISPUTED     분쟁 중
  │         ↓
  │     ┌─ RESOLVED_FULL_REFUND     전액 환불
  │     ├─ RESOLVED_PARTIAL_REFUND  부분 환불
  │     └─ RESOLVED_SETTLED         전액 정산
  │
  └─ REJECTED        업체 거절 → 전액 환불
       ↓
     REFUNDED         환불 완료
```

#### 금액 흐름 예시

```
예시: 고객이 스튜디오 촬영 150만원 패키지 예약

결제 시:
  고객 카드에서 1,500,000원 결제
  → PG사 에스크로 계좌에 보관

서비스 완료 + 구매 확인:
  에스크로 해제: 1,500,000원
  - PG 수수료 (3%): -45,000원
  - 웨딩한방 수수료 (5%): -75,000원
  = 업체 정산액: 1,380,000원

  웨딩한방 수익: 75,000원
  PG사 수수료: 45,000원 (웨딩한방이 부담 or 업체 부담 - 정책에 따라)
```

---

### 2.3 정산 시스템

#### 정산 플로우

```
┌────────────────────────────────────────────────┐
│              정산 시스템 설계                     │
├────────────────────────────────────────────────┤
│                                                │
│  [매일 자정 배치]                                │
│  1. 구매 확인된 건 조회                          │
│  2. 수수료 계산                                 │
│  3. 정산 내역 생성                              │
│  4. 업체별 정산 합계 계산                        │
│                                                │
│  [정산일 (D+3)]                                 │
│  5. 업체 정산 계좌로 이체                        │
│  6. 정산 완료 알림 (이메일 + 앱 알림)            │
│  7. 세금계산서 자동 발행                         │
│                                                │
│  [업체 대시보드]                                 │
│  - 실시간 매출 현황                              │
│  - 정산 예정 금액                               │
│  - 정산 완료 내역                               │
│  - 월간/주간 리포트                              │
│  - 세금계산서 다운로드                           │
│                                                │
└────────────────────────────────────────────────┘
```

#### 정산 테이블 설계

```sql
-- 예약/결제 테이블
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 관계
  customer_id UUID REFERENCES profiles(id),
  vendor_id UUID REFERENCES vendors(id),
  package_id UUID REFERENCES vendor_packages(id),
  couple_id UUID REFERENCES couples(id),

  -- 예약 정보
  service_date DATE NOT NULL,
  service_time TIME,
  special_requests TEXT,
  person_count INTEGER DEFAULT 2,

  -- 결제 정보
  payment_key TEXT,                  -- PG사 결제 키
  payment_method TEXT,               -- 'card' | 'virtual_account' | 'kakao' | 'naver' | 'toss'
  total_amount INTEGER NOT NULL,     -- 총 결제 금액
  escrow_status TEXT DEFAULT 'pending',
  -- 'pending' | 'held' | 'released' | 'refunded' | 'partial_refunded'

  -- 상태
  status TEXT DEFAULT 'pending_payment',
  -- 위 상태 머신 참고

  -- 분쟁
  dispute_reason TEXT,
  dispute_date TIMESTAMPTZ,
  dispute_resolution TEXT,
  dispute_resolved_date TIMESTAMPTZ,

  -- 타임스탬프
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,          -- 구매 확인 시간
  cancelled_at TIMESTAMPTZ,

  -- 자동 구매확인 예정일
  auto_confirm_date DATE             -- 서비스일 + 7일
);

-- 정산 테이블
CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  vendor_id UUID REFERENCES vendors(id),
  reservation_id UUID REFERENCES reservations(id),

  -- 금액
  total_amount INTEGER NOT NULL,        -- 결제 총액
  pg_fee INTEGER NOT NULL,              -- PG 수수료
  platform_fee INTEGER NOT NULL,        -- 웨딩한방 수수료
  settlement_amount INTEGER NOT NULL,   -- 정산액 (총액 - PG - 플랫폼)

  -- 수수료율
  pg_fee_rate DECIMAL(4,2),             -- PG 수수료율 (예: 3.00)
  platform_fee_rate DECIMAL(4,2),       -- 플랫폼 수수료율 (예: 5.00)

  -- 정산 상태
  status TEXT DEFAULT 'pending',
  -- 'pending' | 'scheduled' | 'processing' | 'completed' | 'failed'

  scheduled_date DATE,                  -- 정산 예정일
  completed_date DATE,                  -- 실제 정산일

  -- 이체 정보
  bank_name TEXT,
  account_number TEXT,
  account_holder TEXT,
  transfer_reference TEXT,              -- 이체 참조번호

  -- 세금
  tax_invoice_issued BOOLEAN DEFAULT false,
  tax_invoice_number TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 정산 요약 (월간)
CREATE TABLE settlement_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID REFERENCES vendors(id),

  year INTEGER NOT NULL,
  month INTEGER NOT NULL,

  total_reservations INTEGER DEFAULT 0,
  total_revenue INTEGER DEFAULT 0,
  total_pg_fees INTEGER DEFAULT 0,
  total_platform_fees INTEGER DEFAULT 0,
  total_settled INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vendor_id, year, month)
);
```

---

### 2.4 법적 요구사항

#### 필수 인허가

```
1. 사업자등록
   - 이미 보유하고 있다면 업종 추가 필요
   - 업종: "통신판매업" 또는 "전자상거래업"

2. 통신판매업 신고
   - 관할 시/구청 지역경제과
   - 필요 서류: 사업자등록증, 대표자 신분증, 도메인 등록 확인서
   - 온라인 신고 가능 (정부24)
   - 처리 기간: 3~5 영업일
   - 비용: 무료

3. 에스크로 또는 소비자피해보상보험
   - 전자상거래법 제24조: 선불 결제 시 의무
   - 에스크로 이용 → PG사 에스크로 서비스 가입으로 충족
   - 또는 소비자피해보상보험 가입 (SGI서울보증)
   - 추천: 에스크로 + 보험 둘 다

4. 개인정보처리방침 공개
   - 결제 시 수집하는 개인정보 항목 명시
   - 카드정보는 PG사가 처리 → 웨딩한방은 카드번호 직접 수집/저장 금지
```

#### 통신판매중개자 의무사항

```
웨딩한방 = 통신판매중개자 (업체와 고객을 연결)

의무:
1. 사이트에 "통신판매중개자"임을 명확히 표시
2. "중개자는 통신판매의 당사자가 아닙니다" 고지
3. 판매자(업체) 정보를 소비자에게 제공
   - 상호명, 대표자, 사업자등록번호, 연락처, 주소
4. 분쟁 발생 시 중재 절차 안내
5. 결제 내역 5년 보관

이용약관에 포함할 사항:
- 서비스 이용 조건
- 결제/환불 정책
- 에스크로 운영 규정
- 분쟁 해결 절차
- 개인정보 처리 방침
- 면책 조항 (업체의 서비스 품질에 대한 직접 책임 제한)
```

#### 세금 관련

```
매출 세금:
- 웨딩한방 수수료 수입에 대해 부가세 10% 납부
- 업체에 세금계산서 발행 (수수료에 대해)

원천징수:
- 업체가 사업자인 경우: 원천징수 불필요
- 업체가 프리랜서(개인)인 경우: 3.3% 원천징수

정산 시 고려:
- 부가세 포함/별도 여부 명확히
- 예: 수수료 5% (부가세 별도) → 실제 5.5%
```

---

### 2.5 기술 구현 가이드

#### 포트원 + 토스페이먼츠 연동 (Next.js)

```typescript
// 1. 패키지 설치
// npm install @portone/browser-sdk

// 2. 환경변수 (.env.local)
// NEXT_PUBLIC_PORTONE_STORE_ID=store-xxxxx
// PORTONE_API_SECRET=xxxxx
// TOSS_CLIENT_KEY=xxxxx
// TOSS_SECRET_KEY=xxxxx

// ─── 클라이언트: 결제 요청 ───

// src/lib/payment/client.ts
import PortOne from '@portone/browser-sdk/v2';

interface PaymentRequest {
  reservationId: string;
  amount: number;
  orderName: string;   // "아이린스튜디오 - 프리미엄 웨딩 촬영"
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  isEscrow: boolean;
}

export async function requestPayment(params: PaymentRequest) {
  const response = await PortOne.requestPayment({
    storeId: process.env.NEXT_PUBLIC_PORTONE_STORE_ID!,
    channelKey: 'channel-key-xxxxx', // 토스페이먼츠 채널
    paymentId: params.reservationId,
    orderName: params.orderName,
    totalAmount: params.amount,
    currency: 'KRW',
    payMethod: 'CARD',

    // 에스크로 설정
    isEscrow: params.isEscrow,
    products: [{
      id: params.reservationId,
      name: params.orderName,
      amount: params.amount,
      quantity: 1,
    }],

    customer: {
      fullName: params.customerName,
      email: params.customerEmail,
      phoneNumber: params.customerPhone,
    },

    // 결제 완료 후 리다이렉트
    redirectUrl: `${window.location.origin}/payment/complete`,
  });

  if (response?.code) {
    throw new Error(response.message);
  }

  return response;
}


// ─── 서버: 결제 검증 ───

// src/app/api/payment/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { paymentId, txId } = await req.json();

  // 포트원 서버에서 결제 정보 조회
  const paymentResponse = await fetch(
    `https://api.portone.io/payments/${paymentId}`,
    {
      headers: {
        'Authorization': `PortOne ${process.env.PORTONE_API_SECRET}`,
      },
    }
  );

  const payment = await paymentResponse.json();

  // DB의 예약 정보와 금액 일치 확인
  const reservation = await getReservation(paymentId);

  if (payment.amount.total !== reservation.total_amount) {
    // 금액 불일치 → 위변조 시도
    return NextResponse.json(
      { error: '결제 금액이 일치하지 않습니다' },
      { status: 400 }
    );
  }

  if (payment.status === 'PAID') {
    // 결제 성공 → 예약 상태 업데이트
    await updateReservationStatus(paymentId, 'payment_held');

    // 업체에 새 예약 알림
    await notifyVendor(reservation.vendor_id, {
      type: 'new_reservation',
      reservationId: paymentId,
    });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    { error: '결제가 완료되지 않았습니다' },
    { status: 400 }
  );
}


// ─── 서버: 에스크로 구매 확인 ───

// src/app/api/payment/escrow/confirm/route.ts
export async function POST(req: NextRequest) {
  const { paymentId } = await req.json();
  const userId = await getAuthUserId(req);

  // 본인 예약인지 확인
  const reservation = await getReservation(paymentId);
  if (reservation.customer_id !== userId) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 });
  }

  // 포트원 에스크로 구매 확인 API
  const response = await fetch(
    `https://api.portone.io/payments/${paymentId}/escrow/complete`,
    {
      method: 'POST',
      headers: {
        'Authorization': `PortOne ${process.env.PORTONE_API_SECRET}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (response.ok) {
    // 예약 상태 업데이트
    await updateReservationStatus(paymentId, 'completed');

    // 정산 스케줄 생성
    await createSettlement({
      vendorId: reservation.vendor_id,
      reservationId: paymentId,
      totalAmount: reservation.total_amount,
      scheduledDate: addBusinessDays(new Date(), 3), // D+3
    });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: '처리 실패' }, { status: 500 });
}


// ─── 서버: 웹훅 (결제 상태 변경 수신) ───

// src/app/api/payment/webhook/route.ts
export async function POST(req: NextRequest) {
  const body = await req.json();

  // 웹훅 서명 검증 (보안)
  const signature = req.headers.get('x-portone-signature');
  if (!verifyWebhookSignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const { type, data } = body;

  switch (type) {
    case 'Transaction.Paid':
      await handlePaymentSuccess(data.paymentId);
      break;
    case 'Transaction.Cancelled':
      await handlePaymentCancelled(data.paymentId);
      break;
    case 'Transaction.Escrow.Confirmed':
      await handleEscrowConfirmed(data.paymentId);
      break;
    case 'Transaction.Escrow.Rejected':
      await handleEscrowRejected(data.paymentId);
      break;
  }

  return NextResponse.json({ success: true });
}
```

#### 결제 UI 컴포넌트 설계

```
┌─────────────────────────────────────────┐
│         예약 및 결제                      │
│                                         │
│  📸 아이린 스튜디오                      │
│  프리미엄 웨딩 촬영 패키지               │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ 원판 300장 + 보정 50장          │   │
│  │ 앨범 1권 + 액자 2개             │   │
│  │ 촬영 시간: 3시간                │   │
│  └─────────────────────────────────┘   │
│                                         │
│  예약일: 2026년 5월 15일 (토) 10:00     │
│                                         │
│  ─────────────────────────────────      │
│  결제 금액         1,500,000원          │
│  ─────────────────────────────────      │
│                                         │
│  🔒 에스크로 안심 결제                   │
│  결제 금액은 서비스 완료 후              │
│  고객 확인 시 업체에 전달됩니다.         │
│                                         │
│  결제 수단 선택:                        │
│  ┌──────┐ ┌──────┐ ┌──────┐           │
│  │ 카드  │ │카카오 │ │네이버│           │
│  │ 결제  │ │ 페이  │ │ 페이 │           │
│  └──────┘ └──────┘ └──────┘           │
│                                         │
│  ☑ 이용약관 동의                        │
│  ☑ 에스크로 서비스 이용 동의            │
│  ☑ 개인정보 수집·이용 동의              │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │       1,500,000원 결제하기       │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

---

## 3. 수익 모델 상세

### 3.1 수수료 구조

#### Phase 1: 초기 (0~6개월) — 시장 진입

```
목표: 업체 수 확보, 고객 경험 우선

업체 입점: 무료
거래 수수료: 0% (PG 수수료는 고객 or 업체 부담)
수익: 없음

전략:
- "초기 파트너" 배지로 업체 유인
- 무료라는 사실 자체가 마케팅
- 고객 수가 쌓이면 업체가 알아서 찾아옴
```

#### Phase 2: 성장기 (6~12개월) — 수익화 시작

```
목표: 지속 가능한 수익 구조 구축

업체 입점: 무료 유지
거래 수수료: 3~5% (업체 부담)

수수료 테이블:
| 월 거래액 | 수수료율 |
|----------|---------|
| ~500만원 | 5% |
| 500만~2000만원 | 4% |
| 2000만원~ | 3% |

예상 수익 (월):
- 활성 업체 50곳 × 평균 월 거래 300만원 = 1.5억 거래
- 수수료 5% = 월 750만원
- PG 수수료(3%) 차감 = 월 300만원 순수익
```

#### Phase 3: 안정기 (12개월~) — 다각화

```
수익원 1: 거래 수수료 (3~5%)
수익원 2: 프리미엄 노출 (월 10~30만원)
  - 카테고리 상단 노출
  - "추천 업체" 배지
  - 아모라 우선 추천

수익원 3: 프리미엄 업체 구독 (월 5~15만원)
  - 상세 고객 분석 리포트
  - 예약 관리 고급 기능
  - 포트폴리오 무제한 업로드
  - 프로모션 도구

수익원 4: 고객 프리미엄 (월 9,900원)
  - 아모라 무제한 상담 (무료는 일 제한)
  - 독점 할인가
  - 업체 VIP 예약

예상 수익 (월):
- 거래 수수료: 1,500만원
- 프리미엄 노출: 200만원 (20개 업체 × 10만원)
- 업체 구독: 150만원 (30개 업체 × 5만원)
- 고객 프리미엄: 100만원 (1,000명 × 9,900원)
- 합계: 약 1,950만원/월
```

### 3.2 경쟁 플랫폼 수수료 비교

```
| 플랫폼 | 수수료 모델 | 비율 |
|--------|-----------|------|
| 아이웨딩 | 건당 중개 수수료 | 5~10% |
| 웨딩북 | 월 구독 + 수수료 | 월 10만원 + 3~5% |
| 오늘의집 (참고) | 거래 수수료 | 8~15% |
| 크몽 (참고) | 거래 수수료 | 20% |
| 숨고 (참고) | 견적 발송 건당 과금 | 건당 1,000~5,000원 |
| 에어비앤비 (참고) | 호스트 3% + 게스트 14% | 양면 과금 |

웨딩한방 포지셔닝:
→ 업계 최저 수준 (3~5%)으로 시작
→ AI 맞춤 추천의 가치를 증명한 후 점진적 인상
→ 양면 과금(업체+고객) 검토는 PMF 달성 후
```

---

## 4. 실행 로드맵

### Phase 0: 준비 (1~2주)

```
법적 준비:
☐ 통신판매업 신고 (정부24)
☐ 이용약관 작성 (법률 검토)
☐ 개인정보처리방침 작성
☐ 에스크로 서비스 이용 안내문 작성

사업 준비:
☐ 수수료 정책 확정
☐ 업체 입점 제안서 제작
☐ 업체 대시보드 와이어프레임
☐ 고객 결제 UI 와이어프레임
```

### Phase 1: 시드 데이터 (2~3주)

```
Week 1:
☐ 네이버/카카오 API로 서울/경기 업체 데이터 수집 스크립트 작성
☐ vendors 테이블 스키마 확장 (위 SQL)
☐ 수집 데이터 DB 저장 + 중복 제거

Week 2:
☐ 업체 프로필 페이지 (/vendors/[id])
☐ 업체 검색/필터 페이지 (/vendors)
☐ 아모라 업체 추천 연동 (기존 search_vendors 도구 강화)

Week 3:
☐ 부산/대구/대전/광주/제주 데이터 수집
☐ 업체 데이터 품질 검수
☐ 기본 업체 정보 서비스 오픈
```

### Phase 2: 업체 온보딩 시스템 (2~3주)

```
Week 4:
☐ 업체 입점 신청 폼 (/vendor/register)
☐ 사업자등록번호 검증 API 연동 (국세청 API)
☐ 포트폴리오 업로드 (Supabase Storage)

Week 5:
☐ 업체 대시보드 (/vendor/dashboard)
  - 프로필 관리
  - 패키지/가격 관리
  - 예약 현황
  - 리뷰 관리

Week 6:
☐ 관리자 업체 검수 기능 (/admin/vendors)
☐ 업체 승인/거절 프로세스
☐ 업체 초기 10곳 직접 영업 + 온보딩
```

### Phase 3: 예약 시스템 (2~3주)

```
Week 7:
☐ 예약 폼 (날짜/시간 선택, 패키지 선택)
☐ reservations 테이블 생성
☐ 예약 상태 관리 로직

Week 8:
☐ 업체 예약 확인/거절 기능
☐ 고객 예약 현황 페이지
☐ 예약 알림 (이메일 + 인앱)

Week 9:
☐ 아모라 → 예약 추천 → 예약 페이지 연동
☐ 대시보드에 예약 현황 표시
☐ 캘린더 연동
```

### Phase 4: 결제/에스크로 (3~4주)

```
Week 10:
☐ 포트원 가입 + 토스페이먼츠 연동
☐ 테스트 환경 구축
☐ 결제 API Route 개발

Week 11:
☐ 결제 UI 컴포넌트
☐ 에스크로 결제 플로우 구현
☐ 웹훅 수신 + 처리

Week 12:
☐ 구매 확인/분쟁 프로세스
☐ 환불 처리

Week 13:
☐ 정산 시스템 (settlements 테이블, 배치 처리)
☐ 업체 정산 대시보드
☐ 세금계산서 연동
☐ 실결제 테스트 + QA
```

### Phase 5: 리뷰/평점 시스템 (1~2주)

```
Week 14:
☐ 리뷰 작성 (서비스 완료 후)
☐ 리뷰 사진 업로드
☐ 평점 집계 로직
☐ 리뷰 신고/관리

Week 15:
☐ 업체 프로필에 리뷰 표시
☐ 아모라 추천 시 리뷰/평점 반영
☐ "인증된 구매" 리뷰 배지
```

---

## 5. 리스크 및 대응 방안

### 업체 확보 리스크

```
리스크: 업체가 입점하지 않음
원인: "또 다른 플랫폼일 뿐"이라는 인식

대응:
1. AI 맞춤 추천이라는 차별점 강조
2. 초기 3개월 무료 + 수수료 업계 최저
3. 기존 고객 트래픽 데이터를 보여줌 ("월 OOO명이 스튜디오를 찾고 있어요")
4. 업체에 가치를 먼저 제공 (무료 AI 프로필 페이지, SEO 최적화)
5. 1:1 온보딩 지원 (직접 방문해서 포트폴리오 촬영 도와주기)
```

### 결제 리스크

```
리스크: 고액 결제(수백만원)에 대한 고객 불안
원인: 온라인으로 웨딩 비용을 결제하는 경험이 낯설음

대응:
1. 에스크로로 안전 결제 강조
2. "서비스 완료 전까지 환불 가능" 명시
3. 소비자피해보상보험 가입 + 표시
4. 분할 결제 옵션 (계약금 30% → 잔금 70%)
5. 첫 결제 시 쿠폰/할인으로 진입 장벽 낮추기
```

### 분쟁 리스크

```
리스크: 서비스 품질 불만으로 인한 분쟁
원인: 웨딩 서비스는 주관적 만족도가 높음

대응:
1. 업체 입점 시 서비스 기준 합의 (체크리스트)
2. 에스크로 분쟁 조정 프로세스 (위 상태 머신)
3. 심각한 경우 웨딩한방이 중재 비용 일부 부담 (고객 경험 보호)
4. 반복 분쟁 업체는 등급 하락 또는 퇴출
5. 분쟁 해결 전담 CS 팀 (추후)
```

### 법적 리스크

```
리스크: 통신판매중개자 책임 범위
원인: 업체의 서비스 불이행에 대한 중개자 연대 책임

대응:
1. 이용약관에 중개자 면책 조항 명확히
2. 에스크로로 소비자 보호 장치 구비
3. 소비자피해보상보험 가입
4. 법률 자문 받아 약관 검토
5. 분쟁 발생 시 소비자원 안내 절차 마련
```

---

## 6. 업체 영업 실전 가이드

### 6.1 B2B 아웃리치 방법론 (한국 웨딩 업계 특화)

```
한국 비즈니스 문화 핵심:

1. 따뜻한 소개가 중요하다 (Warm Introduction)
   - 업계 인맥, 공통 지인을 통한 소개가 콜드 메일보다 10배 효과적
   - 웨딩 플래너 협회, 스드메 협회 등 통해 접근

2. 카카오톡이 커뮤니케이션 채널이다
   - 이메일이 아님! 카카오톡 채널 또는 개인 카톡으로 소통
   - 첫 연락: 인스타 DM → 카카오톡으로 전환

3. 대면 미팅을 선호한다
   - 특히 초기 관계 구축 시 직접 방문
   - 업체 매장/스튜디오에 직접 가서 데모

4. 사회적 증거가 강력하다
   - "○○업체도 사용중입니다" 한 마디가 제안서 10장보다 효과적
   - 초기 5개 업체 확보가 가장 어렵고, 이후 급격히 쉬워짐
```

### 6.2 아웃리치 시퀀스

```
Day 1: 인스타그램 DM 또는 카카오톡 채널 메시지
       "안녕하세요, AI 웨딩 플래너 웨딩한방입니다.
        ○○ 스튜디오 포트폴리오가 정말 아름다워서 연락드렸어요.
        저희 플랫폼 소개 드려도 될까요?"

Day 2: 전화 → 방문 일정 잡기
       "간단히 10분만 뵙고 싶은데요,
        ○○님 편하신 시간에 방문 가능할까요?"

Day 3-5: 대면 방문 + 데모
         - 아모라 AI가 업체를 어떻게 추천하는지 라이브 시연
         - 업체 대시보드 보여주기
         - 무료 체험 즉시 세팅

Day 7: 카카오톡 팔로업
       "데모 보시고 어떠셨어요?
        혹시 궁금한 점이나 필요한 게 있으시면 말씀 주세요!"

Day 14: 성과 공유
        "지난 2주간 고객 ○○명이 스튜디오를 검색했어요.
         이 중 ○○님 업체에 관심을 보인 고객이 ○명이에요."

Day 30: 유료 전환 제안 (또는 무료 연장)
```

### 6.3 업체에게 통하는 인센티브 (리서치 검증됨)

```
효과 높음 (즉각적 가치 제공):
✅ 무료 전문 사진 촬영 (매장/작품 촬영) — 체감 가치 매우 높음
✅ AI 기반 포트폴리오 최적화 — "어떤 사진이 고객에게 가장 어필하는지"
✅ 무료 체험 기간 1~3개월 — 리드가 들어오는 걸 직접 확인
✅ 고객 리드 보장 — "월 ○건 이상 문의 보장, 아니면 무료 연장"

효과 중간:
☑ 초기 파트너 특별 수수료 — 영구 50% 할인
☑ 공동 마케팅 — SNS/블로그에 업체 소개 콘텐츠 제작
☑ 리뷰 관리 도구 — 리뷰 수집/관리 대시보드

효과 낮음 (나중에):
☐ 데이터 인사이트 리포트 — 업체 수가 많아야 비교 데이터 의미있음
☐ 프리미엄 배지 — 플랫폼 인지도가 낮을 때는 가치 낮음
```

---

## 7. 경쟁사 상세 분석

### 7.1 기존 플랫폼 수수료 구조 상세

| 플랫폼 | 입점 모델 | 월 비용 | 거래 수수료 | 특이사항 |
|--------|----------|---------|-----------|---------|
| **아이웨딩** | 리스팅 + 수수료 | 30~200만원 | 10~20% | 상장 기업, 시장 점유율 최고 |
| **웨딩북** | 구독 + 노출 | 20~150만원 | 협의 | 앱 중심, 2030 타겟 |
| **더웨딩** | 프리미엄 리스팅 | 50~300만원 | 협의 | 고가 업체 위주 |
| **웨딩의여신** | 커뮤니티 + 광고 | 10~50만원 | 낮음 | 네이버 카페 기반 |
| **숨고** | 건당 과금 | 없음 | 리드당 3,000~10,000원 | 프리랜서 중심 |
| **크몽** | 거래 수수료 | 없음 | 20% | 개인 메이크업 아티스트 |

### 7.2 웨딩한방 차별화 포인트

```
기존 플랫폼의 문제점:
1. 리스트 나열 → 사용자가 직접 수백 개 비교해야 함
2. 광고비 많이 내는 업체 = 상위 노출 (신뢰도 ↓)
3. 패키지 가격 불투명 ("상담 후 안내")
4. 예약 후 관리 없음 (결제~서비스까지 공백)

웨딩한방의 해결:
1. 아모라 AI가 예산/스타일/일정 맞춤 추천 → 비교 시간 90% 절감
2. AI 추천 = 매칭 알고리즘 기반, 광고비 아닌 적합도 (신뢰도 ↑)
3. 투명한 가격 정보 + AI가 예산 내 옵션 제시
4. 에스크로 결제 + 아모라가 예약~서비스까지 케어
5. 커플 갈등 중재까지 → 단순 예약 플랫폼 넘어선 "웨딩 동반자"
```

---

## 부록: 참고 링크 및 리소스

```
PG/결제:
- 포트원 공식 문서: https://developers.portone.io
- 토스페이먼츠 개발자센터: https://developers.tosspayments.com
- NHN KCP 개발자센터: https://developer.kcp.co.kr

법률/인허가:
- 통신판매업 신고 (정부24): https://www.gov.kr
- 전자상거래법 전문: https://law.go.kr
- 공정거래위원회: https://www.ftc.go.kr
- 국세청 사업자 조회 API: https://www.data.go.kr

데이터 API:
- 네이버 검색 API: https://developers.naver.com/docs/serviceapi/search/local/local.md
- 카카오 로컬 API: https://developers.kakao.com/docs/latest/ko/local/dev-guide
- Google Places API: https://developers.google.com/maps/documentation/places

웨딩 시장 참고:
- 통계청 혼인 통계: https://kostat.go.kr
```

---

> 이 문서는 웨딩한방 플랫폼의 업체 데이터 확보 및 결제 시스템 구축을 위한 전략 문서입니다.
> 실행 시 법률 자문을 반드시 병행하시기 바랍니다.
