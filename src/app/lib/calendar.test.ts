import { describe, expect, it } from "vitest";

import {
  inferCalendarProfile,
  resolveCalendarInviteDetails,
} from "./calendar";

describe("inferCalendarProfile", () => {
  it("infers work, home, and zoom defaults from past invites", () => {
    const profile = inferCalendarProfile([
      {
        summary: "Team sync at office",
        location: "1 Market St, San Francisco, CA",
        start: "2026-03-03T10:00:00-08:00",
        attendeeCount: 5,
      },
      {
        summary: "Board meeting work session",
        location: "1 Market St, San Francisco, CA",
        start: "2026-03-10T09:00:00-08:00",
        attendeeCount: 6,
      },
      {
        summary: "Dinner at home",
        location: "77 Pineapple Ave, San Francisco, CA",
        start: "2026-03-14T19:00:00-08:00",
      },
      {
        summary: "Family brunch at home",
        location: "77 Pineapple Ave, San Francisco, CA",
        start: "2026-03-21T11:00:00-08:00",
      },
      {
        summary: "Investor catch-up",
        description: "Zoom link: https://acme.zoom.us/j/123456789?pwd=abc",
        start: "2026-03-11T08:30:00-08:00",
      },
      {
        summary: "Product review",
        description: "Join here https://acme.zoom.us/j/123456789?pwd=abc",
        start: "2026-03-18T08:30:00-08:00",
      },
    ]);

    expect(profile.workAddress?.value).toBe("1 Market St, San Francisco, CA");
    expect(profile.homeAddress?.value).toBe("77 Pineapple Ave, San Francisco, CA");
    expect(profile.zoomLink?.value).toBe("https://acme.zoom.us/j/123456789?pwd=abc");
  });

  it("avoids reusing the same location for both home and work", () => {
    const profile = inferCalendarProfile([
      {
        summary: "Office hours",
        location: "100 Main St, San Francisco, CA",
        start: "2026-03-03T10:00:00-08:00",
        attendeeCount: 3,
      },
      {
        summary: "Another office meeting",
        location: "100 Main St, San Francisco, CA",
        start: "2026-03-04T10:00:00-08:00",
        attendeeCount: 4,
      },
    ]);

    expect(profile.workAddress?.value).toBe("100 Main St, San Francisco, CA");
    expect(profile.homeAddress).toBeNull();
  });
});

describe("resolveCalendarInviteDetails", () => {
  it("uses inferred work location", () => {
    const resolved = resolveCalendarInviteDetails({
      locationPreference: "work",
      inferredProfile: {
        scannedEvents: 12,
        homeAddress: null,
        workAddress: {
          value: "1 Market St, San Francisco, CA",
          confidence: "high",
          evidenceCount: 4,
          reason: "Seen 4 times.",
        },
        zoomLink: null,
      },
    });

    expect(resolved.location).toBe("1 Market St, San Francisco, CA");
  });

  it("adds the inferred zoom link to the event description", () => {
    const resolved = resolveCalendarInviteDetails({
      locationPreference: "zoom",
      notes: "Discuss roadmap",
      inferredProfile: {
        scannedEvents: 9,
        homeAddress: null,
        workAddress: null,
        zoomLink: {
          value: "https://acme.zoom.us/j/123456789?pwd=abc",
          confidence: "medium",
          evidenceCount: 2,
          reason: "Seen 2 times.",
        },
      },
    });

    expect(resolved.location).toBe("https://acme.zoom.us/j/123456789?pwd=abc");
    expect(resolved.description).toContain("Discuss roadmap");
    expect(resolved.description).toContain("Zoom: https://acme.zoom.us/j/123456789?pwd=abc");
  });

  it("fails safely when a requested inferred value is missing", () => {
    const resolved = resolveCalendarInviteDetails({
      locationPreference: "home",
      inferredProfile: {
        scannedEvents: 3,
        homeAddress: null,
        workAddress: null,
        zoomLink: null,
      },
    });

    expect(resolved.error).toContain("home address");
  });
});
