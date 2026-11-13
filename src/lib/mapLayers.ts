import type { Map } from "maplibre-gl";
import palette from "./palette.json";
const empty = () => ({ type: "FeatureCollection" as const, features: [] });
export function addMapLayers(map: Map) {
  for (const id of ["route", "receiver-range", "terminator"])
    map.addSource(id, { type: "geojson", data: empty() });
  map.addSource("selected-trail", {
    type: "geojson",
    data: empty(),
    lineMetrics: true,
  });
  const label = map
    .getStyle()
    .layers.find((layer) => layer.type === "symbol")?.id;
  map.addLayer(
    {
      id: "terminator",
      type: "fill",
      source: "terminator",
      paint: { "fill-color": palette.powder, "fill-opacity": 0.075 },
    },
    label,
  );
  map.addLayer({
    id: "receiver-range",
    type: "line",
    source: "receiver-range",
    paint: {
      "line-color": palette.sage,
      "line-opacity": 0.55,
      "line-width": 1.25,
    },
  });
  map.addLayer({
    id: "route-casing",
    type: "line",
    source: "route",
    filter: ["!=", ["get", "leg"], "airport"],
    paint: {
      "line-color": palette.canvas,
      "line-width": 7,
      "line-opacity": 0.8,
    },
  });
  map.addLayer({
    id: "route-flown",
    type: "line",
    source: "route",
    filter: ["==", ["get", "leg"], "flown"],
    paint: {
      "line-color": palette.powder,
      "line-width": 3,
      "line-opacity": 0.95,
    },
  });
  map.addLayer({
    id: "route-remaining",
    type: "line",
    source: "route",
    filter: ["==", ["get", "leg"], "remaining"],
    paint: {
      "line-color": palette.primary,
      "line-width": 3,
      "line-opacity": 0.85,
      "line-dasharray": [3, 2],
    },
  });
  map.addLayer({
    id: "route-airports",
    type: "circle",
    source: "route",
    filter: ["==", ["get", "leg"], "airport"],
    paint: {
      "circle-radius": 4,
      "circle-color": palette.surface,
      "circle-stroke-color": palette.primary,
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: "route-airport-labels",
    type: "symbol",
    source: "route",
    filter: ["==", ["get", "leg"], "airport"],
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Open Sans Regular"],
      "text-size": 12,
      "text-anchor": "bottom",
      "text-offset": [0, -0.9],
      "text-allow-overlap": true,
      "text-ignore-placement": false,
    },
    paint: {
      "text-color": palette.primary,
      "text-halo-color": palette.canvas,
      "text-halo-width": 2,
    },
  });
  map.addLayer({
    id: "selected-trail-casing",
    type: "line",
    source: "selected-trail",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": palette.canvas,
      "line-width": 5,
      "line-opacity": 0.7,
    },
  });
  map.addLayer({
    id: "selected-trail",
    type: "line",
    source: "selected-trail",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-gradient": [
        "interpolate",
        ["linear"],
        ["line-progress"],
        0,
        palette.ground,
        1,
        palette.ground,
      ],
      "line-width": 2.5,
      "line-opacity": 0.85,
    },
  });
}
