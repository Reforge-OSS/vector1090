"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  providerName,
  savedAtcChannels,
  sortAtcChannels,
  type AtcChannel,
} from "@/lib/atc";
export default function AtcPicker({
  channels,
  current,
  center,
  saved,
  onSelect,
  onSave,
  onRemove,
}: {
  channels: AtcChannel[];
  current: AtcChannel | null;
  center: { lat: number; lon: number } | null;
  saved: AtcChannel[];
  onSelect: (channel: AtcChannel) => void;
  onSave: (channel: AtcChannel) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [nearest, setNearest] = useState(true),
    [focused, setFocused] = useState(0),
    [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const id = useId(),
    results = sortAtcChannels(channels, search, nearest ? center : null);
  const groups = new Map<string, AtcChannel[]>();
  for (const c of results) {
    const key = c.airportIcao ?? c.airportIata ?? "Other channels";
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const ordered = [...groups.values()].flat();
  useEffect(() => {
    if (open)
      document
        .getElementById(id + "-" + focused)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [open, focused, id]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const pointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  const choose = (channel: AtcChannel) => {
    onSelect(channel);
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="atc-picker" ref={container}>
      <button
        ref={trigger}
        className="atc-channel-trigger"
        aria-label="Choose ATC channel"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current?.name ?? "Choose a channel"}</span>
        <span aria-hidden>⌃</span>
      </button>
      {open && (
        <div className="atc-popover">
          <label className="sr-only" htmlFor={id}>
            Search ATC channels
          </label>
          <input
            ref={input}
            id={id}
            role="combobox"
            aria-expanded="true"
            aria-controls={id + "-list"}
            aria-autocomplete="list"
            aria-activedescendant={
              ordered[focused] ? id + "-" + focused : undefined
            }
            placeholder="Airport, city, name or frequency…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setFocused(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setFocused((v) =>
                  Math.max(
                    0,
                    Math.min(
                      ordered.length - 1,
                      v + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
              }
              if (e.key === "Enter" && ordered[focused]) {
                e.preventDefault();
                choose(ordered[focused]);
              }
            }}
          />
          <label className="atc-sort">
            Sort
            <select
              aria-label="Sort ATC channels"
              value={nearest ? "nearest" : "airport"}
              onChange={(e) => {
                setNearest(e.target.value === "nearest");
                setFocused(0);
              }}
            >
              <option value="nearest">Nearest to map center</option>
              <option value="airport">Airport code</option>
            </select>
          </label>
          <div
            role="listbox"
            id={id + "-list"}
            aria-label="ATC channels"
            className="atc-results"
          >
            {!ordered.length && (
              <p className="atc-muted">No matching channels</p>
            )}
            {[...groups].map(([group, items]) => (
              <div key={group} role="group" aria-label={group}>
                <div className="atc-group">
                  {group}
                  {items[0].city ? " · " + items[0].city : ""}
                  {items[0].country ? " · " + items[0].country : ""}
                </div>
                {items.map((c) => {
                  const index = ordered.indexOf(c);
                  return (
                    <button
                      key={c.id}
                      role="option"
                      id={id + "-" + index}
                      aria-selected={current?.id === c.id}
                      className={
                        "atc-option " + (focused === index ? "is-focused" : "")
                      }
                      onMouseEnter={() => setFocused(index)}
                      onClick={() => choose(c)}
                    >
                      <span
                        className={
                          "atc-dot " +
                          (c.provider === "custom"
                            ? "is-unverified"
                            : c.online
                              ? "is-online"
                              : "")
                        }
                        title={
                          c.provider === "custom"
                            ? "Availability checked on play"
                            : c.online
                              ? "Online"
                              : "Offline"
                        }
                      />
                      <span>
                        <b>{c.name}</b>
                        <small>
                          {[
                            c.airportIata,
                            c.frequency,
                            c.type,
                            providerName(c.provider),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {channels.some((c) => c.provider === "ibonav") && (
            <a
              className="atc-attribution"
              href="https://ibonav.aero"
              target="_blank"
              rel="noreferrer"
            >
              ibonav.aero
            </a>
          )}
          <details className="atc-custom">
            <summary>Add a stream URL</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                const channel = savedAtcChannels([
                  {
                    name: data.get("name"),
                    streamUrl: data.get("url"),
                    airportIcao: data.get("airport"),
                    type: data.get("type"),
                  },
                ])[0];
                if (!channel) {
                  setError(
                    "Use an HTTP(S) audio URL without embedded credentials. LiveATC streams cannot be embedded.",
                  );
                  return;
                }
                if (
                  saved.length >= 50 &&
                  !saved.some((c) => c.id === channel.id)
                ) {
                  setError("Remove a saved channel before adding another.");
                  return;
                }
                onSave(channel);
                choose(channel);
                setError("");
              }}
            >
              <input
                name="url"
                aria-label="Stream URL"
                placeholder="https://receiver/stream"
                required
                type="url"
              />
              <input
                name="name"
                aria-label="Channel name"
                placeholder="Channel name"
                maxLength={120}
              />
              <div>
                <input
                  name="airport"
                  aria-label="Airport ICAO"
                  placeholder="ICAO (optional)"
                  pattern="[A-Za-z0-9]{4}"
                  maxLength={4}
                />
                <select name="type" aria-label="Channel type">
                  <option value="tower">Tower</option>
                  <option value="ground">Ground</option>
                  <option value="approach">Approach</option>
                  <option value="other">Other</option>
                </select>
              </div>
              {error && <p role="alert">{error}</p>}
              <button className="control" type="submit">
                Save channel
              </button>
            </form>
            {saved.map((c) => (
              <div key={c.id} className="atc-saved">
                <span>{c.name}</span>
                <button
                  onClick={() => onRemove(c.id)}
                  aria-label={"Remove " + c.name}
                >
                  Remove
                </button>
              </div>
            ))}
          </details>
        </div>
      )}
    </div>
  );
}
