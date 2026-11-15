export function rainviewerTiles(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const data = value as {
    host?: unknown;
    radar?: { past?: { time?: unknown; path?: unknown }[] };
  };
  if (typeof data.host !== "string" || !Array.isArray(data.radar?.past))
    return null;
  let host: URL;
  try {
    host = new URL(data.host);
  } catch {
    return null;
  }
  if (
    host.protocol !== "https:" ||
    !/(^|\.)rainviewer\.com$/.test(host.hostname)
  )
    return null;
  const frames = data.radar.past.filter(
    (frame): frame is { time: number; path: string } =>
      typeof frame?.time === "number" &&
      Number.isFinite(frame.time) &&
      typeof frame.path === "string" &&
      /^\/v2\/radar\/[a-zA-Z0-9/_-]+$/.test(frame.path),
  );
  const frame = frames.sort((a, b) => b.time - a.time)[0];
  return frame ? host.origin + frame.path + "/256/{z}/{x}/{y}/2/1_1.png" : null;
}
