import { labelCamera } from "@/lib/infer";
import { addSeconds, dayKeyFromStamp, formatBrisbane, formatStamp } from "@/lib/time";
import type { CacheFile, Recording, ReviewEpisode } from "@/lib/types";

export function episodesFromCache(recording: Recording, cache: CacheFile): ReviewEpisode[] {
  return (cache.episodes ?? []).map((episode, index) => {
    const startedAt = addSeconds(recording.startedAt, episode.start);
    return {
      id: `${recording.id}:${index}:${episode.start.toFixed(2)}`,
      recordingId: recording.id,
      camera: labelCamera(recording.camera),
      startedAt,
      wallClock: formatStamp(startedAt),
      dayKey: dayKeyFromStamp(startedAt ?? recording.startedAt),
      start: episode.start,
      end: episode.end,
      score: episode.score,
      kind: episode.kind === "howl" ? "howl" : "bark",
      barks: episode.barks ?? episode.pulses.filter((pulse) => pulse.kind !== "howl").length,
      pulses: (episode.pulses ?? []).map((pulse) => ({
        start: pulse.start,
        end: pulse.end,
        score: pulse.score,
      })),
      source: "recording",
    };
  });
}

type FrigateEvent = {
  id?: string | number;
  camera?: string;
  label?: string;
  start_time?: number;
  end_time?: number;
  has_clip?: boolean;
  data?: { score?: number; top_score?: number };
};

export function episodeFromFrigate(event: FrigateEvent): ReviewEpisode | null {
  if (event.id === undefined || event.id === null) return null;
  const eventId = String(event.id);
  if (!/^[A-Za-z0-9._:-]+$/.test(eventId)) return null;
  const start = Number(event.start_time);
  if (!Number.isFinite(start)) return null;
  const end = Number(event.end_time ?? start);
  const label = String(event.label ?? "bark");
  const kind = label === "howl" ? "howl" : "bark";
  const when = formatBrisbane(start);
  const score = Number(event.data?.top_score ?? event.data?.score ?? 0.8);
  return {
    id: `frigate:${eventId}`,
    recordingId: null,
    camera: labelCamera(String(event.camera ?? "Camera")),
    startedAt: null,
    wallClock: when.wallClock,
    dayKey: when.dayKey,
    start: 0,
    end: Math.max(0, end - start),
    score: Number.isFinite(score) ? score : 0.8,
    kind,
    barks: kind === "bark" ? 1 : 0,
    pulses: [],
    source: "frigate",
    frigateEventId: eventId,
    label,
  };
}
