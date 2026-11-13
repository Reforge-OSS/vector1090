import type { HistoryPoint } from "@/hooks/useAircraftFeed";
export function sparklinePath(
  history: HistoryPoint[],
  field: "alt" | "gs",
): string | null {
  const values = history.map((point) =>
    point[field] === "ground" ? 0 : point[field],
  );
  const known = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (known.length < 2) return null;
  const low = Math.min(...known),
    high = Math.max(...known);
  const first = history[0].time,
    duration = Math.max(1, history[history.length - 1].time - first);
  let connected = false;
  return values
    .map((value, index) => {
      if (value === null || !Number.isFinite(value)) {
        connected = false;
        return "";
      }
      const x = 4 + ((history[index].time - first) / duration) * 272;
      const y = high === low ? 32 : 58 - ((value - low) / (high - low)) * 52;
      const segment =
        (connected ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
      connected = true;
      return segment;
    })
    .join(" ");
}
