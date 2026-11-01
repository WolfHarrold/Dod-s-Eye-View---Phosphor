import { t, msg } from '../../i18n/index.js';
import { LOCALES } from '../../i18n/locale.js';
import { layerFeedState } from '../../data/feedState.js';
import { SKINS, PHOSPHOR_COLOURS } from './skinCatalog.js';

/*
 * The one menu tree that replaces the scattered panels. Every leaf drives a
 * control the app already has (its DOM button or a StyleManager method), so
 * the old panels and the tree can never disagree about state.
 *
 * Leaf types: toggle (on/off), select (options), action (one verb), search
 * (a text box). Folders hold children. `desc` says what it does, `result`
 * what happens when you use it; the description card shows both.
 */

const folder = (label, hint, desc, children, extra = {}) => ({
  type: 'folder',
  label,
  hint,
  desc,
  children,
  ...extra,
});
const toggle = (id, label, desc, result, extra) => ({
  id,
  type: 'toggle',
  label,
  desc,
  result,
  ...extra,
});
const select = (id, label, desc, result, extra) => ({
  id,
  type: 'select',
  label,
  desc,
  result,
  ...extra,
});
const action = (id, label, verb, desc, result, extra) => ({
  id,
  type: 'action',
  label,
  verb,
  desc,
  result,
  ...extra,
});

const STEP_LABELS = [msg('Off'), msg('Low'), msg('Medium'), msg('High')];
const BLOOM_STEPS = [0, 50, 100, 150];
const SHARPEN_STEPS = [0, 33, 66, 100];
const FEATHER_STEPS = [
  { value: '0', label: msg('Hard') },
  { value: '11', label: msg('Soft') },
  { value: '30', label: msg('Very Soft') },
];

const nearestStep = (steps, value) =>
  steps.reduce(
    (best, step, index) =>
      Math.abs(step - value) < Math.abs(steps[best] - value) ? index : best,
    0,
  );

/** The globe filters, in the order of their number keys. */
export const GLOBE_FILTERS = Object.freeze([
  { value: 'normal', label: msg('Normal') },
  { value: 'retro', label: msg('CRT') },
  { value: 'surveillance', label: msg('Night Vision') },
  { value: 'thermal', label: msg('Thermal') },
  { value: 'anime', label: msg('Anime') },
  { value: 'noir', label: msg('Noir') },
  { value: 'snow', label: msg('Snow') },
  { value: 'phosphor', label: msg('Phosphor') },
]);

const LOCALE_NAMES = Object.freeze({
  en: 'English',
  es: 'Español',
  ru: 'Русский',
});

