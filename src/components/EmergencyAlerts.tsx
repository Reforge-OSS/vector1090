"use client";
import { useEffect, useState } from "react";
import type { Aircraft } from "@/lib/types";
import { isEmergency } from "@/lib/aircraftStyle";
export default function EmergencyAlerts({
  aircraft,
  lastUpdate,
  stale,
  onSelect,
  onVisible,
}: {
  aircraft: Aircraft[];
  lastUpdate: number | null;
  stale: boolean;
  onSelect: (hex: string) => void;
  onVisible: (visible: boolean) => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const alerts = aircraft.filter(
    (ac) =>
      isEmergency(ac.squawk) &&
      !(ac.stale ?? stale) &&
      lastUpdate !== null &&
      (now - lastUpdate) / 1000 + (ac.seen ?? 0) < 60 &&
      !dismissed.has(ac.hex + ":" + ac.squawk),
  );
  const visible = alerts.length > 0;
  useEffect(() => onVisible(visible), [visible, onVisible]);
  if (!visible) return null;
  return (
    <section className="emergency-strip" aria-label="Emergency alerts">
      <span>Emergency</span>
      {alerts.map((ac) => (
        <div key={ac.hex + ac.squawk}>
          <button onClick={() => onSelect(ac.hex)}>
            {ac.flight || ac.hex.toUpperCase()} <b>{ac.squawk}</b>
          </button>
          <button
            aria-label={"Dismiss emergency " + ac.hex + " " + ac.squawk}
            onClick={() =>
              setDismissed(
                (previous) => new Set([...previous, ac.hex + ":" + ac.squawk]),
              )
            }
          >
            ×
          </button>
        </div>
      ))}
    </section>
  );
}
