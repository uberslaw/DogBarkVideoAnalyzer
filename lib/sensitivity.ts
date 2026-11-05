import type { Sensitivity } from "@/lib/types";

const LINES: Record<Sensitivity, { single: number; volley: number; howl: number }> = {
  sensitive: { single: 0.56, volley: 0.4, howl: 0.5 },
  balanced: { single: 0.8, volley: 0.75, howl: 0.7 },
  strict: { single: 0.94, volley: 0.94, howl: 0.95 },
};

export function episodeVisible(
  episode: { source: string; kind: string; barks: number; score: number },
  sensitivity: Sensitivity,
): boolean {
  if (episode.source === "frigate") return true;
  const line = LINES[sensitivity];
  if (episode.kind === "howl") return episode.score >= line.howl;
  if (episode.barks >= 2) return episode.score >= line.volley;
  return episode.score >= line.single;
}

export const SENSITIVITY_COPY: Record<Sensitivity, string> = {
  sensitive: "Keeps weaker single barks, including the muffled one in the hallway sample.",
  balanced: "The default. Drops muffled singles, keeps clear volleys and the howl.",
  strict: "Only the clearest barks. The sample howl falls under this line.",
};
