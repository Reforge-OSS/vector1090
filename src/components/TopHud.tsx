"use client";
import { useEffect, useState } from "react";
import type { FeedStatus } from "@/hooks/useAircraftFeed";
import type { FeedMode } from "@/lib/types";
interface Props { mode: FeedMode; status: FeedStatus; lastUpdate: number | null; shown: number; total: number; filtered: boolean; paused: boolean; onPause: () => void; trails: boolean; onTrails: () => void; onSettings: () => void; onSidebar: () => void }
export default function TopHud(p: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const color = p.status === "online" ? "bg-emerald-400 animate-pulse" : p.status === "paused" ? "bg-amber-400" : p.status === "connecting" ? "bg-cyan-400 animate-pulse" : "bg-red-400";
  return <header className="glass hud">
    <button className="icon-button" onClick={p.onSidebar} aria-label="Toggle aircraft sidebar">☰</button>
    <div className="wordmark"><span className="text-cyan-300">⌁</span> vector<span className="text-cyan-300">1090</span><small>AIRSPACE INTELLIGENCE</small></div>
    <span className="mode-chip">{p.mode === "public" ? "Public API" : "Local Receiver"}</span>
    <div className="hud-status"><span className={"status-dot " + color} /><span className="capitalize">{p.status.replace("-", " ")}</span><small>{p.lastUpdate ? "updated " + Math.max(0, Math.floor((now - p.lastUpdate) / 1000)) + "s ago" : "Acquiring feed"}</small></div>
    <div className="hud-count"><strong>{p.filtered ? p.shown + "/" : ""}{p.total}</strong><small>AIRCRAFT</small></div>
    <div className="ml-auto flex gap-2">
      <button className="control" onClick={p.onPause} aria-pressed={p.paused}>{p.paused ? "▶ Resume" : "Ⅱ Pause"}</button>
      <button className={"control trails-control " + (p.trails ? "active" : "")} onClick={p.onTrails} aria-pressed={p.trails}>⌁ <span>All trails</span></button>
      <button className="control" onClick={p.onSettings} aria-label="Open settings">⚙ <span className="settings-label">Settings</span></button>
    </div>
  </header>;
}
