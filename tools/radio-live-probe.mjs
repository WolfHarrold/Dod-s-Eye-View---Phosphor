#!/usr/bin/env node
// Live check of the radio finder against the real Radio Browser directory.
// Runs the app's own /api/radio/stations middleware, measures each directory
// query, then opens a sample of streams the way an <audio> element would.
//
//   node tools/radio-live-probe.mjs [--streams 60] [--anchor lat,lon] [--out file.json]
//
// --out also lists every station the Genre tab files under OTHER.

import { writeFile } from 'node:fs/promises';
import { createRadioProxyMiddleware } from '../server/providers/radio/catalog.js';
import { RADIO_RESPONSE_MAX_BYTES } from '../server/providers/radio/constants.js';
import { normalizeRadioBrowserStation } from '../src/sources/radioBrowser.js';
import {
  distanceKm,
  distanceBand,
  stationGenre,
  pickLuckyStation,
} from '../src/ui/skins/skinRadio.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const streamSample = Number(arg('streams', 60));
const [anchorLat, anchorLon] = String(arg('anchor', '40.71,-74.0'))
  .split(',')
  .map(Number);
const anchor = { lat: anchorLat, lon: anchorLon };
const outPath = arg('out', null);
const report = { startedAt: new Date().toISOString(), anchor };
const log = (...parts) => console.log(...parts);

function callMiddleware(middleware, method, url) {
  return new Promise((resolve) => {
    const res = {
      status: 0,
      headers: {},
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers || {};
      },
      end(body) {
        resolve({ status: this.status, body: body ? String(body) : '' });
      },
    };
    middleware({ method, url }, res);
  });
}

// 1. Raw directory queries, sized against the proxy's byte cap.
async function rawQueries() {
  const tags = [
    null,
    'news',
    'talk',
    'weather',
    'emergency',
    'scanner',
    'aviation',
    'marine',
    'traffic',
  ];
  const rows = [];
  for (const [index, tag] of tags.entries()) {
    const params = new URLSearchParams({
      has_geo_info: 'true',
      is_https: 'true',
      hidebroken: 'true',
      order: 'clickcount',
      reverse: 'true',
      limit: index === 0 ? '1800' : '220',
    });
    if (tag) params.set('tag', tag);
    const started = Date.now();
    try {
      const response = await fetch(
        `https://de1.api.radio-browser.info/json/stations/search?${params}`,
        { headers: { 'User-Agent': 'GodsEyeView/1.0 (live probe)' } },
      );
      const text = await response.text();
      const bytes = Buffer.byteLength(text);
      const parsed = JSON.parse(text);
      const accepted = parsed.map(normalizeRadioBrowserStation).filter(Boolean);
      const rejectReasons = {};
      for (const raw of parsed) {
        if (normalizeRadioBrowserStation(raw)) continue;
        const reason =
          Number(raw.lastcheckok) !== 1
            ? 'lastcheckok'
            : Number(raw.hls) === 1
              ? 'hls'
              : !/^(?:MP3|AAC(?:\+|-LC|-HE)?|HE-AAC)$/i.test(raw.codec || '')
                ? `codec:${raw.codec || 'none'}`
                : !String(raw.url_resolved || raw.url).startsWith('https:')
                  ? 'not-https'
                  : 'other';
        rejectReasons[reason] = (rejectReasons[reason] || 0) + 1;
      }
      rows.push({
        tag: tag || '(broad)',
        status: response.status,
        rows: parsed.length,
        accepted: accepted.length,
        bytes,
        overByteCap: bytes > RADIO_RESPONSE_MAX_BYTES,
        ms: Date.now() - started,
        rejectReasons,
      });
    } catch (error) {
      rows.push({ tag: tag || '(broad)', error: String(error?.message || error) });
    }
  }
  return rows;
}

// 2. Open a stream like an <audio> element: follow redirects, note any hop to
// plain http (blocked as mixed content on an https page), read a few KB.
async function probeStream(url) {
  const hops = [];
  let current = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    for (let hop = 0; hop < 6; hop += 1) {
      hops.push(current);
      if (!current.startsWith('https:'))
        return { result: 'redirects-to-http', hops };
      const response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'Icy-MetaData': '0', 'User-Agent': 'Mozilla/5.0' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) return { result: 'redirect-without-location', hops };
        current = new URL(location, current).href;
        continue;
      }
      const type = response.headers.get('content-type') || '';
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return { result: `http-${response.status}`, type, hops };
      }
      const reader = response.body.getReader();
      let bytes = 0;
      const first = Date.now();
      while (bytes < 16_384 && Date.now() - first < 6000) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
      }
      await reader.cancel().catch(() => {});
      if (/text\/html|mpegurl|x-scpls|audio\/x-mpegurl/i.test(type))
        return { result: 'not-audio', type, bytes, hops };
      if (bytes < 2048) return { result: 'stalled', type, bytes, hops };
      return { result: 'ok', type, bytes, hops };
    }
    return { result: 'too-many-redirects', hops };
  } catch (error) {
    return {
      result: error?.name === 'AbortError' ? 'timeout' : 'network-error',
      error: String(error?.cause?.code || error?.message || error),
      hops,
    };
  } finally {
    clearTimeout(timer);
  }
}

