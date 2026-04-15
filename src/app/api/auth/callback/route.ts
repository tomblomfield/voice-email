import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCode,
  encryptTokens,
  getUserEmail,
} from "@/app/lib/gmail";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
  createSessionCookieValue,
  parseAddAccountState,
} from "@/app/lib/session";
import {
  initDb,
  upsertUser,
  findUserByGoogleEmail,
  addGoogleAccount,
  consumeOAuthStateNonce,
  countGoogleAccounts,
} from "@/app/lib/db";

function getRedirectUri(request: NextRequest): string {
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "localhost:3000";
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/auth/callback`;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  try {
    const host =
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      "";
    const proto = request.headers.get("x-forwarded-proto") || "https";
    const origin = host ? `${proto}://${host}` : request.url;
    const response = NextResponse.redirect(new URL("/app", origin));
    const addAccountState = parseAddAccountState(state);
    const isAddAccount = addAccountState.isAddAccount;

    if (
      isAddAccount &&
      (addAccountState.error ||
        !addAccountState.userId ||
        !addAccountState.nonce)
    ) {
      console.warn(
        `auth_callback: add_account_invalid_state reason=${addAccountState.error || "missing"}`
      );
      return NextResponse.redirect(
        new URL(
          addAccountState.error === "expired"
            ? "/app?error=add_account_state_expired"
            : "/app?error=add_account_state_invalid",
          origin
        )
      );
    }

    const redirectUri = getRedirectUri(request);
    const tokens = await exchangeCode(code, redirectUri);
    const encrypted = encryptTokens(tokens);

    await initDb();

    const email = await getUserEmail(tokens);
    let userId: string;

    if (isAddAccount) {
      userId = addAccountState.userId!;
      const stateConsumed = await consumeOAuthStateNonce(
        userId,
        addAccountState.nonce!
      );

      if (!stateConsumed) {
        console.warn(
          `auth_callback: add_account_state_reused_or_expired email=${email}`
        );
        return NextResponse.redirect(
          new URL("/app?error=add_account_state_invalid", origin)
        );
      }

      const isPrimary = (await countGoogleAccounts(userId)) === 0;
      await addGoogleAccount(userId, email, encrypted, isPrimary);
    } else {
      // Regular login
      const existing = await findUserByGoogleEmail(email);
      if (existing) {
        userId = existing.userId;
        await addGoogleAccount(userId, email, encrypted, false);
        await upsertUser(email);
      } else {
        const user = await upsertUser(email);
        if (!user) {
          return NextResponse.json(
            { error: "Database error" },
            { status: 500 }
          );
        }
        userId = user.id;
        await addGoogleAccount(userId, email, encrypted, true);
      }
    }

    response.cookies.set(
      SESSION_COOKIE_NAME,
      createSessionCookieValue(userId),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE,
        path: "/",
      }
    );

    console.log(
      `auth_callback: ${isAddAccount ? "account_added" : "login"} email=${email}`
    );

    return response;
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 }
    );
  }
}
