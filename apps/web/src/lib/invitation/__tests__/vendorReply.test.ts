import { describe, expect, it } from "vitest";
import {
  VENDOR_REPLY_COPY,
  VENDOR_REPLY_MAX_CHARS,
  formatWon,
  maskReceivedText,
  normalizeReceivedText,
  parseKoreanAmount,
  readVendorReply,
  type VendorReplyChip,
} from "@hanbang/shared/invitation";

/**
 * 받은 답 붙여 넣기(D-83 1단계)의 기기 안 읽기. 가리기 → 칩 뽑기 순서와, 칩이 업체가 쓴 값을 옮길 뿐
 * 판정하지 않는다는 약속을 시험한다. 해가 없는 날짜는 `todayYmd` 로 고정해 같은 결과를 본다.
 */

const TODAY = "2026-11-18"; // 수요일
const read = (text: string, todayYmd = TODAY) => readVendorReply(text, { todayYmd });
const masked = (text: string) => maskReceivedText(text).masked;
const ofKind = <K extends VendorReplyChip["kind"]>(text: string, kind: K, todayYmd = TODAY) =>
  read(text, todayYmd).chips.filter((chip): chip is Extract<VendorReplyChip, { kind: K }> => chip.kind === kind);
const char = (code: number) => String.fromCharCode(code);

// hallCompare.test.ts 와 같은 판정 낱말 목록.
const BANNED = /추천|최고|가성비|저렴|1위|합리적|순위|점수|등급|보장/;
const LABELS = VENDOR_REPLY_COPY.maskLabels;

describe("normalizing pasted text", () => {
  it("unifies line breaks, drops invisible characters and maps full-width letters and digits", () => {
    const raw = `a\r\nb${char(0x2028)}c${char(0x2029)}d${char(0x200b)}e${char(0x00a0)}f${char(0x3000)}g${char(0xff11)}${char(0x202e)}h`;
    expect(normalizeReceivedText(raw)).toEqual({ text: "a\nb\nc\nde f g1h", truncated: false });
  });

  it("reads at most 4,000 characters and says so", () => {
    const long = normalizeReceivedText("가".repeat(VENDOR_REPLY_MAX_CHARS + 50));
    expect(long.truncated).toBe(true);
    expect(Array.from(long.text)).toHaveLength(VENDOR_REPLY_MAX_CHARS);
    expect(maskReceivedText("가".repeat(VENDOR_REPLY_MAX_CHARS + 1)).truncated).toBe(true);
    expect(normalizeReceivedText("짧은 글").truncated).toBe(false);
  });
});

