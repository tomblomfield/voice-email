import { google } from "googleapis";
import crypto from "crypto";

const FOOTER_ELIGIBLE_SENDERS = new Set([
  "tomblomfield@gmail.com",
  "tb@ycombinator.com",
]);

function getEncryptionKey(): string {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("SESSION_SECRET environment variable is required");
  return key;
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(): string {
  return getOAuth2Client().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ],
  });
}

export async function exchangeCode(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export function encryptTokens(tokens: any): string {
  const key = crypto.scryptSync(getEncryptionKey(), "salt", 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(JSON.stringify(tokens), "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted}`;
}

export function decryptTokens(encrypted: string): any {
  const key = crypto.scryptSync(getEncryptionKey(), "salt", 32);
  const [ivB64, tagB64, data] = encrypted.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(data, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted);
}

function getAuthedClient(tokens: any) {
  const client = getOAuth2Client();
  client.setCredentials(tokens);
  return client;
}

function getGmail(tokens: any) {
  return google.gmail({ version: "v1", auth: getAuthedClient(tokens) });
}

function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function shouldAddVoicemailFooter(userEmail: string): boolean {
  return FOOTER_ELIGIBLE_SENDERS.has(normalizeEmailAddress(userEmail));
}

export function getVoicemailSiteUrl(): string {
  const candidates = [
    process.env.VOICEMAIL_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN,
    process.env.RAILWAY_STATIC_URL,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const url = normalizeUrl(candidate);
    if (url) return url;
  }

  return "https://railway.app";
}

export function appendVoicemailFooter(body: string, userEmail: string): string {
  if (!shouldAddVoicemailFooter(userEmail)) return body;

  const trimmedBody = body.replace(/\s+$/, "");
  const footer = `sent with voicemail\n${getVoicemailSiteUrl()}`;

  if (!trimmedBody) return footer;

  return `${trimmedBody}\n\n${footer}`;
}

export async function getUserEmail(tokens: any): Promise<string> {
  const gmail = getGmail(tokens);
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.emailAddress || "";
}

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  snippet: string;
  date: string;
}

export async function getUnreadEmails(
  tokens: any,
  maxResults = 10
): Promise<EmailSummary[]> {
  const gmail = getGmail(tokens);
  const res = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread in:inbox",
    maxResults,
  });

  if (!res.data.messages) return [];

  const emails: EmailSummary[] = await Promise.all(
    res.data.messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From", "To", "Cc", "Subject", "Date"],
      });

      const headers = detail.data.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value || "";

      return {
        id: msg.id!,
        threadId: msg.threadId!,
        from: getHeader("From"),
        to: getHeader("To"),
        cc: getHeader("Cc"),
        subject: getHeader("Subject"),
        snippet: detail.data.snippet || "",
        date: getHeader("Date"),
      };
    })
  );

  return emails;
}

export function truncateToLatestMessage(body: string, maxLength = 2000): string {
  const separators = [
    /\r?\nOn .+wrote:\r?\n/,
    /\r?\n-{3,}Original Message-{3,}\r?\n/,
    /\r?\nFrom: .+\r?\nSent: /,
  ];

  let truncated = body;
  for (const sep of separators) {
    const match = truncated.search(sep);
    if (match > 0) {
      truncated = truncated.substring(0, match);
      break;
    }
  }

  truncated = truncated.trim();
  if (truncated.length > maxLength) {
    truncated = truncated.substring(0, maxLength) + "...";
  }
  return truncated;
}

export async function getEmailBody(
  tokens: any,
  messageId: string
): Promise<string> {
  const gmail = getGmail(tokens);
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const payload = res.data.payload;
  if (!payload) return "";

  function extractText(parts: any[]): string {
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
      if (part.parts) {
        const text = extractText(part.parts);
        if (text) return text;
      }
    }
    return "";
  }

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    return extractText(payload.parts);
  }

  return res.data.snippet || "";
}

