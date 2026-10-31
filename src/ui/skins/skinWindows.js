import { t } from '../../i18n/index.js';

/*
 * Floating windows. A tool panel the app already has (radio, cameras,
 * scenes …) opens as a skinned window with a title bar, a close ×, a drag
 * handle and a resize grip, instead of squeezing into its old rail. While
 * open the panel lives in the shell's window layer (the old rails are
 * hidden and transformed, which would trap it); closing puts it back
 * exactly where it was, so the app finds it in its usual place again.
 */

export const WINDOW_MIN = Object.freeze({ width: 280, height: 180 });
const CASCADE_STEP = 28;

function px(value) {
  return `${Math.round(value)}px`;
}

/**
 * The room windows may use: below the top bar, above the footer.
 * @param {Window} view
 * @param {Element} root Element carrying the --skin-top-h/--skin-foot-h vars.
 */
export function windowBounds(view, root) {
  const style = view?.getComputedStyle?.(root);
  const read = (name, fallback) => {
    const value = parseFloat(style?.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const top = read('--skin-top-h', 60);
  const bottom = (view?.innerHeight || 800) - read('--skin-foot-h', 44);
  return { left: 0, top, right: view?.innerWidth || 1200, bottom };
}

/**
 * Keep a window's title bar on screen: it may hang off the sides or the
 * bottom, but never so far that it cannot be dragged back.
 */
export function clampToBounds(rect, bounds, grip = 80) {
  const width = Math.max(WINDOW_MIN.width, rect.width);
  const height = Math.max(WINDOW_MIN.height, rect.height);
  const x = Math.min(
    Math.max(rect.x, bounds.left - width + grip),
    bounds.right - grip,
  );
  const y = Math.min(Math.max(rect.y, bounds.top), bounds.bottom - 32);
  return { x, y, width, height };
}

/**
 * Drag `target` by `handle`. Buttons and fields inside the handle keep
 * their clicks. `onMove` gets the new top-left corner.
 */
export function makeDraggable(handle, { getRect, onMove, onDone, signal }) {
  handle.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      if (event.target.closest('button, select, input, a')) return;
      const start = getRect();
      const originX = event.clientX;
      const originY = event.clientY;
      handle.setPointerCapture?.(event.pointerId);
      const move = (moveEvent) =>
        onMove({
          x: start.x + moveEvent.clientX - originX,
          y: start.y + moveEvent.clientY - originY,
        });
      const end = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        onDone?.();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
      event.preventDefault();
    },
    { signal },
  );
}

/**
 * @param {object} input
 * @param {Document} input.documentRef
 * @param {HTMLElement} input.host The window layer windows live in while open.
 * @param {(kind: string, text: string) => void} input.log Action Log.
 * @param {() => number} input.leftInset Width the open menu takes.
 */
