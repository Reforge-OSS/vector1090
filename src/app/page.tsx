"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useReceiverConfig } from "@/hooks/useReceiverConfig";
import { useAircraftFeed } from "@/hooks/useAircraftFeed";
import TopHud from "@/components/TopHud";
import Sidebar from "@/components/Sidebar";
import Inspector from "@/components/Inspector";
import SettingsModal from "@/components/SettingsModal";
import AtcPlayer from "@/components/AtcPlayer";
import { filterAircraft, type AircraftFilter } from "@/lib/filters";
import type { MapViewport } from "@/lib/types";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useCallsignRoute } from "@/hooks/useAircraftMetadata";

const RadarMap = dynamic(() => import("@/components/RadarMap"), { ssr: false });
export default function Home() {
  const { settings, setSettings } = useSettings();
  const receiverConfig = useReceiverConfig();
  const [paused, setPaused] = useState(false);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const [debouncedViewport, setDebouncedViewport] =
    useState<MapViewport | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedViewport(viewport), 800);
    return () => clearTimeout(timer);
  }, [viewport]);
  const feed = useAircraftFeed(
    settings,
    paused,
    receiverConfig.allowClientLocalUrl,
    debouncedViewport,
  );
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const { watchlist, toggleWatch } = useWatchlist();
  const selectedAircraft = feed.aircraft.find((ac) => ac.hex === selectedHex);
  const routeLookup = useCallsignRoute(selectedAircraft?.flight);
  const selectedRoute = routeLookup.data;
  const [trails, setTrails] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [modal, setModal] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AircraftFilter>("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(
    () => filterAircraft(feed.aircraft, search, filter, settings, watchlist),
    [feed.aircraft, search, filter, settings, watchlist],
  );
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (modal) setModal(false);
        else setSelectedHex(null);
        return;
      }
      if (
        modal ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof HTMLElement &&
          (e.target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)))
      )
        return;
      if (e.key.toLowerCase() === "t") setTrails((value) => !value);
      if (e.code === "Space") {
        e.preventDefault();
        setPaused((value) => !value);
      }
      if (e.key === "/") {
        e.preventDefault();
        setSidebar(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [modal]);
  function select(hex: string | null) {
    setSelectedHex(hex);
    if (hex && window.innerWidth < 768) setSidebar(false);
  }
  return (
    <main
      className={
        "dashboard relative h-dvh w-full overflow-hidden " +
        (selectedHex ? "has-inspector" : "")
      }
    >
      <RadarMap
        aircraft={visible}
        lastUpdate={feed.lastUpdate}
        trailsRef={feed.trailsRef}
        home={{ lat: settings.homeLat, lon: settings.homeLon }}
        selectedHex={selectedHex}
        onSelect={select}
        showAllTrails={trails}
        units={settings.units}
        onViewportChange={setViewport}
        watchlist={watchlist}
      />
      <TopHud
        mode={settings.mode}
        status={feed.status}
        lastUpdate={feed.lastUpdate}
        shown={visible.length}
        total={feed.total}
        filtered={!!search.trim() || filter !== "all"}
        paused={paused}
        onPause={() => setPaused((v) => !v)}
        trails={trails}
        onTrails={() => setTrails((v) => !v)}
        onSettings={() => setModal(true)}
        onSidebar={() => setSidebar((v) => !v)}
      />
      <Sidebar
        open={sidebar}
        aircraft={visible}
        settings={settings}
        search={search}
        onSearch={setSearch}
        filter={filter}
        onFilter={setFilter}
        selectedHex={selectedHex}
        onSelect={select}
        searchRef={searchRef}
      />
      {selectedHex && (
        <Inspector
          key={selectedHex}
          hex={selectedHex}
          aircraft={selectedAircraft}
          settings={settings}
          watched={watchlist.has(selectedHex)}
          onToggleWatch={() => toggleWatch(selectedHex)}
          route={selectedRoute}
          routeLoading={routeLookup.loading}
          history={feed.historyRef.current.get(selectedHex) ?? []}
          onClose={() => setSelectedHex(null)}
        />
      )}
      <AtcPlayer />
      {modal && (
        <SettingsModal
          settings={settings}
          {...receiverConfig}
          onSave={(value) => {
            setSettings(value);
            setModal(false);
          }}
          onClose={() => setModal(false)}
        />
      )}
    </main>
  );
}
