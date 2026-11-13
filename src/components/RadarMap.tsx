"use client";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  Map as MapLibreMap,
  setWorkerUrl,
  type GeoJSONSource,
  type Map as Radar,
} from "maplibre-gl";
import type { FeatureCollection, Feature, Point, LineString } from "geojson";
import type { Aircraft, MapViewport, Settings } from "@/lib/types";
import type { Trails } from "@/hooks/useAircraftFeed";
import {
  altitudeColor,
  EMERGENCY_COLOR,
  iconKind,
  isEmergency,
} from "@/lib/aircraftStyle";
import { circlePolygon, deadReckon, destinationPoint } from "@/lib/geo";
import palette from "@/lib/palette.json";
import { viewportRadius } from "@/lib/feeds";

interface Props {
  aircraft: Aircraft[];
  lastUpdate: number | null;
  trailsRef: MutableRefObject<Trails>;
  home: { lat: number; lon: number };
  selectedHex: string | null;
  onSelect: (hex: string | null) => void;
  showAllTrails: boolean;
  units: Settings["units"];
  onViewportChange: (viewport: MapViewport) => void;
  watchlist: ReadonlySet<string>;
}
const paths = {
  jet: "M32 3 Q35 3 35 12 L35 25 L56 40 L56 45 L35 37 L35 52 L43 58 L43 61 L32 57 L21 61 L21 58 L29 52 L29 37 L8 45 L8 40 L29 25 L29 12 Q29 3 32 3Z",
  heavy:
    "M32 2 Q36 2 36 12 L36 26 L61 38 L61 44 L36 37 L36 53 L46 58 L46 62 L32 58 L18 62 L18 58 L28 53 L28 37 L3 44 L3 38 L28 26 L28 12 Q28 2 32 2Z M10 35 H14 V46 H10Z M20 30 H24 V42 H20Z M40 30 H44 V42 H40Z M50 35 H54 V46 H50Z",
  light:
    "M30 8 H34 V22 L57 27 V33 L34 31 V51 L43 55 V59 L32 57 L21 59 V55 L30 51 V31 L7 33 V27 L30 22Z M18 5 H46 V8 H18Z M31 3 H33 V14 H31Z",
  helicopter:
    "M32 17 Q40 17 40 30 Q40 38 35 40 L34 54 L44 57 V60 H20 V57 L30 54 L29 40 Q24 38 24 30 Q24 17 32 17Z M9 29 H55 V32 H9Z M31 6 H34 V52 H31Z M10 13 L52 49 L54 46 L12 10Z M11 48 L53 12 L51 9 L9 45Z",
  military:
    "M32 2 L37 24 L59 48 L59 53 L38 45 L39 54 L46 61 L32 57 L18 61 L25 54 L26 45 L5 53 L5 48 L27 24Z",
};
async function silhouette(path: string, rotor: boolean): Promise<ImageData> {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 64 64">' +
    (rotor
      ? '<circle cx="32" cy="30" r="25" fill="none" stroke="white" stroke-width="1.5"/>'
      : "") +
    '<path fill="white" d="' +
    path +
    '"/></svg>';
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d")!;
    context.drawImage(img, 0, 0);
    return context.getImageData(0, 0, 128, 128);
  } finally {
    URL.revokeObjectURL(url);
  }
}
const collection = (): FeatureCollection => ({
  type: "FeatureCollection",
  features: [],
});
export default function RadarMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Radar | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousHome = useRef(props.home);
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let frame = 0;
    const initial = latest.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    setWorkerUrl("/maplibre-gl-worker.mjs");
    const map = new MapLibreMap({
      container: container.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [initial.home.lon, initial.home.lat],
      zoom: 8,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      maxPitch: 0,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;
    const reportViewport = () => {
      const center = {
        lat: map.getCenter().lat,
        lon: ((((map.getCenter().lng + 180) % 360) + 360) % 360) - 180,
      };
      const currentBounds = map.getBounds();
      const bounds = {
        west: currentBounds.getWest(),
        east: currentBounds.getEast(),
        south: currentBounds.getSouth(),
        north: currentBounds.getNorth(),
      };
      latest.current.onViewportChange({
        center,
        bounds,
        zoom: map.getZoom(),
        radiusNm: viewportRadius(center, bounds),
      });
    };
    map.on("moveend", reportViewport);
    map.on("resize", reportViewport);
    map.on("error", () => {
      if (!disposed) setError("Map resource unavailable");
    });
    map.on("load", async () => {
      reportViewport();
      for (const layer of map.getStyle().layers) {
        if (layer.type === "symbol")
          map.setPaintProperty(layer.id, "text-opacity", 0.65);
        if (layer.type === "line" && /road|bridge|tunnel/.test(layer.id))
          map.setPaintProperty(layer.id, "line-opacity", 0.6);
      }
      const icons = await Promise.all(
        Object.entries(paths).map(
          async ([name, path]) =>
            [name, await silhouette(path, name === "helicopter")] as const,
        ),
      );
      if (disposed) return;
      for (const [name, data] of icons)
        map.addImage(name, data, { sdf: true, pixelRatio: 2 });
      for (const id of ["aircraft", "trails", "rings", "ring-labels", "home"])
        map.addSource(id, { type: "geojson", data: collection() });
      map.addLayer({
        id: "rings",
        type: "line",
        source: "rings",
        paint: {
          "line-color": palette.muted,
          "line-opacity": 0.22,
          "line-width": 1,
          "line-dasharray": [3, 5],
        },
      });
      map.addLayer({
        id: "ring-labels",
        type: "symbol",
        source: "ring-labels",
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Regular"],
          "text-size": 11,
          "text-offset": [0, -0.8],
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": palette.subtle,
          "text-halo-color": palette.canvas,
          "text-halo-width": 2,
        },
      });
      map.addLayer({
        id: "home",
        type: "circle",
        source: "home",
        paint: {
          "circle-radius": 4,
          "circle-color": palette.primary,
          "circle-stroke-color": palette.canvas,
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "trails",
        type: "line",
        source: "trails",
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": ["get", "opacity"],
          "line-width": 2,
        },
      });
      map.addLayer({
        id: "emergency",
        type: "circle",
        source: "aircraft",
        filter: ["==", ["get", "emergency"], true],
        paint: {
          "circle-radius": 15,
          "circle-color": EMERGENCY_COLOR,
          "circle-opacity": 0.3,
        },
      });
      map.addLayer({
        id: "watchlist",
        type: "circle",
        source: "aircraft",
        filter: ["==", ["get", "watched"], true],
        paint: {
          "circle-radius": 24,
          "circle-color": palette.primary,
          "circle-opacity": 0.04,
          "circle-stroke-color": palette.primary,
          "circle-stroke-width": 2,
          "circle-stroke-opacity": 0.3,
          "circle-blur": 0.15,
        },
      });
      map.addLayer({
        id: "selection",
        type: "circle",
        source: "aircraft",
        filter: ["==", ["get", "selected"], true],
        paint: {
          "circle-radius": 19,
          "circle-color": palette.primary,
          "circle-opacity": 0,
          "circle-stroke-color": palette.primary,
          "circle-stroke-width": 1.5,
          "circle-stroke-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "aircraft",
        type: "symbol",
        source: "aircraft",
        layout: {
          "icon-image": ["get", "kind"],
          "icon-size": 0.48,
          "icon-rotate": ["get", "track"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
        },
        paint: {
          "icon-color": ["get", "color"],
          "icon-halo-color": palette.canvas,
          "icon-halo-width": 1,
        },
      });
      map.addLayer({
        id: "callsigns",
        type: "symbol",
        source: "aircraft",
        layout: {
          "text-field": [
            "step",
            ["zoom"],
            ["case", ["get", "selected"], ["get", "label"], ""],
            8,
            ["get", "label"],
          ],
          "text-font": ["Open Sans Regular"],
          "text-size": 10,
          "text-anchor": "top",
          "text-offset": [0, 1.8],
        },
        paint: {
          "text-color": palette.muted,
          "text-halo-color": palette.canvas,
          "text-halo-width": 2,
        },
      });
      map.on("click", (event) => {
        const hit = map.queryRenderedFeatures(event.point, {
          layers: ["aircraft"],
        })[0];
        latest.current.onSelect(hit ? String(hit.properties.hex) : null);
      });
      map.on("mouseenter", "aircraft", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "aircraft", () => {
        map.getCanvas().style.cursor = "";
      });
      const aircraftData: FeatureCollection<Point> = {
        type: "FeatureCollection",
        features: [],
      };
      const trailData: FeatureCollection<LineString> = {
        type: "FeatureCollection",
        features: [],
      };
      const featureCache = new Map<string, Feature<Point>>();
      let trailTick = 0;
      function animate() {
        if (disposed) return;
        const current = latest.current,
          now = Date.now();
        aircraftData.features.length = 0;
        const active = new Set<string>();
        const rebuildTrails = now - trailTick > 100;
        if (rebuildTrails) trailData.features.length = 0;
        for (const ac of current.aircraft) {
          if (ac.lat === null || ac.lon === null) continue;
          active.add(ac.hex);
          const elapsed = Math.min(
            60,
            Math.max(
              0,
              (now - (current.lastUpdate ?? now)) / 1000 + (ac.seen ?? 0),
            ),
          );
          const position =
            ac.alt_baro !== "ground" && ac.gs !== null && ac.track !== null
              ? deadReckon(ac.lat, ac.lon, ac.gs, ac.track, elapsed)
              : [ac.lon, ac.lat];
          let feature = featureCache.get(ac.hex);
          if (!feature) {
            feature = {
              type: "Feature",
              geometry: { type: "Point", coordinates: position },
              properties: {},
            };
            featureCache.set(ac.hex, feature);
          }
          feature.geometry.coordinates[0] = position[0];
          feature.geometry.coordinates[1] = position[1];
          Object.assign(feature.properties!, {
            hex: ac.hex,
            label: ac.flight || ac.hex,
            track: ac.track ?? 0,
            kind: iconKind(ac),
            color: isEmergency(ac.squawk)
              ? EMERGENCY_COLOR
              : altitudeColor(ac.alt_baro),
            selected: ac.hex === current.selectedHex,
            watched: current.watchlist.has(ac.hex),
            emergency: isEmergency(ac.squawk),
          });
          aircraftData.features.push(feature);
          if (
            rebuildTrails &&
            (current.showAllTrails || ac.hex === current.selectedHex)
          ) {
            const points = current.trailsRef.current.get(ac.hex) ?? [];
            for (let i = 0; i < points.length; i++) {
              const a = points[i],
                b = points[i + 1];
              trailData.features.push({
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: [[a.lon, a.lat], b ? [b.lon, b.lat] : position],
                },
                properties: {
                  color: altitudeColor(a.alt),
                  opacity: ac.hex === current.selectedHex ? 0.5 : 0.18,
                },
              });
            }
          }
        }
        for (const hex of featureCache.keys())
          if (!active.has(hex)) featureCache.delete(hex);
        (map.getSource("aircraft") as GeoJSONSource).setData(aircraftData);
        if (rebuildTrails) {
          (map.getSource("trails") as GeoJSONSource).setData(trailData);
          trailTick = now;
        }
        const pulse = reducedMotion.matches
          ? 0
          : (1 - Math.cos((now / 4000) * Math.PI * 2)) / 2;
        map.setPaintProperty("emergency", "circle-radius", 17 + pulse * 7);
        map.setPaintProperty(
          "emergency",
          "circle-opacity",
          0.08 + pulse * 0.08,
        );
        frame = requestAnimationFrame(animate);
      }
      setReady(true);
      frame = requestAnimationFrame(animate);
    });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const lat = props.home.lat,
      lon = props.home.lon;
    const rings = collection(),
      labels = collection();
    for (const radius of [10, 25, 50]) {
      rings.features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: circlePolygon(lat, lon, radius),
        },
        properties: {},
      });
      labels.features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: destinationPoint(lat, lon, 0, radius),
        },
        properties: {
          label:
            props.units === "metric"
              ? (radius * 1.852).toFixed(1) + " km"
              : radius + " nm",
        },
      });
    }
    (map.getSource("rings") as GeoJSONSource).setData(rings);
    (map.getSource("ring-labels") as GeoJSONSource).setData(labels);
    (map.getSource("home") as GeoJSONSource).setData({
      type: "Point",
      coordinates: [lon, lat],
    });
    if (previousHome.current.lat !== lat || previousHome.current.lon !== lon)
      map.easeTo({ center: [lon, lat], duration: 800 });
    previousHome.current = { lat, lon };
  }, [ready, props.home.lat, props.home.lon, props.units]);
  useEffect(() => {
    const map = mapRef.current;
    const ac = latest.current.aircraft.find(
      (ac) => ac.hex === props.selectedHex,
    );
    if (
      ready &&
      map &&
      ac &&
      ac.lat !== null &&
      ac.lon !== null &&
      !map.getBounds().contains([ac.lon, ac.lat])
    ) {
      map.easeTo({ center: [ac.lon, ac.lat], duration: 800 });
    }
  }, [props.selectedHex, ready]);
  return (
    <>
      <div
        ref={container}
        className="absolute inset-0"
        aria-label="Live aircraft radar map"
      />
      {error && (
        <div className="absolute bottom-8 left-3 text-xs text-sand">
          {error}
        </div>
      )}
    </>
  );
}
