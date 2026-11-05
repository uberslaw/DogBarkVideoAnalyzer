"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { CopyBlock } from "@/components/copy-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { needsPreview } from "@/lib/codecs";
import { FRIGATE_CONFIG, HOME_ASSISTANT_AUTOMATION } from "@/lib/guides";
import { episodeVisible, SENSITIVITY_COPY } from "@/lib/sensitivity";
import { formatDayKey } from "@/lib/time";
import type { Health, JobSnapshot, Recording, ReviewEpisode, Sensitivity } from "@/lib/types";

type LibraryResponse = {
  roots: string[];
  frigateUrl: string;
  frigatePulledAt: string | null;
  frigateError: string | null;
  recordings: Recording[];
  episodes: ReviewEpisode[];
  job: JobSnapshot;
};

type MediaRequest = { src: string; seek: number };

export function Desk() {
  const [health, setHealth] = useState<Health | null>(null);
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState<Sensitivity>("balanced");
  const [camera, setCamera] = useState<string>("all");
  const [day, setDay] = useState<string>("all");
  const [mode, setMode] = useState<"episodes" | "barks">("episodes");
  const [openPulses, setOpenPulses] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cue, setCue] = useState<number | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [frigateOpen, setFrigateOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [fileFilter, setFileFilter] = useState<"all" | "no-audio" | "error">("all");
  const [folderPath, setFolderPath] = useState("");
  const [frigateUrl, setFrigateUrl] = useState("");
  const [frigateHours, setFrigateHours] = useState("12");
  const [waiting, setWaiting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const shouldPlay = useRef(false);

  const refresh = useCallback(async () => {
    const [healthResponse, libraryResponse] = await Promise.all([fetch("/api/health"), fetch("/api/library")]);
    if (healthResponse.ok) setHealth((await healthResponse.json()) as Health);
    if (libraryResponse.ok) {
      const body = (await libraryResponse.json()) as LibraryResponse;
      setLibrary(body);
      setFrigateUrl((current) => current || body.frigateUrl || "");
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("barkline-sensitivity");
    const timer = window.setTimeout(() => {
      if (stored === "sensitive" || stored === "balanced" || stored === "strict") setSensitivity(stored);
      void refresh().catch(() => setNotice("Barkline couldn't load. Is the server still running?"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const job = library?.job;
  const recordings = library?.recordings ?? [];
  const busy =
    job?.status === "running" || recordings.some((recording) => recording.status === "running" || recording.status === "queued");

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 1200);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);

  const visible = useMemo(() => {
    return (library?.episodes ?? [])
      .filter((episode) => episodeVisible(episode, sensitivity))
      .filter((episode) => camera === "all" || episode.camera === camera)
      .filter((episode) => day === "all" || episode.dayKey === day)
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.wallClock.localeCompare(b.wallClock) || a.start - b.start);
  }, [library?.episodes, sensitivity, camera, day]);

  const cameras = useMemo(() => {
    const counts = new Map<string, number>();
    for (const episode of library?.episodes ?? []) {
      if (!episodeVisible(episode, sensitivity)) continue;
      if (day !== "all" && episode.dayKey !== day) continue;
      counts.set(episode.camera, (counts.get(episode.camera) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [library?.episodes, sensitivity, day]);

  const days = useMemo(() => {
    const keys = new Set((library?.episodes ?? []).map((episode) => episode.dayKey));
    return [...keys].sort();
  }, [library?.episodes]);

  const barkRows = useMemo(() => {
    const rows: Array<{ episode: ReviewEpisode; start: number; end: number; score: number; key: string }> = [];
    for (const episode of visible) {
      if (episode.kind === "howl" || episode.pulses.length === 0) continue;
      episode.pulses.forEach((pulse, index) => {
        rows.push({ episode, start: pulse.start, end: pulse.end, score: pulse.score, key: `${episode.id}:${index}` });
      });
    }
    return rows;
  }, [visible]);

  const barkTotal = visible.reduce((sum, episode) => sum + episode.barks, 0);
  const silent = recordings.filter((recording) => recording.status === "no-audio");
  const failed = recordings.filter((recording) => recording.status === "error");
  const heardSeconds = recordings
    .filter((recording) => recording.status === "done")
    .reduce((sum, recording) => sum + recording.durationSec, 0);

  const active = (library?.episodes ?? []).find((episode) => episode.id === activeId) ?? null;
  const activeRecording = recordings.find((recording) => recording.id === active?.recordingId) ?? null;
  const media = active ? mediaFor(active, activeRecording, cue ?? undefined) : null;

  function play(episode: ReviewEpisode, pulseStart?: number) {
    const recording = recordings.find((item) => item.id === episode.recordingId) ?? null;
    const next = mediaFor(episode, recording, pulseStart);
    const video = videoRef.current;
    const same = media?.src === next.src && video && video.readyState >= 1;
    setCue(pulseStart ?? null);
    setActiveId(episode.id);
    setNotice(null);
    if (same && video) {
      shouldPlay.current = false;
      video.currentTime = next.seek;
      void video.play().catch(() => {
        setNotice("Press play on the video if the browser held the sound back.");
      });
      return;
    }
    shouldPlay.current = true;
  }

  async function post(url: string, body?: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(payload.error || "Request failed");
    return payload;
  }

  async function runSample() {
    setBusyAction("sample");
    setNotice(null);
    try {
      await post("/api/sample");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't load the sample.");
    } finally {
      setBusyAction(null);
    }
  }

  async function runScan(path: string) {
    setBusyAction("scan");
    setNotice(null);
    try {
      const result = (await post("/api/scan", { root: path })) as { truncated?: boolean; added?: number };
      setFolderOpen(false);
      if (result.truncated) {
        setNotice("Stopped after 1,500 videos. Point at one camera or one day, then scan again.");
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Scan failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function runAnalyze(ids: string[] | "all", force = false) {
    setBusyAction("analyze");
    setNotice(null);
    try {
      await post("/api/analyze", ids === "all" ? { all: true, force } : { ids, force });
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't start listening.");
    } finally {
      setBusyAction(null);
    }
  }

  async function runFrigate() {
    setBusyAction("frigate");
    setNotice(null);
    try {
      const result = (await post("/api/frigate", { url: frigateUrl, hours: Number(frigateHours) || 12 })) as {
        count?: number;
      };
      setNotice(
        result.count
          ? `Frigate returned ${result.count} bark, howl, dog, or growl events.`
          : "Frigate answered, and it had no matching events in that window.",
      );
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Frigate didn't answer.");
    } finally {
      setBusyAction(null);
    }
  }

  function copyTimes() {
    const lines = visible.map((episode) => {
      const what = episode.kind === "howl" ? "howl" : `${episode.barks} bark${episode.barks === 1 ? "" : "s"}`;
      const origin = episode.source === "frigate" ? "Frigate" : "recording";
      return `${episode.wallClock}  ${episode.camera}  ${what}  match ${episode.score.toFixed(2)}  ${origin}`;
    });
    void navigator.clipboard.writeText(lines.join("\n") || "No barks in this view.");
    setNotice(lines.length ? "Copied the times." : "Nothing to copy in this view.");
  }

  const pending = recordings.filter((recording) => recording.status === "ready").length;
  const overall =
    job && job.total > 0 ? Math.min(1, (job.finished + (job.status === "running" ? job.fileProgress : 0)) / job.total) : 0;

  return (
    <div className="min-h-full">
      <header className="border-b border-border px-4 py-5 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-heading text-4xl tracking-tight text-foreground">Barkline</p>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              The barks, without the twelve hours. Point it at the folder your RLC-810WA writes, and play the moments
              the microphone caught.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setFolderOpen(true)}>
              Recordings folder
            </Button>
            <Button type="button" variant="outline" onClick={() => setFrigateOpen(true)}>
              While you&apos;re out
            </Button>
            <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm">
              <span className="text-muted-foreground">Match</span>
              <select
                className="bg-transparent py-1.5 outline-none"
                value={sensitivity}
                onChange={(event) => {
                  const value = event.target.value as Sensitivity;
                  setSensitivity(value);
                  window.localStorage.setItem("barkline-sensitivity", value);
                }}
              >
                <option value="sensitive">Sensitive</option>
                <option value="balanced">Balanced</option>
                <option value="strict">Strict</option>
              </select>
            </label>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8">
        {health && !health.ok && (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">{health.message}</p>
        )}
        {notice && <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm">{notice}</p>}
        {busy && job && (
          <Progress value={Math.round(overall * 100)}>
            <ProgressLabel>{job.message || "Listening"}</ProgressLabel>
            <ProgressValue />
          </Progress>
        )}

        {recordings.length === 0 ? (
          <EmptyState
            path={folderPath}
            onPath={setFolderPath}
            onScan={() => void runScan(folderPath)}
            onSample={() => void runSample()}
            busy={busyAction}
          />
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-4">
              <Stat
                value={String(visible.length)}
                label={visible.length === 1 ? "episode" : "episodes"}
                pressed={mode === "episodes"}
                onClick={() => setMode("episodes")}
              />
              <Stat
                value={String(barkTotal)}
                label={barkTotal === 1 ? "bark" : "barks"}
                pressed={mode === "barks"}
                onClick={() => setMode("barks")}
              />
              <Stat
                value={String(silent.length)}
                label={silent.length === 1 ? "file without audio" : "files without audio"}
                pressed={false}
                onClick={() => {
                  setFileFilter("no-audio");
                  setFilesOpen(true);
                }}
              />
              <div className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
                <p className="font-heading text-2xl tabular-nums">{formatHeard(heardSeconds)}</p>
                <p className="text-xs text-muted-foreground">listened through</p>
              </div>
            </section>

            <p className="text-sm text-muted-foreground">{SENSITIVITY_COPY[sensitivity]}</p>

            {pending > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
                <p className="text-sm">
                  {pending} {pending === 1 ? "file hasn't" : "files haven't"} been listened to yet.
                </p>
                <Button type="button" disabled={busyAction !== null} onClick={() => void runAnalyze("all")}>
                  Find the barks
                </Button>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
              <aside className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
                <FilterButton active={day === "all"} onClick={() => setDay("all")}>
                  All days
                </FilterButton>
                {days.map((key) => (
                  <FilterButton key={key} active={day === key} onClick={() => setDay(key)}>
                    {formatDayKey(key)}
                  </FilterButton>
                ))}
                <div className="my-1 hidden h-px bg-border lg:block" />
                <FilterButton active={camera === "all"} onClick={() => setCamera("all")}>
                  All cameras
                </FilterButton>
                {cameras.map(([name, count]) => (
                  <FilterButton key={name} active={camera === name} onClick={() => setCamera(name)}>
                    <span>{name}</span>
                    <span className="ml-auto tabular-nums text-primary underline decoration-primary/50">{count}</span>
                  </FilterButton>
                ))}
              </aside>

              <section className="flex min-w-0 flex-col gap-4">
                <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
                  {media ? (
                    <video
                      ref={videoRef}
                      key={media.src}
                      className="aspect-video w-full bg-black"
                      src={media.src}
                      controls
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={(event) => {
                        const video = event.currentTarget;
                        if (!media) return;
                        video.currentTime = media.seek;
                        if (shouldPlay.current) {
                          shouldPlay.current = false;
                          void video.play().catch(() => {
                            setNotice("Press play on the video if the browser held the sound back.");
                          });
                        }
                      }}
                      onWaiting={() => setWaiting(true)}
                      onCanPlay={() => setWaiting(false)}
                      onError={() => {
                        setWaiting(false);
                        setNotice("This browser couldn't play that file. The time is still listed below.");
                      }}
                    />
                  ) : (
                    <div className="flex aspect-video items-center justify-center bg-black/40 px-6 text-center text-sm text-muted-foreground">
                      Pick a bark to play that moment. The clip starts just before the sound.
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <p>
                      {active
                        ? `${active.camera} · ${active.wallClock}`
                        : "Nothing selected"}
                    </p>
                    {waiting && activeRecording && needsPreview(activeRecording.videoCodec) && (
                      <p className="text-muted-foreground">
                        Preparing a short H.264 clip. The 810WA records H.265, which this browser won&apos;t play
                        directly.
                      </p>
                    )}
                  </div>
                  {activeRecording && (
                    <FileTimeline
                      duration={activeRecording.durationSec}
                      episodes={visible.filter((episode) => episode.recordingId === activeRecording.id)}
                      activeId={activeId}
                      onPick={(episode) => play(episode)}
                    />
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-heading text-xl">{mode === "barks" ? "Each bark" : "Episodes"}</h2>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={copyTimes}>
                      Copy times
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFileFilter("all");
                        setFilesOpen(true);
                      }}
                    >
                      Files
                    </Button>
                  </div>
                </div>

                {visible.length === 0 ? (
                  <p className="rounded-xl bg-card px-4 py-6 text-sm text-muted-foreground ring-1 ring-foreground/10">
                    {recordings.some((recording) => recording.status === "done")
                      ? "Nothing in this view crossed the line. Try Sensitive, or another camera."
                      : "Once listening finishes, the barks land here."}
                  </p>
                ) : mode === "episodes" ? (
                  <ul className="flex flex-col gap-2">
                    {visible.map((episode) => (
                      <li
                        key={episode.id}
                        className={`rounded-xl bg-card ring-1 ${episode.id === activeId ? "ring-primary" : "ring-foreground/10"}`}
                      >
                        <div className="flex items-center gap-3 px-3 py-3">
                          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => play(episode)}>
                            <span className="block font-heading text-base">{episode.wallClock}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant="secondary">{episode.camera}</Badge>
                              {episode.kind === "howl" ? <Badge variant="outline">Howl</Badge> : null}
                              {episode.source === "frigate" ? <Badge variant="outline">Frigate</Badge> : null}
                              <span className="tabular-nums">match {episode.score.toFixed(2)}</span>
                            </span>
                          </button>
                          {episode.pulses.length > 0 && (
                            <button
                              type="button"
                              className="shrink-0 text-sm text-primary underline decoration-primary/40 underline-offset-4"
                              aria-expanded={openPulses === episode.id}
                              onClick={() => setOpenPulses((current) => (current === episode.id ? null : episode.id))}
                            >
                              {episode.barks} {episode.barks === 1 ? "bark" : "barks"}
                            </button>
                          )}
                        </div>
                        {openPulses === episode.id && (
                          <ul className="border-t border-border px-3 py-2">
                            {episode.pulses.map((pulse, index) => (
                              <li key={`${episode.id}-${index}`}>
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-between py-1.5 text-left text-sm hover:text-primary"
                                  onClick={() => play(episode, pulse.start)}
                                >
                                  <span>
                                    Bark {index + 1} at {formatOffset(pulse.start)}
                                  </span>
                                  <span className="tabular-nums text-muted-foreground">{pulse.score.toFixed(2)}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {barkRows.map((row) => (
                      <li key={row.key}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 rounded-xl bg-card px-3 py-3 text-left ring-1 ring-foreground/10 hover:ring-primary"
                          onClick={() => play(row.episode, row.start)}
                        >
                          <span>
                            <span className="block font-heading">{row.episode.wallClock}</span>
                            <span className="text-xs text-muted-foreground">
                              {row.episode.camera}
                              {row.episode.kind === "howl" ? " · howl" : ` · ${formatOffset(row.start)} in the file`}
                            </span>
                          </span>
                          <span className="tabular-nums text-sm text-muted-foreground">{row.score.toFixed(2)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </main>

      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Recordings folder</DialogTitle>
            <DialogDescription>
              The folder on this machine where the NAS share or Frigate recordings are mounted. Barkline reads video
              files in it, including subfolders.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void runScan(folderPath);
            }}
          >
            <Input
              value={folderPath}
              onChange={(event) => setFolderPath(event.target.value)}
              placeholder="/mnt/nas/reolink"
              aria-label="Recordings folder"
            />
            <Button type="submit" disabled={busyAction !== null}>
              Scan folder
            </Button>
          </form>
          {library?.roots?.length ? (
            <ul className="text-xs text-muted-foreground">
              {library.roots.map((root) => (
                <li key={root}>{root}</li>
              ))}
            </ul>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={frigateOpen} onOpenChange={setFrigateOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Hear it while you&apos;re out</DialogTitle>
            <DialogDescription>
              Barkline reviews footage already on disk. Frigate can raise a bark event from the live RLC-810WA stream,
              and Home Assistant can ping your phone. The score Frigate stores is its own model, separate from the
              match number on recorded files.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void runFrigate();
            }}
          >
            <Input
              value={frigateUrl}
              onChange={(event) => setFrigateUrl(event.target.value)}
              placeholder="http://192.168.1.20:5000"
              aria-label="Frigate address"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Hours back
              <Input
                className="w-20"
                value={frigateHours}
                onChange={(event) => setFrigateHours(event.target.value)}
                inputMode="numeric"
                aria-label="Hours of Frigate events"
              />
            </label>
            <Button type="submit" disabled={busyAction !== null}>
              Pull bark events
            </Button>
          </form>
          <CopyBlock label="Frigate config for the RLC-810WA" text={FRIGATE_CONFIG} />
          <CopyBlock label="Home Assistant automation" text={HOME_ASSISTANT_AUTOMATION} />
          <p className="text-xs text-muted-foreground">
            Replace USER, PASSWORD, CAMERA_IP, HOME_ASSISTANT_IP, and the phone notify target. In the Reolink app,
            turn the camera microphone on. If the camera itself writes the NAS files, also enable record audio —
            otherwise those files have no sound for Barkline to search. Raise min_volume if the Debug → Audio graph
            shows the mic hiss sitting above the line.
          </p>
        </DialogContent>
      </Dialog>

      <Dialog open={filesOpen} onOpenChange={setFilesOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Files</DialogTitle>
            <DialogDescription>
              {failed.length
                ? `${failed.length} failed and will not be retried until you run them again.`
                : "Silent files are skipped. A failed file stays failed until you run it again."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            {(["all", "no-audio", "error"] as const).map((filter) => (
              <Button
                key={filter}
                type="button"
                size="sm"
                variant={fileFilter === filter ? "default" : "outline"}
                onClick={() => setFileFilter(filter)}
              >
                {filter === "all" ? "All" : filter === "no-audio" ? "No audio" : "Failed"}
              </Button>
            ))}
          </div>
          <ul className="flex flex-col gap-2">
            {recordings
              .filter((recording) => fileFilter === "all" || recording.status === fileFilter)
              .map((recording) => (
                <li key={recording.id} className="rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-foreground/10">
                  <p className="font-medium">{recording.camera}</p>
                  <p className="truncate text-xs text-muted-foreground">{recording.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {recording.status}
                    {recording.audioCodec ? ` · ${recording.audioCodec}` : ""}
                    {recording.videoCodec ? ` · ${recording.videoCodec}` : ""}
                    {recording.episodeCount ? ` · ${recording.episodeCount} episodes` : ""}
                  </p>
                  {recording.error && recording.status !== "done" ? (
                    <p className="mt-1 text-xs">{recording.error}</p>
                  ) : null}
                  {recording.hasAudio && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => void runAnalyze([recording.id], recording.status === "error" || recording.status === "done")}
                    >
                      {recording.status === "error" ? "Try again" : recording.status === "done" ? "Listen again" : "Listen"}
                    </Button>
                  )}
                </li>
              ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  path,
  onPath,
  onScan,
  onSample,
  busy,
}: {
  path: string;
  onPath: (value: string) => void;
  onScan: () => void;
  onSample: () => void;
  busy: string | null;
}) {
  return (
    <section className="grid gap-6 rounded-2xl bg-card p-6 ring-1 ring-foreground/10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <div className="flex flex-col gap-4">
        <h2 className="font-heading text-3xl tracking-tight">A day out, reduced to the barks.</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          The RLC-810WA has a built-in microphone. Barkline reads that track from the files already on your NAS — or
          from Frigate&apos;s recordings folder — and lines up short harmonic bursts that match a bark or a howl. You
          get a list of times instead of scrubbing twelve hours.
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          If a file comes back with no audio, the camera saved video only. Turn the microphone on in the Reolink app
          and, when the camera writes the share itself, enable record audio. Frigate needs an audio role and a record
          preset that keeps AAC, or the footage it writes is silent too.
        </p>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            onScan();
          }}
        >
          <Input
            value={path}
            onChange={(event) => onPath(event.target.value)}
            placeholder="/mnt/nas/reolink"
            aria-label="Recordings folder"
          />
          <Button type="submit" disabled={busy !== null}>
            Scan folder
          </Button>
        </form>
      </div>
      <div className="flex flex-col justify-between gap-4 rounded-xl bg-background p-4 ring-1 ring-foreground/10">
        <div>
          <p className="font-heading text-xl">No share mounted here?</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Play a two-minute backyard clip and a hallway clip with barks, a door, talking, rain, and a howl mixed in.
            Balanced hides the muffled single bark. Strict also drops the howl.
          </p>
        </div>
        <Button type="button" disabled={busy !== null} onClick={onSample}>
          {busy === "sample" ? "Preparing the afternoon…" : "Play the sample afternoon"}
        </Button>
      </div>
    </section>
  );
}

function Stat({
  value,
  label,
  pressed,
  onClick,
}: {
  value: string;
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-xl px-4 py-3 text-left ring-1 ${pressed ? "bg-primary/15 ring-primary" : "bg-card ring-foreground/10"}`}
    >
      <span className="font-heading text-2xl text-primary tabular-nums underline decoration-primary/40 underline-offset-4">
        {value}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">{label}</span>
    </button>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${active ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-card"}`}
    >
      {children}
    </button>
  );
}

function FileTimeline({
  duration,
  episodes,
  activeId,
  onPick,
}: {
  duration: number;
  episodes: ReviewEpisode[];
  activeId: string | null;
  onPick: (episode: ReviewEpisode) => void;
}) {
  if (!duration) return null;
  return (
    <div className="px-4 pb-4">
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-3 h-1 rounded-full bg-muted" />
        {episodes.map((episode) => (
          <button
            key={episode.id}
            type="button"
            aria-label={episode.wallClock}
            onClick={() => onPick(episode)}
            className={`absolute top-1.5 size-4 -translate-x-1/2 rounded-full ${episode.id === activeId ? "bg-primary" : "bg-primary/50"}`}
            style={{ left: `${Math.min(100, Math.max(0, (episode.start / duration) * 100))}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function mediaFor(episode: ReviewEpisode, recording: Recording | null, pulseStart?: number): MediaRequest {
  const moment = pulseStart ?? episode.start;
  if (episode.source === "frigate" && episode.frigateEventId) {
    return { src: `/api/frigate/clip?id=${encodeURIComponent(episode.frigateEventId)}`, seek: 0 };
  }
  if (recording && needsPreview(recording.videoCodec)) {
    const start = Math.max(0, moment - 2);
    const end = Math.max(start + 8, episode.end + 3);
    return {
      src: `/api/preview?id=${recording.id}&start=${start.toFixed(2)}&end=${end.toFixed(2)}`,
      seek: moment - start,
    };
  }
  return {
    src: `/api/media?id=${episode.recordingId}`,
    seek: Math.max(0, moment - 1.2),
  };
}

function formatOffset(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remain = whole % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

function formatHeard(seconds: number): string {
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes} min`;
  if (!whole) return "0 min";
  return `${whole}s`;
}
