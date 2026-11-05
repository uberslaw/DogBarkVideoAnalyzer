import path from "path";

export function labelCamera(name: string): string {
  const cleaned = name.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "Camera";
  if (cleaned === cleaned.toLowerCase()) {
    return cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  return cleaned;
}

export function inferClip(filePath: string): { camera: string; startedAt: string | null } {
  const base = path.basename(filePath, path.extname(filePath));
  const normalized = filePath.replace(/\\/g, "/").replace(/\.[^./]+$/, "");

  const frigate =
    /(?:^|[/\\])(\d{4}-\d{2}-\d{2})[/\\](\d{2})[/\\]([^/\\]+)[/\\](\d{2})\.(\d{2})$/.exec(
      normalized,
    );
  if (frigate) {
    const [, day, hour, camera, minute, second] = frigate;
    return {
      camera: labelCamera(camera),
      startedAt: `${day}T${hour}:${minute}:${second}`,
    };
  }

  const compact = /^(.*?)(?:_\d+)?_?(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(base);
  if (compact && compact[1] !== undefined) {
    const [, rawCamera, year, month, day, hour, minute, second] = compact;
    return {
      camera: labelCamera(rawCamera || parentCamera(filePath)),
      startedAt: `${year}-${month}-${day}T${hour}:${minute}:${second}`,
    };
  }

  const dashed = /(20\d{2})-(\d{2})-(\d{2})[_T ](\d{2})-(\d{2})-(\d{2})/.exec(base);
  if (dashed && dashed.index !== undefined) {
    const prefix = base.slice(0, dashed.index).replace(/[_-]+$/g, "");
    return {
      camera: labelCamera(prefix || parentCamera(filePath)),
      startedAt: `${dashed[1]}-${dashed[2]}-${dashed[3]}T${dashed[4]}:${dashed[5]}:${dashed[6]}`,
    };
  }

  return { camera: labelCamera(parentCamera(filePath)), startedAt: null };
}

function parentCamera(filePath: string): string {
  const parent = path.basename(path.dirname(filePath));
  if (/^\d{2}$/.test(parent) || /^\d{4}-\d{2}-\d{2}$/.test(parent) || /^\d{8}$/.test(parent)) {
    return path.basename(path.dirname(path.dirname(filePath))) || parent;
  }
  return parent || "camera";
}
