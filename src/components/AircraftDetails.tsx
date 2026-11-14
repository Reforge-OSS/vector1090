"use client";
import { useState, type ReactNode } from "react";
import type { Aircraft, Settings } from "@/lib/types";
import type { FlightRoute } from "@/lib/intelligence";
import type { HistoryPoint } from "@/hooks/useAircraftFeed";
import { aircraftCountry } from "@/lib/countries";
import { positionSourceName } from "@/lib/intelligence";
import { useAirframe } from "@/hooks/useAircraftMetadata";
import { formatAltitude, formatSpeed } from "@/lib/units";
import { sparklinePath } from "@/lib/history";
type Tab = "modes" | "airframe" | "history";
export default function AircraftDetails({
  hex,
  aircraft: ac,
  route,
  history,
  settings,
}: {
  hex: string;
  aircraft?: Aircraft;
  route: FlightRoute | null;
  history: HistoryPoint[];
  settings: Settings;
}) {
  const [tab, setTab] = useState<Tab>("modes");
  const airframe = useAirframe(hex);
  const extended: [string, ReactNode][] = [
    ["IAS", ac?.ias == null ? null : formatSpeed(ac.ias, settings.units)],
    ["TAS", ac?.tas == null ? null : formatSpeed(ac.tas, settings.units)],
    ["Mach", ac?.mach == null ? null : ac.mach.toFixed(3)],
    [
      "Geometric altitude",
      ac?.alt_geom == null ? null : formatAltitude(ac.alt_geom, settings.units),
    ],
    [
      "MCP selected altitude",
      ac?.nav_altitude_mcp == null
        ? null
        : formatAltitude(ac.nav_altitude_mcp, settings.units),
    ],
    ["Nav QNH", ac?.nav_qnh == null ? null : ac.nav_qnh.toFixed(1) + " hPa"],
    [
      "Nav modes",
      ac?.nav_modes?.length ? (
        <span className="nav-chips">
          {ac.nav_modes.map((mode) => (
            <span className="badge" key={mode}>
              {mode.replaceAll("_", " ")}
            </span>
          ))}
        </span>
      ) : null,
    ],
    [
      "Wind speed",
      ac?.wind_speed == null
        ? null
        : formatSpeed(ac.wind_speed, settings.units),
    ],
    [
      "Wind direction",
      ac?.wind_dir == null ? null : Math.round(ac.wind_dir) + "°",
    ],
    ["Roll", ac?.roll == null ? null : ac.roll.toFixed(1) + "°"],
    [
      "Magnetic heading",
      ac?.mag_heading == null ? null : ac.mag_heading.toFixed(1) + "°",
    ],
    [
      "True heading",
      ac?.true_heading == null ? null : ac.true_heading.toFixed(1) + "°",
    ],
    ["Position source", positionSourceName(ac?.positionSource ?? null)],
    [
      "Messages",
      ac?.messages == null ? null : ac.messages.toLocaleString("en-GB"),
    ],
  ];
  const rows = (entries: [string, ReactNode][]) => (
    <dl className="detail-rows">
      {entries
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
  return (
    <section className="aircraft-details">
      <div className="detail-tabs" aria-label="Aircraft details">
        {(
          [
            ["modes", "Mode S / Autopilot"],
            ["airframe", "Airframe & Operator"],
            ["history", "History"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="detail-panel" key={tab}>
        {tab === "modes" &&
          (extended.some(([, value]) => value !== null) ? (
            rows(extended)
          ) : (
            <p className="detail-empty">No extended data</p>
          ))}
        {tab === "airframe" && (
          <>
            {rows([
              [
                "ICAO allocation",
                aircraftCountry(hex) ?? "Unassigned / unknown",
              ],
              [
                "Operator / airline",
                route?.airline?.name ?? airframe.data?.operatorCode ?? null,
              ],
              ["Manufacturer", airframe.data?.manufacturer],
              ["Type", airframe.data?.typeDescription],
              ["ICAO type", airframe.data?.icaoType],
              ["Registration", airframe.data?.registration],
              ["Registered owner", airframe.data?.owner],
              ["Owner country", airframe.data?.ownerCountry],
            ])}
            {airframe.loading && (
              <p className="detail-empty" role="status">
                Loading airframe data…
              </p>
            )}
            {airframe.error && (
              <p className="detail-empty">Airframe lookup unavailable</p>
            )}
            {!airframe.loading && !airframe.error && !airframe.data && (
              <p className="detail-empty">No airframe record</p>
            )}
            <p className="detail-credit">Airframe and route data · adsbdb</p>
          </>
        )}
        {tab === "history" && (
          <>
            {(["alt", "gs"] as const).map((field) => {
              const path = sparklinePath(history, field);
              const last = history[history.length - 1];
              return (
                <div className="history-chart" key={field}>
                  <div>
                    <span>{field === "alt" ? "Altitude" : "Ground speed"}</span>
                    <b>
                      {field === "alt"
                        ? formatAltitude(last?.alt ?? null, settings.units)
                        : formatSpeed(last?.gs ?? null, settings.units)}
                    </b>
                  </div>
                  {path ? (
                    <svg
                      viewBox="0 0 280 64"
                      role="img"
                      aria-label={
                        field === "alt"
                          ? "Session altitude history"
                          : "Session ground speed history"
                      }
                    >
                      <path
                        d={path}
                        fill="none"
                        stroke={
                          field === "alt" ? "var(--sage)" : "var(--powder)"
                        }
                        strokeWidth="1.5"
                      />
                    </svg>
                  ) : (
                    <p className="detail-empty">Collecting session history</p>
                  )}
                </div>
              );
            })}
            <p className="detail-credit">
              This session only · up to 600 observations
            </p>
          </>
        )}
      </div>
    </section>
  );
}
