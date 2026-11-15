"use client";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  Map as MapLibreMap,
  setWorkerUrl,
  type GeoJSONSource,
  type Map as Radar,
  type RasterTileSource,
} from "maplibre-gl";
import type { FeatureCollection, Feature, Point, LineString } from "geojson";
import type {
  Aircraft,
  MapViewport,
  Settings,
  LayerSettings,
  FeedMode,
} from "@/lib/types";
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
import type { FlightRoute } from "@/lib/intelligence";
import type { MapCamera } from "@/lib/mapState";
import { aircraftPaths } from "@/lib/aircraftIcons";
import { addMapLayers } from "@/lib/mapLayers";
import {
  nightPolygon,
  receiverRangeLine,
  routeFeatures,
  trailGradient,
  unwrapLine,
  aircraftPosition,
} from "@/lib/mapGeometry";
import { useWeatherRadar } from "@/hooks/useWeatherRadar";

interface Props {
  aircraft: Aircraft[];
  lastUpdate: number | null;
  trailsRef: MutableRefObject<Trails>;
  home: { lat: number; lon: number };
  selectedHex: string | null;
  onSelect: (hex: string | null) => void;
  layers: LayerSettings;
  mode: FeedMode;
  initialCamera: MapCamera | null;
  selectedAircraft: Aircraft | null;
  selectedLastUpdate: number | null;
  selectedRoute: FlightRoute | null;
  receiverSectors: number[];
  units: Settings["units"];
  onViewportChange: (viewport: MapViewport) => void;
  watchlist: ReadonlySet<string>;
}
async function silhouette(path: string): Promise<ImageData> {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 64 64">' +
    '<path fill="white" stroke="white" stroke-width="0.7" stroke-linejoin="round" d="' +
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
  const previousCamera = useRef(props.initialCamera);
  const focusedSelection = useRef<string | null>(null);
  const weather = useWeatherRadar(props.layers.weatherRadar);
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
      center: [
        initial.initialCamera?.lon ?? initial.home.lon,
        initial.initialCamera?.lat ?? initial.home.lat,
      ],
      zoom: initial.initialCamera?.zoom ?? 8,
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
        Object.entries(aircraftPaths).map(
          async ([name, path]) => [name, await silhouette(path)] as const,
        ),
      );
      if (disposed) return;
      for (const [name, data] of icons)
        map.addImage(name, data, { sdf: true, pixelRatio: 2 });
      for (const id of ["aircraft", "trails", "rings", "ring-labels", "home"])
        map.addSource(id, { type: "geojson", data: collection() });
      addMapLayers(map);
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
        id: "ground-aircraft",
        type: "symbol",
        source: "aircraft",
        filter: ["==", ["get", "ground"], true],
        layout: {
          "icon-image": ["get", "kind"],
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            0.3,
            10,
            0.42,
            15,
            0.55,
          ],
          "icon-rotate": ["get", "track"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": false,
          "icon-padding": 2,
          "symbol-sort-key": [
            "case",
            ["get", "selected"],
            -2,
            ["get", "watched"],
            -1,
            0,
          ],
        },
        paint: {
          "icon-color": ["get", "color"],
          "icon-halo-color": palette.canvas,
          "icon-halo-width": 1,
        },
      });
      map.addLayer({
        id: "aircraft",
        type: "symbol",
        source: "aircraft",
        filter: ["!=", ["get", "ground"], true],
        layout: {
          "icon-image": ["get", "kind"],
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            0.32,
            10,
            0.48,
            15,
            0.6,
          ],
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
            [
              "case",
              ["all", ["get", "selected"], ["!", ["get", "ground"]]],
              ["get", "label"],
              "",
            ],
            7,
            ["case", ["get", "ground"], "", ["get", "label"]],
            13,
            ["get", "label"],
          ],
          "text-font": ["Open Sans Regular"],
          "text-size": 10,
          "text-anchor": "top",
          "text-offset": [0, 1.8],
          "text-allow-overlap": false,
          "text-ignore-placement": false,
          "text-padding": 4,
          "symbol-sort-key": [
            "case",
            ["get", "selected"],
            -2,
            ["get", "ground"],
            1,
            0,
          ],
        },
        paint: {
          "text-color": palette.muted,
          "text-halo-color": palette.canvas,
          "text-halo-width": 2,
        },
      });
      map.on("click", (event) => {
        const hit = map.queryRenderedFeatures(event.point, {
          layers: ["aircraft", "ground-aircraft"],
        })[0];
        latest.current.onSelect(hit ? String(hit.properties.hex) : null);
      });
      map.moveLayer("route-airports");
      map.moveLayer("route-airport-labels");
      for (const layer of ["aircraft", "ground-aircraft"]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }
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
      let routeTick = 0;
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
            ground:
              ac.alt_baro === "ground" || ac.category?.startsWith("C") === true,
          });
          aircraftData.features.push(feature);
          if (
            rebuildTrails &&
            current.layers.allTrails &&
            ac.hex !== current.selectedHex
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
          const selected = current.selectedAircraft;
          const selectedPosition = selected
            ? aircraftPosition(selected, current.selectedLastUpdate, now)
            : null;
          const points =
            selected && selectedPosition
              ? [
                  ...(current.trailsRef.current.get(selected.hex) ?? []),
                  {
                    lat: selectedPosition[1],
                    lon: selectedPosition[0],
                    alt: selected.alt_baro,
                    time: now,
                  },
                ]
              : [];
          (map.getSource("selected-trail") as GeoJSONSource).setData(
            points.length >= 2
              ? {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "LineString",
                    coordinates: unwrapLine(
                      points.map((point) => [point.lon, point.lat]),
                    ),
                  },
                }
              : collection(),
          );
          map.setPaintProperty(
            "selected-trail",
            "line-gradient",
            trailGradient(points),
          );
          trailTick = now;
        }
        if (now - routeTick > 1000) {
          const ac = current.selectedAircraft;
          const point = ac
            ? aircraftPosition(ac, current.selectedLastUpdate, now)
            : null;
          const position = point ? { lon: point[0], lat: point[1] } : null;
          (map.getSource("route") as GeoJSONSource).setData(
            routeFeatures(current.selectedRoute, position),
          );
          routeTick = now;
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
    if (focusedSelection.current !== props.selectedHex)
      focusedSelection.current = null;
    const ac = props.selectedAircraft;
    if (
      ready &&
      map &&
      ac &&
      ac.lat !== null &&
      ac.lon !== null &&
      focusedSelection.current !== props.selectedHex &&
      !map.getBounds().contains([ac.lon, ac.lat])
    ) {
      map.easeTo({ center: [ac.lon, ac.lat], duration: 800 });
    }
    if (ac && ready) focusedSelection.current = props.selectedHex;
  }, [props.selectedHex, props.selectedAircraft, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (
      ready &&
      map &&
      props.initialCamera &&
      previousCamera.current !== props.initialCamera
    ) {
      map.jumpTo({
        center: [props.initialCamera.lon, props.initialCamera.lat],
        zoom: props.initialCamera.zoom,
      });
      previousCamera.current = props.initialCamera;
    }
  }, [ready, props.initialCamera]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const id of ["rings", "ring-labels"])
      map.setLayoutProperty(
        id,
        "visibility",
        props.layers.rangeRings ? "visible" : "none",
      );
    map.setLayoutProperty(
      "terminator",
      "visibility",
      props.layers.terminator ? "visible" : "none",
    );
    map.setLayoutProperty(
      "receiver-range",
      "visibility",
      props.layers.receiverRange && props.mode !== "public"
        ? "visible"
        : "none",
    );
    if (map.getLayer("weather"))
      map.setLayoutProperty(
        "weather",
        "visibility",
        props.layers.weatherRadar ? "visible" : "none",
      );
  }, [ready, props.layers, props.mode]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !props.layers.terminator) return;
    const refresh = () =>
      (map.getSource("terminator") as GeoJSONSource).setData(
        nightPolygon(new Date()),
      );
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [ready, props.layers.terminator]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const coordinates = receiverRangeLine(
      { lat: props.home.lat, lon: props.home.lon },
      props.receiverSectors,
    );
    (map.getSource("receiver-range") as GeoJSONSource).setData(
      coordinates.length
        ? {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates },
          }
        : collection(),
    );
  }, [ready, props.home.lat, props.home.lon, props.receiverSectors]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !weather.tiles || !props.layers.weatherRadar) return;
    const source = map.getSource("weather") as RasterTileSource | undefined;
    if (source) source.setTiles([weather.tiles]);
    else {
      map.addSource("weather", {
        type: "raster",
        tiles: [weather.tiles],
        tileSize: 256,
        maxzoom: 7,
        attribution:
          '<a href="https://www.rainviewer.com" target="_blank" rel="noreferrer">RainViewer</a>',
      });
      map.addLayer(
        {
          id: "weather",
          type: "raster",
          source: "weather",
          paint: { "raster-opacity": 0.35, "raster-fade-duration": 350 },
        },
        "terminator",
      );
    }
  }, [ready, weather.tiles, props.layers.weatherRadar]);
  return (
    <>
      <div
        ref={container}
        className="absolute inset-0"
        aria-label="Live aircraft radar map"
      />
      {(error || (weather.error && props.layers.weatherRadar)) && (
        <div className="absolute bottom-8 left-3 text-xs text-sand">
          {error ?? "Weather radar unavailable"}
        </div>
      )}
    </>
  );
}
