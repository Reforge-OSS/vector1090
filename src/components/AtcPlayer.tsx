"use client";
import { useEffect, useRef, useState } from "react";
import { useAtcChannels } from "@/hooks/useAtcChannels";
import { useAtcAudio } from "@/hooks/useAtcAudio";
import { providerName } from "@/lib/atc";
import AtcPicker from "./AtcPicker";
import palette from "@/lib/palette.json";
export default function AtcPlayer({
  center = null,
}: {
  center?: { lat: number; lon: number } | null;
}) {
  const { channels, saved, configured, error, ready, save, remove } =
    useAtcChannels();
  const [volume, setVolume] = useState(0.6),
    [loaded, setLoaded] = useState(false);
  const { current, status, note, meterAvailable, analyser, select, toggle } =
    useAtcAudio(channels, volume);
  const canvas = useRef<HTMLCanvasElement>(null),
    panel = useRef<HTMLElement>(null),
    savedId = useRef<string | null>(null);
  useEffect(() => {
    try {
      const data = JSON.parse(
        localStorage.getItem("vector1090:audio") ?? "null",
      );
      savedId.current = typeof data?.id === "string" ? data.id : null;
      if (typeof data?.volume === "number" && Number.isFinite(data.volume))
        setVolume(Math.max(0, Math.min(1, data.volume)));
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (ready && !current && channels.length)
      select(
        channels.find((c) => c.id === savedId.current) ??
          channels.find((c) => c.provider === "icecast" && c.online) ??
          channels.find((c) => c.online) ??
          channels[0],
      );
  }, [channels, current, ready, select]);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(
          "vector1090:audio",
          JSON.stringify({ id: current?.id, volume }),
        );
      } catch {}
  }, [current, volume, loaded]);
  useEffect(() => {
    if (!panel.current || !globalThis.ResizeObserver) return;
    const dashboard = panel.current.closest<HTMLElement>(".dashboard");
    const observer = new ResizeObserver(() =>
      dashboard?.style.setProperty(
        "--audio-clearance",
        Math.ceil(panel.current!.getBoundingClientRect().height + 54) + "px",
      ),
    );
    observer.observe(panel.current);
    return () => {
      observer.disconnect();
      dashboard?.style.removeProperty("--audio-clearance");
    };
  }, []);
  useEffect(() => {
    let frame = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const data = new Uint8Array(32);
    const draw = () => {
      const ctx = canvas.current?.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, 112, 28);
        analyser.current?.getByteFrequencyData(data);
        for (let i = 0; i < 18; i++) {
          const level =
            status === "playing"
              ? reduced.matches
                ? 0.3
                : analyser.current
                  ? data[i] / 255
                  : 0.1
              : 0.06;
          const height = 2 + level * 24;
          ctx.fillStyle = status === "error" ? palette.rose : palette.muted;
          ctx.globalAlpha = 0.4 + level * 0.6;
          ctx.fillRect(i * 6 + 1, (28 - height) / 2, 3, height);
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [status, analyser]);
  return (
    <section
      className="glass atc-player"
      aria-label="ATC audio player"
      ref={panel}
    >
      <div className="audio-heading">
        <strong>ATC audio</strong>
        <span className="audio-status" role="status">
          {status === "error"
            ? "Unavailable"
            : status === "buffering"
              ? "Connecting…"
              : status === "playing"
                ? "Live audio"
                : status === "paused"
                  ? "Paused"
                  : "Standby"}
        </span>
        <canvas
          ref={canvas}
          width={112}
          height={28}
          aria-label="Audio visualizer"
        />
      </div>
      <div className="audio-controls">
        <button
          className="play-button"
          disabled={!current}
          aria-label={
            status === "playing" || status === "buffering"
              ? "Pause audio"
              : "Play audio"
          }
          onClick={toggle}
        >
          {status === "playing" || status === "buffering" ? "Ⅱ" : "▶"}
        </button>
        <div className="audio-source">
          <AtcPicker
            channels={channels}
            current={current}
            center={center}
            saved={saved}
            onSelect={select}
            onSave={save}
            onRemove={(id) => {
              if (current?.id === id) select(null);
              remove(id);
            }}
          />
          {current && (
            <small className="atc-provider">
              {current.provider === "ibonav" ? (
                <a href="https://ibonav.aero" target="_blank" rel="noreferrer">
                  ibonav.aero
                </a>
              ) : (
                providerName(current.provider)
              )}
              {current.frequency ? " · " + current.frequency : ""}
              {status === "playing" && !meterAvailable
                ? " · meter unavailable"
                : ""}
            </small>
          )}
        </div>
        <label className="volume-control">
          <span aria-hidden>◖))</span>
          <input
            aria-label="Audio volume"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
      </div>
      {!channels.length && (
        <p className="atc-message">
          {!ready
            ? "Loading receivers…"
            : error ||
              (configured
                ? "No receiver mounts found. Paste a stream URL to add a channel."
                : "Add your own receiver with ATC_ICECAST_URL or paste a stream URL")}
        </p>
      )}
      {note && (
        <p className="atc-message" role="status">
          {note}
        </p>
      )}
      {status === "error" && (
        <a
          className="atc-link"
          href={
            "https://www.liveatc.net/search/?icao=" +
            encodeURIComponent(current?.airportIcao ?? "")
          }
          target="_blank"
          rel="noreferrer"
        >
          Open on LiveATC ↗
        </a>
      )}
    </section>
  );
}