describe("masking before anything else is read", () => {
  it("hides links, including bare short links and hosts the list does not know when a path follows", () => {
    for (const [text, expected] of [
      ["자세한 건 https://example.com/a?b=1 참고해 주세요", `자세한 건 ${LABELS.link} 참고해 주세요`],
      ["www.hall.co.kr 에서 보세요", `${LABELS.link} 에서 보세요`],
      ["naver.me/xYz12 확인 부탁드려요", `${LABELS.link} 확인 부탁드려요`],
      ["kko.to/abcd 링크예요", `${LABELS.link} 링크예요`],
      ["bit.ly/3abcD 눌러 주세요", `${LABELS.link} 눌러 주세요`],
      ["open.kakao.com/o/sAbc 오픈채팅", `${LABELS.link} 오픈채팅`],
      ["결제는 pay.toss.im/abc 에서", `결제는 ${LABELS.link} 에서`],
      ["toss.im 으로 결제", `${LABELS.link} 으로 결제`],
    ] as const) {
      expect(masked(text), text).toBe(expected);
    }
  });

  it("keeps the Korean words written right after a link", () => {
    expect(masked("https://pay.example.com/x입금해 주세요")).toBe(`${LABELS.link}입금해 주세요`);
    expect(masked("naver.me/xYz12에서 보세요")).toBe(`${LABELS.link}에서 보세요`);
  });

  it("hides email addresses", () => {
    expect(masked("메일 hall@sodam.co.kr 로 주세요")).toBe(`메일 ${LABELS.email} 로 주세요`);
    expect(maskReceivedText("a.b+c@gmail.com")).toMatchObject({ masked: LABELS.email, maskedKinds: ["email"] });
  });

  it("hides one-time codes in the usual Korean phrasings", () => {
    for (const text of [
      "인증번호 [123456] 를 입력하세요",
      "인증번호는 482910입니다",
      "인증 코드: 4829",
      "확인코드 12345678",
      "승인번호 77881234",
      "OTP 123456",
      "보안코드 3344",
      "인증번호 １２３４５６",
    ]) {
      const result = maskReceivedText(text);
      expect(result.maskedKinds, text).toEqual(["code"]);
      expect(result.masked, text).toContain(LABELS.code);
      expect(result.masked, text).not.toMatch(/\d{4}/);
    }
    // 자릿수가 모자라면 인증번호로 보지 않는다.
    expect(maskReceivedText("인증번호 12 만 남았어요").maskedCount).toBe(0);
  });

  it("hides resident, card and account numbers", () => {
    expect(masked("주민번호 900101-1234567")).toBe(`주민번호 ${LABELS.resident}`);
    expect(masked("카드 1234-5678-9012-3456")).toBe(`카드 ${LABELS.card}`);
    expect(masked("카드 1234 5678 9012 3456")).toBe(`카드 ${LABELS.card}`);
    expect(masked("카드번호 1234567890123456")).toBe(`카드번호 ${LABELS.card}`);
    for (const [text, expected] of [
      ["국민은행 123456-78-901234 예금주 소담", `국민은행 ${LABELS.account} 예금주 소담`],
      ["계좌 110-123-456789 신한", `계좌 ${LABELS.account} 신한`],
      ["입금 계좌는 3333-01-1234567 카카오뱅크입니다", `입금 계좌는 ${LABELS.account} 카카오뱅크입니다`],
      ["농협 302-1234-5678-91", `농협 ${LABELS.account}`],
      ["계좌번호 1234567890123", `계좌번호 ${LABELS.account}`],
      // 은행 낱말이 없어도 붙임표로 끊긴 10~16자리 묶음은 계좌로 본다.
      ["보내실 곳 1002-123-456789", `보내실 곳 ${LABELS.account}`],
    ] as const) {
      expect(masked(text), text).toBe(expected);
    }
  });

  it("never takes a date written after a bank-like word for an account number", () => {
    for (const text of ["우리 홀은 2026-11-30 14:00 가능합니다", "카카오톡으로 2026-11-30 14:00에 뵐게요", "하나 남은 날짜는 2026-11-30 이에요"]) {
      const result = read(text);
      expect(result.maskedCount, text).toBe(0);
      expect(result.masked, text).toBe(text);
      expect(result.caution, text).toBe(false);
    }
    expect(ofKind("우리 홀은 2026-11-30 14:00 가능합니다", "datetime")).toMatchObject([{ ymd: "2026-11-30", time: "14:00", meridiemGuessed: false }]);
  });

  it("hides phone numbers in every common shape", () => {
    for (const text of [
      "010-1234-5678",
      "010.1234.5678",
      "01012345678",
      "010 1234 5678",
      "02-123-4567",
      "02-1234-5678",
      "031-123-4567",
      "(02)123-4567",
      "1588-1234",
      "1644-1234",
      "0505-123-4567",
      "050-1234-5678",
      "070-1234-5678",
      "+82 10-1234-5678",
      "+82-10-1234-5678",
      "+821012345678",
      "０１０－１２３４－５６７８",
    ]) {
      expect(maskReceivedText(`연락처 ${text} 로 주세요`), text).toMatchObject({
        masked: `연락처 ${LABELS.phone} 로 주세요`,
        maskedCount: 1,
        maskedKinds: ["phone"],
      });
    }
  });

  it("keeps brackets balanced around a hidden number", () => {
    // 지역번호만 감싼 괄호는 번호와 함께 가린다.
    for (const text of ["(02)123-4567", "(02) 123-4567", "(02)-123-4567", "(031)123-4567", "02)123-4567"]) {
      expect(masked(text), text).toBe(LABELS.phone);
    }
    // 번호 전체를 감싼 괄호는 휴대폰 번호처럼 그대로 남는다.
    expect(masked("소담하우스(02-123-4567)")).toBe(`소담하우스(${LABELS.phone})`);
    expect(masked("문의 (031-123-4567) 로 주세요")).toBe(`문의 (${LABELS.phone}) 로 주세요`);
    expect(masked("소담하우스(010-1234-5678)")).toBe(`소담하우스(${LABELS.phone})`);
  });

  it("leaves prices alone, even long ones without separators", () => {
    for (const text of ["총 169,000,000원입니다", "169000000원", "식대 55,000원, 대관료 3,000,000원", "1억 2천만원", "견적 12,500,000원"]) {
      expect(maskReceivedText(text), text).toMatchObject({ masked: text, maskedCount: 0 });
    }
    expect(masked("１６９，０００，０００원")).toBe("169,000,000원");
  });

  it("leaves no digits in the placeholders and counts each hidden piece", () => {
    for (const label of Object.values(LABELS)) expect(label).not.toMatch(/\d/);
    const result = maskReceivedText("010-1234-5678 또는 hall@sodam.kr, 계좌 110-123-456789, 링크 naver.me/abc");
    expect(result.maskedCount).toBe(4);
    expect([...result.maskedKinds].sort()).toEqual(["account", "email", "link", "phone"]);
    expect(result.masked).not.toMatch(/\d/);
  });

  it("hides phone numbers typed with brackets, spaced hyphens, +82 (0) or other dash characters", () => {
    for (const text of [
      "010)1234-5678", "(010)1234-5678", "(010) 1234-5678", "010 - 1234 - 5678", "010-1234 -5678", "+82 (0)10-1234-5678",
      "(+82) 10-1234-5678", "02 - 123 - 4567", "070 - 1234 - 5678", "1588 - 1234",
      `010${char(0x2013)}1234${char(0x2013)}5678`, `010${char(0x2010)}1234${char(0x2010)}5678`, `010${char(0x2212)}1234${char(0x2212)}5678`,
      `010${char(0xfe63)}1234${char(0xfe63)}5678`, `02${char(0x2014)}123${char(0x2014)}4567`, `1588${char(0xfe58)}1234`,
    ]) {
      expect(maskReceivedText(`담당 실장 ${text} 로 주세요`), text).toMatchObject({
        masked: `담당 실장 ${LABELS.phone} 로 주세요`,
        maskedCount: 1,
        maskedKinds: ["phone"],
      });
    }
    expect(normalizeReceivedText([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63].map(char).join("")).text).toBe("---------");
  });

  it("labels 080 and 060 numbers as phones, not accounts, and raises no money caution", () => {
    for (const text of ["수신자부담 080-123-4567 로 문의 주세요", "060-123-4567 로 전화 주세요"]) {
      const result = read(text);
      expect(result.maskedKinds, text).toEqual(["phone"]);
      expect(result.masked, text).not.toMatch(/\d/);
      expect(result.caution, text).toBe(false);
    }
  });

  it("hides a 15xx number written without a separator only after 대표, 전화 or 문의", () => {
    for (const [text, expected] of [
      ["대표번호 15881234", `대표번호 ${LABELS.phone}`],
      ["전화 16441234 로 주세요", `전화 ${LABELS.phone} 로 주세요`],
      ["문의는 15881234 로 주세요", `문의는 ${LABELS.phone} 로 주세요`],
    ] as const) {
      expect(masked(text), text).toBe(expected);
    }
    expect(maskReceivedText("견적서 15881234 쪽을 보세요").maskedCount).toBe(0);
  });

  it("hides a resident number written with a space, or with nothing, after a 주민 word", () => {
    expect(maskReceivedText("주민번호 900101 1234567")).toMatchObject({ masked: `주민번호 ${LABELS.resident}`, maskedKinds: ["resident"] });
    expect(maskReceivedText("주민등록번호는 9001011234567 입니다")).toMatchObject({ masked: `주민등록번호는 ${LABELS.resident} 입니다`, maskedKinds: ["resident"] });
  });

  it("hides space-grouped account numbers followed by a bank name or 예금주, with the money caution", () => {
    for (const [text, expected] of [
      ["계약금 50만원은 아래로 보내주세요\n110 123 456789 신한 소담웨딩", `계약금 50만원은 아래로 보내주세요\n${LABELS.account} 신한 소담웨딩`],
      ["1002 123 456789 우리은행 소담", `${LABELS.account} 우리은행 소담`],
      ["123 456 789012 (국민)", `${LABELS.account} (국민)`],
      ["110 123 456789 (예금주 소담)", `${LABELS.account} (예금주 소담)`],
      ["예약금 50만원 1002 123 456789 우리은행으로 보내주시면 가예약 확정됩니다", `예약금 50만원 ${LABELS.account} 우리은행으로 보내주시면 가예약 확정됩니다`],
    ] as const) {
      const result = read(text);
      expect(result.masked, text).toBe(expected);
      expect(result.maskedKinds, text).toEqual(["account"]);
      expect(result.caution, text).toBe(true);
    }
  });

  it("hides verification codes written number-first, on the next line, or after more keywords", () => {
    for (const text of [
      "482910은 인증번호입니다",
      "482910 은 인증번호입니다",
      "인증번호는 아래와 같습니다\n482910",
      "본인확인 482910",
      "핀번호 4829",
      "PIN 4829",
      "Your code is 482910",
    ]) {
      const result = maskReceivedText(text);
      expect(result.maskedKinds, text).toEqual(["code"]);
      expect(result.masked, text).not.toMatch(/\d/);
    }
    // "드레스 코드" 뒤의 날짜는 인증번호가 아니다(같은 줄이든 다음 줄이든).
    for (const text of ["드레스 코드는 블랙이고 2026.11.30 오후 2시 예식입니다", "드레스코드 안내\n2026-11-30 오후 2시 예식입니다"]) {
      expect(maskReceivedText(text).maskedCount, text).toBe(0);
      expect(ofKind(text, "datetime"), text).toMatchObject([{ ymd: "2026-11-30", time: "14:00" }]);
    }
  });

  it("hides bare domains with more endings and with a port", () => {
    for (const [text, expected] of [
      ["링크 sodam.wedding 확인해 주세요", `링크 ${LABELS.link} 확인해 주세요`],
      ["hall.store 에서 보세요", `${LABELS.link} 에서 보세요`],
      ["sodam.com:8080/abc 참고", `${LABELS.link} 참고`],
      ["sodam.studio, hall.online, a.shop, b.site, c.xyz, d.me, e.io, f.ai, g.app", Array(9).fill(LABELS.link).join(", ")],
    ] as const) {
      expect(masked(text), text).toBe(expected);
    }
  });

  it("drops a number cut by the 4,000-character limit instead of showing its first digits", () => {
    for (const tail of [" 010-1234-5678 로 연락 주세요", " 국민 943202-00-123456 입금 부탁드려요"]) {
      for (const pad of [3985, 3988, 3990, 3992]) {
        const result = maskReceivedText(`${"가".repeat(pad)}${tail}`);
        expect(result.truncated, `${pad}`).toBe(true);
        expect(result.masked, `${pad}`).not.toMatch(/\d/);
      }
    }
    // 잘리지 않은 글 끝의 번호는 그대로 가린다.
    expect(masked("연락처 010-1234-5678")).toBe(`연락처 ${LABELS.phone}`);
  });

  it("reads a number followed by a money unit as a price, but still hides a number that starts with 0", () => {
    for (const text of ["견적은 1500-2000만원 선이에요", "식대는 1인 55000-68000원 사이입니다", "추가 옵션 500000-1000000원", "입금하실 금액은 300000000원입니다"]) {
      expect(maskReceivedText(text).maskedCount, text).toBe(0);
      expect(ofKind(text, "price").length, text).toBe(1);
    }
    expect(masked("이 번호 010-1234-5678 원")).toBe(`이 번호 ${LABELS.phone} 원`);
    expect(masked("이 번호 010-1234-5678원")).toBe(`이 번호 ${LABELS.phone}원`);
    expect(masked("이 번호 010-1234-5678만 받아요")).toBe(`이 번호 ${LABELS.phone}만 받아요`);
  });

  it("takes only a money unit written right after the number for a price, never a spaced word that starts with 원", () => {
    // 띄어 쓴 "원"은 다음 낱말(원장님, 원하시면, 원래, 원본)의 첫 글자일 수 있다. 그런 번호는 금액으로 보지 않고 가린다.
    for (const [text, expected] of [
      ["계좌 110-123-456789 원장님 명의입니다", `계좌 ${LABELS.account} 원장님 명의입니다`],
      ["입금계좌: 110-123-456789 원하시면 현금영수증 해 드려요", `입금계좌: ${LABELS.account} 원하시면 현금영수증 해 드려요`],
      ["보내실 곳 1002-123-456789 원장 명의예요", `보내실 곳 ${LABELS.account} 원장 명의예요`],
      ["국민 943202-00-123456 원래 계좌는 해지했어요", `국민 ${LABELS.account} 원래 계좌는 해지했어요`],
      ["900101-1234567 원본 서류 보내 주세요", `${LABELS.resident} 원본 서류 보내 주세요`],
      ["1588-1234 원하시는 시간에 전화 주세요", `${LABELS.phone} 원하시는 시간에 전화 주세요`],
      ["인증번호 482910 원하시면 다시 보내 드려요", `인증번호 ${LABELS.code} 원하시면 다시 보내 드려요`],
    ] as const) {
      const result = read(text);
      expect(result.masked, text).toBe(expected);
      expect(result.chips.some((chip) => chip.kind === "price"), text).toBe(false);
    }
    // 끊지 않은 15xx 꼴의 숫자도 원이 붙으면 금액이다(문의 낱말 뒤라도).
    expect(read("문의하신 대관료는 15000000원입니다")).toMatchObject({ maskedCount: 0, chips: [{ kind: "price", won: 15_000_000, subject: "대관료" }] });
  });

  it("reads two ascending numbers before a bare 만 as a price range, but keeps a 15xx number or a long account before 만 hidden", () => {
    expect(maskReceivedText("견적은 1500-2000만 정도예요").maskedCount).toBe(0);
    expect(ofKind("견적은 1500-2000만 정도예요", "price").map((chip) => chip.label)).toEqual(["1,500만 원 ~ 2,000만 원"]);
    expect(ofKind("대관료 1500-1800만 선입니다", "price").map((chip) => chip.label)).toEqual(["대관료 1,500만 원 ~ 1,800만 원"]);
    // 앞이 더 큰 15xx 번호와 여덟 자리보다 긴 계좌는 "만" 앞이라도 가린다.
    expect(masked("대표번호 1588-1234만 받아요")).toBe(`대표번호 ${LABELS.phone}만 받아요`);
    expect(masked("입금은 1002-123456789만 가능해요")).toBe(`입금은 ${LABELS.account}만 가능해요`);
  });

  it("leaves issued numbers alone after a bank-like word, and when 번호 is left out or bracketed", () => {
    // "우리", "하나", "카카오"는 은행 이름이기도 하다. 그 뒤라도 업체가 매긴 번호는 계좌가 아니고 결제 안내도 켜지 않는다.
    for (const text of [
      "우리 사업자번호 123-45-67890 입니다",
      "우리 예약번호는 2026112901 입니다",
      "하나 더, 주문번호 1234-5678-9012 확인 부탁드려요",
      "카카오 예약번호 2026112901 로 조회돼요",
      "예약 2026112901 로 확인 가능합니다",
      "접수 2026-1118-0001 건 확인했습니다",
      "예약번호가 2026112901 입니다",
      "예약번호(2026112901)",
      "[예약번호] 2026112901",
    ]) {
      const result = read(text);
      expect(result.maskedCount, text).toBe(0);
      expect(result.masked, text).toBe(text);
      expect(result.caution, text).toBe(false);
    }
    // 예약금·예약 확정 계좌는 계좌다.
    for (const text of ["예약금 계좌 110-123-456789", "예약 확정 계좌 110-123-456789"]) {
      expect(read(text), text).toMatchObject({ maskedKinds: ["account"], caution: true });
    }
  });

  it("hides a space-grouped account number with the bank name or 예금주 on the next line, or the account word on the line before", () => {
    for (const [text, expected] of [
      ["110 123 456789\n예금주 소담웨딩", `${LABELS.account}\n예금주 소담웨딩`],
      ["1002 123 456789\n우리은행 소담웨딩", `${LABELS.account}\n우리은행 소담웨딩`],
      ["계좌는 아래와 같습니다\n110 123 456789\n감사합니다", `계좌는 아래와 같습니다\n${LABELS.account}\n감사합니다`],
    ] as const) {
      const result = read(text);
      expect(result.masked, text).toBe(expected);
      expect(result.maskedKinds, text).toEqual(["account"]);
      expect(result.caution, text).toBe(true);
    }
  });

  it("does not call business, reservation, order or receipt numbers accounts", () => {
    // 업체가 매긴 번호는 가리지 않고 둔다. 계좌번호라고 적지 않고 결제 안내도 켜지 않는다.
    for (const text of ["사업자등록번호 123-45-67890", "사업자 123-45-67890", "예약번호 2026112901 로 확인 가능합니다", "주문번호: 1234-5678-9012", "접수번호 2026-1118-0001"]) {
      const result = read(text);
      expect(result.maskedCount, text).toBe(0);
      expect(result.masked, text).toBe(text);
      expect(result.caution, text).toBe(false);
    }
  });
});

