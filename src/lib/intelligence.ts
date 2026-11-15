export interface Airframe {
  typeDescription: string | null;
  icaoType: string | null;
  manufacturer: string | null;
  registration: string | null;
  owner: string | null;
  operatorCode: string | null;
  ownerCountry: string | null;
}
export interface Airport {
  icao: string | null;
  iata: string | null;
  name: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
}
export interface FlightRoute {
  callsign: string;
  airline: {
    name: string | null;
    icao: string | null;
    iata: string | null;
  } | null;
  origin: Airport | null;
  destination: Airport | null;
}
const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
function airport(value: unknown): Airport | null {
  const data = record(value);
  if (!data) return null;
  const lat = number(data.latitude),
    lon = number(data.longitude);
  return {
    icao: string(data.icao_code),
    iata: string(data.iata_code),
    name: string(data.name),
    city: string(data.municipality),
    country: string(data.country_name),
    lat: lat !== null && Math.abs(lat) <= 90 ? lat : null,
    lon: lon !== null && Math.abs(lon) <= 180 ? lon : null,
  };
}
export function parseAirframe(value: unknown): Airframe | null {
  const data = record(value);
  if (!data) return null;
  return {
    typeDescription: string(data.type),
    icaoType: string(data.icao_type),
    manufacturer: string(data.manufacturer),
    registration: string(data.registration),
    owner: string(data.registered_owner),
    operatorCode: string(data.registered_owner_operator_flag_code),
    ownerCountry: string(data.registered_owner_country_name),
  };
}
export function parseFlightRoute(value: unknown): FlightRoute | null {
  const data = record(value);
  if (!data || !string(data.callsign)) return null;
  const airline = record(data.airline);
  return {
    callsign: string(data.callsign)!,
    airline: airline
      ? {
          name: string(airline.name),
          icao: string(airline.icao),
          iata: string(airline.iata),
        }
      : null,
    origin: airport(data.origin),
    destination: airport(data.destination),
  };
}
export function positionSourceName(source: string | null): string | null {
  if (source === null) return null;
  if (source.startsWith("adsb")) return "ADS-B";
  if (source.startsWith("tisb")) return "TIS-B";
  if (source.startsWith("adsr")) return "ADS-R";
  if (source === "mlat") return "MLAT";
  if (source === "mode_s") return "Mode S";
  if (source === "other") return "Other";
  return source.replaceAll("_", " ").toUpperCase();
}
