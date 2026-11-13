"use client";
import type { Aircraft, Settings } from "@/lib/types";
import { aircraftDistance } from "@/lib/filters";
import { altitudeColor, isEmergency } from "@/lib/aircraftStyle";
import {
  formatAltitude,
  formatDistance,
  formatSpeed,
  formatVerticalRate,
} from "@/lib/units";
import type { FlightRoute } from "@/lib/intelligence";
import type { HistoryPoint } from "@/hooks/useAircraftFeed";
import PhotoCarousel from "./PhotoCarousel";
import AircraftDetails from "./AircraftDetails";
import ScrollPanel from "./ScrollPanel";
const emergencyMeaning: Record<string, string> = {
  "7500": "Hijack",
  "7600": "Radio Failure",
  "7700": "General Emergency",
};
export default function Inspector({
  hex,
  aircraft,
  settings,
  onClose,
  watched,
  onToggleWatch,
  route,
  routeLoading,
  history,
}: {
  hex: string;
  aircraft: Aircraft | undefined;
  settings: Settings;
  onClose: () => void;
  watched: boolean;
  onToggleWatch: () => void;
  route: FlightRoute | null;
  routeLoading: boolean;
  history: HistoryPoint[];
}) {
  const ac = aircraft;
  return (
    <aside className="glass inspector" aria-label="Aircraft inspector">
      <div className="panel-heading">
        <span>Aircraft</span>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close inspector"
        >
          ×
        </button>
      </div>
      <ScrollPanel className="inspector-scroll">
        <div className="inspector-content">
          <div className="flex items-start justify-between">
            <div>
              <h1>{ac?.flight || hex.toUpperCase()}</h1>
              <div className="telemetry text-xs text-muted">
                {hex.toUpperCase()} <span className="text-subtle"> / </span>{" "}
                {ac?.reg || "—"} <span className="text-subtle"> / </span>{" "}
                {ac?.type || "—"}
              </div>
            </div>
            <button
              className="watch-button"
              aria-label={
                watched ? "Remove from watchlist" : "Add to watchlist"
              }
              aria-pressed={watched}
              onClick={onToggleWatch}
            >
              {watched ? "★" : "☆"}
            </button>
          </div>
          {ac && (
            <div className="source-label">
              <span className="badge">{ac.feedSource.toUpperCase()}</span>
              {ac.feedSource === "local" && ac.rssi !== null && (
                <span>{ac.rssi.toFixed(1)} dBFS</span>
              )}
            </div>
          )}
          {route && (
            <div className="route-summary">
              <strong>
                {route.origin?.icao ?? route.origin?.iata ?? "—"} →{" "}
                {route.destination?.icao ?? route.destination?.iata ?? "—"}
              </strong>
              <span>
                {route.origin?.city ?? route.origin?.name ?? "Unknown origin"} →{" "}
                {route.destination?.city ??
                  route.destination?.name ??
                  "Unknown destination"}
              </span>
            </div>
          )}
          {routeLoading && <p className="detail-credit">Looking up route…</p>}
          {!ac && (
            <div className="signal-lost" role="status">
              ◌ Signal lost
              <small>This aircraft is no longer in the current feed.</small>
            </div>
          )}
          <div className="my-4 flex flex-wrap gap-2">
            {ac?.isMilitary && <span className="badge military">MILITARY</span>}
            {ac && isEmergency(ac.squawk) && (
              <span className="badge emergency">
                Emergency · {ac.squawk} {emergencyMeaning[ac.squawk!]}
              </span>
            )}
            {ac?.isInteresting && (
              <span className="badge interesting">VIP / INTERESTING</span>
            )}
            {ac?.isLADD && <span className="badge">LADD</span>}
            {ac?.isPIA && <span className="badge">PIA</span>}
          </div>
          <PhotoCarousel hex={hex} registration={ac?.reg} />
          <div className="section-label">
            Telemetry <span>Live</span>
          </div>
          <dl className="telemetry-grid">
            <div>
              <dt>Altitude</dt>
              <dd style={{ color: altitudeColor(ac?.alt_baro ?? null) }}>
                {formatAltitude(ac?.alt_baro ?? null, settings.units)}
              </dd>
            </div>
            <div>
              <dt>Vertical rate</dt>
              <dd
                className={
                  ac?.baro_rate && ac.baro_rate > 0
                    ? "text-sage"
                    : ac?.baro_rate && ac.baro_rate < 0
                      ? "text-sand"
                      : ""
                }
              >
                {ac?.baro_rate ? (ac.baro_rate > 0 ? "▲ " : "▼ ") : ""}
                {formatVerticalRate(ac?.baro_rate ?? null, settings.units)}
              </dd>
            </div>
            <div>
              <dt>Ground speed</dt>
              <dd>{formatSpeed(ac?.gs ?? null, settings.units)}</dd>
            </div>
            <div>
              <dt>Track</dt>
              <dd>
                <span
                  className="compass-arrow"
                  style={{ transform: "rotate(" + (ac?.track ?? 0) + "deg)" }}
                >
                  ↑
                </span>{" "}
                {ac?.track == null ? "—" : Math.round(ac.track) + "°"}
              </dd>
            </div>
            <div>
              <dt>Squawk</dt>
              <dd
                className={isEmergency(ac?.squawk ?? null) ? "text-rose" : ""}
              >
                {ac?.squawk || "—"}
              </dd>
            </div>
            <div>
              <dt>Distance</dt>
              <dd>
                {formatDistance(
                  ac ? aircraftDistance(ac, settings) : null,
                  settings.units,
                )}
              </dd>
            </div>
          </dl>
          <div className="inspector-meta">
            <span>
              Category <b>{ac?.category || "—"}</b>
            </span>
            <span>
              Seen <b>{ac?.seen == null ? "—" : ac.seen.toFixed(1) + "s"}</b>
            </span>
          </div>
          <AircraftDetails
            hex={hex}
            aircraft={ac}
            route={route}
            history={history}
            settings={settings}
          />
          <div className="inspector-note">
            <span className="status-dot bg-subtle" /> Positions extrapolated
            between receiver updates.
          </div>
        </div>
      </ScrollPanel>
    </aside>
  );
}