describe("dates", () => {
  it("reads full dates in Korean and numeric forms", () => {
    for (const text of ["2026년 11월 30일 가능합니다", "2026.11.30 가능", "2026-11-30 가능", "2026/11/30 가능"]) {
      expect(ofKind(text, "date"), text).toMatchObject([{ ymd: "2026-11-30", weekdayMismatch: false, label: "11월 30일 (월)" }]);
    }
  });

  it("picks the nearest coming date for a date without a year and never moves a year to match the written weekday", () => {
    expect(ofKind("11월 30일 가능해요", "date")).toMatchObject([{ ymd: "2026-11-30" }]);
    // 지난 날짜는 내년으로 본다.
    expect(ofKind("11월 17일 가능해요", "date")).toMatchObject([{ ymd: "2027-11-17" }]);
    // 올해가 아닌 날짜는 칩에 해를 적는다.
    expect(ofKind("1월 9일 (토) 가능해요", "date")).toMatchObject([{ ymd: "2027-01-09", weekdayMismatch: false, label: "2027년 1월 9일 (토)" }]);
    expect(ofKind("11월 17일 가능해요", "date")).toMatchObject([{ label: "2027년 11월 17일 (수)" }]);
    // 2029-11-30 은 금요일, 2030-11-30 은 토요일이다. 요일을 맞추려고 해를 넘기지 않고 가까운 날에 어긋남을 알린다(2026-11-18 리드 결정).
    expect(ofKind("11월 30일 (토) 가능합니다", "date", "2029-11-01")).toMatchObject([
      { ymd: "2029-11-30", weekdayMismatch: true, label: "11월 30일 (금)" },
    ]);
    expect(ofKind("11월 30일 가능합니다", "date", "2029-11-01")).toMatchObject([{ ymd: "2029-11-30", weekdayMismatch: false }]);
    // 2026-12-05 는 토요일이다. 요일을 잘못 적은 가까운 날을 요일이 맞는 내년(2027-12-05, 일요일)으로 옮기지 않는다.
    expect(ofKind("12월 5일(일) 상담 가능해요", "date")).toMatchObject([{ ymd: "2026-12-05", weekdayMismatch: true, label: "12월 5일 (토)" }]);
  });

  it("reads a recent date from last year when its written weekday matches, and only within the past 30 days", () => {
    // 2027-01-02 에 읽은 "12월 28일 (월)": 2026-12-28 은 월요일이고 닷새 전이다. 내년 12월 28일(화요일)로 넘기지 않는다.
    expect(ofKind("지난 12월 28일(월) 상담 감사했습니다", "date", "2027-01-02")).toMatchObject([
      { ymd: "2026-12-28", weekdayMismatch: false, label: "2026년 12월 28일 (월)" },
    ]);
    expect(ofKind("12월 31일 (목) 상담 때 말씀드린 대로요", "date", "2027-01-02")).toMatchObject([{ ymd: "2026-12-31", weekdayMismatch: false }]);
    // 요일이 맞지 않으면 지난 날로 읽지 않는다. 요일이 없으면 다가올 날이다.
    expect(ofKind("12월 28일 (수) 가능해요", "date", "2027-01-02")).toMatchObject([{ ymd: "2027-12-28", weekdayMismatch: true }]);
    expect(ofKind("12월 28일 가능해요", "date", "2027-01-02")).toMatchObject([{ ymd: "2027-12-28", weekdayMismatch: false }]);
  });

  it("keeps a recent past date whose written weekday matches instead of moving it to next year", () => {
    // 2026-11-16 은 월요일이고 2027-11-16 은 화요일이다. 이틀 전의 그 월요일이다.
    expect(ofKind("지난 11월 16일 (월)에 연락드렸어요", "date")).toMatchObject([
      { ymd: "2026-11-16", weekdayMismatch: false, label: "11월 16일 (월)" },
    ]);
    // 30일보다 더 지난 날은 그렇게 읽지 않는다: 2026-10-12 는 월요일이지만 37일 전이라 내년(화요일)으로 보고 어긋남을 알린다.
    expect(ofKind("10월 12일 (월)", "date")).toMatchObject([{ ymd: "2027-10-12", weekdayMismatch: true }]);
  });

  it("flags a wrong weekday written next to a date with a year and labels the real weekday", () => {
    // 2026-11-30 은 월요일, 2027-11-30 은 화요일이다. 해를 적은 날짜는 해를 바꾸지 않고 어긋남만 알린다.
    for (const [text, ymd, label] of [
      ["2026년 11월 30일 (토) 가능합니다", "2026-11-30", "11월 30일 (월)"],
      ["2026.11.30(토) 가능합니다", "2026-11-30", "11월 30일 (월)"],
      ["27년 11월 30일 (수) 가능합니다", "2027-11-30", "2027년 11월 30일 (화)"],
    ] as const) {
      expect(ofKind(text, "date"), text).toMatchObject([{ ymd, weekdayMismatch: true, label }]);
    }
    expect(ofKind("2026년 11월 30일 (월) 가능합니다", "date")).toMatchObject([{ ymd: "2026-11-30", weekdayMismatch: false }]);
  });

  it("flags a written weekday that no candidate year matches and labels the real weekday", () => {
    expect(ofKind("11월 30일 (토) 가능해요", "date")).toMatchObject([
      { ymd: "2026-11-30", weekdayMismatch: true, label: "11월 30일 (월)", quote: "11월 30일 (토)" },
    ]);
  });

  it("reads month.day and month/day only when they cannot be a decimal or a fraction", () => {
    expect(ofKind("11.30(토) 가능합니다", "date")).toMatchObject([{ ymd: "2026-11-30", weekdayMismatch: true }]);
    expect(ofKind("11/30 가능", "date")).toMatchObject([{ ymd: "2026-11-30" }]);
    expect(ofKind("12.5 오후 2시", "datetime")).toMatchObject([{ ymd: "2026-12-05", time: "14:00" }]);
    for (const text of ["식대 6.8만원", "1/2 정도 차 있어요", "1.5배 정도예요"]) {
      const chips = read(text).chips;
      expect(chips.some((chip) => chip.kind === "date" || chip.kind === "datetime"), text).toBe(false);
    }
    expect(ofKind("식대 6.8만원", "price")).toMatchObject([{ won: 68_000 }]);
  });

  it("reads two dates separated by a comma", () => {
    expect(ofKind("11/30, 12/12 가능합니다", "date").map((chip) => chip.ymd)).toEqual(["2026-11-30", "2026-12-12"]);
  });

  it("does not guess a day without a month or a relative day", () => {
    for (const text of ["22일 가능합니다", "내일 가능합니다", "다음 주 토요일 가능해요"]) {
      expect(read(text).chips.some((chip) => chip.kind === "date" || chip.kind === "datetime"), text).toBe(false);
    }
    // "내일 오후 2시"는 시간만 옮긴다.
    expect(read("내일 오후 2시 가능").chips.filter((chip) => chip.kind !== "phrase")).toMatchObject([{ kind: "time", time: "14:00" }]);
  });

  it("does not take the first syllable of the next word for a weekday", () => {
    for (const text of ["11월 30일 일정 가능합니다", "11월 30일 금액은 300만원입니다", "2026년 11월 30일 일반홀 가능", "2026.11.30 일정 확인"]) {
      expect(ofKind(text, "date"), text).toMatchObject([{ ymd: "2026-11-30", weekdayMismatch: false }]);
      expect(ofKind(text, "date")[0].quote, text).toMatch(/30(일)?$/);
    }
    // 낱말의 첫 글자로 해를 바꾸지 않는다(2027-11-30 이 화요일).
    expect(ofKind("11월 30일 화장실 공사가 있어요", "date")).toMatchObject([{ ymd: "2026-11-30", weekdayMismatch: false }]);
    // 요일로 쓴 말은 요일로 읽는다. 2026-11-30 은 월요일이라 어긋남을 알리고, 화요일인 2027-11-30 으로 해를 넘기지 않는다.
    expect(ofKind("11월 30일 화요일 가능", "date")).toMatchObject([{ ymd: "2026-11-30", weekdayMismatch: true }]);
    expect(ofKind("12월 25일 금", "date")).toMatchObject([{ ymd: "2026-12-25", weekdayMismatch: false }]);
    expect(ofKind("11월 30일 월 오후 2시", "datetime")).toMatchObject([{ ymd: "2026-11-30", weekdayMismatch: false, time: "14:00" }]);
  });

  it("reads a two-digit year as 20xx and shows the year on the chip", () => {
    const reply = "문의하신 27년 11월 27일 12시 홀은 가능하고요, 27년 12월 4일은 마감입니다.";
    expect(ofKind(reply, "datetime")).toMatchObject([{ ymd: "2027-11-27", time: "12:00", label: "2027년 11월 27일 (토) 오후 12시" }]);
    expect(ofKind(reply, "date")).toMatchObject([{ ymd: "2027-12-04", weekdayMismatch: false, label: "2027년 12월 4일 (토)" }]);
    // 숫자 꼴의 두 자리 해는 요일이나 바로 뒤의 시간이 있을 때만 날짜다.
    for (const text of ["27.11.30(화) 오후 2시 가능", "27.11.30 14:00 가능합니다", "27. 11. 30 오후 2시 가능합니다", "27/11/30 14:00 가능합니다"]) {
      expect(ofKind(text, "datetime"), text).toMatchObject([{ ymd: "2027-11-30", time: "14:00", weekdayMismatch: false }]);
    }
    expect(ofKind("27.11.30 가능합니다", "date")).toEqual([]);
  });

  it("never guesses the year of a month and day written right after a year it could not read", () => {
    // 2027-02-30 은 없는 날이다. 뒤의 "2월 30일"을 올해나 내년으로 짐작하지 않는다. 해를 잘못 친 "027년"도 같다.
    for (const text of ["27년 2월 30일 가능합니다", "027년 11월 30일 가능합니다"]) {
      expect(read(text).chips.some((chip) => chip.kind === "date" || chip.kind === "datetime"), text).toBe(false);
    }
  });

  it("reads 년도 as the year, and never guesses the year of a date written after one it could not read", () => {
    // 해가 적혀 있으므로 올해(2026)의 11월 30일로 짐작하지 않는다.
    expect(ofKind("2027년도 11월 30일 가능합니다", "date")).toMatchObject([{ ymd: "2027-11-30", weekdayMismatch: false, label: "2027년 11월 30일 (화)" }]);
    expect(ofKind("27년도 11월 30일 (화) 오후 2시 가능합니다", "datetime")).toMatchObject([{ ymd: "2027-11-30", time: "14:00", weekdayMismatch: false }]);
    expect(read("027년도 11월 30일 가능합니다").chips.some((chip) => chip.kind === "date" || chip.kind === "datetime")).toBe(false);
  });

  it("reads dotted dates written with spaces and a closing dot, and pairs them with the time after", () => {
    expect(ofKind("상담 일시: 2026. 11. 30.(월) 14:00", "datetime")).toMatchObject([
      { ymd: "2026-11-30", time: "14:00", weekdayMismatch: false, quote: "2026. 11. 30.(월) 14:00" },
    ]);
    expect(ofKind("예식 2027. 11. 30.(화) 오후 1시 가능합니다", "datetime")).toMatchObject([{ ymd: "2027-11-30", time: "13:00", weekdayMismatch: false }]);
    expect(ofKind("2026. 11. 30. 오후 2시 가능", "datetime")).toMatchObject([{ ymd: "2026-11-30", time: "14:00" }]);
    expect(ofKind("2026.11.30.(월) 오후 2:00", "datetime")).toMatchObject([{ ymd: "2026-11-30", time: "14:00" }]);
    expect(ofKind("11. 30.(월) 오후 2시 가능합니다", "datetime")).toMatchObject([{ ymd: "2026-11-30", time: "14:00", weekdayMismatch: false }]);
  });

  it("reads month/day followed by a weekday written without brackets", () => {
    expect(ofKind("12/5 토요일 오후 2시 가능합니다", "datetime")).toMatchObject([{ ymd: "2026-12-05", time: "14:00", weekdayMismatch: false }]);
    expect(ofKind("12.5 토 오후 2시 가능합니다", "datetime")).toMatchObject([{ ymd: "2026-12-05", time: "14:00", weekdayMismatch: false }]);
    expect(ofKind("12/6 일요일 가능합니다", "date")).toMatchObject([{ ymd: "2026-12-06", weekdayMismatch: false }]);
    // 홀로 쓴 "일"은 날수다(하루 반, 반나절).
    for (const text of ["촬영은 약 1.5 일 정도 걸려요", "1/2 일 정도 차 있어요"]) {
      expect(read(text).chips.some((chip) => chip.kind === "date" || chip.kind === "datetime"), text).toBe(false);
    }
  });
});

