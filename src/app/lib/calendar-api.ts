import { getCalendarClient } from "@/app/lib/google-auth";
import {
  inferCalendarProfile as inferCalendarProfileFromEvents,
  resolveCalendarInviteDetails,
  type CalendarInferenceEvent,
  type InferredCalendarProfile,
} from "@/app/lib/calendar";

export interface CalendarEventSummary {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  location: string;
  attendees: string[];
  htmlLink: string;
}

export interface CalendarListOptions {
  startTime?: string;
  endTime?: string;
  maxResults?: number;
  query?: string;
}

export interface UpdateCalendarEventInput {
  eventId: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  timeZone?: string;
  attendeeEmails?: string[];
  notes?: string;
  location?: string;
}

export interface CreateCalendarInviteInput {
  title: string;
  startTime: string;
  endTime: string;
  timeZone?: string;
  attendeeEmails?: string[];
  notes?: string;
  customLocation?: string;
  locationPreference?: "home" | "work" | "zoom" | "custom" | "none";
  inferredProfile?: InferredCalendarProfile | null;
}

function formatEventDateTime(dateTime?: string | null, date?: string | null): string {
  if (dateTime) return dateTime;
  if (date) return `${date}T00:00:00`;
  return "";
}

function truncateDescription(desc: string, maxLength = 300): string {
  if (desc.length <= maxLength) return desc;
  return desc.slice(0, maxLength) + "…";
}

function isResourceCalendar(email: string): boolean {
  return /^c_[a-z0-9]+@resource\.calendar\.google\.com$/.test(email);
}

function mapCalendarEvent(event: any): CalendarEventSummary {
  return {
    id: event.id || "",
    summary: event.summary || "(untitled)",
    description: truncateDescription(event.description || ""),
    start: formatEventDateTime(event.start?.dateTime, event.start?.date),
    end: formatEventDateTime(event.end?.dateTime, event.end?.date),
    location: event.location || "",
    attendees: (event.attendees || [])
      .map((attendee: any) => attendee.email)
      .filter((email: string) => email && !isResourceCalendar(email)),
    htmlLink: event.htmlLink || "",
  };
}

export function ensureTimezone(dt: string): string {
  if (/Z$/.test(dt) || /[+-]\d{2}:\d{2}$/.test(dt)) return dt;
  return dt + "Z";
}

async function getPrimaryCalendarTimeZone(tokens: any): Promise<string | undefined> {
  const calendar = getCalendarClient(tokens);
  const response = await calendar.calendarList.get({ calendarId: "primary" });
  return response.data.timeZone || undefined;
}

export async function listCalendarEvents(
  tokens: any,
  options: CalendarListOptions = {}
): Promise<CalendarEventSummary[]> {
  const calendar = getCalendarClient(tokens);
  const now = new Date();
  const defaultEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const response = await calendar.events.list({
    calendarId: "primary",
    singleEvents: true,
    orderBy: "startTime",
    timeMin: options.startTime ? ensureTimezone(options.startTime) : now.toISOString(),
    timeMax: options.endTime ? ensureTimezone(options.endTime) : defaultEnd.toISOString(),
    maxResults: options.maxResults || 100,
    q: options.query || undefined,
  });

  return (response.data.items || []).map(mapCalendarEvent);
}

export async function inferCalendarProfile(
  tokens: any
): Promise<InferredCalendarProfile> {
  const calendar = getCalendarClient(tokens);
  const now = new Date();
  const timeMax = now.toISOString();
  const timeMin = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const response = await calendar.events.list({
    calendarId: "primary",
    singleEvents: true,
    orderBy: "startTime",
    timeMin,
    timeMax,
    maxResults: 250,
  });

  const events: CalendarInferenceEvent[] = (response.data.items || []).map((event: any) => ({
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: formatEventDateTime(event.start?.dateTime, event.start?.date),
    attendeeCount: event.attendees?.length || 0,
    conferenceUrls: (event.conferenceData?.entryPoints || [])
      .map((entryPoint: any) => entryPoint.uri)
      .filter(Boolean),
  }));

  return inferCalendarProfileFromEvents(events);
}

export async function createCalendarInvite(
  tokens: any,
  input: CreateCalendarInviteInput
): Promise<{
  event: CalendarEventSummary;
  usedProfileFields: string[];
}> {
  const resolved = resolveCalendarInviteDetails({
    notes: input.notes,
    customLocation: input.customLocation,
    locationPreference: input.locationPreference,
    inferredProfile: input.inferredProfile,
  });

  if (resolved.error) {
    throw new Error(resolved.error);
  }

  const attendeeEmails = Array.from(
    new Set((input.attendeeEmails || []).map((email) => email.trim().toLowerCase()).filter(Boolean))
  );
  const timeZone = input.timeZone || (await getPrimaryCalendarTimeZone(tokens));
  const usedProfileFields: string[] = [];
  if (input.locationPreference === "home") usedProfileFields.push("homeAddress");
  if (input.locationPreference === "work") usedProfileFields.push("workAddress");
  if (input.locationPreference === "zoom") usedProfileFields.push("zoomLink");

  const calendar = getCalendarClient(tokens);
  const response = await calendar.events.insert({
    calendarId: "primary",
    sendUpdates: attendeeEmails.length > 0 ? "all" : "none",
    requestBody: {
      summary: input.title,
      description: resolved.description,
      location: resolved.location,
      start: {
        dateTime: input.startTime,
        timeZone,
      },
      end: {
        dateTime: input.endTime,
        timeZone,
      },
      attendees: attendeeEmails.map((email) => ({ email })),
    },
  });

  return {
    event: mapCalendarEvent(response.data),
    usedProfileFields,
  };
}

export async function updateCalendarEvent(
  tokens: any,
  input: UpdateCalendarEventInput
): Promise<CalendarEventSummary> {
  const calendar = getCalendarClient(tokens);
  const timeZone = input.timeZone || (await getPrimaryCalendarTimeZone(tokens));

  const requestBody: any = {};
  if (input.title !== undefined) requestBody.summary = input.title;
  if (input.notes !== undefined) requestBody.description = input.notes;
  if (input.location !== undefined) requestBody.location = input.location;
  if (input.startTime !== undefined) {
    requestBody.start = { dateTime: input.startTime, timeZone };
  }
  if (input.endTime !== undefined) {
    requestBody.end = { dateTime: input.endTime, timeZone };
  }
  if (input.attendeeEmails !== undefined) {
    requestBody.attendees = input.attendeeEmails.map((email: string) => ({ email }));
  }

  const hasAttendees = input.attendeeEmails && input.attendeeEmails.length > 0;
  const response = await calendar.events.patch({
    calendarId: "primary",
    eventId: input.eventId,
    sendUpdates: hasAttendees ? "all" : "none",
    requestBody,
  });

  return mapCalendarEvent(response.data);
}

export async function deleteCalendarEvent(
  tokens: any,
  eventId: string,
  sendUpdates: "all" | "none" = "all"
): Promise<void> {
  const calendar = getCalendarClient(tokens);
  await calendar.events.delete({
    calendarId: "primary",
    eventId,
    sendUpdates,
  });
}
