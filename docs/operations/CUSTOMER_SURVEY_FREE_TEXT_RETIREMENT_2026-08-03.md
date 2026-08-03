# 익명 고객 설문 자유서술 폐기 절차 (2026-08-03)

상태: **코드·마이그레이션 준비 완료, production 미실행**

## 왜 폐기하는가

익명 설문의 자유서술은 이메일·전화·URL만 거부했고 이름, 주민등록번호, 상세주소,
계좌번호와 소셜 식별자처럼 더 넓은 직접 식별정보를 완전하게 차단하지 못했다.
익명 행은 계정과 연결되지 않아 정보주체의 열람·삭제 요청 대상을 안정적으로 찾기도
어렵다. 검증된 DLP와 짧은 보유기간, 자동 파기 worker가 함께 준비될 때까지 선택형
응답만 받는다.

웹은 `q21`과 모든 `hasTextInput` 입력을 화면에서 제거한다. API는 이전 탭이나 위조
클라이언트가 `q21` 또는 `otherTexts`를 보내면 저장 전에 400으로 거부한다. 신규
마이그레이션은 다음 열의 기존 값을 모두 `NULL`로 바꾸고 CHECK 제약으로 재입력을
차단한다.

- `q7_other`
- `q8_2_other`
- `q11_other`
- `q12_other`
- `q17_other`
- `q18_other`
- `q21_feedback`

마이그레이션은 다음 두 파일을 반드시 같은 write-fence 구간에서 순서대로 적용한다.

1. `supabase/migrations/20260803114000_retire_customer_survey_free_text.sql`
2. `supabase/migrations/20260803115000_rotate_customer_survey_consent_version.sql`

첫 파일은 기존 자유서술을 폐기하고 재입력을 차단한다. 두 번째 파일은 새 웹 계약과
DB trigger의 설문 동의 버전을 `2026-08-03`으로 맞추되, 이미 저장된
`2026-08-02` 동의 증거는 보존한다. `115000`보다 웹을 먼저 배포하면 새 선택형 설문도
이전 DB trigger에서 거부되므로 순서를 바꾸거나 중간에 write fence를 열면 안 된다.

## 적용 전 필수 조건

1. 정확한 릴리스 커밋으로 hosted staging을 만들고 production과 다른 project ref인지
   확인한다.
2. DB 백업과 isolated restore를 완료하고 receipt를 릴리스 커밋에 묶는다.
3. 전역 production write fence를 닫고 기존 설문 제출을 일시 중단한다.
4. 원문을 출력하지 않고 다음과 같은 count-only inventory만 수집한다.

```sql
SELECT
  count(*) AS total_rows,
  count(*) FILTER (
    WHERE q7_other IS NOT NULL
       OR q8_2_other IS NOT NULL
       OR q11_other IS NOT NULL
       OR q12_other IS NOT NULL
       OR q17_other IS NOT NULL
       OR q18_other IS NOT NULL
       OR q21_feedback IS NOT NULL
  ) AS rows_with_retired_free_text
FROM public.customer_survey_responses;
```

이 count를 얻기 위해 자유서술 원문을 터미널, CI 로그, GitHub issue/PR, 채팅 또는
evidence 파일에 복사하지 않는다.

## 검증 순서

1. isolated restore와 hosted staging에서 successor manifest 84개를 hash 검증한다.
2. write fence가 닫힌 상태에서 `114000`을 적용하고
   `rows_with_retired_free_text=0`을 확인한다.
3. 이어서 `115000`을 적용한 뒤 `customer_survey_responses_free_text_retired`가
   validated CHECK이고 신규 동의 버전이 `2026-08-03`인지 확인한다.
4. DB 검증이 끝난 뒤에만 동일 커밋의 웹을 배포한다.
5. 일반 선택형 설문은 저장되고, 평범한 문장·주민등록번호·주소가 포함된 `q21`과
   `otherTexts`는 모두 400이며 service-role client가 생성되지 않는지 canary한다.
6. 기존 자유서술 열에 직접 값을 쓰는 staging transaction이 CHECK 위반으로
   실패하는지 확인하고 rollback한다.
7. production은 동일한 백업·write fence·`114000`→`115000` 적용·count-only 검증
   receipt가 모두
   준비된 뒤 후속 릴리스 controller로만 적용한다.

## 되돌리기 정책

이 작업은 개인정보 최소화 목적의 삭제다. 장애가 나도 자유서술을 production에 다시
복원하거나 CHECK를 임의 제거하지 않는다. 구조화된 설문 열의 스키마·응답을
forward-fix하고, 원본 확인이 법률상 반드시 필요하면 승인된 isolated restore 안에서만
최소 인원이 접근한다. 자유서술 수집을 다시 열려면 DLP corpus, 보유기간, 자동 파기,
정보주체 권리 처리, 처리방침과 법률 검토를 별도 릴리스로 통과해야 한다.
