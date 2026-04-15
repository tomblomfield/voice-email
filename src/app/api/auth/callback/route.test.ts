import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockAddGoogleAccount,
  mockCountGoogleAccounts,
  mockCreateSessionCookieValue,
  mockEncryptTokens,
  mockExchangeCode,
  mockFindUserByGoogleEmail,
  mockGetUserEmail,
  mockInitDb,
  mockParseAddAccountState,
  mockConsumeOAuthStateNonce,
  mockUpsertUser,
} = vi.hoisted(() => ({
  mockAddGoogleAccount: vi.fn(),
  mockCountGoogleAccounts: vi.fn(),
  mockCreateSessionCookieValue: vi.fn(),
  mockEncryptTokens: vi.fn(),
  mockExchangeCode: vi.fn(),
  mockFindUserByGoogleEmail: vi.fn(),
  mockGetUserEmail: vi.fn(),
  mockInitDb: vi.fn(),
  mockParseAddAccountState: vi.fn(),
  mockConsumeOAuthStateNonce: vi.fn(),
  mockUpsertUser: vi.fn(),
}));

vi.mock("@/app/lib/gmail", () => ({
  exchangeCode: mockExchangeCode,
  encryptTokens: mockEncryptTokens,
  getUserEmail: mockGetUserEmail,
}));

vi.mock("@/app/lib/db", () => ({
  initDb: mockInitDb,
  upsertUser: mockUpsertUser,
  findUserByGoogleEmail: mockFindUserByGoogleEmail,
  addGoogleAccount: mockAddGoogleAccount,
  consumeOAuthStateNonce: mockConsumeOAuthStateNonce,
  countGoogleAccounts: mockCountGoogleAccounts,
}));

vi.mock("@/app/lib/session", () => ({
  SESSION_COOKIE_NAME: "voicemail_session",
  SESSION_MAX_AGE: 60 * 60 * 24 * 30,
  createSessionCookieValue: mockCreateSessionCookieValue,
  parseAddAccountState: mockParseAddAccountState,
}));

function callbackRequest(state: string, cookieValue?: string) {
  const headers = new Headers({
    "x-forwarded-host": "voice-email.example",
    "x-forwarded-proto": "https",
  });
  if (cookieValue) {
    headers.set("Cookie", `voicemail_session=${cookieValue}`);
  }

  return new NextRequest(
    `https://voice-email.example/api/auth/callback?code=code_123&state=${encodeURIComponent(
      state
    )}`,
    { headers }
  );
}

describe("GET /api/auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExchangeCode.mockResolvedValue({ access_token: "token" });
    mockEncryptTokens.mockReturnValue("encrypted-tokens");
    mockGetUserEmail.mockResolvedValue("second@example.com");
    mockInitDb.mockResolvedValue(undefined);
    mockCountGoogleAccounts.mockResolvedValue(1);
    mockConsumeOAuthStateNonce.mockResolvedValue(true);
    mockAddGoogleAccount.mockResolvedValue({
      id: "account_123",
      email: "second@example.com",
      is_primary: false,
    });
    mockCreateSessionCookieValue.mockImplementation(
      (userId: string) => `session:${userId}`
    );
  });

  it("adds an OAuth account to the user id carried in state when the session cookie is missing", async () => {
    mockParseAddAccountState.mockReturnValue({
      isAddAccount: true,
      userId: "original-user",
      nonce: "nonce_123",
      error: null,
    });
    const { GET } = await import("./route");

    const response = await GET(callbackRequest("encrypted-state"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://voice-email.example/app"
    );
    expect(mockConsumeOAuthStateNonce).toHaveBeenCalledWith(
      "original-user",
      "nonce_123"
    );
    expect(mockAddGoogleAccount).toHaveBeenCalledWith(
      "original-user",
      "second@example.com",
      "encrypted-tokens",
      false
    );
    expect(mockCreateSessionCookieValue).toHaveBeenCalledWith("original-user");
    expect(response.headers.get("set-cookie")).toContain(
      "voicemail_session=session%3Aoriginal-user"
    );
  });

  it("does not exchange OAuth code for invalid add-account state", async () => {
    mockParseAddAccountState.mockReturnValue({
      isAddAccount: true,
      userId: null,
      nonce: null,
      error: "invalid",
    });
    const { GET } = await import("./route");

    const response = await GET(callbackRequest("addAccount"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://voice-email.example/app?error=add_account_state_invalid"
    );
    expect(mockExchangeCode).not.toHaveBeenCalled();
    expect(mockFindUserByGoogleEmail).not.toHaveBeenCalled();
    expect(mockUpsertUser).not.toHaveBeenCalled();
    expect(mockAddGoogleAccount).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects add-account callback when the nonce has already been used", async () => {
    mockParseAddAccountState.mockReturnValue({
      isAddAccount: true,
      userId: "original-user",
      nonce: "nonce_123",
      error: null,
    });
    mockConsumeOAuthStateNonce.mockResolvedValue(false);
    const { GET } = await import("./route");

    const response = await GET(callbackRequest("encrypted-state"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://voice-email.example/app?error=add_account_state_invalid"
    );
    expect(mockAddGoogleAccount).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("reports expired add-account state without exchanging OAuth code", async () => {
    mockParseAddAccountState.mockReturnValue({
      isAddAccount: true,
      userId: null,
      nonce: null,
      error: "expired",
    });
    const { GET } = await import("./route");

    const response = await GET(callbackRequest("expired-state"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://voice-email.example/app?error=add_account_state_expired"
    );
    expect(mockExchangeCode).not.toHaveBeenCalled();
  });
});