log('— Raw directory queries');
report.queries = await rawQueries();
console.table(
  report.queries.map(({ rejectReasons, ...row }) => row),
);

log('— App catalog through /api/radio/stations');
const middleware = createRadioProxyMiddleware();
const started = Date.now();
const response = await callMiddleware(middleware, 'GET', '/stations');
const catalog = JSON.parse(response.body || '{}');
report.catalog = {
  status: response.status,
  ms: Date.now() - started,
  stations: catalog.stations?.length ?? 0,
  degraded: catalog.degraded,
  degradedReason: catalog.degradedReason,
  coverage: catalog.coverage,
  acceptedGeneration: catalog.acceptedGeneration,
  error: catalog.error,
};
log(report.catalog);
const stations = catalog.stations || [];

if (stations.length) {
  log('— Finder views from', anchor);
  const ranked = stations
    .map((station) => ({ station, km: distanceKm(anchor, station) }))
    .sort((a, b) => a.km - b.km);
  const bands = {};
  const genres = {};
  const countries = {};
  for (const { station, km } of ranked) {
    const band = distanceBand(km);
    bands[band] = (bands[band] || 0) + 1;
    const genre = stationGenre(station) || '(none)';
    genres[genre] = (genres[genre] || 0) + 1;
    const country = station.country || '(unknown)';
    countries[country] = (countries[country] || 0) + 1;
  }
  const top = (map, n) =>
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);
  report.finder = {
    nearest: ranked.slice(0, 10).map(({ station, km }) => ({
      name: station.name,
      km: Math.round(km),
      genre: stationGenre(station),
    })),
    bands,
    genreGroups: Object.keys(genres).length,
    singletonGenres: Object.values(genres).filter((n) => n === 1).length,
    topGenres: top(genres, 15),
    countryGroups: Object.keys(countries).length,
    topCountries: top(countries, 10),
    lucky: pickLuckyStation(ranked, new Set())?.station?.name,
    sameCoords: (() => {
      const seen = {};
      for (const { station } of ranked) {
        const key = `${station.lat},${station.lon}`;
        seen[key] = (seen[key] || 0) + 1;
      }
      return top(seen, 5);
    })(),
  };
  report.untagged = stations
    .filter((station) => !stationGenre(station))
    .map(({ id, name, tags, homepage, country, languages }) => ({
      id,
      name,
      tags,
      homepage,
      country,
      languages,
    }));
  log(JSON.stringify(report.finder, null, 2));
  log(`${report.untagged.length} stations have no genre`);

  log(`— Streams: nearest ${streamSample / 2} plus ${streamSample / 2} spread`);
  const nearest = ranked.slice(0, streamSample / 2).map((entry) => entry.station);
  const step = Math.max(1, Math.floor(stations.length / (streamSample / 2)));
  const spread = stations.filter((_, index) => index % step === 0);
  const sample = [...new Map([...nearest, ...spread].map((s) => [s.id, s])).values()].slice(0, streamSample);
  const results = [];
  for (let index = 0; index < sample.length; index += 8) {
    const batch = sample.slice(index, index + 8);
    results.push(
      ...(await Promise.all(
        batch.map(async (station) => ({
          name: station.name,
          codec: station.codec,
          url: station.streamUrl,
          ...(await probeStream(station.streamUrl)),
        })),
      )),
    );
  }
  const tally = {};
  for (const row of results) tally[row.result] = (tally[row.result] || 0) + 1;
  report.streams = { tally, failures: results.filter((r) => r.result !== 'ok'), types: {} };
  for (const row of results)
    if (row.type) report.streams.types[row.type] = (report.streams.types[row.type] || 0) + 1;
  log(tally);
  console.table(
    report.streams.failures.map(({ name, result, type, error }) => ({ name, result, type, error })),
  );
}

report.finishedAt = new Date().toISOString();
if (outPath) {
  await writeFile(outPath, JSON.stringify(report, null, 2));
  log('Wrote', outPath);
}
