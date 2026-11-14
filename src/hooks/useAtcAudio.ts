"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { nextAtcChannel, type AtcChannel } from "@/lib/atc";
type Status = "idle" | "buffering" | "playing" | "paused" | "error";
export function useAtcAudio(channels: AtcChannel[], volume: number) {
  const [current, setCurrent] = useState<AtcChannel | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [note, setNote] = useState("");
  const [meterAvailable, setMeterAvailable] = useState(false);
  const analyser = useRef<AnalyserNode | null>(null);
  const context = useRef<AudioContext | null>(null);
  const source = useRef<MediaElementAudioSourceNode | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout>>();
  const watchdog = useRef<ReturnType<typeof setInterval>>();
  const generation = useRef(0);
  const active = useRef<AtcChannel | null>(null);
  const latest = useRef({ channels, volume });
  latest.current = { channels, volume };
  const stop = useCallback(() => {
    generation.current++;
    clearTimeout(retry.current);
    retry.current = undefined;
    clearInterval(watchdog.current);
    const old = audio.current;
    audio.current = null;
    if (old) {
      old.onplaying = null;
      old.onerror = null;
      old.onstalled = null;
      old.onended = null;
      old.pause();
      old.removeAttribute("src");
      old.load();
    }
    source.current?.disconnect();
    source.current = null;
    analyser.current?.disconnect();
    analyser.current = null;
  }, []);
  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);
  useEffect(
    () => () => {
      stop();
      void context.current?.close();
      context.current = null;
    },
    [stop],
  );
  const select = useCallback(
    (channel: AtcChannel | null) => {
      stop();
      active.current = channel;
      setCurrent(channel);
      setStatus("idle");
      setNote("");
      setMeterAvailable(false);
    },
    [stop],
  );
  const play = useCallback(() => {
    if (!active.current) return;
    const tried = new Set<string>();
    const launch = (channel: AtcChannel, backup = false) => {
      stop();
      tried.add(channel.id);
      active.current = channel;
      setCurrent(channel);
      setStatus("buffering");
      setNote(backup ? "Switched to backup: " + channel.name : "");
      const element = new Audio();
      element.preload = "none";
      element.volume = latest.current.volume;
      audio.current = element;
      const token = generation.current;
      const isActive = () =>
        generation.current === token && audio.current === element;
      let failed = false,
        lastTime = 0,
        lastProgress = Date.now();
      const fail = () => {
        if (!isActive() || failed) return;
        failed = true;
        const next = nextAtcChannel(latest.current.channels, channel, tried);
        stop();
        if (!next) {
          setStatus("error");
          setNote("No live stream available");
          return;
        }
        setStatus("buffering");
        setNote("Trying backup…");
        const waiting = generation.current;
        retry.current = setTimeout(() => {
          if (generation.current === waiting) launch(next.channel, true);
        }, next.delayMs);
      };
      element.onplaying = () => {
        if (isActive()) setStatus("playing");
      };
      element.onerror = fail;
      element.onstalled = fail;
      element.onended = fail;
      setMeterAvailable(false);
      if (channel.provider !== "custom") {
        try {
          context.current ??= new AudioContext();
          const ctx = context.current,
            node = ctx.createAnalyser();
          node.fftSize = 64;
          const input = ctx.createMediaElementSource(element);
          input.connect(node);
          node.connect(ctx.destination);
          analyser.current = node;
          source.current = input;
          setMeterAvailable(true);
          void ctx.resume().catch(() => {});
        } catch {
          analyser.current = null;
        }
      }
      watchdog.current = setInterval(() => {
        if (!isActive()) return;
        if (
          Number.isFinite(element.currentTime) &&
          element.currentTime > lastTime + 0.01
        ) {
          lastTime = element.currentTime;
          lastProgress = Date.now();
        }
        if (Date.now() - lastProgress >= 8000) fail();
      }, 500);
      element.src = channel.streamUrl;
      void element.play().catch((error: unknown) => {
        if (!isActive()) return;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          stop();
          setStatus("paused");
          setNote("Press play to start audio");
        } else fail();
      });
    };
    launch(active.current);
  }, [stop]);
  const toggle = useCallback(() => {
    if (audio.current || retry.current) {
      stop();
      setStatus("paused");
      setNote("");
    } else play();
  }, [play, stop]);
  return { current, status, note, meterAvailable, analyser, select, toggle };
}
