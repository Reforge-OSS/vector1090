"use client";
import { useEffect, useRef, useState } from "react";
import type { Settings } from "@/lib/types";
import ScrollPanel from "./ScrollPanel";
export default function SettingsModal({
  settings,
  allowClientLocalUrl,
  localReceiverConfigured,
  onSave,
  onClose,
}: {
  settings: Settings;
  allowClientLocalUrl: boolean;
  localReceiverConfigured: boolean;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  const field = (key: keyof Settings, value: string | number | boolean) =>
    setDraft((s) => ({ ...s, [key]: value }));
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (
      !Number.isFinite(draft.homeLat) ||
      Math.abs(draft.homeLat) > 90 ||
      !Number.isFinite(draft.homeLon) ||
      Math.abs(draft.homeLon) > 180 ||
      !Number.isFinite(draft.radiusNm) ||
      draft.radiusNm < 1 ||
      draft.radiusNm > 250 ||
      !Number.isFinite(draft.pollIntervalSec) ||
      draft.pollIntervalSec < (draft.mode === "local" ? 1 : 5) ||
      draft.pollIntervalSec > 300
    ) {
      setError("Check coordinates, radius and polling interval.");
      return;
    }
    if (draft.mode === "hybrid" && !localReceiverConfigured) {
      setError("Configure LOCAL_RECEIVER_URL on the server to use Hybrid.");
      return;
    }
    if (draft.mode === "local" && allowClientLocalUrl) {
      try {
        if (!["http:", "https:"].includes(new URL(draft.localUrl).protocol))
          throw new Error();
      } catch {
        setError("Enter a valid HTTP or HTTPS receiver URL.");
        return;
      }
    }
    onSave(draft);
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="glass settings-modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const focusable = dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input,select",
          );
          if (!focusable?.length) return;
          const first = focusable[0],
            last = focusable[focusable.length - 1];
          if (
            e.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === dialog.current)
          ) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="panel-heading">
          <span id="settings-title">Settings</span>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <ScrollPanel className="settings-body">
          <form onSubmit={save}>
            <h2>Radar settings</h2>
            <p className="text-sm text-muted">
              Choose a feed, home location and units.
            </p>
            <label className="field-label">Feed</label>
            <div className="mode-switch">
              {(["public", "local", "hybrid"] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  disabled={mode === "hybrid" && !localReceiverConfigured}
                  aria-pressed={draft.mode === mode}
                  className={draft.mode === mode ? "active" : ""}
                  onClick={() =>
                    setDraft((s) => ({
                      ...s,
                      mode,
                      pollIntervalSec: mode === "local" ? 2 : 10,
                    }))
                  }
                >
                  {mode === "public"
                    ? "Public API"
                    : mode === "hybrid"
                      ? "Hybrid"
                      : "Local receiver"}
                </button>
              ))}
            </div>
            {!localReceiverConfigured && (
              <p className="text-xs text-muted">
                Hybrid requires LOCAL_RECEIVER_URL on the server.
              </p>
            )}
            {draft.mode === "local" && (
              <label className="field-label">
                Local aircraft.json URL
                <input
                  type={allowClientLocalUrl ? "url" : "text"}
                  required={allowClientLocalUrl}
                  readOnly={!allowClientLocalUrl}
                  value={
                    allowClientLocalUrl
                      ? draft.localUrl
                      : "Server-managed receiver"
                  }
                  onChange={(e) => field("localUrl", e.target.value)}
                />
                {!allowClientLocalUrl && (
                  <span className="normal-case text-muted">
                    Server-managed:{" "}
                    {localReceiverConfigured
                      ? "using the configured receiver URL"
                      : "using the server default URL"}
                    . Set ALLOW_CLIENT_LOCAL_URL=true on the server to enable
                    editing.
                  </span>
                )}
              </label>
            )}
            <div className="section-label">Home location</div>
            <div className="settings-coordinates">
              {(
                [
                  ["homeLat", "Latitude", -90, 90],
                  ["homeLon", "Longitude", -180, 180],
                  ["radiusNm", "Radius · nm", 1, 250],
                ] as const
              ).map(([key, label, min, max]) => (
                <label className="field-label" key={key}>
                  {label}
                  <input
                    required
                    type="number"
                    step="any"
                    min={min}
                    max={max}
                    value={Number.isNaN(draft[key]) ? "" : draft[key]}
                    onChange={(e) =>
                      field(
                        key,
                        e.target.value === "" ? NaN : Number(e.target.value),
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <div className="section-label">Display and updates</div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={draft.trackViewport}
                disabled={draft.mode === "local"}
                onChange={(e) => field("trackViewport", e.target.checked)}
              />
              Follow map viewport
            </label>
            <label className="field-label">
              Units
              <select
                value={draft.units}
                onChange={(e) => field("units", e.target.value)}
              >
                <option value="aviation">Aviation · ft / kts / nm</option>
                <option value="metric">Metric · m / km/h / km</option>
              </select>
            </label>
            <label className="field-label">
              Polling interval · seconds{" "}
              <span className="normal-case text-subtle">
                (min {draft.mode === "local" ? 1 : 5}s)
              </span>
              <input
                required
                type="number"
                min={draft.mode === "local" ? 1 : 5}
                max={300}
                value={
                  Number.isNaN(draft.pollIntervalSec)
                    ? ""
                    : draft.pollIntervalSec
                }
                onChange={(e) =>
                  field(
                    "pollIntervalSec",
                    e.target.value === "" ? NaN : Number(e.target.value),
                  )
                }
              />
            </label>
            {error && (
              <p className="mt-3 text-sm text-rose" role="alert">
                {error}
              </p>
            )}
            <footer className="modal-footer">
              <span>Stored on this device</span>
              <button className="control" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="control primary" type="submit">
                Save settings
              </button>
            </footer>
          </form>
        </ScrollPanel>
      </div>
    </div>
  );
}
