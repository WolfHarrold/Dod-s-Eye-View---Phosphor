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

// About one in seven directory streams will not play (401/403, dead hosts,
// stalls). Lucky and next/previous skip past them, up to this many in a row.
const MAX_AUTO_SKIPS = 4;
// A stream that has not started after this long is treated as off air.
const STALL_MS = 15_000;

// Radio Browser tags are free text: "80s", "80er" and "80's" are one genre,
// and the first tag is often a network or band ("dab", "capital", "#"). Each
// tag is matched against these buckets in the station's own tag order. World
// sits above Pop so "k pop" lands there, Reggae above Dance for "dancehall".
const GENRES = [
  [msg('News'), /\bnews\b|nachrichten|noticias|actualit/],
  [msg('Weather'), /weather|noaa/],
  [msg('Sports'), /sport/],
  [msg('Comedy'), /comedy|humou?r/],
  [msg('Talk'), /talk|spoken|podcast|interview|old time radio|drama/],
  [msg('Classical'), /classical|klassik|opera|baroque|choral|symphon/],
  [msg('Jazz'), /jazz|swing|bebop|big band/],
  [msg('Blues & Soul'), /blues|soul|funk|r ?& ?b|rnb|motown/],
  [msg('Hip Hop'), /hip ?hop|\brap\b|trap|grime/],
  [msg('Reggae'), /reggae|\bska\b|dancehall|dub\b/],
  [
    msg('Religious'),
    /christ|gospel|worship|relig|catholic|islam|quran|church|bible|spiritual/,
  ],
  [
    msg('Latin'),
    /latin|salsa|reggaeton|bachata|cumbia|tropical|ranchera|mariachi|mexican|flamenco|tango|bossa|samba/,
  ],
  [
    msg('World'),
    /world|bollywood|hindi|arab|afro|african|k ?pop|j ?pop|celtic|greek|turk|persian|indian|asian|balkan|chanson|traditional/,
  ],
  [
    msg('Country & Folk'),
    /country|folk|bluegrass|americana|schlager|volksmusik/,
  ],
  [msg('Rock'), /rock|metal|punk|grunge|indie|alternative/],
  [
    msg('Dance & Electronic'),
    /dance|electr|house|techno|trance|edm|club|dubstep|drum|dnb|disco|anthems|beats/,
  ],
  [
    msg('Ambient & Chill'),
    /ambient|chill|lounge|relax|downtempo|drone|meditat|sleep|new age|easy listening/,
  ],
  [
    msg('Oldies'),
    /oldies|\b(?:19)?[4-9]0 ?'?s\b|\b[4-9]0er\b|\b(?:19)?[4-9]0 ?'?s|2000s|retro|classic hits|nostalgi|vinyl|\b78\b|\b19[2-9]0\b/,
  ],
  [
    msg('Pop'),
    /\bpop\b|top ?40|\bhits?\b|charts?|adult contemporary|\bchr\b|\bac\b/,
  ],
  [msg('Kids'), /kids|children|kinder/],
  [
    msg('Public & Community'),
    /community|college|university|public radio|\bnpr\b|\bbbc\b|variety|local/,
  ],
];

const genreOf = (text) =>
  GENRES.find(([, pattern]) => pattern.test(text.toLocaleLowerCase()));

/**
 * The station's genre bucket, or an empty string when nothing fits one. Tags
 * win; a station with no usable tag is often named for what it plays
 * ("Adroit Jazz Underground", "100 Best Ibiza Deep House"), so its name is
 * tried next.
 */
