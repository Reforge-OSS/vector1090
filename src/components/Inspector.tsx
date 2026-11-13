"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import type { Aircraft, Settings } from "@/lib/types";
import { aircraftDistance } from "@/lib/filters";
import { altitudeColor, isEmergency } from "@/lib/aircraftStyle";
import {
  formatAltitude,
  formatDistance,
  formatSpeed,
  formatVerticalRate,
} from "@/lib/units";
import { loadPhoto } from "@/lib/photos";
import ScrollPanel from "./ScrollPanel";
interface Photo {
  thumbnail: string;
  large: string;
  link: string;
  photographer: string;
}
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
}: {
  hex: string;
  aircraft: Aircraft | undefined;
  settings: Settings;
  onClose: () => void;
}) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setPhoto(null);
    loadPhoto(hex)
      .catch(() => null)
      .then((result) => {
        if (active) {
          setPhoto(result);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [hex]);
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
            <span className="text-3xl text-muted">✈</span>
          </div>
          {!ac && (
            <div className="signal-lost" role="status">
              ◌ Signal lost
              <small>This aircraft is no longer in the current feed.</small>
            </div>
          )}
          <div className="my-4 flex flex-wrap gap-2">
            {ac?.isMilitary && <span className="badge military">Military</span>}
            {ac && isEmergency(ac.squawk) && (
              <span className="badge emergency">
                Emergency · {ac.squawk} {emergencyMeaning[ac.squawk!]}
              </span>
            )}
            {ac?.isInteresting && (
              <span className="badge interesting">Interesting</span>
            )}
          </div>
          <div className="photo-card">
            {loading ? (
              <div
                className="photo-skeleton"
                aria-label="Loading aircraft photo"
              />
            ) : photo?.thumbnail ? (
              <>
                <Image
                  unoptimized
                  src={photo.thumbnail}
                  alt={ac?.reg ? "Aircraft " + ac.reg : "Selected aircraft"}
                  width={640}
                  height={420}
                  onError={() => setPhoto(null)}
                />
                <a href={photo.link} target="_blank" rel="noreferrer">
                  © {photo.photographer || "Planespotters.net"} ↗
                </a>
              </>
            ) : (
              <div className="photo-placeholder">
                <span>✈</span>
                <p>No photo available</p>
                <small>Aircraft photo</small>
              </div>
            )}
          </div>
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
          <div className="inspector-note">
            <span className="status-dot bg-subtle" /> Positions extrapolated
            between receiver updates.
          </div>
        </div>
      </ScrollPanel>
    </aside>
  );
}
