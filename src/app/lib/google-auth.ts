import { google } from "googleapis";

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthedClient(tokens: any) {
  const client = getOAuth2Client();
  client.setCredentials(tokens);
  return client;
}

export function getGmailClient(tokens: any) {
  return google.gmail({ version: "v1", auth: getAuthedClient(tokens) });
}

export function getCalendarClient(tokens: any) {
  return google.calendar({ version: "v3", auth: getAuthedClient(tokens) });
}
