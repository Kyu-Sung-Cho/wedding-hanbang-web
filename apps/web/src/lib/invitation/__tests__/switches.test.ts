import { describe, expect, it } from "vitest";
import {
  INQUIRY_DAILY_CAP_ENV,
  INQUIRY_GLOBAL_DAILY_CAP_ENV,
  INQUIRY_SELF_SEND_ENV,
  INQUIRY_SENDING_ENV,
  inquiryDailyCap,
  inquiryGlobalDailyCap,
  isInquirySelfSendEnabled,
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

describe("couple self-send switch (D-83 stage 1)", () => {
  it("reads the documented variable name", () => {
    expect(INQUIRY_SELF_SEND_ENV).toBe("HALL_INQUIRY_SELF_SEND_ENABLED");
  });

  it("keeps self-send off unless the value is exactly true", () => {
    expect(isInquirySelfSendEnabled({})).toBe(false);
    for (const value of ["", "TRUE", "True", "1", "yes", "on", " true", "true ", "false"]) {
      expect(isInquirySelfSendEnabled({ [INQUIRY_SELF_SEND_ENV]: value }), value).toBe(false);
    }
    expect(isInquirySelfSendEnabled({ [INQUIRY_SELF_SEND_ENV]: "true" })).toBe(true);
  });

  it("is off whenever operator sending is on, so the two paths never open together", () => {
    expect(isInquirySelfSendEnabled({ [INQUIRY_SELF_SEND_ENV]: "true", [INQUIRY_SENDING_ENV]: "true" })).toBe(false);
    // 대기열 스위치가 "true" 가 아니면(빈 값·오타 포함) 꺼진 것이고 직접 보내기는 그대로 켜진다.
    for (const sending of ["false", "", "TRUE", "1"]) {
      expect(isInquirySelfSendEnabled({ [INQUIRY_SELF_SEND_ENV]: "true", [INQUIRY_SENDING_ENV]: sending }), sending).toBe(true);
    }
  });

  it("reads the process environment by default", () => {
    const saved = { self: process.env[INQUIRY_SELF_SEND_ENV], sending: process.env[INQUIRY_SENDING_ENV] };
    try {
      delete process.env[INQUIRY_SENDING_ENV];
      process.env[INQUIRY_SELF_SEND_ENV] = "true";
      expect(isInquirySelfSendEnabled()).toBe(true);
      process.env[INQUIRY_SENDING_ENV] = "true";
      expect(isInquirySelfSendEnabled()).toBe(false);
      delete process.env[INQUIRY_SELF_SEND_ENV];
      delete process.env[INQUIRY_SENDING_ENV];
      expect(isInquirySelfSendEnabled()).toBe(false);
    } finally {
      if (saved.self === undefined) delete process.env[INQUIRY_SELF_SEND_ENV];
      else process.env[INQUIRY_SELF_SEND_ENV] = saved.self;
      if (saved.sending === undefined) delete process.env[INQUIRY_SENDING_ENV];
      else process.env[INQUIRY_SENDING_ENV] = saved.sending;
    }
  });
});
