import { NextRequest, NextResponse } from "next/server";
import { decryptTokens, getAuthUrl, hasRequiredGoogleScopes } from "@/app/lib/gmail";

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
  const url = getAuthUrl();
  return NextResponse.redirect(url);
}
