/** Codecs Chrome will play directly. The RLC-810WA records H.265, which usually will not. */
export function needsPreview(codec: string | null): boolean {
  return codec === "hevc" || codec === "h265" || codec === "mjpeg";
}
