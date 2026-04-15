import { encryptTokens, decryptTokens } from "./gmail";

export const SESSION_COOKIE_NAME = "voicemail_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
export const ADD_ACCOUNT_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const ADD_ACCOUNT_STATE_PREFIX = "addAccount:";

export function createSessionCookieValue(userId: string): string {
  return encryptTokens({ userId });
}

export function getSessionUserId(cookieValue: string): string | null {
  try {
    const data = decryptTokens(cookieValue);
    return data?.userId || null;
  } catch {
    return null;
  }
}

export function createAddAccountState(
  userId: string,
  nonce: string,
  now: number = Date.now()
): string {
  return `${ADD_ACCOUNT_STATE_PREFIX}${encryptTokens({
    purpose: "addAccount",
    userId,
    nonce,
    iat: now,
  })}`;
}

export type AddAccountStateError = "expired" | "invalid";

export function parseAddAccountState(
  state: string | null,
  now: number = Date.now()
): {
  isAddAccount: boolean;
  userId: string | null;
  nonce: string | null;
  error: AddAccountStateError | null;
} {
  if (!state) {
    return { isAddAccount: false, userId: null, nonce: null, error: null };
  }

  if (state === "addAccount") {
    return { isAddAccount: true, userId: null, nonce: null, error: "invalid" };
  }

  if (!state.startsWith(ADD_ACCOUNT_STATE_PREFIX)) {
    return { isAddAccount: false, userId: null, nonce: null, error: null };
  }

  try {
    const data = decryptTokens(state.slice(ADD_ACCOUNT_STATE_PREFIX.length));
    if (
      data?.purpose === "addAccount" &&
      typeof data.userId === "string" &&
      typeof data.nonce === "string" &&
      typeof data.iat === "number"
    ) {
      if (now - data.iat > ADD_ACCOUNT_STATE_MAX_AGE_MS) {
        return {
          isAddAccount: true,
          userId: null,
          nonce: null,
          error: "expired",
        };
      }

      if (data.iat > now + 60 * 1000) {
        return {
          isAddAccount: true,
          userId: null,
          nonce: null,
          error: "invalid",
        };
      }

      return {
        isAddAccount: true,
        userId: data.userId,
        nonce: data.nonce,
        error: null,
      };
    }
  } catch {
    // Treat malformed add-account state as add-account without a recoverable
    // user id so the callback does not silently switch accounts.
  }

  return { isAddAccount: true, userId: null, nonce: null, error: "invalid" };
}
