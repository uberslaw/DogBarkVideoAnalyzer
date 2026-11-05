import { episodeFromFrigate } from "@/lib/episodes";
import { log, updateLibrary } from "@/lib/store";
import type { ReviewEpisode } from "@/lib/types";

export class FrigateError extends Error {}

export function cleanFrigateUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new FrigateError("Enter the Frigate address, such as http://192.168.1.20:5000");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new FrigateError("That doesn't look like an address. Include http:// and the port.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FrigateError("Frigate's address needs to start with http:// or https://");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export async function pullFrigate(rawUrl: string, hours: number): Promise<ReviewEpisode[]> {
  const base = cleanFrigateUrl(rawUrl);
  const span = Math.min(72, Math.max(1, hours));
  const after = Math.floor(Date.now() / 1000) - span * 3600;
  const labels = ["bark", "howl", "dog", "growling"];
  const seen = new Set<string>();
  const episodes: ReviewEpisode[] = [];

  for (const label of labels) {
    const endpoint = new URL("/api/events", base);
    endpoint.searchParams.set("label", label);
    endpoint.searchParams.set("limit", "100");
    endpoint.searchParams.set("after", String(after));
    let response: Response;
    try {
      response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? `Frigate at ${base} didn't answer within 8 seconds.`
          : `Couldn't reach Frigate at ${base}. Barkline has to open it from this machine, not only from your browser.`;
      await updateLibrary((library) => {
        library.frigateUrl = base;
        library.frigateError = message;
      });
      log(`frigate pull failed: ${message}`);
      throw new FrigateError(message);
    }
    if (!response.ok) {
      const message = `Frigate returned ${response.status} for ${label} events.`;
      await updateLibrary((library) => {
        library.frigateUrl = base;
        library.frigateError = message;
      });
      throw new FrigateError(message);
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      throw new FrigateError("Frigate didn't return an event list. Check the address and the version.");
    }
    for (const item of body) {
      const episode = episodeFromFrigate(item as Parameters<typeof episodeFromFrigate>[0]);
      if (!episode || seen.has(episode.id)) continue;
      seen.add(episode.id);
      episodes.push(episode);
    }
  }

  episodes.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.wallClock.localeCompare(b.wallClock));
  await updateLibrary((library) => {
    library.frigateUrl = base;
    library.frigateEpisodes = episodes;
    library.frigatePulledAt = new Date().toISOString();
    library.frigateError = null;
  });
  log(`frigate pull ${base} events=${episodes.length} hours=${span}`);
  return episodes;
}