/** Friendly names, descriptions and menu groups for the live layers. */
export const LAYER_MENU = Object.freeze({
  flights: {
    group: 'air',
    label: msg('Aircraft'),
    desc: msg('Live positions of civil aircraft from public ADS-B feeds.'),
    result: msg(
      'Adds moving icons that update every few seconds. Busy areas can show thousands.',
    ),
  },
  military: {
    group: 'air',
    label: msg('Military Aircraft'),
    desc: msg('Aircraft flagged as military by public trackers.'),
    result: msg('Adds a second marker style for military traffic.'),
  },
  'local-adsb': {
    group: 'air',
    label: msg('My ADS-B Receiver'),
    desc: msg('Aircraft from an ADS-B receiver you run yourself.'),
    result: msg(
      'Needs a receiver on your network. Without one it reports that it cannot connect.',
    ),
  },
  'ais-live-vessels': {
    group: 'sea',
    label: msg('Ships'),
    desc: msg('Vessel positions from AIS transponders.'),
    result: msg('Adds ship icons and names along coasts and shipping lanes.'),
  },
  'telegeography-submarine-cables': {
    group: 'sea',
    label: msg('Undersea Cables'),
    desc: msg('Routes of submarine internet cables.'),
    result: msg('Static lines. Light on performance.'),
  },
  satellites: {
    group: 'space',
    label: msg('Satellites'),
    desc: msg('Orbits and current positions of tracked satellites.'),
    result: msg('Adds moving dots and orbit lines. Best viewed zoomed out.'),
  },
  'rocket-launches': {
    group: 'space',
    label: msg('Rocket Launches'),
    desc: msg('Upcoming and recent rocket launches.'),
    result: msg('Adds launch pad markers with countdowns.'),
  },
  'gnss-integrity': {
    group: 'space',
    label: msg('GPS Interference'),
    desc: msg('Areas where GPS signals are reported as jammed.'),
    result: msg('Adds shaded zones. The data updates about once a day.'),
  },
  traffic: {
    group: 'ground',
    label: msg('Road Traffic'),
    desc: msg('Simulated traffic flowing along the real road network.'),
    result: msg(
      'Downloads the road network around you first, which can take a moment.',
    ),
  },
  transit: {
    group: 'ground',
    label: msg('Public Transit'),
    desc: msg('Live buses and trains where cities publish them.'),
    result: msg('Adds vehicle icons along their routes.'),
  },
  bikeshare: {
    group: 'ground',
    label: msg('Bike Share'),
    desc: msg('Bike share docks and how many bikes they hold.'),
    result: msg('Adds dock markers in cities that publish them.'),
  },
  directions: {
    group: 'ground',
    label: msg('Directions'),
    desc: msg('Route planning between two places.'),
    result: msg('Draws a route on the map when you ask for one.'),
  },
  'alpr-cameras': {
    group: 'ground',
    label: msg('Plate Reader Cameras'),
    desc: msg('Mapped automatic number plate reader cameras.'),
    result: msg('Adds camera markers. Zoom in to load them.'),
  },
  'military-installations': {
    group: 'ground',
    label: msg('Military Installations'),
    desc: msg('Known military sites from public map data.'),
    result: msg('Adds site outlines. Zoom in to load them.'),
  },
  'local-datacenters': {
    group: 'ground',
    label: msg('Data Centres'),
    desc: msg('Mapped data centres.'),
    result: msg('Adds site markers. Zoom in to load them.'),
  },
  'latrobe-power': {
    group: 'ground',
    label: msg('Latrobe Valley Power'),
    desc: msg(
      'Live output of Loy Yang A, Loy Yang B and Yallourn W from Open Electricity.',
    ),
    result: msg(
      'Adds a column at each station that rises with its output. Needs a free Open Electricity key.',
    ),
  },
  'local-places': {
    group: 'ground',
    label: msg('Places of Interest'),
    desc: msg(
      'Heritage places, landmarks, parks, Gunaikurnai places and 4-star attractions in Victoria.',
    ),
    result: msg('Adds coloured place markers. Zoom in to load them.'),
  },
  'local-dams': {
    group: 'ground',
    label: msg('Dams'),
    desc: msg('Mapped dams and reservoirs.'),
    result: msg('Adds site markers. Zoom in to load them.'),
  },
  cctv: {
    group: 'cameras',
    label: msg('Public Cameras'),
    desc: msg('Public traffic and city cameras, with live frames.'),
    result: msg('Adds camera markers. Open the camera viewer to watch one.'),
    panel: 'cctv-panel',
  },
  'recent-imagery': {
    group: 'cameras',
    label: msg('Recent Satellite Imagery'),
    desc: msg('Recent satellite pictures of an area you choose.'),
    result: msg('Draw a box on the map to load imagery for that area.'),
    panel: 'recent-imagery-panel',
  },
  'street-level': {
    group: 'cameras',
    label: msg('Street-Level Photos'),
    desc: msg('Ground-level photos people have shared, where they exist.'),
    result: msg('Adds photo points. Open the viewer to look through one.'),
    panel: 'street-level-panel',
  },
  earthquakes: {
    group: 'hazards',
    label: msg('Earthquakes'),
    desc: msg('Earthquakes reported by USGS.'),
    result: msg('Adds rings sized by magnitude.'),
  },
  'local-firms': {
    group: 'hazards',
    label: msg('Wildfire Hotspots'),
    desc: msg('Active fire hotspots seen by NASA satellites.'),
    result: msg('Adds hotspot dots. Updates every few hours.'),
  },
  'fire-perimeters': {
    group: 'hazards',
    label: msg('Wildfire Perimeters'),
    desc: msg('Mapped outlines of large active fires.'),
    result: msg('Adds fire outlines.'),
  },
  'weather-cyclones': {
    group: 'hazards',
    label: msg('Cyclones'),
    desc: msg('Tracks and forecasts of tropical storms.'),
    result: msg('Adds storm paths and forecast cones.'),
  },
  'weather-radar': {
    group: 'hazards',
    label: msg('Weather Radar'),
    desc: msg('Precipitation radar.'),
    result: msg('Adds a moving rain layer over the map.'),
  },
  'weather-satellite': {
    group: 'hazards',
    label: msg('Cloud Cover'),
    desc: msg('Satellite cloud imagery.'),
    result: msg('Adds a cloud layer over the map.'),
  },
  'weather-lightning': {
    group: 'hazards',
    label: msg('Lightning'),
    desc: msg('Recent lightning strikes.'),
    result: msg('Adds strike flashes.'),
  },
  wind: {
    group: 'hazards',
    label: msg('Wind'),
    desc: msg('Animated wind flow.'),
    result: msg('Adds moving streaks. Heavier on the graphics card.'),
  },
  'bom-weather': {
    group: 'hazards',
    label: msg('Australian Weather (BoM)'),
    desc: msg(
      'Bureau of Meteorology rain radar and station temperatures for Gippsland and Melbourne.',
    ),
    result: msg('Adds a looping radar and temperature markers.'),
  },
  'air-quality': {
    group: 'hazards',
    label: msg('Air Quality'),
    desc: msg('Air quality readings from public stations.'),
    result: msg('Adds coloured station markers.'),
  },
  radio: {
    group: 'audio',
    label: msg('Radio Stations on the Map'),
    desc: msg('Internet radio stations placed where they broadcast from.'),
    result: msg(
      'Shows station markers and loads the station list for the radio in the top bar.',
    ),
    panel: 'radio-panel',
  },
});

