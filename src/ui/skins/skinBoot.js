import { t, msg } from '../../i18n/index.js';

// Pacing of an early-80s terminal: system text prints at about 60 characters
// a second, an operator types the login at human speed and the password one
// masked character at a time.
export const BOOT_TIMING = Object.freeze({
  systemCharMs: 17,
  loginCharMs: 110,
  passwordCharMs: 62,
  cursorBlinkMs: 150,
  memoryStepMs: 60,
  hexLineMs: 30,
  collapseMs: 700,
  afterglowMs: 900,
  decoStepMs: 600,
});

// Same length as the access phrase the owner picked (23 characters).
export const BOOT_PASSWORD = 'Ph0sph0r-Gr1d-0verwatch';
export const BOOT_LOGIN_MASK = '********';

const DECO_STEPS = Object.freeze([
  msg('WARMING THE TUBES'),
  msg('LOADING 3D MAP TILES'),
  msg('CONNECTING LIVE FEEDS'),
  msg('RESTORING YOUR LAYERS'),
  msg('READY'),
]);

function hexLine(random = Math.random) {
  const word = () =>
    Math.floor(random() * 0xffffff)
      .toString(16)
      .toUpperCase()
      .padStart(6, '0');
  return `0X${word()} 0X${word()}${word()}${word()}${word().slice(0, 5)}  ${word()}`;
}

/**
 * Drive the full-screen restart overlay used when the skin changes.
 * Any key or click skips to the end; reduced motion skips the animation.
 * @param {object} input
 * @param {HTMLElement} input.root The #skin-boot overlay.
 * @param {HTMLElement} input.screen Element collapsed like a CRT on power-down.
 * @param {() => boolean} [input.reduceMotion]
 */
