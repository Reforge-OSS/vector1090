"use client";
import { useEffect, useState } from "react";
import { savedAtcChannels, type AtcChannel } from "@/lib/atc";
export function useAtcChannels() {
  const [remote, setRemote] = useState<AtcChannel[]>([]),
    [saved, setSaved] = useState<AtcChannel[]>([]);
  const [loaded, setLoaded] = useState(false),
    [configured, setConfigured] = useState(false),
    [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const legacy = JSON.parse(
        localStorage.getItem("vector1090:audio") ?? "null",
      );
      const stored = localStorage.getItem("vector1090:atc");
      setSaved(
        savedAtcChannels(
          stored
            ? JSON.parse(stored)
            : legacy?.url
              ? [{ name: "Saved stream", streamUrl: legacy.url }]
              : [],
        ),
      );
    } catch {}
    setLoaded(true);
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/atc/channels", {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.channels)) throw new Error();
        setRemote(data.channels);
        setConfigured(data.configured === true);
        setError(
          Object.values(data.providers ?? {}).some(
            (status) => status === "error" || status === "rate_limited",
          )
            ? "Some receivers are unavailable. Check provider access or try later."
            : "",
        );
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Channel discovery unavailable. You can still add a stream URL.",
          );
      } finally {
        if (!controller.signal.aborted) setReady(true);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem("vector1090:atc", JSON.stringify(saved));
      } catch {}
  }, [saved, loaded]);
  return {
    channels: [...remote, ...saved],
    saved,
    configured,
    error,
    ready,
    save: (channel: AtcChannel) =>
      setSaved((previous) =>
        savedAtcChannels([
          ...previous.filter((c) => c.id !== channel.id),
          channel,
        ]),
      ),
    remove: (id: string) =>
      setSaved((previous) => previous.filter((c) => c.id !== id)),
  };
}
