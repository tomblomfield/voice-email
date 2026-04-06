const ZOOM_URL_REGEX = /https?:\/\/[^\s<>()"]*zoom\.us\/[^\s<>()"]+/gi;

const HOME_KEYWORDS = /\b(home|house|apartment|apt|residence|condo|flat)\b/i;
const WORK_KEYWORDS = /\b(work|office|hq|headquarters|campus)\b/i;

export interface CalendarInferenceEvent {
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  start?: string | null;
  conferenceUrls?: string[];
  attendeeCount?: number;
}

export interface CalendarProfileCandidate {
  value: string;
  confidence: "low" | "medium" | "high";
  evidenceCount: number;
  reason: string;
}

export interface InferredCalendarProfile {
  scannedEvents: number;
  homeAddress: CalendarProfileCandidate | null;
  workAddress: CalendarProfileCandidate | null;
  zoomLink: CalendarProfileCandidate | null;
}

export interface CalendarInviteResolutionInput {
  notes?: string;
  customLocation?: string;
  locationPreference?: "home" | "work" | "zoom" | "custom" | "none";
  inferredProfile?: InferredCalendarProfile | null;
}

export interface CalendarInviteResolution {
  location?: string;
  description?: string;
  error?: string;
}

interface CandidateState {
  key: string;
  value: string;
  count: number;
  score: number;
  latestSeenAt: number;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeLocationKey(value: string): string {
  return normalizeWhitespace(value)
    .replace(/[.,]$/g, "")
    .toLowerCase();
}

function looksPhysicalLocation(location: string): boolean {
  const trimmed = normalizeWhitespace(location);
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (/@/.test(trimmed) && !/\d/.test(trimmed)) return false;
  if (/zoom\.us/i.test(trimmed)) return false;
  return /[\d,]/.test(trimmed) || /\b(st|street|ave|avenue|road|rd|blvd|boulevard|dr|drive|lane|ln|way|suite|ste|floor|fl)\b/i.test(trimmed);
}

function getTimestamp(start?: string | null): number {
  if (!start) return 0;
  const parsed = new Date(start).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isBusinessTime(start?: string | null): boolean {
  if (!start) return false;
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  const hour = date.getHours();
  return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
}

function isHomeishTime(start?: string | null): boolean {
  if (!start) return false;
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  const hour = date.getHours();
  return day === 0 || day === 6 || hour < 8 || hour >= 18;
}

function addCandidate(
  map: Map<string, CandidateState>,
  value: string,
  score: number,
  start?: string | null
) {
  if (!value || score <= 0) return;
  const normalized = normalizeWhitespace(value);
  const key = normalizeLocationKey(normalized);
  const existing = map.get(key);
  const latestSeenAt = getTimestamp(start);

  if (existing) {
    existing.count += 1;
    existing.score += score;
    if (latestSeenAt >= existing.latestSeenAt) {
      existing.latestSeenAt = latestSeenAt;
      existing.value = normalized;
    }
    return;
  }

  map.set(key, {
    key,
    value: normalized,
    count: 1,
    score,
    latestSeenAt,
  });
}

function extractZoomUrls(event: CalendarInferenceEvent): string[] {
  const urls = new Set<string>();

  for (const url of event.conferenceUrls || []) {
    if (url && /zoom\.us/i.test(url)) {
      urls.add(url.trim());
    }
  }

  const combinedText = [event.description, event.location].filter(Boolean).join("\n");
  for (const match of combinedText.matchAll(ZOOM_URL_REGEX)) {
    const url = match[0].trim().replace(/[).,]+$/, "");
    urls.add(url);
  }

  return Array.from(urls);
}

function chooseCandidate(
  candidates: CandidateState[],
  minScore: number
): CalendarProfileCandidate | null {
  const [top] = candidates
    .filter((candidate) => candidate.score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.count !== a.count) return b.count - a.count;
      return b.latestSeenAt - a.latestSeenAt;
    });

  if (!top) return null;

  const confidence: CalendarProfileCandidate["confidence"] =
    top.score >= 16 || top.count >= 4
      ? "high"
      : top.score >= 9 || top.count >= 2
      ? "medium"
      : "low";

  return {
    value: top.value,
    confidence,
    evidenceCount: top.count,
    reason: `Seen ${top.count} time${top.count === 1 ? "" : "s"} across past calendar invites.`,
  };
}

export function inferCalendarProfile(
  events: CalendarInferenceEvent[]
): InferredCalendarProfile {
  const homeCandidates = new Map<string, CandidateState>();
  const workCandidates = new Map<string, CandidateState>();
  const zoomCandidates = new Map<string, CandidateState>();

  for (const event of events) {
    const location = normalizeWhitespace(event.location || "");
    const combinedText = `${event.summary || ""}\n${event.description || ""}`;

    if (location && looksPhysicalLocation(location)) {
      let homeScore = 0;
      let workScore = 0;

      if (HOME_KEYWORDS.test(combinedText)) homeScore += 7;
      if (WORK_KEYWORDS.test(combinedText)) workScore += 5;
      if (isHomeishTime(event.start)) homeScore += 2;
      if (isBusinessTime(event.start)) workScore += 3;
      if ((event.attendeeCount || 0) > 1) workScore += 1;
      if (/\b(room|conference|meeting room|boardroom)\b/i.test(location)) {
        workScore += 2;
      }

      addCandidate(homeCandidates, location, homeScore, event.start);
      addCandidate(workCandidates, location, workScore, event.start);
    }

    const zoomUrls = extractZoomUrls(event);
    for (const zoomUrl of zoomUrls) {
      addCandidate(zoomCandidates, zoomUrl, 4, event.start);
    }
  }

  const workAddress = chooseCandidate(Array.from(workCandidates.values()), 6);
  const homePool = Array.from(homeCandidates.values()).filter(
    (candidate) =>
      !workAddress || normalizeLocationKey(candidate.value) !== normalizeLocationKey(workAddress.value)
  );
  const homeAddress = chooseCandidate(homePool, 6);
  const zoomLink = chooseCandidate(Array.from(zoomCandidates.values()), 4);

  return {
    scannedEvents: events.length,
    homeAddress,
    workAddress,
    zoomLink,
  };
}

export function resolveCalendarInviteDetails(
  input: CalendarInviteResolutionInput
): CalendarInviteResolution {
  const notes = normalizeWhitespace(input.notes || "");
  const preference = input.locationPreference || "none";
  const inferredProfile = input.inferredProfile;
  let location: string | undefined;
  let description = notes;

  if (preference === "custom") {
    const customLocation = normalizeWhitespace(input.customLocation || "");
    if (!customLocation) {
      return { error: "A custom location was requested but none was provided." };
    }
    location = customLocation;
  }

  if (preference === "home") {
    location = inferredProfile?.homeAddress?.value;
    if (!location) {
      return { error: "I couldn't infer a home address from past calendar invites yet." };
    }
  }

  if (preference === "work") {
    location = inferredProfile?.workAddress?.value;
    if (!location) {
      return { error: "I couldn't infer a work address from past calendar invites yet." };
    }
  }

  if (preference === "zoom") {
    location = inferredProfile?.zoomLink?.value;
    if (!location) {
      return { error: "I couldn't infer a Zoom link from past calendar invites yet." };
    }
    description = description
      ? `${description}\n\nZoom: ${location}`
      : `Zoom: ${location}`;
  }

  return {
    location,
    description: description || undefined,
  };
}
