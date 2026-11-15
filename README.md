# vector1090

A dark-mode ADS-B radar and ATC audio dashboard. Version 1.2 combines public
coverage with a local receiver, without needing browser access to either upstream.

![Radar overview](docs/overview.png)

## Features

- Public adsb.lol, local readsb/tar1090, or Hybrid feeds. Local telemetry wins
  when both sources see an aircraft; either source can continue if the other fails.
- Debounced viewport tracking, shared server caches, request coalescing and 429
  cooldowns. Below zoom 5, global scope shows military and squawk 7700 traffic,
  **not every aircraft worldwide**.
- Search, filters, persistent watchlist and overhead aircraft picker.
- Intelligence drawer: credited photo carousel, airframe/operator information,
  extended telemetry and session altitude/speed history.
- Great-circle routes, altitude-colored selected trails, category silhouettes,
  interpolated positions and shareable camera/selection/filter URLs.
- Persistent layers: range rings, trails, day/night shading, RainViewer radar and
  a home-keyed receiver range plot with reset.
- Dismissible 7500/7600/7700 alerts.
- Icecast, authorized ibonav.aero and saved custom ATC streams, with airport-aware
  failover, bounded retries, volume and visualizer. No autoplay.
- Monochrome panels, pastel data colors and inertial scrolling with reduced-motion support.

![Aircraft drawer with route and credited photo](docs/aircraft.png)

Altitude colors: ground/unknown grey; below 5,000 ft sage; 5,000–9,999 ft sand;
10,000–24,999 ft blue; 25,000 ft and above lavender. Emergency traffic uses muted rose.

## Quickstart

With Docker and Compose:

```sh
git clone https://github.com/Reforge-OSS/vector1090.git
cd vector1090
cp .env.example .env
docker compose up -d --build
```

Open http://localhost:3000. Public mode needs no receiver or API key.
The image uses Node 22 Alpine, standalone output and a non-root user.
Credentials are supplied at runtime, not bundled into the image.

For development, use Node.js 22 (minimum 20):

```sh
npm ci
npm run dev
```

| Command                                   | Purpose                           |
| ----------------------------------------- | --------------------------------- |
| `npm run dev`                             | Development server                |
| `npm run build`                           | Standalone production build       |
| `npm run lint` / `npm run typecheck`      | ESLint / TypeScript               |
| `npm run format` / `npm run format:check` | Write / check Prettier formatting |
| `npm test`                                | Offline Vitest tests              |

For production outside Docker, build, copy `public` into
`.next/standalone/public` and `.next/static` into
`.next/standalone/.next/static`, then run `node .next/standalone/server.js`.
Docker performs these copies automatically. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Self-hosting on a Raspberry Pi with readsb/tar1090

Keep your existing readsb, tar1090 or ultrafeeder installation. Find its
`aircraft.json` request in the receiver map's browser Network tab, or try:

- `http://<pi>:8080/data/aircraft.json`
- `http://<pi>/tar1090/data/aircraft.json`

Check that it returns an `aircraft` array **from the machine running vector1090**:

```sh
curl http://192.168.1.20:8080/data/aircraft.json
```

Set these in `.env`, restart Compose, then select **Hybrid** in Settings and
set your home coordinates:

```dotenv
FEED_MODE=HYBRID
LOCAL_RECEIVER_URL=http://192.168.1.20:8080/data/aircraft.json
ALLOW_CLIENT_LOCAL_URL=false
```

Hybrid is recommended: your receiver supplies local telemetry while public queries
fill the rest of the map. Local mode avoids public requests entirely.
The server fetches the receiver; browser CORS setup is not needed.

Alternatively, add vector1090 alongside your existing readsb/ultrafeeder Compose
service on the same network. For an existing service named `ultrafeeder`:

```yaml
services:
  # Keep your existing ultrafeeder service and receiver configuration.
  vector1090:
    build: ./vector1090
    ports:
      - "3000:3000"
    restart: unless-stopped
    environment:
      FEED_MODE: HYBRID
      LOCAL_RECEIVER_URL: http://ultrafeeder:80/data/aircraft.json
      ALLOW_CLIENT_LOCAL_URL: "false"
```