describe("times", () => {
  it("reads written meridiems and 24-hour clocks as given", () => {
    expect(ofKind("오후 2시 가능", "time")).toMatchObject([{ time: "14:00", meridiemGuessed: false, label: "오후 2시" }]);
    expect(ofKind("14:00 가능", "time")).toMatchObject([{ time: "14:00", meridiemGuessed: false }]);
    expect(ofKind("오전 10시 30분", "time")).toMatchObject([{ time: "10:30", meridiemGuessed: false, label: "오전 10시 30분" }]);
    expect(ofKind("저녁 7시", "time")).toMatchObject([{ time: "19:00", meridiemGuessed: false }]);
  });

  it("guesses business hours for a bare hour and says it guessed", () => {
    // 짐작한 오전·오후는 칩 글자에 적지 않는다(업체가 쓴 대로 "2시").
    expect(ofKind("2시 가능", "time")).toMatchObject([{ time: "14:00", meridiemGuessed: true, label: "2시" }]);
    expect(ofKind("10시 30분 가능", "time")).toMatchObject([{ time: "10:30", meridiemGuessed: true, label: "10시 30분" }]);
    expect(ofKind("2시 반 가능", "time")).toMatchObject([{ time: "14:30", meridiemGuessed: true }]);
    expect(ofKind("10시 가능", "time")).toMatchObject([{ time: "10:00", meridiemGuessed: true }]);
    expect(ofKind("2시가 비어 있어요", "time")).toMatchObject([{ time: "14:00", meridiemGuessed: true }]);
  });

  it("carries the meridiem across a range and across noon", () => {
    expect(ofKind("오후 2시~5시 가능", "time").map((chip) => [chip.time, chip.meridiemGuessed])).toEqual([["14:00", false], ["17:00", false]]);
    expect(ofKind("오후 2시부터 5시까지", "time").map((chip) => chip.time)).toEqual(["14:00", "17:00"]);
    expect(ofKind("오전 10시~2시 상담 가능", "time").map((chip) => chip.time)).toEqual(["10:00", "14:00"]);
    expect(ofKind("오전 11시~1시 가능", "time").map((chip) => chip.time)).toEqual(["11:00", "13:00"]);
    expect(ofKind("오전 9시~12시", "time").map((chip) => chip.time)).toEqual(["09:00", "12:00"]);
    expect(ofKind("오전 9시~11시", "time").map((chip) => chip.time)).toEqual(["09:00", "11:00"]);
  });

  it("carries the meridiem across the other tildes and dashes Korean keyboards type", () => {
    for (const dash of [char(0x223c), char(0x301c), char(0x2013)]) {
      const label = `U+${dash.charCodeAt(0).toString(16)}`;
      expect(ofKind(`오후 7시${dash}9시 가능`, "time").map((chip) => [chip.time, chip.meridiemGuessed]), label)
        .toEqual([["19:00", false], ["21:00", false]]);
      expect(ofKind(`오전 10시${dash}2시 상담`, "time").map((chip) => [chip.time, chip.meridiemGuessed]), label)
        .toEqual([["10:00", false], ["14:00", false]]);
    }
  });

  it("does not read a duration as a time", () => {
    expect(ofKind("2시간 정도 걸려요", "time")).toEqual([]);
    expect(ofKind("상담은 1시간 30분이에요", "time")).toEqual([]);
    expect(ofKind("1~2시간 정도 걸려요", "time")).toEqual([]);
  });

  it("reads both ends of a range written with a single 시 at the end", () => {
    const times = (text: string) => ofKind(text, "time").map((chip) => [chip.time, chip.meridiemGuessed]);
    expect(times("상담은 오후 2~5시 가능합니다")).toEqual([["14:00", false], ["17:00", false]]);
    expect(times("오전 10~11시 상담 가능")).toEqual([["10:00", false], ["11:00", false]]);
    expect(times("주말은 오전 10~오후 5시 가능합니다")).toEqual([["10:00", false], ["17:00", false]]);
    expect(times("평일은 10~오후 2시예요")).toEqual([["10:00", false], ["14:00", false]]);
    // 오전·오후를 하나도 적지 않았으면 두 끝 모두 짐작이다.
    expect(times("2~5시 가능")).toEqual([["14:00", true], ["17:00", true]]);
    expect(ofKind("오후 2~5시", "time").map((chip) => chip.label)).toEqual(["오후 2시", "오후 5시"]);
  });

  it("reads 밤 12시 as midnight", () => {
    expect(ofKind("가예약은 오늘 밤 12시까지 유지됩니다", "time")).toMatchObject([{ time: "00:00", meridiemGuessed: false, label: "오전 12시" }]);
    expect(ofKind("밤 9시까지 상담돼요", "time")).toMatchObject([{ time: "21:00" }]);
  });

  it("ends an evening range written up to 12시 at midnight, and reads 밤 1시 as one in the morning", () => {
    const times = (text: string) => ofKind(text, "time").map((chip) => chip.time);
    expect(times("주말에는 밤 10시~12시까지 통화 가능해요")).toEqual(["22:00", "00:00"]);
    expect(times("밤 10~12시 사이에 답장 드릴게요")).toEqual(["22:00", "00:00"]);
    expect(times("오후 10시~12시")).toEqual(["22:00", "00:00"]);
    // 오전이나 낮 12시에서 시작한 범위의 12시는 정오다.
    expect(times("오전 9시~12시")).toEqual(["09:00", "12:00"]);
    expect(ofKind("가예약은 밤 1시까지 잡아 둘게요", "time")).toMatchObject([{ time: "01:00", meridiemGuessed: false, label: "오전 1시" }]);
    expect(ofKind("밤 11시까지 연락 주세요", "time")).toMatchObject([{ time: "23:00" }]);
  });

  it("does not take the sent times of a copied KakaoTalk conversation for values", () => {
    const schedulable = (text: string) => read(text).chips.filter((chip) => chip.kind !== "phrase" && chip.kind !== "price");
    for (const text of [
      "[소담하우스] [오후 2:15] 안녕하세요 신부님\n[소담하우스] [오후 2:16] 12월 5일(토) 오전 11시 상담 가능해요",
      "2026년 11월 18일 오후 2:15, 소담하우스 : 안녕하세요\n2026년 11월 18일 오후 2:16, 소담하우스 : 12월 5일(토) 오전 11시 상담 가능해요",
      "2026. 11. 18. 오후 2:15, 소담하우스 : 12월 5일(토) 오전 11시 상담 가능해요",
      "--------------- 2026년 11월 18일 수요일 ---------------\n[소담하우스] [오후 2:15] 12월 5일(토) 오전 11시 상담 가능해요",
    ]) {
      expect(schedulable(text), text).toEqual([expect.objectContaining({ kind: "datetime", ymd: "2026-12-05", time: "11:00" })]);
      const result = read(text);
      // 따온 말에도 보낸 시각은 없다.
      expect(result.chips.filter((chip) => chip.kind === "phrase").map((chip) => chip.quote), text).toEqual(["12월 5일(토) 오전 11시 상담 가능해요"]);
      for (const chip of result.chips) expect(result.masked, text).toContain(chip.quote);
    }
    // 업체가 말 속에 쓴 시각은 그대로 읽는다.
    expect(ofKind("[소담하우스] [오후 2:15] 오후 3:30에 오시면 돼요", "time")).toMatchObject([{ time: "15:30" }]);
  });
});

