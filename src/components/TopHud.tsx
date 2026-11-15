"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FeedStatus } from "@/hooks/useAircraftFeed";
import type { Aircraft, FeedMode, LayerSettings } from "@/lib/types";
import Logo from "./Logo";
interface Props {
  mode: FeedMode;
  status: FeedStatus;
  lastUpdate: number | null;
  shown: number;
  total: number;
  filtered: boolean;
  paused: boolean;
  onPause: () => void;
  onSettings: () => void;
  onSidebar: () => void;
  layers: LayerSettings;
  onLayer: (key: keyof LayerSettings, value: boolean) => void;
  onResetRange: () => void;
  overhead: Aircraft[];
  onSelect: (hex: string) => void;
}
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
const layerLabels: [keyof LayerSettings, string][] = [
  ["rangeRings", "Range rings"],
  ["allTrails", "All trails"],
  ["terminator", "Day/night terminator"],
  ["weatherRadar", "Weather radar"],
  ["receiverRange", "Receiver range"],
];
export default function TopHud(p: Props) {
  const [now, setNow] = useState(Date.now());
  const [menu, setMenu] = useState<"layers" | "overhead" | null>(null);
  const layersRef = useRef<HTMLDivElement>(null),
    overheadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const root = menu === "layers" ? layersRef.current : overheadRef.current;
    root
      ?.querySelector<HTMLElement>(".hud-popover input, .hud-popover button")
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root?.contains(event.target))
        setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setMenu(null);
        root?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [menu]);
  const color =
    p.status === "online"
      ? "bg-sage"
      : p.status === "paused" || p.status === "partial"
        ? "bg-sand"
        : p.status === "connecting"
          ? "bg-ground"
          : "bg-rose";
  return (
    <header className="glass hud">
      <button
        className="icon-button hud-icon"
        onClick={p.onSidebar}
        aria-label="Toggle aircraft sidebar"
      >
        <Icon>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </Icon>
      </button>
      <Logo />
      <div
        className="hud-status"
        title={
          p.mode === "public"
            ? "Public feed"
            : p.mode === "hybrid"
              ? "Hybrid feed"
              : "Local receiver"
        }
      >
        <span className={"status-dot " + color} />
        <span className="capitalize">{p.status.replace("-", " ")}</span>
        <small>
          {p.lastUpdate
            ? "updated " +
              Math.max(0, Math.floor((now - p.lastUpdate) / 1000)) +
              "s ago"
            : "Acquiring feed"}
        </small>
      </div>
      <div className="hud-count">
        <strong>
          {p.filtered ? p.shown + "/" : ""}
          {p.total}
        </strong>
        <small>aircraft</small>
      </div>
      {p.overhead.length > 0 && (
        <div className="hud-popover-anchor overhead-anchor" ref={overheadRef}>
          <button
            className="control overhead-button"
            aria-label={"Overhead aircraft: " + p.overhead.length}
            onClick={() => setMenu(menu === "overhead" ? null : "overhead")}
            aria-expanded={menu === "overhead"}
          >
            <Icon>
              <circle cx="12" cy="12" r="7" />
              <path d="M12 2v5m0 10v5M2 12h5m10 0h5" />
            </Icon>
            <span className="overhead-label">Overhead</span>{" "}
            <b>{p.overhead.length}</b>
          </button>
          {menu === "overhead" && (
            <div
              className="hud-popover overhead-popover"
              role="dialog"
              aria-label="Overhead aircraft"
            >
              <h3>Within 5 nm of home</h3>
              {p.overhead.map((ac) => (
                <button
                  key={ac.hex}
                  onClick={() => {
                    p.onSelect(ac.hex);
                    setMenu(null);
                  }}
                >
                  <span>{ac.flight || ac.hex.toUpperCase()}</span>
                  <small>{ac.reg ?? ac.type}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="hud-actions ml-auto flex gap-2">
        <button
          className="control hud-action"
          onClick={p.onPause}
          aria-pressed={p.paused}
          aria-label={p.paused ? "Resume feed" : "Pause feed"}
        >
          <Icon>
            {p.paused ? (
              <path d="m8 4 12 8-12 8Z" />
            ) : (
              <path d="M8 4v16M16 4v16" />
            )}
          </Icon>
          <span className="pause-label">{p.paused ? "Resume" : "Pause"}</span>
        </button>
        <div className="hud-popover-anchor" ref={layersRef}>
          <button
            className="control hud-action"
            onClick={() => setMenu(menu === "layers" ? null : "layers")}
            aria-label="Map layers"
            aria-expanded={menu === "layers"}
            aria-controls="map-layers"
          >
            <Icon>
              <path d="m12 3 10 6-10 6L2 9Zm-10 9 10 6 10-6M2 16l10 6 10-6" />
            </Icon>
            <span className="layers-label">Layers</span>
          </button>
          {menu === "layers" && (
            <div
              id="map-layers"
              className="hud-popover layers-popover"
              role="dialog"
              aria-label="Map layers"
            >
              <h3>Map layers</h3>
              {layerLabels.map(([key, label]) => (
                <label className="layer-option" key={key}>
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={p.layers[key]}
                    disabled={key === "receiverRange" && p.mode === "public"}
                    onChange={(event) => p.onLayer(key, event.target.checked)}
                  />
                </label>
              ))}
              <div className="range-reset">
                <small>
                  {p.mode === "public"
                    ? "Receiver range needs local / hybrid"
                    : "Range measured from home"}
                </small>
                <button onClick={p.onResetRange} disabled={p.mode === "public"}>
                  Reset
                </button>
              </div>
              <small className="weather-credit">
                Weather tiles by{" "}
                <a
                  href="https://www.rainviewer.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  RainViewer
                </a>
              </small>
            </div>
          )}
        </div>
        <button
          className="control hud-action"
          onClick={p.onSettings}
          aria-label="Open settings"
        >
          <Icon>
            <circle cx="12" cy="12" r="3" />
            <path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 3 3 3-2 1-3 3-1 2-3-2-2 1-3-2-3-3 1-3-3Z" />
          </Icon>
          <span className="settings-label">Settings</span>
        </button>
      </div>
    </header>
  );
}
