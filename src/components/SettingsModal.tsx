"use client";
import { useEffect, useRef, useState } from "react";
import type { Settings } from "@/lib/types";
export default function SettingsModal({ settings, onSave, onClose }: { settings: Settings; onSave: (settings: Settings) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  const field = (key: keyof Settings, value: string | number) => setDraft(s => ({ ...s, [key]: value }));
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(draft.homeLat) || Math.abs(draft.homeLat) > 90 || !Number.isFinite(draft.homeLon) || Math.abs(draft.homeLon) > 180 || !Number.isFinite(draft.radiusNm) || draft.radiusNm < 1 || draft.radiusNm > 250 || !Number.isFinite(draft.pollIntervalSec) || draft.pollIntervalSec < (draft.mode === "public" ? 5 : 1) || draft.pollIntervalSec > 300) { setError("Check coordinates, radius and polling interval."); return; }
    if (draft.mode === "local") {
      try { if (!["http:", "https:"].includes(new URL(draft.localUrl).protocol)) throw new Error(); } catch { setError("Enter a valid HTTP or HTTPS receiver URL."); return; }
    }
    onSave(draft);
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="glass settings-modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} onKeyDown={e => {
      if (e.key !== "Tab") return;
      const focusable = dialog.current?.querySelectorAll<HTMLElement>("button,input,select");
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }}>
      <div className="panel-heading"><span id="settings-title">SYSTEM CONFIGURATION</span><button className="icon-button" aria-label="Close settings" onClick={onClose}>×</button></div>
      <form onSubmit={save}>
        <h2>Radar settings</h2><p className="text-sm text-slate-400">Configure your receiver and home airspace.</p>
        <label className="field-label">DATA SOURCE</label>
        <div className="mode-switch">{(["public", "local"] as const).map(mode => <button type="button" key={mode} aria-pressed={draft.mode === mode} className={draft.mode === mode ? "active" : ""} onClick={() => setDraft(s => ({ ...s, mode, pollIntervalSec: mode === "public" ? 10 : 2 }))}>{mode === "public" ? "◉ Public Live API" : "⌁ Local Receiver"}</button>)}</div>
        {draft.mode === "local" && <label className="field-label">LOCAL AIRCRAFT.JSON URL<input type="url" required value={draft.localUrl} onChange={e => field("localUrl", e.target.value)} /></label>}
        <div className="section-label">HOME AIRSPACE</div>
        <div className="settings-coordinates">{([["homeLat", "LATITUDE", -90, 90], ["homeLon", "LONGITUDE", -180, 180], ["radiusNm", "RADIUS · NM", 1, 250]] as const).map(([key, label, min, max]) => <label className="field-label" key={key}>{label}<input required type="number" step="any" min={min} max={max} value={Number.isNaN(draft[key]) ? "" : draft[key]} onChange={e => field(key, e.target.value === "" ? NaN : Number(e.target.value))} /></label>)}</div>
        <div className="section-label">DISPLAY & UPDATES</div>
        <label className="field-label">UNITS<select value={draft.units} onChange={e => field("units", e.target.value)}><option value="aviation">Aviation · ft / kts / nm</option><option value="metric">Metric · m / km/h / km</option></select></label>
        <label className="field-label">POLLING INTERVAL · SECONDS <span className="normal-case text-slate-500">(min {draft.mode === "public" ? 5 : 1}s)</span><input required type="number" min={draft.mode === "public" ? 5 : 1} max={300} value={Number.isNaN(draft.pollIntervalSec) ? "" : draft.pollIntervalSec} onChange={e => field("pollIntervalSec", e.target.value === "" ? NaN : Number(e.target.value))} /></label>
        {error && <p className="mt-3 text-sm text-red-400" role="alert">{error}</p>}
        <footer className="modal-footer"><span>Stored on this device</span><button className="control" type="button" onClick={onClose}>Cancel</button><button className="control primary" type="submit">Save settings</button></footer>
      </form>
    </div>
  </div>;
}
