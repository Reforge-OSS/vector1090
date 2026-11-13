"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import type { Aircraft, Settings } from "@/lib/types";
import { aircraftDistance } from "@/lib/filters";
import { altitudeColor, isEmergency } from "@/lib/aircraftStyle";
import { formatAltitude, formatDistance, formatSpeed, formatVerticalRate } from "@/lib/units";
interface Photo { thumbnail: string; large: string; link: string; photographer: string }
const photos = new Map<string, Promise<Photo | null>>();
const emergencyMeaning: Record<string, string> = { "7500": "Hijack", "7600": "Radio Failure", "7700": "General Emergency" };
export default function Inspector({ hex, aircraft, settings, onClose }: { hex: string; aircraft: Aircraft | undefined; settings: Settings; onClose: () => void }) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setPhoto(null);
    if (!photos.has(hex)) photos.set(hex, fetch("/api/photo/" + hex).then(res => res.ok ? res.json() : null).then(data => data?.photo ?? null).catch(() => null));
    photos.get(hex)!.then(result => { if (active) { setPhoto(result); setLoading(false); } });
    return () => { active = false; };
  }, [hex]);
  const ac = aircraft;
  return <aside className="glass inspector" aria-label="Aircraft inspector">
    <div className="panel-heading"><span>AIRCRAFT INTELLIGENCE</span><button className="icon-button" onClick={onClose} aria-label="Close inspector">×</button></div>
    <div className="inspector-content">
      <div className="flex items-start justify-between"><div><div className="eyebrow">SELECTED TARGET</div><h1>{ac?.flight || hex.toUpperCase()}</h1><div className="telemetry text-xs text-slate-400">{hex.toUpperCase()} <span className="text-slate-600"> / </span> {ac?.reg || "—"} <span className="text-slate-600"> / </span> {ac?.type || "—"}</div></div><span className="text-3xl text-cyan-300">✈</span></div>
      {!ac && <div className="signal-lost" role="status">◌ Signal lost<small>This aircraft is no longer in the current feed.</small></div>}
      <div className="my-4 flex flex-wrap gap-2">{ac?.isMilitary && <span className="badge military">MILITARY</span>}{ac && isEmergency(ac.squawk) && <span className="badge emergency">EMERGENCY · {ac.squawk} {emergencyMeaning[ac.squawk!]}</span>}{ac?.isInteresting && <span className="badge interesting">INTERESTING</span>}</div>
      <div className="photo-card">
        {loading ? <div className="photo-skeleton animate-pulse" aria-label="Loading aircraft photo" /> : photo?.thumbnail ? <><Image unoptimized src={photo.thumbnail} alt={ac?.reg ? "Aircraft " + ac.reg : "Selected aircraft"} width={640} height={420} onError={() => setPhoto(null)} /><a href={photo.link} target="_blank" rel="noreferrer">© {photo.photographer || "Planespotters.net"} ↗</a></> : <div className="photo-placeholder"><span>✈</span><p>No photo available</p><small>AIRCRAFT IMAGERY</small></div>}
      </div>
      <div className="section-label">FLIGHT TELEMETRY <span>LIVE</span></div>
      <dl className="telemetry-grid">
        <div><dt>BARO ALTITUDE</dt><dd style={{ color: altitudeColor(ac?.alt_baro ?? null) }}>{formatAltitude(ac?.alt_baro ?? null, settings.units)}</dd></div>
        <div><dt>VERTICAL RATE</dt><dd className={ac?.baro_rate && ac.baro_rate > 0 ? "text-emerald-400" : ac?.baro_rate && ac.baro_rate < 0 ? "text-amber-400" : ""}>{ac?.baro_rate ? ac.baro_rate > 0 ? "▲ " : "▼ " : ""}{formatVerticalRate(ac?.baro_rate ?? null, settings.units)}</dd></div>
        <div><dt>GROUND SPEED</dt><dd>{formatSpeed(ac?.gs ?? null, settings.units)}</dd></div>
        <div><dt>TRACK</dt><dd><span className="compass-arrow" style={{ transform: "rotate(" + (ac?.track ?? 0) + "deg)" }}>↑</span> {ac?.track == null ? "—" : Math.round(ac.track) + "°"}</dd></div>
        <div><dt>SQUAWK</dt><dd className={isEmergency(ac?.squawk ?? null) ? "text-red-400" : ""}>{ac?.squawk || "—"}</dd></div>
        <div><dt>FROM HOME</dt><dd>{formatDistance(ac ? aircraftDistance(ac, settings) : null, settings.units)}</dd></div>
      </dl>
      <div className="inspector-meta"><span>CATEGORY <b>{ac?.category || "—"}</b></span><span>SEEN <b>{ac?.seen == null ? "—" : ac.seen.toFixed(1) + "s"}</b></span></div>
      <div className="inspector-note"><span className="status-dot bg-cyan-400" /> Positions extrapolated between receiver updates.</div>
    </div>
  </aside>;
}
