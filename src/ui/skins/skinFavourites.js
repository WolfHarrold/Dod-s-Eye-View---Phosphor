import { t } from '../../i18n/index.js';
import { walkTree } from './skinMenuModel.js';
import { createMenuTree } from './skinMenuTree.js';
import { clampToBounds, makeDraggable, windowBounds } from './skinWindows.js';

/*
 * Favourites: a floating menu of the settings someone starred in the main
 * menu. The rows are the same live controls as in the menu (a toggle here
 * and there are one setting). It collapses to a slim bar and opens again
 * from it, and it remembers its place, its rows and whether it is open.
 */

const FAVOURITES_WIDTH = 330;

/** Find the leaves with these ids, in the order they were starred. */
export function favouriteNodes(nodes, ids) {
  const byId = new Map();
  walkTree(nodes, (node) => {
    if (node.id && node.type !== 'folder') byId.set(node.id, node);
  });
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** Add or remove one id; new favourites go to the end of the list. */
export function toggleFavourite(ids, id) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

/**
 * @param {object} input
 * @param {HTMLElement} input.root #skin-fav
 * @param {object} input.prefs Skin preferences; favourites fields are kept here.
 * @param {() => void} input.save Writes prefs.
 * @param {() => object[]} input.getNodes The main menu tree.
 * @param {Function} input.onUse Same handler as the main menu.
 * @param {(kind: string, text: string) => void} input.log Action Log.
 * @param {() => void} input.onChange Called after a star is added or removed.
 */
export function createFavourites({
  root,
  prefs,
  save,
  getNodes,
  onUse,
  log,
  onChange,
}) {
  const documentRef = root.ownerDocument;
  const view = documentRef.defaultView;
  const abort = new AbortController();
  const bar = root.querySelector('[data-skin-fav-bar]');
  const body = root.querySelector('[data-skin-fav-body]');
  const count = root.querySelector('[data-skin-fav-count]');
  const empty = root.querySelector('[data-skin-fav-empty]');
  const collapseButton = root.querySelector('[data-skin-fav-collapse]');
  const treeEl = root.querySelector('[data-skin-fav-tree]');

  const api = {
    has: (id) => prefs.favourites.includes(id),
    toggle(node) {
      const adding = !prefs.favourites.includes(node.id);
      prefs.favourites = toggleFavourite(prefs.favourites, node.id);
      save();
      log(
        'set',
        adding
          ? t('Added {name} to Favourites', { name: t(node.label) })
          : t('Removed {name} from Favourites', { name: t(node.label) }),
      );
      // A first star opens a collapsed bar so the new row is seen.
      if (adding && prefs.favouritesCollapsed) setCollapsed(false);
      render();
      onChange?.();
    },
  };

  // The favourites list has no search box or description card of its own.
  const tree = createMenuTree({
    treeEl,
    infoEl: documentRef.createElement('div'),
    findEl: documentRef.createElement('input'),
    getNodes: () => favouriteNodes(getNodes(), prefs.favourites),
    onUse,
    log,
    favourites: api,
  });

  let position = prefs.favouritesPos;
  function place(next) {
    const bounds = windowBounds(view, documentRef.documentElement);
    const width = root.offsetWidth || FAVOURITES_WIDTH;
    const fallback = {
      x: bounds.right - width - 16,
      y: bounds.top + 12,
    };
    const rect = clampToBounds(
      { ...(next || fallback), width, height: 200 },
      bounds,
    );
    position = { x: Math.round(rect.x), y: Math.round(rect.y) };
    root.style.setProperty('--skin-fav-x', `${position.x}px`);
    root.style.setProperty('--skin-fav-y', `${position.y}px`);
  }
  makeDraggable(bar, {
    signal: abort.signal,
    getRect: () => position,
    onMove: place,
    onDone: () => {
      prefs.favouritesPos = position;
      save();
    },
  });
  view?.addEventListener('resize', () => place(position), {
    signal: abort.signal,
  });

  function setCollapsed(collapsed, { quiet = false } = {}) {
    prefs.favouritesCollapsed = collapsed;
    root.classList.toggle('collapsed', collapsed);
    body.hidden = collapsed;
    collapseButton.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed
      ? t('Open Favourites')
      : t('Collapse Favourites to a bar');
    collapseButton.setAttribute('aria-label', label);
    collapseButton.title = label;
    collapseButton.textContent = collapsed ? '+' : '–';
    if (!quiet) {
      save();
      log(
        'click',
        collapsed ? t('Collapsed Favourites') : t('Opened Favourites'),
      );
    }
    if (!collapsed) tree.render();
  }
  collapseButton.addEventListener(
    'click',
    (event) => {
      event.stopPropagation();
      setCollapsed(!prefs.favouritesCollapsed);
    },
    { signal: abort.signal },
  );
  // Double-clicking the bar does the same as its button.
  bar.addEventListener(
    'dblclick',
    (event) => {
      if (event.target.closest('button')) return;
      setCollapsed(!prefs.favouritesCollapsed);
    },
    { signal: abort.signal },
  );

  function render() {
    const total = favouriteNodes(getNodes(), prefs.favourites).length;
    count.textContent = total ? String(total) : '';
    empty.hidden = total > 0;
    if (!prefs.favouritesCollapsed) tree.render();
  }

  root.hidden = false;
  setCollapsed(prefs.favouritesCollapsed, { quiet: true });
  place(position);

  return {
    api,
    render,
    destroy() {
      abort.abort();
      tree.destroy();
      root.hidden = true;
    },
  };
}
