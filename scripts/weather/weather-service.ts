import { createLogger } from "../utils/logger";

const log = createLogger("WeatherService");

// ---------------------------------------------------------------------------
// CONFIG - set these to your location.
// ---------------------------------------------------------------------------
const LATITUDE = 51.4779;   // CHANGE ME - Greenwich Observatory placeholder
const LONGITUDE = -0.0015;
const TEMPERATURE_UNIT = "fahrenheit"; // "fahrenheit" | "celsius"
const REFRESH_MS = 15 * 60 * 1000;

// Open-Meteo needs no API key and no account. `timezone=auto` makes it return
// local times and today's high/low for the requested coordinates, which avoids
// doing any timezone maths on the device.
const ENDPOINT =
  "https://api.open-meteo.com/v1/forecast" +
  `?latitude=${LATITUDE}&longitude=${LONGITUDE}` +
  "&current=temperature_2m,weather_code,is_day" +
  "&daily=weather_code,temperature_2m_max,temperature_2m_min" +
  `&temperature_unit=${TEMPERATURE_UNIT}&timezone=auto&forecast_days=1`;

export type WeatherPayload = {
  schema: 1;
  temp: number;
  code: number;
  isDay: 0 | 1;
  high: number;
  low: number;
  unit: "F" | "C";
  /** UTC offset in seconds for the weather LOCATION, straight from Open-Meteo
   *  (timezone=auto). The Car Thing's own system clock runs in UTC - Nocturne's
   *  UI only looks right because it pulls local time from the Pi over RPC. So
   *  the overlay cannot use new Date() for anything user-visible; it derives
   *  local time from this. Also handles DST, since Open-Meteo recomputes it. */
  utcOffsetSeconds: number;
  /** Epoch ms when this reading was actually fetched, NOT when it was sent.
   *  The overlay uses it to mark data stale rather than showing a wrong
   *  temperature confidently. Re-broadcasts keep the original timestamp. */
  fetchedAt: number;
};

export class WeatherService {
  private last: WeatherPayload | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly broadcast: (topic: string, data: unknown) => Promise<void>) {}

  /** Last good reading, for answering a `weather.get` RPC. */
  get current(): WeatherPayload | null {
    return this.last;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), REFRESH_MS);
    log.info(`Weather broadcasting every ${REFRESH_MS / 60000} min for ${LATITUDE},${LONGITUDE}`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    try {
      const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j: any = await res.json();

      // Validate before caching. A malformed response that parses as JSON would
      // otherwise poison the cache and be re-broadcast for hours.
      const temp = j?.current?.temperature_2m;
      const high = j?.daily?.temperature_2m_max?.[0];
      const low = j?.daily?.temperature_2m_min?.[0];
      if (typeof temp !== "number" || typeof high !== "number" || typeof low !== "number") {
        throw new Error("response missing expected fields");
      }

      this.last = {
        schema: 1,
        temp,
        code: Number(j.current.weather_code ?? 0),
        isDay: j.current.is_day === 0 ? 0 : 1,
        high,
        low,
        unit: TEMPERATURE_UNIT === "celsius" ? "C" : "F",
        utcOffsetSeconds: Number(j.utc_offset_seconds ?? 0),
        fetchedAt: Date.now(),
      };
      log.info(`Weather ${Math.round(temp)}° code=${this.last.code} hi=${Math.round(high)} lo=${Math.round(low)}`);
    } catch (err: any) {
      // Deliberately do not clear the cache. A dropped poll should leave the
      // last good reading on screen, marked stale - never a blank panel.
      log.warn(`Weather fetch failed (${err?.message ?? err}); keeping last good reading`);
    }

    if (this.last) {
      try {
        await this.broadcast("weather.update", this.last);
      } catch (err: any) {
        log.warn(`Weather broadcast failed: ${err?.message ?? err}`);
      }
    }
  }
}
