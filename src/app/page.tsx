"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useAircraftFeed } from "@/hooks/useAircraftFeed";
import TopHud from "@/components/TopHud";
import Sidebar from "@/components/Sidebar";
import Inspector from "@/components/Inspector";
import SettingsModal from "@/components/SettingsModal";
import AtcPlayer from "@/components/AtcPlayer";
import { filterAircraft, type AircraftFilter } from "@/lib/filters";

const RadarMap = dynamic(() => import("@/components/RadarMap"), { ssr: false });
export default function Home() {
  const { settings, setSettings } = useSettings();
  const [paused, setPaused] = useState(false);
  const feed = useAircraftFeed(settings, paused);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [trails, setTrails] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [modal, setModal] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AircraftFilter>("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => filterAircraft(feed.aircraft, search, filter, settings), [feed.aircraft, search, filter, settings]);
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if (e.key === "Escape") { if (modal) setModal(false); else setSelectedHex(null); return; }
      if (modal || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))) return;
      if (e.key.toLowerCase() === "t") setTrails(value => !value);
      if (e.code === "Space") { e.preventDefault(); setPaused(value => !value); }
      if (e.key === "/") { e.preventDefault(); setSidebar(true); requestAnimationFrame(() => searchRef.current?.focus()); }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [modal]);
  function select(hex: string | null) { setSelectedHex(hex); if (hex && window.innerWidth < 768) setSidebar(false); }
  return <main className={"dashboard relative h-dvh w-full overflow-hidden " + (selectedHex ? "has-inspector" : "")}>
    <RadarMap aircraft={visible} lastUpdate={feed.lastUpdate} trailsRef={feed.trailsRef}
      home={{ lat: settings.homeLat, lon: settings.homeLon }} selectedHex={selectedHex}
      onSelect={select} showAllTrails={trails} units={settings.units} />
    <TopHud mode={settings.mode} status={feed.status} lastUpdate={feed.lastUpdate} shown={visible.length} total={feed.total}
      filtered={!!search.trim() || filter !== "all"} paused={paused} onPause={() => setPaused(v => !v)} trails={trails}
      onTrails={() => setTrails(v => !v)} onSettings={() => setModal(true)} onSidebar={() => setSidebar(v => !v)} />
    <Sidebar open={sidebar} aircraft={visible} settings={settings} search={search} onSearch={setSearch}
      filter={filter} onFilter={setFilter} selectedHex={selectedHex} onSelect={select} searchRef={searchRef} />
    {selectedHex && <Inspector key={selectedHex} hex={selectedHex} aircraft={feed.aircraft.find(ac => ac.hex === selectedHex)} settings={settings} onClose={() => setSelectedHex(null)} />}
    <AtcPlayer />
    {modal && <SettingsModal settings={settings} onSave={value => { setSettings(value); setModal(false); }} onClose={() => setModal(false)} />}
  </main>;
}
