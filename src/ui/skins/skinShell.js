import { t, msg, getLocale } from '../../i18n/index.js';
import {
  DEFAULT_SKIN,
  PHOSPHOR_COLOURS,
  SKINS,
  phosphorColour,
  readSkinPreferences,
  skinById,
  writeSkinPreferences,
} from './skinCatalog.js';
import { createBootSequencer } from './skinBoot.js';
import { createNotices, logTime } from './skinNotices.js';
import {
  buildMenuTree,
  domControls,
  LAYER_MENU,
  walkTree,
} from './skinMenuModel.js';
import { createMenuTree } from './skinMenuTree.js';
import { createSkinRadio } from './skinRadio.js';
import { createWindowManager } from './skinWindows.js';
import { createFavourites } from './skinFavourites.js';
import { TOOL_WINDOWS } from './skinMenuModel.js';
import { applyPictureQuality, PICTURE_PRESETS } from './skinPicture.js';
import { layerFeedState } from '../../data/feedState.js';

export const GLITCH_INTERVAL_MS = 8000;
export const GLITCH_DURATION_MS = 1450;

/** Quick Start: the first view that shows the app off without clutter. */
export const QUICK_START_LAYERS = Object.freeze([
  'flights',
  'ais-live-vessels',
  'satellites',
  'earthquakes',
]);

function drawStarbursts(documentRef) {
  for (const group of documentRef.querySelectorAll('[data-skin-burst]')) {
    let lines = '';
    for (let index = 0; index < 12; index += 1) {
      const angle = (index * Math.PI) / 6;
      const length = index % 2 ? 7 : 12;
      lines += `<line x1="${(Math.cos(angle) * 3.5).toFixed(2)}" y1="${(Math.sin(angle) * 3.5).toFixed(2)}" x2="${(Math.cos(angle) * length).toFixed(2)}" y2="${(Math.sin(angle) * length).toFixed(2)}"/>`;
    }
    group.innerHTML = lines;
  }
}

/**
 * Mount the skin shell over the running app.
 * @param {object} input
 * @param {object} input.styleManager Initialized StyleManager.
 * @param {object} input.dataManager DataLayerManager.
 * @param {Document} [input.documentRef]
 * @param {Storage} [input.storage]
 * @returns {null|{destroy: Function, changeSkin: Function}}
 */