const LAYER_GROUPS = Object.freeze([
  { id: 'air', label: msg('Air'), desc: msg('Aircraft and receivers.') },
  {
    id: 'sea',
    label: msg('Sea'),
    desc: msg('Ships and what lies under the water.'),
  },
  {
    id: 'space',
    label: msg('Space'),
    desc: msg('Things in orbit and on the way there.'),
  },
  {
    id: 'ground',
    label: msg('Ground'),
    desc: msg('Roads, cities and infrastructure.'),
  },
  {
    id: 'cameras',
    label: msg('Cameras & Imagery'),
    desc: msg('Live cameras, satellite pictures and street photos.'),
  },
  {
    id: 'hazards',
    label: msg('Hazards & Weather'),
    desc: msg('Natural events and conditions.'),
  },
  {
    id: 'other',
    label: msg('Other'),
    desc: msg('Layers without a group yet.'),
  },
]);

/**
 * Small DOM helpers over the existing controls. A control that is missing
 * or disabled reports false so the tree can tell the person why.
 */
export function domControls(documentRef = globalThis.document) {
  const byId = (id) => documentRef.getElementById(id);
  return {
    byId,
    exists: (id) => Boolean(byId(id)),
    click(id) {
      const element = typeof id === 'string' ? byId(id) : id;
      if (
        !element ||
        element.disabled ||
        element.getAttribute('aria-disabled') === 'true'
      )
        return false;
      element.click();
      return true;
    },
    pressed(id) {
      const element = byId(id);
      if (!element) return false;
      const aria = element.getAttribute('aria-pressed');
      return aria === null
        ? element.classList.contains('active')
        : aria === 'true';
    },
    setValue(id, value, eventType = 'input') {
      const element = byId(id);
      if (!element) return false;
      element.value = String(value);
      element.dispatchEvent(new Event(eventType, { bubbles: true }));
      if (eventType !== 'change')
        element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
  };
}

function layerNode(layer, ctx) {
  const info = LAYER_MENU[layer.id];
  return toggle(
    `layer:${layer.id}`,
    info ? info.label : layer.name,
    info ? info.desc : msg('A live data layer.'),
    info ? info.result : msg('Adds this layer to the globe.'),
    {
      live: true,
      layerId: layer.id,
      dynamicLabel: !info,
      get: () => ctx.layer(layer.id)?.enabled === true,
      set: (on) => ctx.setLayer(layer.id, on),
      status: () => {
        const current = ctx.layer(layer.id);
        if (!current?.enabled) return null;
        if (current.stats?.keyRequired) return msg('Needs a provider key');
        if (layerFeedState(current.stats) !== 'unavailable') return null;
        const error = current.stats?.error || current.stats?.lastError;
        return error ? String(error) : msg('Feed unavailable');
      },
    },
  );
}

function liveDataFolder(ctx) {
  const layers = ctx.layers().filter((layer) => layer.showInTogglePanel);
  const groups = LAYER_GROUPS.map((group) => ({ ...group, children: [] }));
  const byGroup = new Map(groups.map((group) => [group.id, group]));
  for (const layer of layers) {
    const info = LAYER_MENU[layer.id];
    if (info?.group === 'audio') continue;
    (byGroup.get(info?.group) || byGroup.get('other')).children.push(
      layerNode(layer, ctx),
    );
  }
  const children = groups
    .filter((group) => group.children.length)
    .map((group) => folder(group.label, '', group.desc, group.children));
  children.push(
    select(
      'models3d',
      msg('3D Aircraft Models'),
      msg('When aircraft are drawn as 3D models instead of flat icons.'),
      msg(
        'All looks best but is heavy. With many layers on it can drop the frame rate.',
      ),
      {
        options: () => [
          { value: 'off', label: msg('Off') },
          { value: 'proximity', label: msg('Nearby Only') },
          { value: 'all', label: msg('All') },
        ],
        get: () => {
          const state = ctx.controlState()?.models3d;
          return state?.enabled ? state.mode || 'proximity' : 'off';
        },
        set: (value) => ctx.setModels3d(value),
        warn: () =>
          ctx.controlState()?.models3d?.mode === 'all' &&
          ctx.controlState()?.models3d?.enabled &&
          ctx.liveCount() >= 4
            ? t(
                'All 3D models with {count} live layers on can drop the frame rate below 30 FPS.',
                { count: ctx.liveCount() },
              )
            : null,
      },
    ),
  );
  for (const [id, info] of Object.entries(LAYER_MENU)) {
    if (!info.panel || info.group === 'audio' || !ctx.dom.exists(info.panel))
      continue;
    if (!layers.some((layer) => layer.id === id)) continue;
    children.push(
      action(
        `panel:${info.panel}`,
        t('{name} Viewer', { name: t(info.label) }),
        msg('OPEN'),
        msg('Opens the full panel for this layer on the right of the screen.'),
        msg('Close it again with the × on the panel. Nothing else changes.'),
        { run: () => ctx.openPanel(info.panel, id) },
      ),
    );
  }
  children.push(
    action(
      'layers-off',
      msg('Turn Off All Live Data'),
      msg('CLEAR'),
      msg('Switches off every live layer in one step.'),
      msg('The map keeps its imagery. You can turn layers back on one by one.'),
      { run: () => ctx.dom.click('clear-selected-layers') },
    ),
  );
  return folder(
    msg('Live Data'),
    msg('what is on the map'),
    msg(
      'Live feeds drawn on the globe, grouped by where they are. Each one you turn on adds network traffic and work for your computer.',
    ),
    children,
  );
}

/**
 * Build the menu tree for the current app. Called again whenever layers are
 * registered, so it stays a pure function of `ctx`.
 * @param {object} ctx Adapter built by createSkinShell.
 */
export function buildMenuTree(ctx) {
  const dom = ctx.dom;
  const state = () => ctx.controlState() || {};
  return [
    action(
      'quick-start',
      msg('Quick Start'),
      msg('START'),
      msg(
        'Sets up a clean first view with the most useful layers on and nothing cluttered.',
      ),
      msg(
        'Turns on Aircraft, Ships, Satellites and Earthquakes and turns every other layer and tool off. 3D models only up close, glow Low, readouts Minimal. Saved views are not touched.',
      ),
      { pinned: true, run: () => ctx.quickStart() },
    ),
    folder(
      msg('System'),
      msg('skin, keys, language'),
      msg(
        'Settings that decide how the whole app runs. Check these first if something is not working.',
      ),
      [
        select(
          'skin',
          msg('Skin'),
          msg(
            'The whole look of the app: colours, fonts, shapes and effects. Also in Change Skin at top right, with previews.',
          ),
          msg(
            'The screen powers down and restarts into the new skin, about 10 seconds. Layers you turned on stay on.',
          ),
          {
            options: () =>
              SKINS.filter((skin) => skin.available).map((skin) => ({
                value: skin.id,
                label: skin.name,
              })),
            get: () => ctx.skin(),
            set: (value) => ctx.changeSkin(value),
          },
        ),
        select(
          'phosphor-colour',
          msg('Phosphor Colour'),
          msg(
            'The one colour the Phosphor skin draws everything in. Also at the top of the screen.',
          ),
          msg('Changes straight away. Phosphor always starts in green.'),
          {
            options: () =>
              PHOSPHOR_COLOURS.map((colour) => ({
                value: colour.id,
                label: colour.label,
              })),
            get: () => ctx.phosphorColour(),
            set: (value) => ctx.setPhosphorColour(value),
            available: () => ctx.skin() === 'phosphor',
            unavailable: msg('Only used by the Phosphor skin.'),
          },
        ),
        toggle(
          'boot-animation',
          msg('Play Boot Animation'),
          msg(
            'Plays the power-down, restart and login sequence when you change skin.',
          ),
          msg('Off makes the switch instant. Nothing else changes.'),
          {
            get: () => ctx.bootAnimation(),
            set: (on) => ctx.setBootAnimation(on),
          },
        ),
        action(
          'keys',
          msg('Data Keys & Providers'),
          msg('OPEN'),
          msg(
            'Where you add API keys for Google 3D tiles and the feeds that need one.',
          ),
          msg(
            'Opens the key setup screen. Layers that need a missing key stay off until you add it.',
          ),
          {
            run: () =>
              dom.click('key-setup-chip') ||
              ctx.fail(
                msg('Data Keys & Providers'),
                msg(
                  'Key setup is only available when this app runs on its own development server.',
                ),
              ),
          },
        ),
        select(
          'language',
          msg('Language'),
          msg('Language for every label, notice and voice reply.'),
          msg(
            'The app reloads to apply it. Your camera position and layers are kept.',
          ),
          {
            options: () =>
              LOCALES.map((code) => ({
                value: code,
                label: LOCALE_NAMES[code] || code,
                raw: true,
              })),
            get: () => ctx.locale(),
            set: (value) => ctx.setLocale(value),
          },
        ),
      ],
      { open: true },
    ),
    folder(
      msg('Map & Camera'),
      msg('where you are looking'),
      msg('Which map you see and where the camera points.'),
      [
        select(
          'map-stack',
          msg('Map Imagery'),
          msg('The base map drawn under everything else.'),
          msg(
            'Switching reloads the map tiles for a few seconds. Some maps need a key.',
          ),
          {
            options: () =>
              (ctx.mapStacks() || []).map((stack) => ({
                value: stack.id,
                label: stack.label,
                raw: true,
                disabled: !stack.available,
              })),
            get: () => state().mapStack,
            set: (value) => ctx.setMapStack(value),
          },
        ),
        {
          id: 'go-to',
          type: 'search',
          label: msg('Go To a Place'),
          placeholder: msg('Place or coordinates'),
          desc: msg(
            'Search by place name or coordinates and fly the camera there.',
          ),
          result: msg(
            'The camera flies to the result. Live layers reload for the new area.',
          ),
          run: (query) => ctx.goTo(query),
        },
        toggle(
          'tilt',
          msg('Tilted View'),
          msg('Shows the map at an angle instead of straight down.'),
          msg(
            'Off points the camera straight down, which makes distances easier to judge.',
          ),
          {
            get: () => dom.pressed('tilt-map-view'),
            set: () => dom.click('tilt-map-view'),
          },
        ),
        action(
          'north',
          msg('Point North'),
          msg('RESET'),
          msg('Turns the map so north is at the top.'),
          msg('Only the bearing changes. Zoom and position stay.'),
          { run: () => dom.click('north-up-view') },
        ),
        action(
          'globe',
          msg('Back to Full Globe'),
          msg('RESET'),
          msg('Zooms all the way out to the whole planet.'),
          msg('Anything you were following is released.'),
          { run: () => dom.click('reset-globe-view') },
        ),
      ],
    ),
    liveDataFolder(ctx),
    folder(
      msg('Look & Filters'),
      msg('how the globe looks'),
      msg('Colour filters and visual effects on the globe.'),
      [
        select(
          'filter',
          msg('Globe Filter'),
          msg(
            'The colour treatment applied to the globe. Keys 1 to 8 pick one too.',
          ),
          msg(
            'Only the globe changes. The menu and text keep the current skin.',
          ),
          {
            options: () => GLOBE_FILTERS,
            get: () => state().style,
            set: (value) => ctx.setFilter(value),
            warn: () =>
              ctx.skin() === 'phosphor' && state().style !== 'phosphor'
                ? t(
                    'The Phosphor skin draws the globe in one colour. Another filter can make the colours clash.',
                  )
                : null,
          },
        ),
        select(
          'bloom',
          msg('Glow'),
          msg('Soft glow around bright lights and markers.'),
          msg(
            'Higher values look more like an old tube and cost a little performance.',
          ),
          {
            options: () =>
              STEP_LABELS.map((label, index) => ({
                value: String(index),
                label,
              })),
            get: () => {
              const bloom = state().bloom || {};
              return String(
                bloom.enabled
                  ? Math.max(
                      1,
                      nearestStep(BLOOM_STEPS, bloom.intensityPct ?? 0),
                    )
                  : 0,
              );
            },
            set: (value) => {
              const pct = BLOOM_STEPS[Number(value)] ?? 0;
              return ctx.sm.setBloom({
                enabled: pct > 0,
                ...(pct > 0 ? { intensityPct: pct } : {}),
              });
            },
          },
        ),
        select(
          'sharpen',
          msg('Sharpen'),
          msg('Crisper edges on map detail and text.'),
          msg('High can make imagery look grainy.'),
          {
            options: () =>
              STEP_LABELS.map((label, index) => ({
                value: String(index),
                label,
              })),
            get: () => {
              const sharpen = state().sharpen || {};
              return String(
                sharpen.enabled
                  ? Math.max(
                      1,
                      nearestStep(SHARPEN_STEPS, sharpen.intensityPct ?? 0),
                    )
                  : 0,
              );
            },
            set: (value) => {
              const pct = SHARPEN_STEPS[Number(value)] ?? 0;
              return ctx.sm.setSharpen({
                enabled: pct > 0,
                ...(pct > 0 ? { intensityPct: pct } : {}),
              });
            },
          },
        ),
        select(
          'hud',
          msg('Corner Readouts'),
          msg(
            'Coordinates, time, altitude and target data in the corners of the screen.',
          ),
          msg('Minimal leaves the most room for the map. Off hides them.'),
          {
            options: () => [
              { value: 'off', label: msg('Off') },
              { value: 'minimal', label: msg('Minimal') },
              { value: 'tactical', label: msg('Tactical') },
              { value: 'operator', label: msg('Operator') },
              { value: 'cyber', label: msg('Cyber') },
            ],
            get: () =>
              state().hud?.visible ? state().hud.layout || 'tactical' : 'off',
            set: (value) => ctx.setHud(value),
          },
        ),
        toggle(
          'scope',
          msg('Scope Mask'),
          msg('Shows the globe through a circular viewport, like a scope.'),
          msg('Everything outside the circle goes dark.'),
          {
            get: () => dom.pressed('scope-toggle'),
            set: () => dom.click('scope-toggle'),
          },
        ),
        select(
          'scope-feather',
          msg('Scope Edge Softness'),
          msg('How soft the edge of the Scope Mask is.'),
          msg('Only matters while Scope Mask is on.'),
          {
            options: () => FEATHER_STEPS,
            get: () => {
              const value = Number(
                dom.byId('scope-feather-slider')?.value ?? 11,
              );
              return FEATHER_STEPS[
                nearestStep(
                  FEATHER_STEPS.map((step) => Number(step.value)),
                  value,
                )
              ].value;
            },
            set: (value) => dom.setValue('scope-feather-slider', value),
            available: () => dom.pressed('scope-toggle'),
            unavailable: msg('Turn on Scope Mask first.'),
          },
        ),
        toggle(
          'clean-view',
          msg('Hide Everything'),
          msg(
            'Hides every control so only the globe shows, for screenshots and recording.',
          ),
          msg(
            'A small return button stays in the corner. Esc also brings the controls back.',
          ),
          {
            get: () => state().cleanView === true,
            set: (on) => ctx.sm.toggleCleanView(on),
          },
        ),
      ],
    ),
    folder(
      msg('Analysis Tools'),
      msg('detect, mark, measure'),
      msg('Tools that add information on top of the map.'),
      [
        select(
          'detection',
          msg('Detection Labels'),
          msg('Labels and boxes around the contacts the app tracks in view.'),
          msg('Busy areas can get crowded. Fewer keeps the map readable.'),
          {
            options: () => [
              { value: 'OFF', label: msg('Off') },
              { value: 'SPARSE', label: msg('Few') },
              { value: 'BALANCED', label: msg('Some') },
              { value: 'DENSE', label: msg('Many') },
            ],
            get: () => state().detection?.detectionMode || 'OFF',
            set: (value) =>
              value === 'OFF'
                ? ctx.sm.setDetection({ enabled: false })
                : ctx.sm.setDetection({
                    enabled: true,
                    mode: value.toLowerCase(),
                  }),
          },
        ),
        toggle(
          'sonar',
          msg('Contact Sonar'),
          msg('A sweeping ring that reveals nearby contacts in pulses.'),
          msg('Contacts fade between sweeps.'),
          {
            get: () => state().hud?.sonar?.enabled === true,
            set: (on) => ctx.sm.setCyberSonar({ enabled: on }),
          },
        ),
        toggle(
          'celestial',
          msg('Celestial Ring'),
          msg('A ring of sky data around the full globe view.'),
          msg(
            'Shows when you are zoomed out far enough to see the whole planet.',
          ),
          {
            get: () => state().celestialRing?.enabled === true,
            set: (on) => ctx.sm.setCelestialRingEnabled(on, { focus: on }),
          },
        ),
        toggle(
          'draw',
          msg('Draw on the Map'),
          msg(
            'Click points on the map to draw a shape; double-click or press Enter to finish.',
          ),
          msg(
            'While drawing, clicks on the map add points instead of selecting things.',
          ),
          {
            get: () => dom.pressed('draw-toggle'),
            set: () => dom.click('draw-toggle'),
          },
        ),
        action(
          'draw-clear',
          msg('Clear My Drawings'),
          msg('CLEAR'),
          msg('Removes every shape you drew.'),
          msg('This cannot be undone.'),
          { run: () => dom.click('draw-clear') },
        ),
        action(
          'import',
          msg('Import Map Files'),
          msg('OPEN'),
          msg('Shows your own GeoJSON, KML, KMZ or GPX files on the globe.'),
          msg(
            'Files stay on this computer. They can appear in shared screenshots.',
          ),
          { run: () => dom.click('geo-import-button') },
        ),
      ],
    ),
    folder(
      msg('Follow & Cockpit'),
      msg('ride along'),
      msg('Follow one aircraft or spacecraft and see what it sees.'),
      [
        action(
          'contacts',
          msg('Nearby Contacts'),
          msg('OPEN'),
          msg('A list of aircraft and ships near where you are looking.'),
          msg('Opens the contacts panel on the right. Pick one to follow it.'),
          { run: () => ctx.openContext('global-context-flights-btn') },
        ),
        action(
          'missions',
          msg('Space Missions'),
          msg('OPEN'),
          msg('Launches, spacecraft and orbital context.'),
          msg('Opens the space missions panel on the right.'),
          { run: () => ctx.openContext('global-context-missions-btn') },
        ),
        action(
          'cockpit',
          msg('Enter Cockpit View'),
          msg('OPEN'),
          msg('Puts the camera in the aircraft you are following.'),
          msg(
            'Needs an aircraft selected. The cockpit has its own controls; press Esc to leave.',
          ),
          {
            run: () =>
              dom.click('cockpit-entry') ||
              ctx.fail(
                msg('Enter Cockpit View'),
                msg(
                  'No aircraft is selected. Click an aircraft on the map first.',
                ),
              ),
          },
        ),
      ],
    ),
    folder(
      msg('Audio & Radio'),
      msg('listen and talk'),
      msg(
        'Radio, voice and sound. The quick radio controls are also in the top bar.',
      ),
      [
        ...ctx
          .layers()
          .filter((layer) => layer.id === 'radio')
          .map((layer) => layerNode(layer, ctx)),
        select(
          'radio-volume',
          msg('Radio Volume'),
          msg('How loud the radio plays.'),
          msg('Mute keeps the station playing silently.'),
          {
            options: () => [
              { value: '0', label: msg('Mute') },
              { value: '0.3', label: msg('Low') },
              { value: '0.6', label: msg('Medium') },
              { value: '1', label: msg('High') },
            ],
            get: () => {
              const volume = Number(ctx.radioState()?.volume ?? 0.8);
              return ['0', '0.3', '0.6', '1'].reduce((best, value) =>
                Math.abs(Number(value) - volume) <
                Math.abs(Number(best) - volume)
                  ? value
                  : best,
              );
            },
            set: (value) => ctx.setRadioVolume(Number(value)),
          },
        ),
        action(
          'lucky-reset',
          msg('Reset Feeling Lucky'),
          msg('RESET'),
          msg('Forgets which stations Feeling Lucky has already played.'),
          msg('The next press starts again from the nearest station.'),
          { run: () => ctx.resetLucky() },
        ),
        ...(dom.exists('radio-panel')
          ? [
              action(
                'radio-panel',
                msg('Full Radio Panel'),
                msg('OPEN'),
                msg(
                  'The full radio panel with the tuner dial, genre filter and the local receiver.',
                ),
                msg('Opens on the right of the screen.'),
                { run: () => ctx.openPanel('radio-panel', 'radio') },
              ),
            ]
          : []),
        toggle(
          'voice',
          msg('Voice Commands'),
          msg('Control the app by speaking. Hold Space to talk.'),
          msg(
            'Needs microphone permission and a voice provider key. If either is missing it turns itself back off.',
          ),
          {
            get: () => ctx.voiceActive(),
            set: () =>
              dom.click('gev-voice-button') ||
              ctx.fail(
                msg('Voice Commands'),
                msg('Voice control is not available in this build.'),
              ),
            available: () => dom.exists('gev-voice-button'),
            unavailable: msg('Voice control is not available in this build.'),
          },
        ),
      ],
    ),
    folder(
      msg('Saved Views'),
      msg('scenes, sharing, history'),
      msg('Save, share and replay what you see.'),
      [
        ...(dom.exists('scene-panel')
          ? [
              action(
                'scenes',
                msg('Scenes'),
                msg('OPEN'),
                msg(
                  'Saved camera paths, layers and filters you can play back like a film.',
                ),
                msg(
                  'Opens the scenes panel. Playing one replaces your current layers.',
                ),
                { run: () => ctx.openPanel('scene-panel') },
              ),
            ]
          : []),
        action(
          'share',
          msg('Copy Share Link'),
          msg('COPY'),
          msg('Copies a link that opens this exact view.'),
          msg('Anyone with the link sees the same place, layers and filter.'),
          { run: () => dom.click('share-btn') },
        ),
        action(
          'action-log',
          msg('Action Log'),
          msg('OPEN'),
          msg('Every click, change and failure in time order.'),
          msg('Opens the log panel. Nothing is changed.'),
          { run: () => ctx.openLog() },
        ),
      ],
    ),
  ];
}

/** Visit every node, depth first, with its parent. */
export function walkTree(nodes, visit, parent = null) {
  for (const node of nodes) {
    visit(node, parent);
    if (node.children) walkTree(node.children, visit, node);
  }
}

/** Does the node or anything under it match a search? */
export function nodeMatches(node, query) {
  if (!query) return true;
  const text =
    `${t(node.label)} ${node.desc ? t(node.desc) : ''}`.toLowerCase();
  if (text.includes(query)) return true;
  return (node.children || []).some((child) => nodeMatches(child, query));
}
