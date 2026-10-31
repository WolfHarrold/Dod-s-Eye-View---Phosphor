import { t } from '../../i18n/index.js';
import { nodeMatches, walkTree } from './skinMenuModel.js';

/*
 * Windows 98 Explorer-style tree: +/− boxes, dotted connectors, one control
 * column. Hovering or arrowing to a row fills the description card below.
 * Keys: ↑ ↓ move, → open, ← close, Enter use.
 */

const optionLabel = (option) => t(option.label);

function warningOf(node) {
  try {
    return node.warn?.() || null;
  } catch {
    return null;
  }
}

function statusOf(node) {
  try {
    return node.status?.() || null;
  } catch {
    return null;
  }
}

function availableOf(node) {
  try {
    return node.available ? node.available() !== false : true;
  } catch {
    return true;
  }
}

function valueOf(node) {
  try {
    return node.get?.();
  } catch {
    return undefined;
  }
}

/**
 * @param {object} input
 * @param {HTMLElement} input.treeEl The [role=tree] container.
 * @param {HTMLElement} input.infoEl The description card.
 * @param {HTMLInputElement} input.findEl "Find a setting" box.
 * @param {() => object[]} input.getNodes Current tree.
 * @param {(node: object, kind: string, value?: unknown) => void} input.onUse
 *   Called for every use: kind is 'toggle', 'select', 'action' or 'search'.
 * @param {(kind: string, text: string) => void} input.log Action Log.
 */
