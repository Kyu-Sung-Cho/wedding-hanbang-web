import { describe, expect, it } from "vitest";
import {
  INQUIRY_DAILY_CAP_ENV,
  INQUIRY_GLOBAL_DAILY_CAP_ENV,
  INQUIRY_SENDING_ENV,
  inquiryDailyCap,
  inquiryGlobalDailyCap,
  isInquirySendingEnabled,
} from "../switches";

describe("inquiry switches (WS5)", () => {
  it("keeps sending off unless the value is exactly true", () => {
    expect(isInquirySendingEnabled({})).toBe(false);
    for (const value of ["", "TRUE", "1", "yes", " true", "false"]) {
      expect(isInquirySendingEnabled({ [INQUIRY_SENDING_ENV]: value }), value).toBe(false);
    }
    expect(isInquirySendingEnabled({ [INQUIRY_SENDING_ENV]: "true" })).toBe(true);
  });

  it("defaults the daily cap to five and fails closed on a bad value", () => {
    expect(inquiryDailyCap({})).toEqual({ value: 5, misconfigured: false });
    expect(inquiryDailyCap({ [INQUIRY_DAILY_CAP_ENV]: " 3 " })).toEqual({ value: 3, misconfigured: false });
    expect(inquiryDailyCap({ [INQUIRY_DAILY_CAP_ENV]: "50" })).toEqual({ value: 50, misconfigured: false });
    for (const value of ["0", "51", "-1", "2.5", "many", "1e2"]) {
      expect(inquiryDailyCap({ [INQUIRY_DAILY_CAP_ENV]: value }), value).toEqual({ value: 0, misconfigured: true });
    }
  });

  it("fails the service-wide daily cap closed: missing or bad means nothing is queued", () => {
    expect(inquiryGlobalDailyCap({})).toEqual({ value: 0, misconfigured: true });
    expect(inquiryGlobalDailyCap({ [INQUIRY_GLOBAL_DAILY_CAP_ENV]: "" })).toEqual({ value: 0, misconfigured: true });
    expect(inquiryGlobalDailyCap({ [INQUIRY_GLOBAL_DAILY_CAP_ENV]: " 40 " })).toEqual({ value: 40, misconfigured: false });
    expect(inquiryGlobalDailyCap({ [INQUIRY_GLOBAL_DAILY_CAP_ENV]: "0" })).toEqual({ value: 0, misconfigured: false });
    expect(inquiryGlobalDailyCap({ [INQUIRY_GLOBAL_DAILY_CAP_ENV]: "1000" })).toEqual({ value: 1000, misconfigured: false });
    for (const value of ["1001", "-1", "2.5", "many", "1e2", "99999"]) {
      expect(inquiryGlobalDailyCap({ [INQUIRY_GLOBAL_DAILY_CAP_ENV]: value }), value).toEqual({ value: 0, misconfigured: true });
    }
  });
});