Clone this repository into `./vector1090` beside that Compose file. Adjust the
service name, **internal** web port and path for your receiver.
For a receiver on the Docker host, use
`http://host.docker.internal:8080/data/aircraft.json`, not `localhost`.
Docker Desktop provides that name; on Linux enable the `extra_hosts` entry in
this repository's Compose file. The receiver must listen on a reachable interface.
The Node base image supports 64-bit ARM Pis; a 32-bit Pi build is not verified.

Receiver URLs are server-managed by default. `ALLOW_CLIENT_LOCAL_URL=true` allows
browser clients to request arbitrary HTTP(S) destinations reachable by the server,
including private addresses. Enable that only on trusted deployments.
There is no built-in authentication: protect private receivers and licensed streams
with your own access controls.

## ATC audio with RTLSDR-Airband + Icecast

Run RTLSDR-Airband and Icecast separately. Configure RTLSDR-Airband's Icecast output
with your host, source credentials and mount (for example, `/tower.mp3`), following
their documentation. Confirm that Icecast's `/status-json.xsl` lists the mount and
its audio plays in a browser. vector1090 is a listener, not an SDR decoder or source.

Uncomment and configure these in `.env`, then restart Compose:

```dotenv
ATC_ICECAST_URL=http://192.168.1.20:8000
ATC_ICECAST_AIRPORT=EGLL
ATC_ICECAST_LABELS={"/tower.mp3":{"name":"Tower","icao":"EGLL","iata":"LHR","city":"London","country":"United Kingdom","frequency":"118.500 MHz","type":"tower","lat":51.4706,"lon":-0.4619}}
```

Mount discovery supports Icecast's object and array source formats and caches for
60 seconds. Configured streams use a server-side streaming proxy. Labels are
optional; Icecast names/descriptions are used otherwise. Simple mappings such as
`{"/tower.mp3":"Tower"}` also work. `ATC_ICECAST_AIRPORT` accepts a default
ICAO or a JSON mount-to-ICAO mapping.

Airport codes group backup channels. Errors, stalls or about eight seconds without
playback progress trigger another online channel at that airport, preferring the
same service type. There are at most four total attempts with increasing delays.
Unknown-airport channels are not assumed to belong together.

Authorized ibonav.aero users can set `IBONAV_ATC_TOKEN` with the required
**ATC Broadcasts Access** role. Documented `access_token` authentication remains
server-side; credentials never reach the browser. Discovery caches for at least a
minute and respects Retry-After. Its channels include ibonav.aero attribution.

You can also save HTTP(S) URLs in the picker. These remain in that browser and are
checked on play. Custom streams need a browser-supported codec and HTTPS on HTTPS
deployments. Proxied streams have a measured visualizer; direct custom URLs may
show “meter unavailable.” Nothing preloads or plays until you press Play.

**LiveATC prohibits third-party use of its live streams.** They are not embedded
and their stream URLs are rejected. The fallback is an external search link only.
Check provider terms and local laws before receiving, recording, rebroadcasting or
sharing airband audio. Permission to listen is not necessarily permission to redistribute.

## Configuration

Compose reads `.env`; other deployments use environment variables or Next.js
environment files. These are **API defaults**, not remote browser preferences.
The browser initially uses Public mode and stores its own Settings; its explicit
mode, coordinates and radius override server defaults. Select Hybrid in Settings
even if `FEED_MODE=HYBRID` is set.