export async function getThreadMessages(
  tokens: any,
  threadId: string,
  maxMessages = 5
): Promise<{ from: string; date: string; body: string }[]> {
  const gmail = getGmail(tokens);
  const thread = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });

  const messages = thread.data.messages || [];
  // Take the last N messages (most recent context)
  const recent = messages.slice(-maxMessages);

  return recent.map((msg) => {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name === name)?.value || "";

    function extractText(parts: any[]): string {
      for (const part of parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          return Buffer.from(part.body.data, "base64url").toString("utf-8");
        }
        if (part.parts) {
          const text = extractText(part.parts);
          if (text) return text;
        }
      }
      return "";
    }

    let rawText = "";
    if (msg.payload?.body?.data) {
      rawText = Buffer.from(msg.payload.body.data, "base64url").toString("utf-8");
    } else if (msg.payload?.parts) {
      rawText = extractText(msg.payload.parts);
    } else {
      rawText = msg.snippet || "";
    }

    return {
      from: getHeader("From"),
      date: getHeader("Date"),
      body: rawText,
    };
  });
}

export async function sendReply(
  tokens: any,
  messageId: string,
  threadId: string,
  body: string,
  userEmail: string
): Promise<void> {
  const gmail = getGmail(tokens);

  const original = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "Subject", "Message-ID"],
  });

  const headers = original.data.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name === name)?.value || "";

  const to = getHeader("From");
  const subject = getHeader("Subject").startsWith("Re:")
    ? getHeader("Subject")
    : `Re: ${getHeader("Subject")}`;
  const messageIdHeader = getHeader("Message-ID");
  const bodyWithFooter = appendVoicemailFooter(body, userEmail);

  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${messageIdHeader}`,
    `References: ${messageIdHeader}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    bodyWithFooter,
  ].join("\r\n");

  const encoded = Buffer.from(raw).toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded, threadId },
  });
}

export async function archiveEmail(
  tokens: any,
  messageId: string
): Promise<void> {
  const gmail = getGmail(tokens);
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["INBOX"] },
  });
}

export async function markAsRead(
  tokens: any,
  messageId: string
): Promise<void> {
  const gmail = getGmail(tokens);
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}

export async function searchEmails(
  tokens: any,
  query: string,
  maxResults = 10
): Promise<EmailSummary[]> {
  const gmail = getGmail(tokens);
  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  if (!res.data.messages) return [];

  const emails: EmailSummary[] = await Promise.all(
    res.data.messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From", "To", "Cc", "Subject", "Date"],
      });

      const headers = detail.data.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value || "";

      return {
        id: msg.id!,
        threadId: msg.threadId!,
        from: getHeader("From"),
        to: getHeader("To"),
        cc: getHeader("Cc"),
        subject: getHeader("Subject"),
        snippet: detail.data.snippet || "",
        date: getHeader("Date"),
      };
    })
  );

  return emails;
}

export async function findContact(
  tokens: any,
  name: string
): Promise<{ name: string; email: string }[]> {
  const gmail = getGmail(tokens);
  // Search for recent emails involving this person
  const res = await gmail.users.messages.list({
    userId: "me",
    q: name,
    maxResults: 20,
  });

  if (!res.data.messages) return [];

  const details = await Promise.all(
    res.data.messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From", "To", "Cc"],
      });
      return detail.data.payload?.headers || [];
    })
  );

  // Extract all email addresses from From/To/Cc headers
  const nameLower = name.toLowerCase();
  const contactMap = new Map<string, { name: string; email: string; count: number }>();

  for (const headers of details) {
    for (const h of headers) {
      if (!h.value) continue;
      // Parse addresses like "Denisa Smith <denisa@example.com>" or bare "denisa@example.com"
      const addresses = h.value.split(",").map((a) => a.trim());
      for (const addr of addresses) {
        const match = addr.match(/^(.+?)\s*<(.+?)>$/);
        const displayName = match ? match[1].trim().replace(/^"|"$/g, "") : "";
        const email = match ? match[2].trim().toLowerCase() : addr.trim().toLowerCase();

        if (
          displayName.toLowerCase().includes(nameLower) ||
          email.includes(nameLower)
        ) {
          const existing = contactMap.get(email);
          if (existing) {
            existing.count++;
          } else {
            contactMap.set(email, {
              name: displayName || email,
              email,
              count: 1,
            });
          }
        }
      }
    }
  }

  // Sort by frequency (most emailed first)
  return Array.from(contactMap.values())
    .sort((a, b) => b.count - a.count)
    .map(({ name, email }) => ({ name, email }));
}

export async function sendNewEmail(
  tokens: any,
  to: string,
  subject: string,
  body: string,
  userEmail: string
): Promise<void> {
  const gmail = getGmail(tokens);
  const bodyWithFooter = appendVoicemailFooter(body, userEmail);

  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    bodyWithFooter,
  ].join("\r\n");

  const encoded = Buffer.from(raw).toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
}