export function createWindowManager({ documentRef, host, log, leftInset }) {
  const view = documentRef.defaultView;
  const root = documentRef.documentElement;
  const abort = new AbortController();
  const frames = new Map();
  let stack = 0;
  let opened = 0;

  const bounds = () => windowBounds(view, root);

  function paint(panel, rect) {
    const frame = frames.get(panel);
    const next = clampToBounds(rect, bounds());
    frame.rect = next;
    panel.style.setProperty('--skin-win-x', px(next.x));
    panel.style.setProperty('--skin-win-y', px(next.y));
    panel.style.setProperty('--skin-win-w', px(next.width));
    panel.style.setProperty('--skin-win-h', px(next.height));
  }

  function front(panel) {
    stack += 1;
    panel.style.setProperty('--skin-win-z', String(stack));
    for (const [other] of frames)
      other.classList.toggle('skin-window-front', other === panel);
  }

  function firstRect(side) {
    const area = bounds();
    const width = Math.min(460, area.right - area.left - 32);
    const height = Math.min(640, area.bottom - area.top - 24);
    const step = (opened % 6) * CASCADE_STEP;
    opened += 1;
    // From the menu: beside it, where the eye already is. Opened by the app
    // itself (a picked camera, a street photo): on the right, where those
    // panels always were, so the middle of the globe stays clear.
    const x =
      side === 'right'
        ? Math.max((leftInset?.() || 0) + 16, area.right - width - 16 - step)
        : Math.min((leftInset?.() || 0) + 16 + step, area.right - width - 16);
    return { x, y: area.top + 12 + step, width, height };
  }

  function frameFor(panel, title, onClose) {
    if (frames.has(panel)) {
      const frame = frames.get(panel);
      frame.onClose = onClose;
      frame.titleEl.textContent = title;
      return frame;
    }
    const bar = documentRef.createElement('div');
    bar.className = 'skin-window-bar';
    const titleEl = documentRef.createElement('span');
    titleEl.className = 'skin-window-title';
    titleEl.textContent = title;
    const close = documentRef.createElement('button');
    close.type = 'button';
    close.className = 'skin-window-close';
    close.textContent = '×';
    close.setAttribute('aria-label', t('Close panel'));
    close.title = t('Close panel');
    bar.append(titleEl, close);
    const grip = documentRef.createElement('div');
    grip.className = 'skin-window-grip';
    grip.setAttribute('aria-hidden', 'true');
    grip.title = t('Drag to resize');
    panel.prepend(bar);
    panel.append(grip);
    const frame = {
      bar,
      grip,
      titleEl,
      rect: null,
      onClose,
      home: documentRef.createComment('skin-window home'),
    };
    frames.set(panel, frame);

    close.addEventListener(
      'click',
      (event) => {
        event.stopPropagation();
        closeWindow(panel);
      },
      { signal: abort.signal },
    );
    panel.addEventListener('pointerdown', () => front(panel), {
      signal: abort.signal,
      capture: true,
    });
    makeDraggable(bar, {
      signal: abort.signal,
      getRect: () => frame.rect,
      onMove: ({ x, y }) => paint(panel, { ...frame.rect, x, y }),
    });
    makeDraggable(grip, {
      signal: abort.signal,
      getRect: () => ({ x: frame.rect.width, y: frame.rect.height }),
      onMove: ({ x, y }) =>
        paint(panel, { ...frame.rect, width: x, height: y }),
    });
    return frame;
  }

  /**
   * Show `panel` as a window. Opening one that is already open brings it
   * to the front.
   */
  function open(panel, { title = '', onClose, side = 'left' } = {}) {
    if (!panel) return false;
    const frame = frameFor(panel, title, onClose);
    if (!panel.classList.contains('skin-window')) {
      if (host && panel.parentNode !== host) {
        panel.before(frame.home);
        host.append(panel);
      }
      paint(panel, frame.rect || firstRect(side));
      panel.classList.add('skin-window', 'skin-panel-open');
    }
    front(panel);
    return true;
  }

  function closeWindow(panel, { quiet = false } = {}) {
    const frame = frames.get(panel);
    if (!frame || !panel.classList.contains('skin-window')) return;
    panel.classList.remove('skin-window', 'skin-panel-open');
    goHome(frame, panel);
    if (!quiet)
      log?.(
        'click',
        t('Closed {name}', { name: frame.titleEl.textContent || t('a panel') }),
      );
    frame.onClose?.();
  }

  function goHome(frame, panel) {
    if (frame.home.parentNode) frame.home.replaceWith(panel);
  }

  // Keep windows reachable when the browser window shrinks.
  view?.addEventListener(
    'resize',
    () => {
      for (const [panel, frame] of frames)
        if (frame.rect) paint(panel, frame.rect);
    },
    { signal: abort.signal },
  );

  return {
    open,
    close: closeWindow,
    isOpen: (panel) => panel?.classList.contains('skin-window') === true,
    closeAll() {
      for (const [panel] of frames) closeWindow(panel, { quiet: true });
    },
    destroy() {
      abort.abort();
      for (const [panel, frame] of frames) {
        panel.classList.remove('skin-window', 'skin-panel-open');
        goHome(frame, panel);
        frame.bar.remove();
        frame.grip.remove();
        for (const name of ['x', 'y', 'w', 'h', 'z'])
          panel.style.removeProperty(`--skin-win-${name}`);
      }
      frames.clear();
    },
  };
}