export function stationGenre(station) {
  for (const tag of station?.tags || []) {
    const bucket = genreOf(String(tag || ''));
    if (bucket) return t(bucket[0]);
  }
  const bucket = genreOf(stationName(station).replace(/[_-]+/g, ' '));
  return bucket ? t(bucket[0]) : '';
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Station names in the directory often carry HTML entities ("Vibes &amp;
 * Energy"). They are only ever shown as text, so decode the common ones.
 */
export function stationName(station) {
  return String(station?.name || '').replace(
    /&(?:#(\d{1,6})|#x([0-9a-f]{1,6})|([a-z]{2,6}));/gi,
    (whole, dec, hex, named) => {
      const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : null;
      if (code !== null)
        return code > 31 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      return ENTITIES[named.toLowerCase()] ?? whole;
    },
  );
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
 * Feeling Lucky: the nearest station not heard yet, skipping stations that
 * failed to play. When every station has been heard it starts again from the
 * nearest.
 * @returns {{station: object|null, wrapped: boolean}}
 */
export function pickLuckyStation(ranked, heard, failed = new Set()) {
  const live = ranked.filter((entry) => !failed.has(entry.station.id));
  const next = live.find((entry) => !heard.has(entry.station.id));
  if (next) return { station: next.station, wrapped: false };
  return { station: live[0]?.station || null, wrapped: live.length > 0 };
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
  // Stations that failed to play this session; Lucky and next/previous skip
  // them and the finder marks them OFF AIR.
  const failed = new Set();
  // The station an automatic pick (Lucky, next, previous) is waiting on, so a
  // failure can move on to the next one instead of stopping on an error.
  let pending = null;
  let stallTimer = null;
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
    if (
      pending &&
      station?.id === pending.id &&
      current.audioState === 'playing'
    ) {
      pending = null;
      clearTimeout(stallTimer);
    }
    if (station) {
      heard.add(station.id);
      nameEl.textContent = stationName(station);
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
      if (station) failed.add(station.id);
      if (!skipPast(station)) {
        notices.notify(
          'fail',
          t('Radio: {name}', {
            name: station ? stationName(station) : t('RADIO'),
          }),
          String(current.audioError),
        );
      }
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

  /**
   * After an automatic pick fails, move on to the next one. Returns whether
   * it did, so the caller can skip the failure notice.
   */
  function skipPast(station) {
    if (!pending || !station || station.id !== pending.id) return false;
    const { advance, skips } = pending;
    pending = null;
    clearTimeout(stallTimer);
    if (skips >= MAX_AUTO_SKIPS) return false;
    notices.log(
      'radio',
      t('{name} is off air, trying the next station', {
        name: stationName(station),
      }),
    );
    setTimeout(() => void advance(skips + 1), 0);
    return true;
  }

  function watchForStall(station) {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      const current = state();
      if (
        pending?.id !== station.id ||
        current?.selected?.id !== station.id ||
        !['loading', 'buffering'].includes(current.audioState)
      )
        return;
      failed.add(station.id);
      radio()?.stopRadioPlayback?.({ origin: 'user' });
      if (!skipPast(station)) {
        notices.notify(
          'fail',
          t('Radio: {name}', { name: stationName(station) }),
          t('The station did not start playing.'),
        );
        paint();
      }
    }, STALL_MS);
  }

  async function tune(station, how, advance = null, skips = 0) {
    const layer = radio();
    if (!layer || !station) return;
    pending = advance ? { id: station.id, advance, skips } : null;
    clearTimeout(stallTimer);
    if (advance) watchForStall(station);
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
    notices.log('radio', `${how}: ${stationName(station)}`);
    paint();
  }

  async function step(direction, skips = 0) {
    if (!(await ready())) return;
    const list = ranked();
    const currentId = state()?.selected?.id;
    const index = list.findIndex((entry) => entry.station.id === currentId);
    let next = null;
    for (let offset = 1; offset <= list.length; offset += 1) {
      const entry =
        list[(index + direction * offset + list.length * offset) % list.length];
      if (!failed.has(entry.station.id)) {
        next = entry;
        break;
      }
    }
    if (!next) return;
    await tune(
      next.station,
      direction > 0 ? t('Next') : t('Previous'),
      (count) => step(direction, count),
      skips,
    );
  }

  async function lucky(skips = 0) {
    if (!(await ready())) return;
    const choice = pickLuckyStation(ranked(), heard, failed);
    if (!choice.station) return;
    if (choice.wrapped) {
      heard = new Set();
      notices.notify(
        'info',
        t('Feeling Lucky'),
        t('You have heard every station. Starting again from the nearest.'),
      );
    }
    await tune(choice.station, t('Feeling Lucky'), lucky, skips);
  }

  async function togglePlay() {
    const current = state();
    if (!current?.enabled || !current.selected) {
      await lucky();
      return;
    }
    pending = null;
    clearTimeout(stallTimer);
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
        [
          stationName(station),
          station.state,
          station.country,
          stationGenre(station),
          ...(station.tags || []),
        ]
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
        else if (failed.has(station.id)) button.className = 'off';
        const name = document.createElement('span');
        name.textContent = stationName(station);
        const detail = document.createElement('small');
        detail.textContent = [
          place(station),
          tab === 'genre' ? '' : stationGenre(station),
        ]
          .filter(Boolean)
          .join(' · ');
        const distance = document.createElement('em');
        distance.textContent =
          failed.has(station.id) && station.id !== currentId
            ? t('OFF AIR')
            : formatDistance(km);
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
  on(luckyBtn, 'click', () => lucky());
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
      clearTimeout(stallTimer);
      abort.abort();
      unsubscribe?.();
    },
  };
}
