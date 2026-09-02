/** 기간의 크기를 한국어 단위로. 단위는 값에서 나온다(「255월」 이 만들어질 수 없다). */
export declare function formatKoreanDayCount(days: number): string;

/** 오늘 기준 앞뒤를 함께. `오늘`·`내일`·`어제`·`8일 후`·`약 9개월 후`. */
export declare function formatKoreanRelativeDays(days: number): string;
