import { t, msg, formatNumber } from '../../i18n/index.js';

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const titleCase = (text) =>
  String(text || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toLocaleUpperCase() + word.slice(1))
    .join(' ');

export function stationGenre(station) {
  const tag = (station?.tags || []).find((value) => value && value.length < 24);
  return tag ? titleCase(tag) : '';
}

export function distanceBand(km) {
  if (km < 50) return msg('NEAR YOU');
  if (km < 1000) return msg('IN YOUR REGION');
  if (km < 3000) return msg('FURTHER OUT');
  return msg('OVERSEAS');
}

export function formatDistance(km) {
  if (!Number.isFinite(km)) return '';
  return km < 1000
    ? t('{distance} km', { distance: formatNumber(Math.round(km)) })
    : t('{distance}k km', {
        distance: formatNumber(km / 1000, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      });
}

/**
 * Feeling Lucky: the nearest station not heard yet. When every station has
 * been heard it starts again from the nearest.
 * @returns {{station: object|null, wrapped: boolean}}
 */
export function pickLuckyStation(ranked, heard) {
  const next = ranked.find((entry) => !heard.has(entry.station.id));
  if (next) return { station: next.station, wrapped: false };
  return { station: ranked[0]?.station || null, wrapped: ranked.length > 0 };
}

/**
 * The top-bar radio: previous / play / next, a station display that opens
 * the finder (Near Me, Country, Genre and search), and Feeling Lucky.
 * Everything plays through the app's own radio layer.
 */
export function createSkinRadio({
  root,
  getRadio,
  ensureRadioEnabled,
  getAnchor,
  notices,
}) {
  const $ = (selector) => root.querySelector(selector);
  const prevBtn = $('[data-skin-radio-prev]');
  const playBtn = $('[data-skin-radio-play]');
  const nextBtn = $('[data-skin-radio-next]');
  const display = $('[data-skin-radio-display]');
  const nameEl = $('[data-skin-radio-name]');
  const metaEl = $('[data-skin-radio-meta]');
  const luckyBtn = $('[data-skin-radio-lucky]');
  const panel = $('[data-skin-radio-panel]');
  const search = $('[data-skin-radio-search]');
  const list = $('[data-skin-radio-list]');
  const tabs = [...root.querySelectorAll('[data-skin-radio-tab]')];
  let tab = 'near';
  let heard = new Set();
  let unsubscribe = null;
  let subscribedTo = null;
  let lastError = null;
  const abort = new AbortController();
  const on = (target, type, handler) =>
    target?.addEventListener(type, handler, { signal: abort.signal });

  const radio = () => getRadio();
  const state = () => radio()?.getRadioUIState?.() || null;

  function ranked() {
    const stations =
      radio()?.getRadioAcceptedCatalogSnapshot?.()?.stations || [];
    const anchor = getAnchor();
    return stations
      .filter(
        (station) =>
          Number.isFinite(station.lat) && Number.isFinite(station.lon),
      )
      .map((station) => ({
        station,
        km: anchor ? distanceKm(anchor, station) : NaN,
      }))
      .sort((a, b) => (a.km || 0) - (b.km || 0));
  }

  function place(station) {
    return [station.state, station.countryCode || station.country]
      .filter(Boolean)
      .join(', ');
  }

  function paint() {
    const current = state();
    const station = current?.selected || null;
    const playing = ['loading', 'playing', 'buffering'].includes(
      current?.audioState,
    );
    playBtn.setAttribute('aria-pressed', String(playing));
    playBtn.textContent = playing ? '■' : '▶';
    playBtn.setAttribute(
      'aria-label',
      playing ? t('Stop radio') : t('Play radio'),
    );
    if (station) {
      heard.add(station.id);
      nameEl.textContent = station.name;
      const anchor = getAnchor();
      metaEl.textContent = [
        place(station),
        stationGenre(station),
        anchor ? formatDistance(distanceKm(anchor, station)) : '',
      ]
        .filter(Boolean)
        .join(' · ');
    } else {
      nameEl.textContent = t('RADIO');
      metaEl.textContent = current?.enabled
        ? current.loading
          ? t('Loading stations…')
          : t('Pick a station')
        : t('Press play or Lucky to start');
    }
    if (current?.audioError && current.audioError !== lastError) {
      notices.notify(
        'fail',
        t('Radio: {name}', { name: station?.name || t('RADIO') }),
        String(current.audioError),
      );
    }
    lastError = current?.audioError || null;
    if (!panel.hidden) renderStations();
  }

  function subscribe() {
    const layer = radio();
    if (!layer || layer === subscribedTo) return;
    unsubscribe?.();
    subscribedTo = layer;
    unsubscribe = layer.subscribeToRadio?.(() => paint()) || null;
  }

  async function ready() {
    const enabled = await ensureRadioEnabled();
    subscribe();
    if (!enabled) {
      notices.notify(
        'fail',
        t('Radio'),
        t('The radio layer could not be turned on.'),
      );
      return false;
    }
    // The station list arrives a moment after the layer turns on.
    for (let attempt = 0; attempt < 40 && !ranked().length; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 250));
    if (!ranked().length) {
      notices.notify(
        'fail',
        t('Radio'),
        t('No stations have loaded yet. Try again in a moment.'),
      );
      return false;
    }
    return true;
  }

  async function tune(station, how) {
    const layer = radio();
    if (!layer || !station) return;
    let ok = layer.selectRadioStation?.(station.id, {
      autoplay: true,
      origin: 'user',
    });
    if (ok === false) {
      layer.setRadioFilter?.('all');
      ok = layer.selectRadioStation?.(station.id, {
        autoplay: true,
        origin: 'user',
      });
    }
    heard.add(station.id);
    notices.log('radio', `${how}: ${station.name}`);
    paint();
  }

  async function step(direction) {
    if (!(await ready())) return;
    const list = ranked();
    const currentId = state()?.selected?.id;
    const index = list.findIndex((entry) => entry.station.id === currentId);
    const next = list[(index + direction + list.length) % list.length];
    await tune(next.station, direction > 0 ? t('Next') : t('Previous'));
  }

  async function lucky() {
    if (!(await ready())) return;
    const choice = pickLuckyStation(ranked(), heard);
    if (choice.wrapped) {
      heard = new Set();
      notices.notify(
        'info',
        t('Feeling Lucky'),
        t('You have heard every station. Starting again from the nearest.'),
      );
    }
    await tune(choice.station, t('Feeling Lucky'));
  }

  async function togglePlay() {
    const current = state();
    if (!current?.enabled || !current.selected) {
      await lucky();
      return;
    }
    notices.log(
      'radio',
      current.audioState === 'playing' ? t('Stop') : t('Play'),
    );
    await radio()?.toggleRadioPlayback?.({ origin: 'user' });
  }

  function renderStations() {
    const query = search.value.trim().toLowerCase();
    const currentId = state()?.selected?.id;
    const entries = ranked().filter(
      ({ station }) =>
        !query ||
        [station.name, station.state, station.country, ...(station.tags || [])]
          .join(' ')
          .toLowerCase()
          .includes(query),
    );
    const groups = new Map();
    for (const entry of entries.slice(0, 400)) {
      const key =
        tab === 'near'
          ? t(distanceBand(entry.km))
          : tab === 'country'
            ? (entry.station.country || t('Unknown')).toLocaleUpperCase()
            : (stationGenre(entry.station) || t('Other')).toLocaleUpperCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const keys = [...groups.keys()];
    if (tab !== 'near') keys.sort((a, b) => a.localeCompare(b));
    list.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('h4');
      empty.textContent = state()?.enabled
        ? t('NO MATCHES')
        : t('Press play or Lucky to load stations');
      list.appendChild(empty);
      return;
    }
    for (const key of keys) {
      const heading = document.createElement('h4');
      heading.textContent = `${key} (${groups.get(key).length})`;
      list.appendChild(heading);
      for (const { station, km } of groups.get(key)) {
        const button = document.createElement('button');
        button.type = 'button';
        if (station.id === currentId) button.className = 'now';
        const name = document.createElement('span');
        name.textContent = station.name;
        const detail = document.createElement('small');
        detail.textContent = [
          place(station),
          tab === 'genre' ? '' : stationGenre(station),
        ]
          .filter(Boolean)
          .join(' · ');
        const distance = document.createElement('em');
        distance.textContent = formatDistance(km);
        button.append(name, detail, distance);
        button.addEventListener('click', () => tune(station, t('Picked')));
        list.appendChild(button);
      }
    }
  }

  async function setPanel(open) {
    panel.hidden = !open;
    display.setAttribute('aria-expanded', String(open));
    if (open) {
      renderStations();
      search.focus({ preventScroll: true });
      if (!state()?.enabled) {
        await ensureRadioEnabled();
        subscribe();
      }
    }
  }

  on(prevBtn, 'click', () => step(-1));
  on(nextBtn, 'click', () => step(1));
  on(playBtn, 'click', togglePlay);
  on(luckyBtn, 'click', lucky);
  on(display, 'click', () => {
    void setPanel(panel.hidden);
    notices.log(
      'click',
      panel.hidden
        ? t('Closed the station finder')
        : t('Opened the station finder'),
    );
  });
  on(search, 'input', renderStations);
  for (const button of tabs)
    on(button, 'click', () => {
      tab = button.dataset.skinRadioTab;
      for (const other of tabs)
        other.setAttribute('aria-selected', String(other === button));
      notices.log('click', `${t('Station finder')}: ${button.textContent}`);
      renderStations();
    });

  subscribe();
  paint();
  return {
    paint: () => {
      subscribe();
      paint();
    },
    close: () => setPanel(false),
    get panel() {
      return panel;
    },
    get opener() {
      return display;
    },
    resetLucky() {
      heard = new Set(state()?.selected ? [state().selected.id] : []);
    },
    destroy() {
      abort.abort();
      unsubscribe?.();
    },
  };
}