describe("dates paired with times", () => {
  it("pairs a time written right after a date on the same line", () => {
    expect(read("11월 30일 (토) 오후 2시 가능합니다").chips.filter((chip) => chip.kind !== "phrase")).toEqual([{
      kind: "datetime",
      ymd: "2026-11-30",
      time: "14:00",
      meridiemGuessed: false,
      weekdayMismatch: true,
      label: "11월 30일 (월) 오후 2시",
      quote: "11월 30일 (토) 오후 2시",
    }]);
    expect(ofKind("11월 30일 오후 2시, 12월 1일 오전 11시 가능", "datetime").map((chip) => `${chip.ymd} ${chip.time}`))
      .toEqual(["2026-11-30 14:00", "2026-12-01 11:00"]);
    expect(ofKind("2026.11.30 14:00", "datetime")).toMatchObject([{ ymd: "2026-11-30", time: "14:00" }]);
    expect(ofKind("11월 30일 (토) 2시", "datetime")).toMatchObject([{ time: "14:00", meridiemGuessed: true, label: "11월 30일 (월) 2시" }]);
  });

  it("gives a time to the nearest date before it, never across another date", () => {
    for (const text of [
      "11월 30일은 마감이고 12월 1일 오후 2시 가능합니다",
      "11/30, 12/1 오후 2시 가능",
      "11월 30일 (월) 12월 1일 (화) 오후 2시",
    ]) {
      expect(ofKind(text, "datetime"), text).toMatchObject([{ ymd: "2026-12-01", time: "14:00", quote: expect.stringMatching(/^12/) }]);
      expect(ofKind(text, "date"), text).toMatchObject([{ ymd: "2026-11-30" }]);
    }
    expect(ofKind("11월 30일은 마감이고 12월 1일 오후 2시 가능합니다", "datetime")[0].quote).toBe("12월 1일 오후 2시");
  });

  it("does not pair across a line break", () => {
    const chips = read("11월 30일은 마감이고\n오후 2시는 다른 날").chips;
    expect(chips.some((chip) => chip.kind === "datetime")).toBe(false);
    expect(chips.filter((chip) => chip.kind === "date" || chip.kind === "time").map((chip) => chip.kind)).toEqual(["date", "time"]);
  });

  it("does not pair a date with a time across 까지, 마감, 이고, a comma or a sentence end", () => {
    for (const text of [
      "11월 30일까지 답 주시면 오후 2시 상담 잡아 드릴게요",
      "11월 30일 마감 후 오후 2시 상담이 비어요",
      "11월 30일이고 오후 2시는 다른 날이에요",
      "11월 30일, 오후 2시 둘 다 가능해요",
      "11월 30일. 오후 2시는 어려워요",
    ]) {
      const chips = read(text).chips;
      expect(chips.some((chip) => chip.kind === "datetime"), text).toBe(false);
      expect(chips.filter((chip) => chip.kind === "date" || chip.kind === "time").map((chip) => chip.kind), text).toEqual(["date", "time"]);
    }
    // 날짜 꼴의 끝 점과 요일은 끊는 말이 아니다.
    expect(ofKind("2026.11.30.(월) 오후 2:00 가능합니다", "datetime")).toMatchObject([{ ymd: "2026-11-30", time: "14:00" }]);
  });

  it("does not pair a date with a time across a formal sentence end written without a full stop", () => {
    for (const text of [
      "11월 30일은 예약이 찼습니다 오후 2시는 12월 1일에 가능해요",
      "11월 30일 상담은 어렵습니다 오후 2시는 12월에 가능해요",
    ]) {
      expect(ofKind(text, "datetime"), text).toEqual([]);
      expect(ofKind(text, "time").map((chip) => chip.time), text).toEqual(["14:00"]);
    }
    // "요"는 말 중간에도 붙으므로("12월 5일은요") 끊지 않는다. 날짜에 붙은 요일도 끊는 말이 아니다.
    expect(ofKind("12월 5일은요 오후 2시 가능해요", "datetime")).toMatchObject([{ ymd: "2026-12-05", time: "14:00" }]);
    expect(ofKind("11월 30일 월요일 오후 2시 가능해요", "datetime")).toMatchObject([{ ymd: "2026-11-30", time: "14:00" }]);
    expect(ofKind("12/5 토요일 오후 2시 가능합니다", "datetime")).toMatchObject([{ ymd: "2026-12-05", time: "14:00" }]);
  });
});

