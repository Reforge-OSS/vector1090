"use client";
import { useEffect, useRef, useState } from "react";
import palette from "@/lib/palette.json";
const streams = [
  ["JFK Tower", "https://s1-fmt2.liveatc.net/kjfk_twr"],
  ["Boston Tower", "https://s1-bos.liveatc.net/kbos_twr"],
  ["Heathrow · example", "https://s1-fmt2.liveatc.net/egll_twr"],
  ["Amsterdam · example", "https://s1-fmt2.liveatc.net/eham_twr"],
  ["Los Angeles · example", "https://s1-fmt2.liveatc.net/klax_twr"],
  ["San Francisco · example", "https://s1-fmt2.liveatc.net/ksfo_twr"],
];
type AudioStatus = "idle" | "buffering" | "playing" | "paused" | "error";
export default function AtcPlayer() {
  const [url, setUrl] = useState(streams[0][1]);
  const [volume, setVolume] = useState(0.6);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<AudioStatus>("idle");
  const [fallback, setFallback] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const context = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const mounted = useRef(true);
  const bufferingTimer = useRef<ReturnType<typeof setTimeout>>();
  const currentVolume = useRef(volume);
  currentVolume.current = volume;
  useEffect(() => {
    mounted.current = true;
    try {
      const saved = JSON.parse(
        localStorage.getItem("vector1090:audio") ?? "null",
      );
      if (typeof saved?.url === "string") setUrl(saved.url);
      if (typeof saved?.volume === "number" && Number.isFinite(saved.volume))
        setVolume(Math.max(0, Math.min(1, saved.volume)));
    } catch {
      /* Storage is optional. */
    }
    setLoaded(true);
    return () => {
      mounted.current = false;
      clearTimeout(bufferingTimer.current);
      if (audio.current) {
        audio.current.onerror = null;
        audio.current.pause();
        audio.current.src = "";
      }
      void context.current?.close();
    };
  }, []);
  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
    if (loaded) {
      try {
        localStorage.setItem(
          "vector1090:audio",
          JSON.stringify({ url, volume }),
        );
      } catch {
        /* Storage is optional. */
      }
    }
  }, [url, volume, loaded]);
  useEffect(() => {
    let frame = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const data = new Uint8Array(32);
    const draw = (time: number) => {
      const ctx = canvas.current?.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, 112, 28);
        analyser.current?.getByteFrequencyData(data);
        for (let i = 0; i < 18; i++) {
          const level =
            status === "playing"
              ? reducedMotion.matches
                ? 0.3
                : analyser.current
                  ? data[i] / 255
                  : 0.15 +
                    Math.abs(
                      Math.sin(time / 280 + i * 1.7) * Math.cos(time / 710 + i),
                    ) *
                      0.8
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
  }, [status]);
  function stop() {
    clearTimeout(bufferingTimer.current);
    if (audio.current) {
      audio.current.onerror = null;
      audio.current.pause();
      audio.current.src = "";
    }
    audio.current = null;
    analyser.current = null;
    void context.current?.close();
    context.current = null;
  }
  function start(withCors = true) {
    let parsed: URL;
    try {
      parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      setStatus("error");
      return;
    }
    stop();
    setStatus("buffering");
    setFallback(!withCors);
    const element = new Audio();
    if (withCors) element.crossOrigin = "anonymous";
    element.preload = "none";
    element.volume = currentVolume.current;
    audio.current = element;
    const active = () => mounted.current && audio.current === element;
    const fail = () => {
      if (!active()) return;
      if (withCors) start(false);
      else {
        setStatus("error");
        stop();
      }
    };
    element.onplaying = () => {
      if (active()) {
        clearTimeout(bufferingTimer.current);
        setStatus("playing");
      }
    };
    element.onwaiting = () => {
      if (active()) {
        setStatus("buffering");
        clearTimeout(bufferingTimer.current);
        bufferingTimer.current = setTimeout(fail, 15000);
      }
    };
    element.onended = () => {
      if (active()) {
        setStatus("paused");
        stop();
      }
    };
    element.onerror = fail;
    bufferingTimer.current = setTimeout(fail, 15000);
    if (withCors) {
      try {
        const ctx = new AudioContext();
        context.current = ctx;
        const source = ctx.createMediaElementSource(element);
        const node = ctx.createAnalyser();
        node.fftSize = 64;
        source.connect(node);
        node.connect(ctx.destination);
        analyser.current = node;
        void ctx.resume().catch(() => {});
      } catch {
        analyser.current = null;
        setFallback(true);
      }
    }
    element.src = parsed.href;
    void element.play().catch((error) => {
      if (!active()) return;
      if (error.name === "NotAllowedError") {
        setStatus("error");
        stop();
      } else if (withCors) start(false);
      else {
        setStatus("error");
        stop();
      }
    });
  }
  function toggle() {
    if (status === "playing" || status === "buffering") {
      stop();
      setStatus("paused");
    } else start();
  }
  return (
    <section className="glass atc-player" aria-label="ATC audio player">
      <div className="audio-heading">
        <span className="status-dot bg-subtle" />
        <strong>ATC audio</strong>
        <span
          className={
            "audio-status " + (status === "error" ? "text-rose" : "text-muted")
          }
          role="status"
        >
          {status === "error"
            ? "Stream unavailable"
            : status === "buffering"
              ? "Buffering…"
              : status === "playing"
                ? "Live audio"
                : "Standby"}
          {fallback && status === "playing" ? " · visualizer simulated" : ""}
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
          <select
            aria-label="Example ATC stream"
            value={streams.some((s) => s[1] === url) ? url : ""}
            onChange={(e) => {
              stop();
              setStatus("idle");
              setUrl(e.target.value);
            }}
          >
            <option value="" disabled>
              Custom stream
            </option>
            <optgroup label="Examples (availability may vary)">
              {streams.map(([name, value]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </optgroup>
          </select>
          <input
            aria-label="ATC stream URL"
            value={url}
            onChange={(e) => {
              stop();
              setStatus("idle");
              setUrl(e.target.value);
            }}
            placeholder="https://…/stream"
          />
        </div>
        <label className="volume-control">
          <span aria-hidden>◖))</span>
          <input
            aria-label="Audio volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
      </div>
    </section>
  );
}
