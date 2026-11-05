# Barkline

Barkline finds dog barks in recordings from a Reolink RLC-810WA (or any camera that saved a microphone track) so a day away from home is a handful of clips instead of twelve hours of scrubbing.

It runs on a machine that can see the files. That is usually the Home Assistant box, or a computer with the NAS share mounted. It does not log into the camera.

## What it does

- Scans a folder of video files and reads the audio track.
- Marks short harmonic bursts that match a bark, and longer wavering tones that match a howl.
- Plays each moment a second or so before the sound.
- Groups a volley into one episode. The bark count opens the individual hits.
- Optionally pulls bark, howl, dog, and growl events from Frigate and shows a config you can paste so the next day alerts your phone while you are out.

The match number ranks how much a sound fits that shape. It is not Frigate's YAMNet probability. Clear barks score high. A muffled single bark scores lower, which is what the Sensitive / Balanced / Strict control is for. Balanced is the default.

## Run it

Requirements: Node.js 20+, Python 3.11+, ffmpeg (with ffprobe).

```bash
npm install
npm run setup
npm run dev
```

Open http://127.0.0.1:47231

`npm run setup` creates `.venv`, installs NumPy, and writes `data/logs/doctor.json`. If ffmpeg or Python is missing, it exits with a message instead of failing halfway through a recording.

### Point it at the NAS

1. Mount the share on this machine, for example `/mnt/nas/reolink`.
2. In Barkline, enter that path and scan.
3. Choose **Find the barks**.

Reolink file names such as `Backyard_00_20261103101422.mp4` and Frigate paths such as `recordings/2026-11-03/10/backyard/05.30.mp4` both keep the camera name and the clock.

The RLC-810WA has a built-in microphone. If a file has no audio track, the camera saved video only. In the Reolink app, turn the microphone on. If the camera itself writes the NAS, also enable record audio.

A full day is decoded from the audio only, in 30-second pieces, so the video is not loaded into memory. Finished files are remembered by size and modified time. Scanning or listening again does not redo them. A file that fails is left failed until you choose **Try again** — Barkline will not loop on a broken recording.

Logs: `data/logs/barkline.log`

### Sample afternoon

**Play the sample afternoon** builds two short clips (backyard and hallway) with barks, a door, talking, rain, a knock, a howl, and one muffled bark. Use it to see the list before the NAS is mounted. Balanced hides the muffled bark. Strict also drops the howl.

## While you are out

Frigate can detect barks on the live stream. Barkline's **While you're out** panel has a config for this camera and a Home Assistant automation that notifies your phone. Paste the Frigate address (for example `http://192.168.1.20:5000`) to pull recent events into the same list.

Frigate has to be reachable from the machine running Barkline, not only from your browser.

The 810WA is an 8MP H.265 camera. Frigate's Reolink notes put that generation on RTSP (`/Preview_01_main` and `/Preview_01_sub`). The record preset has to keep AAC, or Frigate's files are silent too. H.265 files are transcoded to a short H.264 clip when you press play, because most browsers will not play the camera's recording directly.

## Checks

```bash
npm run doctor
npm run test:detector
node --experimental-strip-types --test lib/infer.test.ts
```

## Assumptions

- Runtime: Node 20+ for the site, Python 3.11+ with NumPy in `.venv` for listening. Both are set up by `npm run setup`.
- Tools: `ffmpeg` and `ffprobe` on `PATH`.
- Network: none for local files. Frigate pull needs HTTP to the address you type. Nothing is sent anywhere else.
- Files: recordings stay where they are. Barkline writes its index, logs, and browser clips under `data/`.
- Topology: one process on a machine that can read the recording folder. It binds to port 47231 on all interfaces when you use `npm run dev`.

## Limits

This is a shape detector, tuned so doors, rain, hum, and held speech do not page you. It will miss a dog at the far end of the yard if the mic barely hears it, and some other short sharp sounds can still get through. For live alerts, Frigate's `bark` model is the better listener. Use Barkline to review what was already recorded, including days from before audio events were turned on.
