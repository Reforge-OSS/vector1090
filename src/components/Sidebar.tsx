"use client";
import type { RefObject } from "react";
import type { Aircraft, Settings } from "@/lib/types";
import type { AircraftFilter } from "@/lib/filters";
import { aircraftDistance } from "@/lib/filters";
import {
  altitudeColor,
  EMERGENCY_COLOR,
  isEmergency,
} from "@/lib/aircraftStyle";
import ScrollPanel from "./ScrollPanel";
import { formatAltitude, formatDistance, formatSpeed } from "@/lib/units";
interface Props {
  open: boolean;
  aircraft: Aircraft[];
  settings: Settings;
  search: string;
  onSearch: (v: string) => void;
  filter: AircraftFilter;
  onFilter: (v: AircraftFilter) => void;
  selectedHex: string | null;
  onSelect: (hex: string) => void;
  searchRef: RefObject<HTMLInputElement>;
}
export default function Sidebar(p: Props) {
  return (
    <aside
      className={"glass sidebar " + (!p.open ? "sidebar-hidden" : "")}
      aria-label="Aircraft sidebar"
    >
      <div className="panel-heading">
        <span>Traffic</span>
        <span className="text-muted">
          {p.aircraft.length.toString().padStart(2, "0")} aircraft
        </span>
      </div>
      <div className="px-4 pb-3">
        <div className="search-wrap">
          <span>⌕</span>
          <input
            ref={p.searchRef}
            aria-label="Search aircraft"
            placeholder="Callsign, hex, registration…"
            value={p.search}
            onChange={(e) => p.onSearch(e.target.value)}
          />
          <kbd>/</kbd>
        </div>
        <div className="filter-pills">
          {(
            [
              ["all", "All"],
              ["low", "Low Alt < 15k ft"],
              ["military", "Military"],
              ["emergency", "Emergency"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={p.filter === value ? "active" : ""}
              aria-pressed={p.filter === value}
              onClick={() => p.onFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="list-caption">
        <span>Aircraft / altitude</span>
        <span>Nearest first</span>
      </div>
      <ScrollPanel className="aircraft-list">
        {p.aircraft.length === 0 && (
          <div className="empty-state">
            <span>⌁</span>No matching aircraft
            <small>Adjust your search or filters.</small>
          </div>
        )}
        {p.aircraft.map((ac) => (
          <button
            key={ac.hex}
            className={
              "aircraft-row " + (ac.hex === p.selectedHex ? "selected" : "")
            }
            onClick={() => p.onSelect(ac.hex)}
          >
            <div className="flex items-center justify-between gap-2">
              <strong>{ac.flight || ac.hex.toUpperCase()}</strong>
              <span
                className="telemetry"
                style={{
                  color: isEmergency(ac.squawk)
                    ? EMERGENCY_COLOR
                    : altitudeColor(ac.alt_baro),
                }}
              >
                {formatAltitude(ac.alt_baro, p.settings.units)}
              </span>
            </div>
            <div className="row-secondary">
              <span>
                {ac.type || "—"} <i>·</i> {ac.reg || ac.hex}
              </span>
              <span>{formatSpeed(ac.gs, p.settings.units)}</span>
            </div>
            <div className="row-footer">
              <span>
                {ac.isMilitary && <b className="badge military">Military</b>}
                {isEmergency(ac.squawk) && (
                  <b className="badge emergency">Emergency</b>
                )}
                <span className="text-subtle">{ac.hex.toUpperCase()}</span>
              </span>
              <span>
                {formatDistance(
                  aircraftDistance(ac, p.settings),
                  p.settings.units,
                )}{" "}
                <span className="text-subtle">↗</span>
              </span>
            </div>
          </button>
        ))}
      </ScrollPanel>
      <footer className="shortcuts">
        <span>
          <kbd>/</kbd> Search
        </span>
        <span>
          <kbd>T</kbd> Trails
        </span>
        <span>
          <kbd>Space</kbd> Pause
        </span>
        <span>
          <kbd>Esc</kbd> Close
        </span>
      </footer>
    </aside>
  );
}
