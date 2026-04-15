import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAddAccountState,
  createSessionCookieValue,
  getSessionUserId,
  parseAddAccountState,
} from "./session";

let originalSessionSecret: string | undefined;

beforeEach(() => {
  originalSessionSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret";
});

afterEach(() => {
  if (originalSessionSecret === undefined) {
    delete process.env.SESSION_SECRET;
  } else {
    process.env.SESSION_SECRET = originalSessionSecret;
  }
});

describe("session cookies", () => {
  it("round trips the encrypted user id", () => {
    const value = createSessionCookieValue("user_123");

    expect(getSessionUserId(value)).toBe("user_123");
  });

  it("returns null for invalid cookie values", () => {
    expect(getSessionUserId("not encrypted")).toBeNull();
  });
});

describe("add-account OAuth state", () => {
  it("round trips the encrypted original user id", () => {
    const state = createAddAccountState("user_123", "nonce_123", 1000);

    expect(parseAddAccountState(state, 1000)).toEqual({
      isAddAccount: true,
      userId: "user_123",
      nonce: "nonce_123",
      error: null,
    });
  });

  it("rejects expired add-account state", () => {
    const state = createAddAccountState("user_123", "nonce_123", 1000);

    expect(parseAddAccountState(state, 1000 + 10 * 60 * 1000 + 1)).toEqual({
      isAddAccount: true,
      userId: null,
      nonce: null,
      error: "expired",
    });
  });

  it("rejects add-account state issued too far in the future", () => {
    const state = createAddAccountState("user_123", "nonce_123", 1000);

    expect(parseAddAccountState(state, -60_001)).toEqual({
      isAddAccount: true,
      userId: null,
      nonce: null,
      error: "invalid",
    });
  });

  it("rejects legacy add-account state without a nonce", () => {
    expect(parseAddAccountState("addAccount")).toEqual({
      isAddAccount: true,
      userId: null,
      nonce: null,
      error: "invalid",
    });
  });

  it("does not treat unrelated state as add-account state", () => {
    expect(parseAddAccountState("regularLogin")).toEqual({
      isAddAccount: false,
      userId: null,
      nonce: null,
      error: null,
    });
  });

  it("keeps malformed add-account state in add-account mode", () => {
    expect(parseAddAccountState("addAccount:not encrypted")).toEqual({
      isAddAccount: true,
      userId: null,
      nonce: null,
      error: "invalid",
    });
  });
});
