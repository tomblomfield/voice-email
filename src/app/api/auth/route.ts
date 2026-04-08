import { NextRequest, NextResponse } from "next/server";
import { decryptTokens, getAuthUrl, hasRequiredGoogleScopes } from "@/app/lib/gmail";

function getRedirectUri(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/auth/callback`;
}

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get("gmail_tokens");
  if (cookie) {
    try {
      const tokens = decryptTokens(cookie.value);
      if (hasRequiredGoogleScopes(tokens)) {
        return NextResponse.json({ authenticated: true });
      }
    } catch {}
  }
  const redirectUri = getRedirectUri(request);
  const url = getAuthUrl(redirectUri);
  return NextResponse.redirect(url);
}
