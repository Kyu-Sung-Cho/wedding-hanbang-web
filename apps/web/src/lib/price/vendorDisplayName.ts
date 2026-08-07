/**
 * 화면에 쓸 업체명. 공시 원본 **파일명**에서 흘러들어온 찌꺼기를 떼어낸다.
 *
 * 적재를 만든 스캐너가 파일명을 그대로 업체명으로 썼다. 그래서 운영에
 * `베로나지디_예식장`·`빌라드지디 논현(라비에벨(주))`·`스카이나인스 표준양식`처럼
 * **사람이 쓴 상호가 아닌 것**이 그대로 노출돼 있다(2026-08-08 실측 21곳).
 * 검색으로 못 찾고, 찾아도 신뢰를 잃는 종류의 오류다.
 *
 * DB의 `vendors.name`을 고치는 게 근본이지만 운영 쓰기는 릴리스 매니페스트
 * 경로로 봉인돼 있다. 표시 규칙은 앱이 가질 수 있으므로 여기서 정리한다.
 *
 * **지우지 않고 옮긴다.** 괄호 안 법인명은 공시 의무 주체라 정보 가치가 있다 —
 * 이름에서 떼되 `disclosureEntity`로 돌려주고 상세에서 "공시주체"로 보여준다.
 * 검색도 이 값을 포함해야 `라비에벨`로 찾던 사람이 못 찾게 되지 않는다.
 */

/** 파일명 꼬리표. 이 둘만 뗀다 — 공시 문서 종류지 상호가 아니다. */
const DOCUMENT_TAIL = /_(?:예식장|결혼준비대행)\s*$/;

/** 문서 양식어. `스카이나인스 표준양식`은 실제 공시인데 이름에 양식어가 붙었다. */
const FORM_WORD = /\s*표준양식\s*$/;

/**
 * 같은 파일을 두 번 받은 사본 표시 `… (1)`.
 * 실측상 코퍼스 전체에서 1건뿐이고(셀레네하우스웨딩, 원본과 sha256 동일),
 * 상호가 숫자 괄호로 끝나는 업체는 없다.
 */
const COPY_MARKER = /\s*\(\d+\)\s*$/;

/** 법인격 토큰. 이게 든 **끝** 괄호만 법인명으로 본다. */
const CORPORATE_TOKEN = /\(주\)|\(유\)|㈜|㈲|주식회사|유한회사|유한책임회사|농업회사법인/;

export type VendorDisplayName = {
  /** 화면에 쓸 이름. */
  name: string;
  /** 괄호에서 떼어낸 공시 의무 주체(법인). 없으면 null. */
  disclosureEntity: string | null;
};

/**
 * 이름 끝의 괄호 한 덩어리를 떼어낸다. 괄호가 중첩된 경우
 * (`힐스코트(태성산업(주))`)를 위해 뒤에서부터 짝을 맞춘다.
 */
function splitTrailingParen(value: string): { head: string; inner: string } | null {
  const text = value.trimEnd();
  if (!text.endsWith(")")) return null;
  let depth = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index];
    if (character === ")") depth += 1;
    else if (character === "(") {
      depth -= 1;
      if (depth === 0) {
        return { head: text.slice(0, index).trimEnd(), inner: text.slice(index + 1, -1) };
      }
    }
  }
  return null;
}

export function vendorDisplayName(rawName: string): VendorDisplayName {
  let name = String(rawName ?? "").trim();
  let disclosureEntity: string | null = null;
  if (!name) return { name, disclosureEntity };

  name = name.replace(DOCUMENT_TAIL, "").trimEnd();

  // 법인 괄호는 꼬리표를 뗀 뒤에 본다 — `…(㈜디에스에이치글로벌 익산지점)_예식장`
  // 처럼 괄호 뒤에 꼬리표가 붙은 경우가 있다.
  const paren = splitTrailingParen(name);
  if (paren && paren.head && CORPORATE_TOKEN.test(paren.inner)) {
    disclosureEntity = paren.inner.trim() || null;
    name = paren.head;
  }

  name = name.replace(FORM_WORD, "").trimEnd();
  name = name.replace(COPY_MARKER, "").trimEnd();
  // 정리하다 이름이 통째로 사라지면 원본을 쓴다 — 빈 카드보다 낫다.
  return { name: name || String(rawName ?? "").trim(), disclosureEntity };
}

/**
 * 검색 대상 문자열. 표시명만 넣으면 정리로 떼어낸 말로 찾던 사람이 못 찾는다.
 * (`라비에벨`로 `빌라드지디 논현`을 찾는 경우 — 정리 전에는 찾아졌다.)
 */
export function vendorSearchTerms(rawName: string): string[] {
  const { name, disclosureEntity } = vendorDisplayName(rawName);
  const terms = [name, rawName];
  if (disclosureEntity) terms.push(disclosureEntity);
  return terms.filter((value): value is string => Boolean(value && value.trim()));
}