describe("prices", () => {
  it("reads won amounts in the usual Korean shapes", () => {
    for (const [text, won] of [
      ["대관료 300만원", 3_000_000],
      ["대관료 300만 원", 3_000_000],
      ["식대 6.5만원", 65_000],
      ["식대 6만 5천원", 65_000],
      ["총 1억 2천만원", 120_000_000],
      ["3,000,000원", 3_000_000],
      ["총 169,000,000원입니다", 169_000_000],
    ] as const) {
      expect(ofKind(text, "price").map((chip) => chip.won), text).toEqual([won]);
    }
  });

  it("names what the amount is for when the vendor wrote it right before", () => {
    expect(ofKind("1인 55,000원", "price")).toMatchObject([{ won: 55_000, subject: "1인", label: "1인 55,000원" }]);
    expect(ofKind("인당 55,000원", "price")).toMatchObject([{ subject: "1인" }]);
    expect(ofKind("꽃장식 150만원", "price")).toMatchObject([{ subject: "꽃장식", label: "꽃장식 150만 원" }]);
    expect(ofKind("식대 6.8만원, 대관료 300만원", "price").map((chip) => chip.subject)).toEqual(["식대", "대관료"]);
    expect(ofKind("3,000,000원", "price")).toMatchObject([{ subject: null, label: "300만 원" }]);
  });

  it("reads 만 without 원 only next to a price word", () => {
    expect(ofKind("식대 6.8만", "price")).toMatchObject([{ won: 68_000, subject: "식대" }]);
    expect(ofKind("조회수가 6.8만이에요", "price")).toEqual([]);
    expect(ofKind("하객 200명 예상", "price")).toEqual([]);
  });

  it("converts amounts exactly", () => {
    expect(parseKoreanAmount("300만원")).toBe(3_000_000);
    expect(parseKoreanAmount("6만 5천원")).toBe(65_000);
    expect(parseKoreanAmount("1억 2천만원")).toBe(120_000_000);
    expect(parseKoreanAmount("1억2천5백만원")).toBe(125_000_000);
    expect(parseKoreanAmount("3,000,000원")).toBe(3_000_000);
    expect(parseKoreanAmount("예약금")).toBeNull();
    expect(formatWon(3_000_000)).toBe("300만 원");
    expect(formatWon(65_000)).toBe("65,000원");
  });

  it("reads 1억2천 and 1억 2천 as 1억 2천만, as people say them", () => {
    expect(parseKoreanAmount("1억2천")).toBe(120_000_000);
    expect(parseKoreanAmount("1억 5천")).toBe(150_000_000);
    expect(parseKoreanAmount("1억2천5백")).toBe(125_000_000);
    // 끝에 맨 숫자가 오면 만 단위로 읽지 않는다.
    expect(parseKoreanAmount("1억 2000")).toBe(100_002_000);
    expect(ofKind("호텔 패키지로 하시면 총 1억2천 정도 예상하시면 돼요", "price")).toMatchObject([{ won: 120_000_000, upToWon: null, subject: "총" }]);
    expect(ofKind("총 1억 2천 정도예요", "price")).toMatchObject([{ won: 120_000_000 }]);
  });

  it("shows a price range as one chip with both ends, never the upper end alone", () => {
    expect(ofKind("대관료 300~400만원 선입니다", "price")).toEqual([
      { kind: "price", won: 3_000_000, upToWon: 4_000_000, subject: "대관료", label: "대관료 300만 원 ~ 400만 원", quote: "300~400만원" },
    ]);
    for (const [text, labels] of [
      ["식대 55,000~68,000원입니다", ["식대 55,000원 ~ 68,000원"]],
      ["식대 5.5~6.8만원", ["식대 55,000원 ~ 68,000원"]],
      ["대관료 300만~400만원", ["대관료 300만 원 ~ 400만 원"]],
      ["대관료 2천~3천만원", ["대관료 2,000만 원 ~ 3,000만 원"]],
      ["대관료는 300에서 400만원 사이예요", ["대관료 300만 원 ~ 400만 원"]],
      // 붙여 쓴 범위는 전화번호나 계좌번호로 가리지 않고 금액으로 읽는다.
      ["견적은 대략 1500-2000만원 선이고, 식대는 1인 55000-68000원 사이입니다.", ["1,500만 원 ~ 2,000만 원", "1인 55,000원 ~ 68,000원"]],
    ] as const) {
      expect(ofKind(text, "price").map((chip) => chip.label), text).toEqual(labels);
      expect(read(text).maskedCount, text).toBe(0);
    }
    // 두 금액이 범위가 아니면(뺀 값) 따로 읽는다.
    expect(ofKind("대관료 300만원 - 50만원 할인", "price").map((chip) => [chip.won, chip.upToWon])).toEqual([[3_000_000, null], [500_000, null]]);
  });
});

