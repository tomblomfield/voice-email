import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl } from "@/app/lib/gmail";
import {
  SESSION_COOKIE_NAME,
  ADD_ACCOUNT_STATE_MAX_AGE_MS,
  createAddAccountState,
  getSessionUserId,
} from "@/app/lib/session";
import {
  countGoogleAccounts,
  createOAuthStateNonce,
  initDb,
  storeOAuthStateNonce,
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

/**
 * Detect in-app browsers (WebViews) that Google blocks for OAuth.
 * Google returns 403 disallowed_useragent for these.
 */
function isInAppBrowser(userAgent: string): boolean {
  const patterns = [
    /FBAN|FBAV/i,           // Facebook
    /Instagram/i,            // Instagram
    /Twitter|X-Twitter/i,    // Twitter / X
    /LinkedInApp/i,          // LinkedIn
    /Line\//i,               // Line
    /MicroMessenger/i,       // WeChat
    /Snapchat/i,             // Snapchat
    /Reddit/i,               // Reddit
    /Pinterest/i,            // Pinterest
    /TikTok/i,               // TikTok
    /; wv\)/i,               // Android WebView
  ];
  return patterns.some((p) => p.test(userAgent));
}

const MAX_ACCOUNTS = 5;

export async function GET(request: NextRequest) {
  // Block in-app browsers before attempting Google OAuth
  const ua = request.headers.get("user-agent") || "";
  if (isInAppBrowser(ua)) {
    return NextResponse.redirect(new URL("/open-in-browser", request.url));
  }

  // Next.js RSC prefetch sends fetch requests that follow redirects.
  // Redirecting to accounts.google.com causes a CORS error because Google
  // doesn't include Access-Control-Allow-Origin headers. Return a JSON
  // response instead so the client falls back to full-page navigation.
  const isRscPrefetch =
    request.headers.get("rsc") || request.headers.get("next-router-prefetch");

  const addAccount = request.nextUrl.searchParams.get("addAccount") === "true";
  const redirectUri = getRedirectUri(request);

  if (addAccount) {
    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
    if (!sessionCookie) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    const userId = getSessionUserId(sessionCookie.value);
    if (!userId) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    await initDb();
    const count = await countGoogleAccounts(userId);
    if (count >= MAX_ACCOUNTS) {
      return NextResponse.redirect(
        new URL("/app?error=max_accounts", request.url)
      );
    }

    const nonce = createOAuthStateNonce();
    await storeOAuthStateNonce(
      userId,
      nonce,
      new Date(Date.now() + ADD_ACCOUNT_STATE_MAX_AGE_MS)
    );

    const url = getAuthUrl(redirectUri, {
      state: createAddAccountState(userId, nonce),
    });
    return NextResponse.redirect(url);
  }

  // Check if already authenticated
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (sessionCookie) {
    const userId = getSessionUserId(sessionCookie.value);
    if (userId) {
      const count = await countGoogleAccounts(userId);
      if (count > 0) {
        return NextResponse.json({ authenticated: true });
      }
    }
  }

  if (isRscPrefetch) {
    return NextResponse.json({ authenticated: false });
  }

  const url = getAuthUrl(redirectUri);
  return NextResponse.redirect(url);
}