export function initSkinShell({
  styleManager: sm,
  dataManager: dm = sm?._dataManager,
  documentRef = globalThis.document,
  storage,
} = {}) {
  const shell = documentRef?.getElementById?.('skin-shell');
  const bootRoot = documentRef?.getElementById?.('skin-boot');
  if (!shell || !bootRoot || shell.dataset.initialized === 'true') return null;
  shell.dataset.initialized = 'true';
  const html = documentRef.documentElement;
  const $ = (id) => documentRef.getElementById(id);
  const dom = domControls(documentRef);
  const abort = new AbortController();
  const on = (target, type, handler, options = {}) =>
    target?.addEventListener(type, handler, {
      ...options,
      signal: abort.signal,
    });
  const timers = new Set();
  const every = (fn, ms) => {
    const id = setInterval(fn, ms);
    timers.add(() => clearInterval(id));
  };

  const prefs = readSkinPreferences(storage);
  let skin = prefs.skin;
  let colour = PHOSPHOR_COLOURS[0].id;
  const userEnabled = new Set();
  const reportedFailures = new Set();

  const notices = createNotices({
    host: $('skin-notices'),
    logList: $('skin-log-list'),
    logButton: $('skin-log-btn'),
  });
  const boot = createBootSequencer({
    root: bootRoot,
    screen: documentRef.body,
  });

  // ── State helpers the menu reads and writes through ─────────────────
  const layers = () => dm?.getAll?.() || [];
  const layer = (id) => layers().find((entry) => entry.id === id);
  const liveCount = () =>
    layers().filter((entry) => entry.showInTogglePanel && entry.enabled).length;
  const radioModule = () => dm?.layers?.get?.('radio')?.module || null;
  const controlState = () => {
    try {
      return sm.getControlState();
    } catch {
      return null;
    }
  };

  function fail(title, body) {
    notices.notify('fail', t('Failed: {name}', { name: t(title) }), t(body));
    return false;
  }

  async function setLayer(id, enabled) {
    if (enabled) userEnabled.add(id);
    else {
      userEnabled.delete(id);
      reportedFailures.delete(id);
    }
    const ok = await dm.setEnabled(id, enabled, { origin: 'user' });
    if (enabled && ok === false) {
      const name = LAYER_MENU[id] ? t(LAYER_MENU[id].label) : id;
      const error = layer(id)?.stats?.error;
      fail(
        name,
        error ? String(error) : msg('The layer could not be turned on.'),
      );
    }
    return ok;
  }

  function applyPhosphorColour(id) {
    colour = phosphorColour(id).id;
    const preset = phosphorColour(colour);
    preset.tiers.forEach((value, index) =>
      html.style.setProperty(`--ph-t${index + 1}`, value),
    );
    html.dataset.phColour = colour;
    const select = $('skin-colour');
    if (select) select.value = colour;
    if (controlState()?.style === 'phosphor')
      sm.applyCinematicPreset?.({
        styleParams: { phosphor: { tint: preset.tint } },
      });
  }

  function setFilter(style) {
    if (!documentRef.querySelector(`.style-btn[data-style="${style}"]`))
      return fail(msg('Globe Filter'), msg('That filter is not available.'));
    sm.setStyle(style, { userInitiated: true, revealParameters: false });
    if (style === 'phosphor') applyPhosphorColour(colour);
    return true;
  }

  function setModels3d(value) {
    const state = controlState()?.models3d || {};
    if (value === 'off') {
      if (state.enabled) dom.click('models3d-toggle');
      return;
    }
    if (!state.enabled) dom.click('models3d-toggle');
    dom.click(`models3d-mode-${value}`);
  }

  function setHud(value) {
    if (value === 'off') return sm.setHudVisible('off');
    sm.setHudVisible('on');
    return sm.setHudLayout(value);
  }

  async function setMapStack(id) {
    const result = await sm.setMapStack(id);
    if (!result?.ok)
      fail(msg('Map Imagery'), result?.error || msg('The map did not switch.'));
  }

  function goTo(query) {
    const input = $('location-search');
    if (!input)
      return fail(msg('Go To a Place'), msg('Place search is not available.'));
    input.value = query;
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    return true;
  }

  // Tool panels open as floating, skinned windows (src/ui/skins/skinWindows.js).
  const windowTitles = new Map(
    TOOL_WINDOWS.map((entry) => [entry.panel, entry.label]),
  );
  const windows = createWindowManager({
    documentRef,
    host: $('skin-windows'),
    log: (kind, text) => notices.log(kind, text),
    leftInset: () =>
      treePanel?.hidden === false ? treePanel.getBoundingClientRect().right : 0,
  });
  function openPanel(panelId, layerId, title, { side } = {}) {
    const panel = $(panelId);
    if (!panel) return false;
    if (layerId && !layer(layerId)?.enabled) void setLayer(layerId, true);
    if (panel.hidden) panel.hidden = false;
    sm.setPanelCollapsed?.(panelId, false, { explicit: true });
    return windows.open(panel, {
      title: t(title || windowTitles.get(panelId) || ''),
      side,
    });
  }

  function openContext(buttonId) {
    if (!dom.click(buttonId))
      return fail(msg('Side panel'), msg('That panel is not available.'));
    return openPanel('global-context-panel');
  }

  // ── Notices, log and footer ──────────────────────────────────────────
  const logPanel = $('skin-log');
  const logButton = $('skin-log-btn');
  function setLog(open) {
    logPanel.hidden = !open;
    logButton.setAttribute('aria-expanded', String(open));
  }
  on(logButton, 'click', () => {
    setLog(logPanel.hidden);
    notices.log(
      'click',
      logPanel.hidden ? t('Closed the Action Log') : t('Opened the Action Log'),
    );
  });
  on($('skin-log-close'), 'click', () => setLog(false));
  on($('skin-log-clear'), 'click', () => {
    notices.clearLog();
    notices.log('click', t('Cleared the Action Log'));
  });

  const footSkin = shell.querySelector('[data-skin-cell-skin]');
  const footLayers = shell.querySelector('[data-skin-cell-layers]');
  const footClock = shell.querySelector('[data-skin-cell-clock]');
  function paintFooter() {
    footSkin.textContent = `${t('SKIN')} ${t(skinById(skin)?.name || '').toLocaleUpperCase()}`;
    footLayers.textContent = t('LIVE LAYERS {count}', { count: liveCount() });
  }
  const tick = () => {
    footClock.textContent = `${logTime()} ${t('LOCAL')}`;
  };
  tick();
  every(tick, 1000);

  // The app's own toast (copied links, camera notices) becomes a compact notice.
  const appToast = $('toast');
  let lastToast = '';
  const toastObserver = appToast
    ? new MutationObserver(() => {
        const text = appToast.textContent.trim();
        if (!text || text === lastToast) {
          lastToast = text;
          return;
        }
        lastToast = text;
        notices.notify('info', text);
      })
    : null;
  toastObserver?.observe(appToast, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  // Panels the app opens itself after a pick on the globe (a camera, a
  // station, a place, a street photo) are shown in place, as before.
  const REVEALED_PANELS = new Set([
    'cctv-panel',
    'radio-panel',
    'global-context-panel',
    'street-level-panel',
  ]);
  const setPanelCollapsed = sm.setPanelCollapsed;
  if (typeof setPanelCollapsed === 'function') {
    sm.setPanelCollapsed = function (panelId, collapsed, options = {}) {
      const result = setPanelCollapsed.apply(this, arguments);
      if (
        collapsed === false &&
        options?.explicit &&
        !options.restore &&
        REVEALED_PANELS.has(panelId)
      )
        windows.open($(panelId), {
          title: t(windowTitles.get(panelId) || ''),
          side: 'right',
        });
      return result;
    };
  }
  const streetPhoto = $('sl-viewer-wrap');
  const streetPhotoObserver = streetPhoto
    ? new MutationObserver(() => {
        if (!streetPhoto.hidden)
          openPanel('street-level-panel', null, null, { side: 'right' });
      })
    : null;
  streetPhotoObserver?.observe(streetPhoto, {
    attributes: true,
    attributeFilter: ['hidden'],
  });

  // ── Menu tree ───────────────────────────────────────────────────────
  let nodes = [];
  const ctx = {
    sm,
    dm,
    dom,
    layers,
    layer,
    liveCount,
    controlState,
    setLayer,
    setFilter,
    setModels3d,
    setHud,
    setMapStack,
    goTo,
    openPanel,
    openContext,
    fail,
    mapStacks: () => sm.mapStackController?.getStacks?.() || [],
    skin: () => skin,
    changeSkin: (id) => changeSkin(id),
    phosphorColour: () => colour,
    setPhosphorColour: (id) => applyPhosphorColour(id),
    bootAnimation: () => prefs.bootAnimation,
    setBootAnimation: (enabled) => {
      prefs.bootAnimation = enabled;
      writeSkinPreferences({ ...prefs, skin }, storage);
    },
    locale: () => getLocale(),
    setLocale: (code) => sm._chooseLocale?.(code),
    radioState: () => radioModule()?.getRadioUIState?.() || null,
    setRadioVolume: (volume) => {
      if (radioModule()?.setRadioVolume?.(volume) === false)
        fail(msg('Radio Volume'), msg('Turn the radio on first.'));
    },
    voiceActive: () => {
      const status = $('gev-voice-control')?.dataset.status;
      return ['connecting', 'listening', 'executing'].includes(status);
    },
    resetLucky: () => radio.resetLucky(),
    quickStart: () => quickStart(),
    openLog: () => setLog(true),
    openKeys: () => openKeys(),
    pictureQuality: () => prefs.pictureQuality,
    setPictureQuality: (id) => setPictureQuality(id),
    crtOverlay: () => prefs.crtOverlay,
    setCrtOverlay: (on) => {
      prefs.crtOverlay = on === true;
      html.classList.toggle('skin-crt-lines', prefs.crtOverlay);
      writeSkinPreferences({ ...prefs, skin }, storage);
    },
  };

  // ── Picture quality ─────────────────────────────────────────────────
  let stopPicture = () => {};
  function setPictureQuality(id, { sharpen = true } = {}) {
    const preset = PICTURE_PRESETS[id];
    if (!preset)
      return fail(msg('Picture Quality'), msg('That setting is not known.'));
    prefs.pictureQuality = id;
    writeSkinPreferences({ ...prefs, skin }, storage);
    stopPicture();
    stopPicture = applyPictureQuality(sm.viewer, id);
    if (sharpen)
      sm.setSharpen?.({
        enabled: preset.sharpenPct > 0,
        ...(preset.sharpenPct > 0 ? { intensityPct: preset.sharpenPct } : {}),
      });
    return true;
  }

  // ── API keys: a button in the bottom bar opens the key setup window ──
  const keysButton = $('skin-keys-btn');
  function openKeys() {
    if (dom.click('key-setup-chip')) return true;
    return fail(
      msg('API Keys'),
      msg(
        'Key setup is only available when this app runs on its own development server.',
      ),
    );
  }
  on(keysButton, 'click', () => {
    notices.log('click', t('Opened API Keys'));
    openKeys();
  });

  async function useNode(node, kind, value) {
    const label = t(node.label);
    try {
      if (kind === 'toggle') {
        notices.log(value ? 'on' : 'off', label);
        await node.set(value);
      } else if (kind === 'select') {
        const option = node
          .options?.()
          .find((item) => String(item.value) === String(value));
        notices.log('set', `${label} → ${option ? t(option.label) : value}`);
        await node.set(value);
      } else if (kind === 'search') {
        notices.log('run', `${label}: ${value}`);
        node.run(value);
      } else {
        notices.log('run', label);
        await node.run();
      }
    } catch (error) {
      fail(label, error?.message || String(error));
    }
    renderTree();
    const warning = node.warn?.();
    if (warning) notices.notify('warn', t('Warning'), warning);
  }

  let favourites = null;
  const treePanel = $('skin-tree-panel');
  const menuButton = $('skin-menu-btn');
  const tree = createMenuTree({
    treeEl: $('skin-tree'),
    infoEl: $('skin-info'),
    findEl: $('skin-find'),
    getNodes: () => nodes,
    log: (kind, text) => notices.log(kind, text),
    onUse: useNode,
    favourites: {
      has: (id) => favourites?.api.has(id) === true,
      toggle: (node) => favourites?.api.toggle(node),
    },
  });

  favourites = createFavourites({
    root: $('skin-fav'),
    prefs,
    save: () => writeSkinPreferences({ ...prefs, skin }, storage),
    getNodes: () => nodes,
    onUse: useNode,
    log: (kind, text) => notices.log(kind, text),
    onChange: () => renderTree(),
  });

  function rebuild() {
    nodes = buildMenuTree(ctx);
    renderTree();
  }
  function renderTree() {
    if (!treePanel.hidden) tree.render();
    favourites?.render();
    paintFooter();
  }
  function setMenu(open, { quiet = false } = {}) {
    treePanel.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.querySelector('.skin-tree-box')?.classList.toggle('open', open);
    html.classList.toggle('skin-menu-open', open);
    if (!quiet)
      notices.log('click', open ? t('Opened the menu') : t('Hid the menu'));
    if (open) tree.render();
  }
  on(menuButton, 'click', () => setMenu(treePanel.hidden));
  on($('skin-open-all'), 'click', () => {
    tree.openAll();
    notices.log('click', t('Opened all folders'));
  });
  on($('skin-close-all'), 'click', () => {
    tree.closeAll();
    notices.log('click', t('Closed all folders'));
  });
  on($('skin-find'), 'change', (event) => {
    if (event.target.value)
      notices.log(
        'click',
        t('Searched the menu for "{query}"', { query: event.target.value }),
      );
  });

  // Layer changes from anywhere (voice, share links, the app) refresh the tree.
  let renderQueued = false;
  const unsubscribeLayers = dm?.subscribe?.(() => {
    for (const id of userEnabled) {
      const entry = layer(id);
      if (!entry?.enabled || reportedFailures.has(id)) continue;
      const name = LAYER_MENU[id] ? t(LAYER_MENU[id].label) : entry.name;
      if (entry.stats?.keyRequired) {
        reportedFailures.add(id);
        fail(
          name,
          msg(
            'This layer needs a provider key. Add one with API KEYS in the bottom bar.',
          ),
        );
      } else if (layerFeedState(entry.stats) === 'unavailable') {
        reportedFailures.add(id);
        const error = entry.stats?.error || entry.stats?.lastError;
        fail(
          name,
          error ? String(error) : msg('The feed is unavailable right now.'),
        );
      }
    }
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (
        nodes.length &&
        countLeaves(nodes) !== countLeaves(buildMenuTree(ctx))
      )
        rebuild();
      else renderTree();
    });
  });
  const countLeaves = (list) => {
    let count = 0;
    walkTree(list, () => (count += 1));
    return count;
  };

  // ── Radio ───────────────────────────────────────────────────────────
  const radio = createSkinRadio({
    root: $('skin-radio'),
    getRadio: radioModule,
    ensureRadioEnabled: async () =>
      layer('radio')?.enabled
        ? true
        : (await setLayer('radio', true)) !== false,
    getAnchor: () => {
      const position = sm.viewer?.camera?.positionCartographic;
      return position
        ? {
            lat: (position.latitude * 180) / Math.PI,
            lon: (position.longitude * 180) / Math.PI,
          }
        : null;
    },
    notices,
  });

  // ── Change Skin: button, glitch and picker ──────────────────────────
  const switchEl = $('skin-switch');
  const picker = $('skin-picker');
  function paintSwitch() {
    const name = t(skinById(skin)?.name || '');
    for (const element of shell.querySelectorAll('[data-skin-current-name]'))
      element.textContent =
        skin === 'phosphor' ? name.toLocaleUpperCase() : name;
    const phosphor = skin === 'phosphor';
    switchEl.querySelector('.face-deco').classList.toggle('main', !phosphor);
    switchEl.querySelector('.face-deco').classList.toggle('alt', phosphor);
    switchEl.querySelector('.face-phosphor').classList.toggle('main', phosphor);
    switchEl.querySelector('.face-phosphor').classList.toggle('alt', !phosphor);
    for (const button of switchEl.querySelectorAll('button'))
      button.tabIndex = button.closest('.alt') ? -1 : 0;
  }
  function renderPicker() {
    const grid = picker.querySelector('[data-skin-picker-grid]');
    grid.replaceChildren();
    for (const entry of SKINS) {
      const card = documentRef.createElement('button');
      card.type = 'button';
      card.className = `skin-card${entry.id === skin ? ' now' : ''}`;
      card.disabled = !entry.available;
      const thumb = documentRef.createElement('div');
      thumb.className = 'skin-card-thumb';
      if (entry.preview) {
        const image = documentRef.createElement('img');
        image.src = entry.preview;
        image.alt = t('{name} skin, main screen', { name: t(entry.name) });
        image.loading = 'lazy';
        thumb.appendChild(image);
      } else {
        const [a, b, c] = entry.swatch;
        thumb.style.background = `linear-gradient(90deg,${a} 0 40%,${b} 40% 72%,${c} 72%)`;
      }
      const text = documentRef.createElement('div');
      text.className = 'skin-card-text';
      const name = documentRef.createElement('b');
      name.textContent = t(entry.name);
      const badge = documentRef.createElement('em');
      badge.textContent =
        entry.id === skin ? t('CURRENT') : entry.available ? '' : t('LATER');
      const description = documentRef.createElement('small');
      description.textContent = entry.description
        ? t(entry.description)
        : t('Coming in a later round.');
      text.append(name, badge, description);
      card.append(thumb, text);
      card.addEventListener('click', () => {
        setPicker(false);
        notices.log('set', `${t('Skin')} → ${t(entry.name)}`);
        void changeSkin(entry.id);
      });
      grid.appendChild(card);
    }
  }
  function setPicker(open) {
    picker.hidden = !open;
    if (open) {
      renderPicker();
      notices.log('click', t('Opened Change Skin'));
    }
  }
  for (const button of switchEl.querySelectorAll('button'))
    on(button, 'click', () => setPicker(picker.hidden));
  every(() => {
    if (boot.running || documentRef.hidden) return;
    switchEl.classList.remove('glitch');
    void switchEl.offsetWidth;
    switchEl.classList.add('glitch');
    const id = setTimeout(
      () => switchEl.classList.remove('glitch'),
      GLITCH_DURATION_MS,
    );
    timers.add(() => clearTimeout(id));
  }, GLITCH_INTERVAL_MS);

  const colourSelect = $('skin-colour');
  for (const preset of PHOSPHOR_COLOURS) {
    const option = documentRef.createElement('option');
    option.value = preset.id;
    option.textContent = `${t('COLOUR:')} ${t(preset.label)}`;
    colourSelect.appendChild(option);
  }
  on(colourSelect, 'change', () => {
    applyPhosphorColour(colourSelect.value);
    notices.log('set', `${t('Colour')} → ${t(phosphorColour(colour).label)}`);
    renderTree();
  });

  function applySkin(id) {
    skin = id;
    html.dataset.skin = id;
    // The Phosphor skin keeps the map as it is: its one-colour globe filter
    // and the CRT lines over the map are both opt-in from Look & Filters.
    if (id === 'phosphor') applyPhosphorColour(PHOSPHOR_COLOURS[0].id);
    else if (controlState()?.style === 'phosphor') setFilter('normal');
    html.classList.toggle('skin-crt-lines', prefs.crtOverlay);
    paintSwitch();
    rebuild();
    radio.paint();
  }

  function closePopups() {
    setPicker(false);
    setLog(false);
    radio.close();
    notices.clearNotices();
  }

  async function changeSkin(id) {
    const target = skinById(id);
    if (!target || target.id === skin || boot.running) {
      paintSwitch();
      renderTree();
      return;
    }
    prefs.skin = target.id;
    writeSkinPreferences({ ...prefs }, storage);
    closePopups();
    const menuWasOpen = !treePanel.hidden;
    setMenu(false, { quiet: true });
    if (!prefs.bootAnimation) {
      applySkin(target.id);
    } else if (target.id === 'phosphor') {
      const { skipped } = await boot.powerOnPhosphor({
        onSwap: () => applySkin(target.id),
      });
      if (skipped) notices.log('click', t('Skipped the boot sequence'));
    } else {
      const { skipped } = await boot.powerDownToDeco({
        onSwap: () => applySkin(target.id),
      });
      if (skipped) notices.log('click', t('Skipped the boot sequence'));
    }
    if (menuWasOpen) setMenu(true, { quiet: true });
    shell.classList.remove('skin-arrive');
    void shell.offsetWidth;
    shell.classList.add('skin-arrive');
    notices.log(
      'system',
      target.id === 'phosphor'
        ? t('Booted into the Phosphor skin as ********')
        : t('Restarted into the {name} skin', { name: t(target.name) }),
    );
  }

  // ── Quick Start and the welcome card ────────────────────────────────
  const welcome = $('skin-welcome');
  async function quickStart() {
    welcome.hidden = true;
    prefs.welcomeSeen = true;
    writeSkinPreferences({ ...prefs, skin }, storage);
    const wanted = new Set(QUICK_START_LAYERS);
    const changes = layers()
      .filter(
        (entry) =>
          entry.showInTogglePanel && entry.enabled !== wanted.has(entry.id),
      )
      .map((entry) => setLayer(entry.id, wanted.has(entry.id)));
    sm.setDetection?.({ enabled: false });
    if (controlState()?.hud?.sonar?.enabled)
      sm.setCyberSonar?.({ enabled: false });
    if (dom.pressed('scope-toggle')) dom.click('scope-toggle');
    if (controlState()?.celestialRing?.enabled)
      sm.setCelestialRingEnabled?.(false);
    if (dom.pressed('draw-toggle')) dom.click('draw-toggle');
    setModels3d('proximity');
    sm.setBloom?.({ enabled: true, intensityPct: 50 });
    setHud('minimal');
    setFilter('normal');
    notices.log(
      'set',
      t(
        'Quick Start: Aircraft, Ships, Satellites and Earthquakes on; everything else off',
      ),
    );
    notices.notify(
      'info',
      t('Quick Start applied'),
      t(
        '{count} live layers on, everything else off. Change anything from the menu.',
        {
          count: QUICK_START_LAYERS.filter((id) => layer(id)).length,
        },
      ),
    );
    await Promise.allSettled(changes);
    renderTree();
  }
  on(welcome.querySelector('[data-skin-quick-start]'), 'click', () => {
    notices.log('click', t('Welcome: Quick Start'));
    void quickStart();
  });
  function dismissWelcome() {
    notices.log('click', t("Welcome: I'll explore myself"));
    welcome.hidden = true;
    prefs.welcomeSeen = true;
    writeSkinPreferences({ ...prefs, skin }, storage);
  }
  on(
    welcome.querySelector('[data-skin-welcome-dismiss]'),
    'click',
    dismissWelcome,
  );

  // ── Global keys and clicking outside pop-ups ────────────────────────
  on(globalThis, 'keydown', (event) => {
    if (boot.running || event.defaultPrevented) return;
    const typing = event.target?.matches?.(
      'input, select, textarea, [contenteditable="true"]',
    );
    if (
      !typing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.key === 'm' || event.key === 'M')
    ) {
      setMenu(treePanel.hidden);
      event.preventDefault();
    }
    if (event.key === 'Escape') {
      setPicker(false);
      radio.close();
      // Escape answers the welcome card like "I'll explore myself".
      if (!welcome.hidden) dismissWelcome();
    }
  });
  const OUTSIDE = [
    [picker, switchEl, () => setPicker(false)],
    [radio.panel, radio.opener, () => radio.close()],
    [logPanel, logButton, () => setLog(false)],
  ];
  on(documentRef, 'pointerdown', (event) => {
    if (boot.running) return;
    const target = event.target;
    if (
      target?.closest?.(
        '.skin-notice, #skin-welcome, #skin-tree-panel, #skin-fav, .skin-window',
      )
    )
      return;
    for (const [panel, opener, close] of OUTSIDE) {
      if (panel.hidden || panel.contains(target) || opener.contains(target))
        continue;
      close();
    }
  });

  // ── First paint ─────────────────────────────────────────────────────
  drawStarbursts(documentRef);
  // A shared link brings its own sharpen setting; the rest still applies.
  setPictureQuality(prefs.pictureQuality, { sharpen: !sm.hasShareState });
  shell.hidden = false;
  html.classList.add('skin-active');
  applySkin(skin || DEFAULT_SKIN);
  // On a phone the open menu would cover the whole globe, so it starts closed.
  const narrow =
    documentRef.defaultView?.matchMedia?.('(max-width: 760px)').matches ===
    true;
  setMenu(!narrow, { quiet: true });
  if (!prefs.welcomeSeen && !sm.hasShareState) welcome.hidden = false;
  notices.log(
    'system',
    t('Started in the {name} skin', { name: t(skinById(skin).name) }),
  );

  return {
    changeSkin,
    quickStart,
    get skin() {
      return skin;
    },
    notices,
    destroy() {
      abort.abort();
      for (const stop of timers) stop();
      timers.clear();
      toastObserver?.disconnect();
      streetPhotoObserver?.disconnect();
      if (typeof setPanelCollapsed === 'function')
        sm.setPanelCollapsed = setPanelCollapsed;
      unsubscribeLayers?.();
      radio.destroy();
      windows.destroy();
      favourites.destroy();
      stopPicture();
      tree.destroy();
      boot.destroy();
      notices.destroy();
      html.classList.remove('skin-active', 'skin-menu-open', 'skin-crt-lines');
      delete html.dataset.skin;
      delete html.dataset.phColour;
      shell.hidden = true;
      delete shell.dataset.initialized;
    },
  };
}