describe("guarantee counts", () => {
  it("reads the guarantee in both word orders and nothing else", () => {
    expect(ofKind("보증인원 200명", "count")).toMatchObject([{ count: 200, label: "보증 인원 200명", quote: "보증인원 200명" }]);
    expect(ofKind("200명 보증", "count")).toMatchObject([{ count: 200, quote: "200명 보증" }]);
    expect(ofKind("보증 인원은 250명입니다", "count")).toMatchObject([{ count: 250 }]);
    expect(ofKind("하객 200명 예상", "count")).toEqual([]);
  });
});

describe("the vendor's own words", () => {
  it("quotes sentences verbatim and never classifies them", () => {
    const [phrase] = ofKind("그날은 불가능합니다.", "phrase");
    // "불가능"에는 "가능"이 들어 있다. 그래도 가능·불가능을 가르지 않고 문장을 그대로 옮긴다.
    expect(phrase).toEqual({ kind: "phrase", label: "그날은 불가능합니다.", quote: "그날은 불가능합니다." });
    expect(ofKind("토요일 오후 2시 가능합니다.", "phrase")).toEqual([{ kind: "phrase", label: "토요일 오후 2시 가능합니다.", quote: "토요일 오후 2시 가능합니다." }]);
    for (const text of ["예약이 마감되었습니다.", "가예약 걸어 드릴 수 있어요.", "그 날은 어렵습니다", "확정되었습니다"]) {
      expect(ofKind(text, "phrase").map((chip) => chip.quote), text).toEqual([text]);
    }
  });

  it("quotes from the masked text, never from the original", () => {
    const result = read("010-1234-5678 로 연락 주시면 가능합니다");
    const phrases = result.chips.filter((chip) => chip.kind === "phrase");
    expect(phrases.map((chip) => chip.quote)).toEqual([`${LABELS.phone} 로 연락 주시면 가능합니다`]);
    for (const chip of result.chips) expect(result.masked).toContain(chip.quote);
  });
});

