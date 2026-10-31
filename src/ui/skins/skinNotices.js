import { t, msg } from '../../i18n/index.js';

export const NOTICE_LIFETIME_MS = 10_000;
export const MAX_NOTICES = 4;
export const MAX_LOG_ENTRIES = 500;

// Entry kinds are machine ids (CSS lg-* classes); only the label translates.
const LOG_KIND_LABELS = Object.freeze({
  click: msg('CLICK'),
  on: msg('ON'),
  off: msg('OFF'),
  set: msg('SET'),
  run: msg('RUN'),
  radio: msg('RADIO'),
  warn: msg('WARN'),
  fail: msg('FAIL'),
  system: msg('SYSTEM'),
});

export function logTime(date = new Date()) {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

/**
 * Compact notices (one title line, at most two lines of text, click to
 * dismiss) and the Action Log, which keeps every click, change and failure.
 * @param {object} input
 * @param {HTMLElement} input.host Notice stack.
 * @param {HTMLElement} input.logList Its <ol>.
 * @param {HTMLElement} input.logButton Footer button that shows the count.
 */
export function createNotices({ host, logList, logButton }) {
  const entries = [];
  const timers = new Set();

  function renderLog() {
    logButton.textContent = t('ACTION LOG ({count})', {
      count: entries.length,
    });
    logList.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.className = 'skin-log-empty';
      empty.textContent = t(
        'Nothing yet. Every click lands here with its time.',
      );
      logList.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const row = document.createElement('li');
      row.className = `lg-${entry.kind}`;
      const time = document.createElement('time');
      time.textContent = entry.time;
      const kind = document.createElement('span');
      kind.className = 'skin-log-kind';
      kind.textContent = t(
        LOG_KIND_LABELS[entry.kind] || LOG_KIND_LABELS.click,
      );
      const text = document.createElement('span');
      text.textContent = entry.text;
      row.append(time, kind, text);
      logList.appendChild(row);
    }
  }

  /** Add one line to the Action Log, newest first. */
  function log(kind, text) {
    entries.unshift({ time: logTime(), kind, text: String(text) });
    if (entries.length > MAX_LOG_ENTRIES) entries.length = MAX_LOG_ENTRIES;
    renderLog();
  }

  /**
   * Show a notice for ten seconds. Failures and warnings also go to the log.
   * @param {'info'|'warn'|'fail'} kind
   */
  function notify(kind, title, body = '') {
    const notice = document.createElement('div');
    notice.className = `skin-notice t-${kind}`;
    notice.setAttribute('role', kind === 'fail' ? 'alert' : 'status');
    notice.title = t('Click to dismiss. Kept in the Action Log.');
    const icon = document.createElement('span');
    icon.className = 'skin-notice-icon';
    icon.setAttribute('aria-hidden', 'true');
    const textBox = document.createElement('div');
    const heading = document.createElement('b');
    heading.textContent = title;
    const paragraph = document.createElement('p');
    paragraph.textContent = body;
    textBox.append(heading, paragraph);
    const drain = document.createElement('i');
    drain.setAttribute('aria-hidden', 'true');
    notice.append(icon, textBox, drain);
    const remove = () => notice.remove();
    notice.addEventListener('click', remove);
    host.prepend(notice);
    while (host.children.length > MAX_NOTICES) host.lastElementChild.remove();
    const timer = setTimeout(() => {
      timers.delete(timer);
      remove();
    }, NOTICE_LIFETIME_MS);
    timers.add(timer);
    if (kind === 'fail' || kind === 'warn')
      log(kind, body ? `${title}: ${body}` : title);
    return notice;
  }

  function clearNotices() {
    host.replaceChildren();
  }

  function clearLog() {
    entries.length = 0;
    renderLog();
  }

  renderLog();
  return {
    log,
    notify,
    clearNotices,
    clearLog,
    get entries() {
      return entries.slice();
    },
    destroy() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      clearNotices();
    },
  };
}