export function createBootSequencer({
  root,
  screen,
  reduceMotion = () =>
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ===
    true,
}) {
  const consoleEl = root.querySelector('[data-skin-boot-console]');
  const afterglowEl = root.querySelector('[data-skin-boot-afterglow]');
  const decoEl = root.querySelector('[data-skin-boot-deco]');
  const progressEl = root.querySelector('[data-skin-boot-progress]');
  const stepEl = root.querySelector('[data-skin-boot-step]');
  let skipping = false;
  let running = false;
  let cancels = [];

  const wait = (ms) =>
    skipping || ms <= 0
      ? Promise.resolve()
      : new Promise((resolve) => {
          const id = setTimeout(resolve, ms);
          cancels.push(() => {
            clearTimeout(id);
            resolve();
          });
        });

  const line = (className) => {
    const span = document.createElement('span');
    if (className) span.className = className;
    consoleEl.appendChild(span);
    return span;
  };

  // Typing keeps to the clock rather than to timer callbacks, so a busy
  // main thread (a heavy globe frame) catches up instead of slowing the text.
  async function typeWith(span, length, ms, paint) {
    const start = performance.now();
    let shown = 0;
    while (shown < length && !skipping) {
      const due =
        ms > 0 ? Math.floor((performance.now() - start) / ms) + 1 : length;
      shown = Math.min(length, Math.max(shown + 1, due));
      paint(shown);
      await wait(ms);
    }
    paint(length, true);
    return span;
  }

  /** Run `count` timed steps on the clock; late steps are skipped, not queued. */
  async function steps(count, ms, onStep) {
    const start = performance.now();
    let last = -1;
    while (last < count - 1 && !skipping) {
      const due = Math.min(
        count - 1,
        Math.floor((performance.now() - start) / ms),
      );
      if (due > last) {
        last = due;
        onStep(due);
      }
      await wait(ms);
    }
    if (last < count - 1) onStep(count - 1, true);
  }

  function type(text, ms, className) {
    const span = line(className);
    const characters = [...text];
    return typeWith(span, characters.length, ms, (count) => {
      span.textContent = characters.slice(0, count).join('');
    });
  }

  function typePassword(text, ms) {
    const span = line();
    return typeWith(span, text.length, ms, (count, done) => {
      // Each character shows for one keystroke before it is masked.
      span.textContent = done
        ? '*'.repeat(text.length)
        : '*'.repeat(count - 1) + text[count - 1];
    });
  }

  async function blinkCursor(times) {
    const cursor = document.createElement('span');
    cursor.className = 'skin-boot-cursor';
    consoleEl.appendChild(cursor);
    await steps(times * 2, BOOT_TIMING.cursorBlinkMs, (index) =>
      cursor.classList.toggle('off', index % 2 === 0),
    );
    cursor.remove();
  }

  function afterglow() {
    afterglowEl.classList.remove('go');
    void afterglowEl.offsetWidth;
    afterglowEl.classList.add('go');
  }

  function reset() {
    consoleEl.textContent = '';
    consoleEl.className = 'skin-boot-console';
    decoEl.classList.remove('show', 'visible');
    progressEl.style.width = '0';
    stepEl.textContent = '';
    screen.classList.remove('skin-crt-off');
    root.classList.remove('dark', 'phosphor');
  }

  function skip() {
    if (!running || skipping) return;
    skipping = true;
    for (const cancel of cancels) cancel();
    cancels = [];
  }

  const onKey = (event) => {
    event.preventDefault();
    event.stopPropagation();
    skip();
  };

  function begin() {
    running = true;
    skipping = reduceMotion();
    reset();
    root.hidden = false;
    document.body.classList.add('skin-booting');
    globalThis.addEventListener('keydown', onKey, true);
    root.addEventListener('pointerdown', skip);
  }

  function end() {
    globalThis.removeEventListener('keydown', onKey, true);
    root.removeEventListener('pointerdown', skip);
    reset();
    root.hidden = true;
    document.body.classList.remove('skin-booting');
    running = false;
    skipping = false;
    cancels = [];
  }

  /** CRT collapse, then the BIOS, memory test and operator login. */
  async function powerOnPhosphor({ onSwap }) {
    begin();
    const T = BOOT_TIMING;
    root.classList.add('phosphor');
    screen.classList.add('skin-crt-off');
    await wait(T.collapseMs);
    root.classList.add('dark');
    afterglow();
    await wait(T.afterglowMs);
    screen.classList.remove('skin-crt-off');
    onSwap();
    await wait(250);
    consoleEl.classList.add('on');
    await type('PHOSPHOR BIOS v2.89   (C) 2289 GEV SYSTEMS\n', T.systemCharMs);
    await type('CPU 8088 @ 4.77 MHZ   CRT 60 HZ INTERLACED\n', T.systemCharMs);
    const memory = line();
    await steps(21, T.memoryStepMs, (index) => {
      memory.textContent = `${t('MEMORY TEST')}  ${String(index * 32).padStart(3, '0')}K`;
    });
    // i18n-ignore: memory size and OK stay as the machine prints them
    memory.textContent = `${t('MEMORY TEST')}  640K  OK\n`;
    let hexShown = 0;
    await steps(20, T.hexLineMs, (index, final) => {
      if (final) return;
      for (; hexShown <= index; hexShown += 1)
        line('hex').textContent = `${hexLine()}\n`;
    });
    consoleEl.classList.remove('on');
    void consoleEl.offsetWidth;
    consoleEl.classList.add('wobble');
    await type(`\n${t('LOADING GEV-OS 3.1')} ........ OK\n`, T.systemCharMs);
    await type(`${t('TERMINAL 08 READY')}\n\n`, T.systemCharMs);
    await blinkCursor(4);
    await type(`${t('LOGIN:')}    `, T.systemCharMs);
    await type(`${BOOT_LOGIN_MASK}\n`, T.loginCharMs);
    await wait(250);
    await type(`${t('PASSWORD:')} `, T.systemCharMs);
    await typePassword(BOOT_PASSWORD, T.passwordCharMs);
    line().textContent = '\n';
    await wait(300);
    await type(
      `\n${t('ACCESS GRANTED')}\n${t('WELCOME, OPERATOR.')}\n`,
      T.systemCharMs,
    );
    await blinkCursor(2);
    await wait(200);
    const skipped = skipping;
    end();
    return { skipped };
  }

  /** Log off, halt, green collapse, then the Deco warm-up screen. */
  async function powerDownToDeco({ onSwap }) {
    begin();
    const T = BOOT_TIMING;
    root.classList.add('phosphor', 'dark');
    consoleEl.classList.add('on');
    await type(
      `${t('LOGGING OFF OPERATOR')} ${BOOT_LOGIN_MASK}\n`,
      T.systemCharMs,
    );
    await type(`${t('SAVING SETTINGS')} ............ OK\n`, T.systemCharMs);
    await type(`${t('CLOSING LIVE FEEDS')} ......... OK\n`, T.systemCharMs);
    await type(`${t('SYSTEM HALTED. SAFE TO SWITCH.')}\n`, T.systemCharMs);
    await wait(500);
    consoleEl.classList.remove('on');
    consoleEl.classList.add('off');
    await wait(T.collapseMs);
    consoleEl.textContent = '';
    afterglow();
    await wait(1000);
    root.classList.remove('phosphor');
    onSwap();
    decoEl.classList.add('show');
    void decoEl.offsetWidth;
    decoEl.classList.add('visible');
    await steps(DECO_STEPS.length, T.decoStepMs, (index, final) => {
      stepEl.textContent = t(DECO_STEPS[index]);
      if (final) progressEl.style.transition = 'none';
      progressEl.style.width = `${((index + 1) / DECO_STEPS.length) * 100}%`;
    });
    await wait(T.decoStepMs);
    decoEl.classList.remove('visible');
    await wait(400);
    const skipped = skipping;
    end();
    return { skipped };
  }

  return {
    get running() {
      return running;
    },
    powerOnPhosphor,
    powerDownToDeco,
    skip,
    destroy() {
      skip();
      end();
    },
  };
}