describe("money caution", () => {
  it("adds the caution line for accounts, deposits and payment links", () => {
    for (const text of [
      "예약금은 계좌로 입금 부탁드립니다",
      "입금 계좌는 3333-01-1234567 카카오뱅크입니다",
      "결제 링크 보내 드릴게요 https://pay.example.com/x",
      "카드 결제 링크를 보내 드려요",
      "결제는 pay.toss.im/abc 에서",
    ]) {
      expect(read(text).caution, text).toBe(true);
    }
  });

  it("stays quiet for an ordinary reply", () => {
    expect(read("상담은 토요일 오후 2시 가능합니다").caution).toBe(false);
    expect(read("대관료 300만원, 식대 1인 55,000원입니다").caution).toBe(false);
  });

  it("adds the caution line for bank names and 예금주 even without a number", () => {
    for (const text of ["국민은행으로 보내 주세요", "카카오뱅크로 부탁드려요", "예금주는 소담웨딩입니다", "농협으로 부탁드려요", "신협으로 부탁드려요", "새마을금고로 부탁드려요", "우체국으로 보내 주세요"]) {
      expect(read(text).caution, text).toBe(true);
    }
  });

  it("does not raise the caution for a number hidden only by its digit pattern", () => {
    // 은행·송금 낱말 없이 숫자 묶음만 보고 가린 계좌는 가리되 안내를 켜지 않는다. 가린 자리의 "[계좌번호]" 표시도 돈 이야기가 아니다.
    for (const text of ["보내실 곳 1002-123-456789", "참고 번호 1234567890123 입니다"]) {
      const result = read(text);
      expect(result.maskedKinds, text).toEqual(["account"]);
      expect(result.caution, text).toBe(false);
    }
  });

  it("raises the caution for a link only when a payment word is next to it", () => {
    expect(read("카드 결제는 여기서: bit.ly/xyz").caution).toBe(true);
    expect(read("결제는 아래에서 해 주세요\nnaver.me/abc").caution).toBe(true);
    const far = `자세한 안내는 naver.me/abc 참고해 주세요. ${"주차는 지하 2층에 가능합니다. ".repeat(3)}카드 결제도 됩니다`;
    expect(read(far).caution).toBe(false);
    expect(read("자세한 안내는 naver.me/abc 참고해 주세요").caution).toBe(false);
  });
});

describe("labels say values, not verdicts", () => {
  const SAMPLES = [
    "2026년 11월 30일 (토) 오후 2시 가능합니다. 대관료 300만원, 식대 1인 6.8만원, 보증인원 200명입니다.",
    "11/30 14:00, 12월 1일 오전 11시~1시 가능. 총 1억 2천만원 견적입니다.",
    "예약금 50만원은 계좌로 입금해 주세요. 최고의 홀이에요! 추천드려요.",
    "27년 11월 27일 (토) 오후 2~5시 가능하고 대관료 300~400만원, 식대 1인 55000-68000원입니다.",
  ];

  it("uses no judgement words in any label we write", () => {
    for (const text of SAMPLES) {
      for (const chip of read(text).chips) {
        if (chip.kind === "phrase") continue;
        expect(chip.label, chip.label).not.toMatch(BANNED);
      }
    }
    const copyStrings = Object.values(VENDOR_REPLY_COPY).flatMap((value): string[] => {
      if (typeof value === "string") return [value];
      if (Array.isArray(value)) return value.map(String);
      if (typeof value === "function") return [];
      return Object.values(value as Record<string, string>);
    });
    for (const text of [
      ...copyStrings,
      VENDOR_REPLY_COPY.masked(3),
      VENDOR_REPLY_COPY.dateChip(11, 30, "월"),
      VENDOR_REPLY_COPY.timeChip("오후", 2, 30),
      VENDOR_REPLY_COPY.countChip(200),
      VENDOR_REPLY_COPY.priceChip("식대", "6만 원"),
      VENDOR_REPLY_COPY.priceRangeChip("300만 원", "400만 원"),
    ]) {
      expect(text, text).not.toMatch(BANNED);
    }
  });

  it("keeps the vendor's words only inside phrase chips, quoted as written", () => {
    const result = read(SAMPLES[2]);
    for (const chip of result.chips.filter((item) => item.kind === "phrase")) {
      expect(chip.label).toBe(chip.quote);
      expect(result.masked).toContain(chip.quote);
    }
  });

  it("never returns more than twelve chips", () => {
    const many = Array.from({ length: 20 }, (_, index) => `${index + 1}월 ${index + 1}일 오후 ${(index % 5) + 1}시`).slice(0, 12).join(", ");
    expect(read(`${many}, 대관료 300만원, 식대 6만원, 보증인원 200명`).chips.length).toBeLessThanOrEqual(12);
  });

  it("keeps at most eight dates and times so prices, the guarantee and the vendor's words still show", () => {
    const reply = [
      "11/21(토) 11/22(일) 11/28(토) 11/29(일) 12/5(토) 12/6(일) 12/12(토) 12/13(일) 12/19(토) 12/20(일) 12/26(토) 12/27(일)",
      "대관료 300만원, 식대 1인 68,000원, 보증인원 200명입니다",
      "12월 이후는 마감입니다.",
    ].join("\n");
    const chips = read(reply).chips;
    expect(chips.filter((chip) => chip.kind === "date").map((chip) => chip.ymd)).toEqual([
      "2026-11-21", "2026-11-22", "2026-11-28", "2026-11-29", "2026-12-05", "2026-12-06", "2026-12-12", "2026-12-13",
    ]);
    expect(chips.filter((chip) => chip.kind !== "date").map((chip) => chip.label)).toEqual([
      "보증 인원 200명", "대관료 300만 원", "1인 68,000원", "12월 이후는 마감입니다.",
    ]);
  });

  it("keeps the weekday warning when the same date is written twice and only one copy has the wrong weekday", () => {
    for (const text of ["11월 30일 가능하고요, 11월 30일 (토) 오후는 마감이에요", "11월 30일 (토) 오후는 마감이에요. 11월 30일 가능하고요"]) {
      expect(ofKind(text, "date"), text).toMatchObject([{ ymd: "2026-11-30", weekdayMismatch: true, label: "11월 30일 (월)" }]);
    }
    expect(ofKind("11월 30일 오후 2시 가능하고요. 11월 30일 (토) 오후 2시로 잡을까요?", "datetime")).toMatchObject([
      { ymd: "2026-11-30", time: "14:00", weekdayMismatch: true },
    ]);
  });

  it("does not cut a quoted sentence at a dot that follows a digit", () => {
    expect(ofKind("2026. 11. 30.(월) 오후 2시 상담 가능합니다. 대관료는 300만원입니다.", "phrase").map((chip) => chip.quote)).toEqual([
      "2026. 11. 30.(월) 오후 2시 상담 가능합니다.",
    ]);
  });
});
