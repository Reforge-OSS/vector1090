"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useReceiverConfig } from "@/hooks/useReceiverConfig";
import { useAircraftFeed } from "@/hooks/useAircraftFeed";
import TopHud from "@/components/TopHud";
import Sidebar from "@/components/Sidebar";
import Inspector from "@/components/Inspector";
import SettingsModal from "@/components/SettingsModal";
import AtcPlayer from "@/components/AtcPlayer";
import { filterAircraft, aircraftDistance } from "@/lib/filters";
import type { LayerSettings, MapViewport } from "@/lib/types";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useCallsignRoute } from "@/hooks/useAircraftMetadata";
import { useMapState } from "@/hooks/useMapState";
import { useReceiverRange } from "@/hooks/useReceiverRange";
import EmergencyAlerts from "@/components/EmergencyAlerts";
import { useSelectedAircraft } from "@/hooks/useSelectedAircraft";

const RadarMap = dynamic(() => import("@/components/RadarMap"), { ssr: false });
export default function Home() {
  const { settings, setSettings, loaded } = useSettings();
  const receiverConfig = useReceiverConfig();
  const [paused, setPaused] = useState(false);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const {
    selectedHex,
    setSelectedHex,
    filter,
    setFilter,
    initialCamera,
    ready: urlReady,
  } = useMapState(viewport);
  const [debouncedViewport, setDebouncedViewport] =
    useState<MapViewport | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedViewport(viewport), 800);
    return () => clearTimeout(timer);
  }, [viewport]);
  const feed = useAircraftFeed(
    settings,
    paused || !loaded || !urlReady,
    receiverConfig.allowClientLocalUrl,
    debouncedViewport,
  );
  const { watchlist, toggleWatch } = useWatchlist();
  const selectedAircraft = feed.aircraft.find((ac) => ac.hex === selectedHex);
  const sourceIdentity =
    settings.mode +
    ":" +
    settings.localUrl +
    ":" +
    receiverConfig.allowClientLocalUrl;
  const mappedSelection = useSelectedAircraft(
    selectedHex,
    selectedAircraft,
    feed.lastUpdate,
    sourceIdentity,
  );
  const routeLookup = useCallsignRoute(mappedSelection?.aircraft.flight);
  const selectedRoute = routeLookup.data;
  const toggleTrails = useCallback(
    () =>
      setSettings((previous) => ({
        layers: { ...previous.layers, allTrails: !previous.layers.allTrails },
      })),
    [setSettings],
  );
  const setLayer = (key: keyof LayerSettings, value: boolean) =>
    setSettings((previous) => ({
      layers: { ...previous.layers, [key]: value },
    }));
  const range = useReceiverRange(
    { lat: settings.homeLat, lon: settings.homeLon },
    feed.aircraft,
    loaded && settings.mode !== "public",
  );
  const [hasAlert, setHasAlert] = useState(false);
  const overhead = useMemo(
    () =>
      feed.aircraft
        .filter(
          (ac) =>
            ac.lat !== null &&
            ac.lon !== null &&
            (aircraftDistance(ac, settings) ?? Infinity) <= 5,
        )
        .sort(
          (a, b) =>
            (aircraftDistance(a, settings) ?? Infinity) -
            (aircraftDistance(b, settings) ?? Infinity),
        ),
    [feed.aircraft, settings],
  );
  const [sidebar, setSidebar] = useState(true);
  useEffect(() => {
    if (selectedHex && window.innerWidth < 768) setSidebar(false);
  }, [selectedHex]);
  const [modal, setModal] = useState(false);
  const [search, setSearch] = useState("");
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
      if (e.key.toLowerCase() === "t") toggleTrails();
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
  }, [modal, toggleTrails, setSelectedHex]);
  function select(hex: string | null) {
    setSelectedHex(hex);
    if (hex && window.innerWidth < 768) setSidebar(false);
  }
  return (
    <main
      className={[
        "dashboard relative h-dvh w-full overflow-hidden",
        selectedHex && "has-inspector",
        hasAlert && "has-alert",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {loaded && urlReady && (
        <RadarMap
          aircraft={visible}
          lastUpdate={feed.lastUpdate}
          trailsRef={feed.trailsRef}
          home={{ lat: settings.homeLat, lon: settings.homeLon }}
          selectedHex={selectedHex}
          onSelect={select}
          layers={settings.layers}
          mode={settings.mode}
          initialCamera={initialCamera}
          selectedAircraft={mappedSelection?.aircraft ?? null}
          selectedLastUpdate={mappedSelection?.lastUpdate ?? null}
          selectedRoute={selectedRoute}
          receiverSectors={range.sectors}
          units={settings.units}
          onViewportChange={setViewport}
          watchlist={watchlist}
        />
      )}
      <TopHud
        mode={settings.mode}
        status={feed.status}
        lastUpdate={feed.lastUpdate}
        shown={visible.length}
        total={feed.total}
        filtered={!!search.trim() || filter !== "all"}
        paused={paused}
        onPause={() => setPaused((v) => !v)}
        layers={settings.layers}
        onLayer={setLayer}
        onResetRange={range.reset}
        overhead={overhead}
        onSelect={select}
        onSettings={() => setModal(true)}
        onSidebar={() => setSidebar((v) => !v)}
      />
      <EmergencyAlerts
        aircraft={feed.aircraft}
        lastUpdate={feed.lastUpdate}
        stale={feed.stale}
        onSelect={select}
        onVisible={setHasAlert}
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
      <AtcPlayer center={viewport?.center ?? null} />
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
