import { describe, expect, it } from "vitest";
import { ensureTimezone } from "./calendar-api";

describe("ensureTimezone", () => {
  it("appends Z to a bare ISO datetime", () => {
    expect(ensureTimezone("2026-04-10T00:00:00")).toBe("2026-04-10T00:00:00Z");
  });

  it("leaves a UTC Z suffix unchanged", () => {
    expect(ensureTimezone("2026-04-10T00:00:00Z")).toBe("2026-04-10T00:00:00Z");
  });

  it("leaves a positive offset unchanged", () => {
    expect(ensureTimezone("2026-04-10T00:00:00+05:30")).toBe("2026-04-10T00:00:00+05:30");
  });

  it("leaves a negative offset unchanged", () => {
    expect(ensureTimezone("2026-04-10T00:00:00-07:00")).toBe("2026-04-10T00:00:00-07:00");
  });

  it("handles datetime with seconds and fractional seconds", () => {
    expect(ensureTimezone("2026-04-10T14:30:00.000")).toBe("2026-04-10T14:30:00.000Z");
  });

  it("handles date-only string", () => {
    expect(ensureTimezone("2026-04-10")).toBe("2026-04-10Z");
  });
});