| Variable                  | Default                                                       | Purpose                                                                            |
| ------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `FEED_MODE`               | `public`                                                      | API default: `public`, `local`, `hybrid`; case-insensitive                         |
| `LOCAL_RECEIVER_URL`      | Unset                                                         | Primary server-managed aircraft.json URL; required for Hybrid's local source       |
| `LOCAL_AIRCRAFT_URL`      | Unset                                                         | Legacy alias if the primary name is empty                                          |
| `ALLOW_CLIENT_LOCAL_URL`  | `false`                                                       | Literal `true` enables URL overrides in Local mode; Hybrid uses the configured URL |
| `ADSB_API_BASE`           | `https://api.adsb.lol`                                        | Public API base                                                                    |
| `ADSB_API_KEY`            | Unset                                                         | Optional public API key                                                            |
| `HOME_LAT`                | `52.8311`                                                     | API default latitude                                                               |
| `HOME_LON`                | `-1.3281`                                                     | API default longitude                                                              |
| `HOME_RADIUS_NM`          | `50`                                                          | API default radius, clamped to 1–250 nm                                            |
| `PHOTO_USER_AGENT`        | `vector1090/1.0 (+https://github.com/Reforge-OSS/vector1090)` | Photo request identification override                                              |
| `ATC_ICECAST_URL`         | Unset                                                         | Icecast base; optional URL user/password become server-side Basic authentication   |
| `ATC_ICECAST_LABELS`      | Unset                                                         | JSON mount-to-name/metadata map                                                    |
| `ATC_ICECAST_AIRPORT`     | Unset                                                         | Default ICAO or JSON mount-to-ICAO map                                             |
| `IBONAV_ATC_TOKEN`        | Unset                                                         | Authorized ibonav credential; enables the provider                                 |
| `NODE_ENV`                | Docker: `production`                                          | Runtime mode                                                                       |
| `PORT`                    | `3000`                                                        | HTTP listener; Compose publishes 3000                                              |
| `HOSTNAME`                | Docker: `0.0.0.0`                                             | Standalone listener interface                                                      |
| `NEXT_TELEMETRY_DISABLED` | Docker: `1`                                                   | Disable Next.js telemetry                                                          |

Without receiver variables, the Local API falls back to
`http://localhost:8080/data/aircraft.json` inside the server/container;
Hybrid does not. Public/Hybrid polling defaults to 10 seconds (minimum 5);
Local defaults to 2 seconds (minimum 1). Viewport tracking defaults on and does
not apply in Local mode. Settings, watchlists, layers, custom channels and receiver
range history use localStorage.

## Controls, API and customization

Press `/` for search, `T` for trails, Space to pause/resume aircraft polling
(not audio), and Escape to close popovers/settings or clear selection.
Shortcuts do not interfere with typing. Shared selections appear once that
aircraft is in the configured feed; links do not query individual aircraft worldwide.
Mode/receiver changes clear old trails; pans preserve them until the next response.

- `GET /api/aircraft`: `mode`, `scope=area|global`, `lat`, `lon`, `radius`.
  Returns normalized aircraft, source statuses and timestamps. Public queries are
  rounded/bucketed and cached for 8 seconds; local queries for 1 second.
  `X-Cache` reports hits/coalescing/cooldowns. Rate limits may return stale data;
  Hybrid stays HTTP 200 when local data is available.
- `GET /api/config`: URL-policy/receiver-configured booleans, never URLs or secrets.
- `GET /api/photo/{hex}`: `photos` array and first-photo `photo` alias;
  successful/empty lookups cache one hour, failures are no-store.
- `GET /api/airframe/{hex}`, `GET /api/callsign/{callsign}`: adsbdb metadata;
  successful metadata caches 24 hours, upstream failures are no-store.
- `GET /api/atc/channels`: normalized channels, provider status and retry delay.
- `GET /api/atc/stream?id=…`: known configured mount, streamed without whole-body
  buffering. It is not an arbitrary-URL proxy.

Caches are in-memory per server process, not distributed. Coverage, routes,
status and imagery may be incomplete. **Not for navigation or operational use.**

Replace `public/logo.svg` for the mark/favicon; the adjacent wordmark is plain text
in `Logo.tsx`. The central palette is `src/lib/palette.json`. Source is in
`src/app`, `src/components`, `src/hooks`, `src/lib`; offline tests in `tests`.
The MapLibre worker is copied before dev/build and is not tracked.
Known dependency advisories remain; review them before public deployment.

## Data credits and license

- Aircraft: [adsb.lol](https://adsb.lol/), its feeders and your local receiver.
- Airframe/operator/routes: [adsbdb](https://www.adsbdb.com/).
- Photos: [Planespotters.net](https://www.planespotters.net/) and each credited
  photographer; image rights remain with their owners.
- Weather: [RainViewer](https://www.rainviewer.com/).
- Basemap: [CARTO](https://carto.com/attributions) and
  [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
- Optional ATC data/audio: [ibonav.aero](https://ibonav.aero/), subject to access
  permissions and attribution.
- Map rendering: [MapLibre](https://maplibre.org/).

MIT. See [LICENSE](LICENSE). Third-party data and media retain their own terms.