export function createMenuTree({
  treeEl,
  infoEl,
  findEl,
  getNodes,
  onUse,
  log,
}) {
  const openFolders = new Set();
  let rows = [];
  let cursor = -1;
  let initialised = false;

  const folderKey = (node, parent) =>
    `${parent ? folderKey(parent.node, parent.parent) + '/' : ''}${node.label}`;

  function control(node) {
    const label = t(node.label);
    const available = availableOf(node);
    if (node.type === 'toggle') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'skin-toggle';
      const on = valueOf(node) === true;
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', label);
      button.disabled = !available;
      const onText = document.createElement('span');
      onText.className = 'on';
      onText.textContent = t('ON');
      const offText = document.createElement('span');
      offText.className = 'off';
      offText.textContent = t('OFF');
      button.append(onText, offText);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onUse(node, 'toggle', !on);
      });
      return button;
    }
    if (node.type === 'select') {
      const field = document.createElement('select');
      field.className = 'skin-select';
      field.setAttribute('aria-label', label);
      field.disabled = !available;
      const current = valueOf(node);
      let options = [];
      try {
        options = node.options?.() || [];
      } catch {
        options = [];
      }
      for (const option of options) {
        const element = document.createElement('option');
        element.value = option.value;
        element.textContent = optionLabel(option);
        element.disabled = option.disabled === true;
        if (String(option.value) === String(current)) element.selected = true;
        field.appendChild(element);
      }
      field.addEventListener('click', (event) => event.stopPropagation());
      field.addEventListener('change', () =>
        onUse(node, 'select', field.value),
      );
      return field;
    }
    if (node.type === 'search') {
      const form = document.createElement('form');
      form.className = 'skin-tree-search';
      const input = document.createElement('input');
      input.type = 'search';
      input.className = 'skin-input';
      input.placeholder = t(node.placeholder || node.label);
      input.setAttribute('aria-label', label);
      input.autocomplete = 'off';
      form.appendChild(input);
      form.addEventListener('click', (event) => event.stopPropagation());
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const query = input.value.trim();
        if (query) onUse(node, 'search', query);
      });
      return form;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'skin-action';
    button.textContent = t(node.verb);
    button.setAttribute('aria-label', `${t(node.verb)} ${label}`);
    button.disabled = !available;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onUse(node, 'action');
    });
    return button;
  }

  function build(nodes, depth, query, parent) {
    const list = document.createElement('ul');
    list.setAttribute('role', depth ? 'group' : 'none');
    for (const node of nodes) {
      if (!nodeMatches(node, query)) continue;
      const item = document.createElement('li');
      item.setAttribute('role', 'treeitem');
      const row = document.createElement('div');
      row.className = 'skin-tree-row';
      const index = rows.length;
      const entry = { node, row, parent, key: null };
      rows.push(entry);
      row.addEventListener('mouseenter', () => {
        cursor = index;
        paintCursor();
      });
      if (node.type === 'folder') {
        const key = folderKey(node, parent);
        entry.key = key;
        const open = query ? true : openFolders.has(key);
        item.setAttribute('aria-expanded', String(open));
        const box = document.createElement('span');
        box.className = `skin-tree-box${open ? ' open' : ''}`;
        box.setAttribute('aria-hidden', 'true');
        const title = document.createElement('span');
        title.className = 'skin-tree-folder';
        title.textContent = t(node.label).toLocaleUpperCase();
        if (node.hint) {
          const hint = document.createElement('small');
          hint.textContent = t(node.hint);
          title.appendChild(hint);
        }
        row.append(box, title);
        row.classList.add('folder');
        row.addEventListener('click', () => toggleFolder(entry));
        item.appendChild(row);
        if (open)
          item.appendChild(build(node.children, depth + 1, query, entry));
      } else {
        if (node.type === 'toggle' && valueOf(node) === true)
          row.classList.add('on');
        if (node.pinned) row.classList.add('pinned');
        if (!availableOf(node)) row.classList.add('unavailable');
        const mark = document.createElement('span');
        mark.className = 'skin-tree-mark';
        mark.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'skin-tree-label';
        name.textContent = t(node.label);
        row.append(mark, name);
        if (warningOf(node) || statusOf(node)) {
          const badge = document.createElement('span');
          badge.className = 'skin-warn-badge';
          badge.textContent = '!';
          badge.title = warningOf(node) || t(statusOf(node));
          row.appendChild(badge);
        }
        row.appendChild(control(node));
        item.appendChild(row);
      }
      list.appendChild(item);
    }
    return list;
  }

  function render() {
    const nodes = getNodes();
    if (!initialised) {
      walkTree(nodes, (node) => {
        if (node.type === 'folder' && node.open) openFolders.add(node.label);
      });
      initialised = true;
    }
    const query = findEl.value.trim().toLowerCase();
    const focusedInTree = treeEl.contains(document.activeElement);
    rows = [];
    treeEl.replaceChildren(build(nodes, 0, query, null));
    if (cursor >= rows.length) cursor = rows.length - 1;
    paintCursor();
    if (focusedInTree && !treeEl.contains(document.activeElement))
      treeEl.focus({ preventScroll: true });
  }

  function toggleFolder(entry) {
    const open = !openFolders.has(entry.key);
    if (open) openFolders.add(entry.key);
    else openFolders.delete(entry.key);
    log(
      'click',
      `${open ? t('Opened folder') : t('Closed folder')} ${t(entry.node.label)}`,
    );
    render();
  }

  function addInfo(label, text) {
    if (!text) return;
    const key = document.createElement('span');
    key.className = 'skin-info-key';
    key.textContent = label;
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    infoEl.append(key, paragraph);
  }

  function paintCursor() {
    rows.forEach((entry, index) =>
      entry.row.classList.toggle('cursor', index === cursor),
    );
    infoEl.replaceChildren();
    const entry = rows[cursor];
    infoEl.classList.toggle('idle', !entry);
    const heading = document.createElement('h3');
    if (!entry) {
      heading.textContent = t('Settings');
      infoEl.appendChild(heading);
      addInfo(
        '',
        t(
          'Hover or arrow to a row to see what it does and what changes if you use it.',
        ),
      );
      addInfo(
        t('KEYS'),
        t('↑ ↓ move · → open · ← close · Enter use · M hide menu'),
      );
      return;
    }
    const { node } = entry;
    heading.textContent = t(node.label);
    infoEl.appendChild(heading);
    addInfo(t('WHAT IT DOES'), node.desc && t(node.desc));
    addInfo(t('WHAT HAPPENS'), node.result && t(node.result));
    if (node.type === 'toggle')
      addInfo(t('NOW'), valueOf(node) === true ? t('On') : t('Off'));
    if (node.type === 'select') {
      const current = valueOf(node);
      let option;
      try {
        option = node
          .options?.()
          .find((item) => String(item.value) === String(current));
      } catch {
        option = null;
      }
      if (option) addInfo(t('NOW'), optionLabel(option));
    }
    if (node.type === 'folder')
      addInfo(
        t('CONTAINS'),
        node.children.map((child) => t(child.label)).join(', '),
      );
    if (!availableOf(node) && node.unavailable)
      addInfo(t('NOT AVAILABLE'), t(node.unavailable));
    const warning =
      node.type === 'folder'
        ? null
        : warningOf(node) || (statusOf(node) && t(statusOf(node)));
    if (warning) {
      const box = document.createElement('div');
      box.className = 'skin-info-warning';
      const label = document.createElement('b');
      label.textContent = `${t('WARNING')} `;
      box.append(label, document.createTextNode(warning));
      infoEl.appendChild(box);
    }
  }

  function onKeydown(event) {
    if (event.target.matches('input, select')) return;
    const entry = rows[cursor];
    const isFolder = entry?.node.type === 'folder';
    const open = isFolder && openFolders.has(entry.key);
    if (event.key === 'ArrowDown') {
      cursor = Math.min(rows.length - 1, cursor + 1);
    } else if (event.key === 'ArrowUp') {
      cursor = Math.max(0, cursor - 1);
    } else if (event.key === 'ArrowRight' && isFolder && !open) {
      toggleFolder(entry);
    } else if (event.key === 'ArrowLeft' && isFolder && open) {
      toggleFolder(entry);
    } else if (event.key === 'ArrowLeft' && entry?.parent) {
      cursor = rows.indexOf(entry.parent);
    } else if (event.key === 'Enter' && entry) {
      if (isFolder) toggleFolder(entry);
      else if (entry.node.type === 'toggle')
        onUse(entry.node, 'toggle', valueOf(entry.node) !== true);
      else if (entry.node.type === 'action') onUse(entry.node, 'action');
      else entry.row.querySelector('select, input')?.focus();
    } else {
      return;
    }
    event.preventDefault();
    paintCursor();
    rows[cursor]?.row.scrollIntoView({ block: 'nearest' });
  }

  function setAll(open) {
    walkTree(getNodes(), () => {});
    for (const entry of rows) {
      if (entry.node.type !== 'folder') continue;
      if (open) openFolders.add(entry.key);
      else openFolders.delete(entry.key);
    }
    if (open) {
      // Rendering opens one level at a time; repeat until nothing new appears.
      let before;
      do {
        before = openFolders.size;
        render();
        for (const entry of rows)
          if (entry.node.type === 'folder') openFolders.add(entry.key);
      } while (openFolders.size !== before);
    } else {
      openFolders.clear();
      cursor = 0;
    }
    render();
  }

  treeEl.tabIndex = 0;
  treeEl.addEventListener('keydown', onKeydown);
  const onFind = () => {
    cursor = 0;
    render();
  };
  findEl.addEventListener('input', onFind);

  return {
    render,
    openAll: () => setAll(true),
    closeAll: () => setAll(false),
    destroy() {
      treeEl.removeEventListener('keydown', onKeydown);
      findEl.removeEventListener('input', onFind);
    },
  };
}
