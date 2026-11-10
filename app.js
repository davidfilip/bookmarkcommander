'use strict';

const panesElement = document.querySelector('#panes');
const message = document.querySelector('#message');
let root = { id: 'root', title: 'Bookmarks', children: [] };
let nodes = new Map();
let active = 0;
const panes = [0, 1].map(() => ({ folder: 'root', selected: 0 }));
let rememberLocation = false;
const locationKey = 'bookmarkCommander.location.v1';

function saveLocation() {
  if (!rememberLocation) return;
  try {
    localStorage.setItem(locationKey, JSON.stringify({
      active,
      panes: panes.map(pane => ({
        folder: pane.folder,
        selectedId: pane.search ? pane.search.selectedId : entries(pane)[pane.selected]?.id,
        search: pane.search ? { ...pane.search, resultId: entries(pane)[pane.selected]?.id } : undefined,
      })),
    }));
  } catch { /* Navigation remains available if local storage is unavailable. */ }
}

function restoreLocation() {
  try {
    const saved = JSON.parse(localStorage.getItem(locationKey));
    if (!saved || !Array.isArray(saved.panes)) return;
    active = saved.active === 1 ? 1 : 0;
    panes.forEach((pane, index) => {
      const previous = saved.panes[index];
      const folder = nodes.get(previous?.folder);
      if (!folder || folder.url) return;
      delete pane.search;
      pane.folder = folder.id;
      pane.selected = Math.max(0, entries(pane).findIndex(item => item.id === previous.selectedId));
      if (typeof previous.search?.query === 'string') {
        pane.search = {
          query: previous.search.query,
          selectedId: previous.selectedId,
          selected: pane.selected,
          scrollTop: Number.isFinite(previous.search.scrollTop) ? Math.max(0, previous.search.scrollTop) : 0,
        };
        pane.selected = Math.max(0, entries(pane).findIndex(item => item.id === previous.search.resultId));
      }
    });
  } catch { /* Missing or invalid saved state starts at the bookmark root. */ }
}

function indexTree(node, parent = null) {
  node.parent = parent;
  nodes.set(node.id, node);
  node.children?.forEach(child => indexTree(child, node));
}

function installTree(tree, reset = true) {
  root = tree;
  nodes = new Map();
  indexTree(root);
  for (const pane of panes) {
    if (reset || !nodes.has(pane.folder)) { pane.folder = root.id; pane.selected = 0; delete pane.search; }
  }
  render();
}

function entries(pane) {
  const folder = nodes.get(pane.folder);
  if (pane.search) {
    const results = [];
    function visit(node) {
      if (node.url) {
        const score = Math.min(fuzzyScore(pane.search.query, node.title || ''), fuzzyScore(pane.search.query, node.url));
        if (Number.isFinite(score)) results.push({ node, score });
      }
      node.children?.forEach(visit);
    }
    visit(folder);
    return results.sort((a, b) => a.score - b.score).map(result => result.node);
  }
  return [...(folder.parent ? [{ id: '..', title: '..', target: folder.parent }] : []), ...(folder.children || [])];
}

function fuzzyScore(query, text) {
  query = query.toLocaleLowerCase().replace(/\s+/g, '');
  text = text.toLocaleLowerCase();
  if (!query || text.includes(query)) return 0;
  const maxGaps = Math.max(1, Math.floor(query.length / 2));
  let best = Infinity;
  for (let start = text.indexOf(query[0]); start >= 0; start = text.indexOf(query[0], start + 1)) {
    let position = start;
    let gaps = 0;
    for (let i = 1; i < query.length; i++) {
      const next = text.indexOf(query[i], position + 1);
      if (next < 0) { gaps = Infinity; break; }
      gaps += next - position - 1;
      if (gaps > maxGaps) break;
      position = next;
    }
    if (gaps <= maxGaps) best = Math.min(best, gaps);
  }
  return best;
}

function startSearch() {
  const pane = panes[active];
  if (pane.search) { render(true, false, true); return; }
  pane.search = {
    query: '', selectedId: entries(pane)[pane.selected]?.id, selected: pane.selected,
    scrollTop: panesElement.children[active].querySelector('.list')?.scrollTop || 0,
  };
  pane.selected = 0;
  render(true, true, true);
}

function stopSearch() {
  const pane = panes[active];
  if (!pane.search) return;
  const saved = pane.search;
  delete pane.search;
  const index = entries(pane).findIndex(item => item.id === saved.selectedId);
  pane.selected = index >= 0 ? index : saved.selected;
  render(true, false);
  const list = panesElement.children[active].querySelector('.list');
  if (list) list.scrollTop = saved.scrollTop;
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function bookmarkIcon(item) {
  const icon = element('span', 'icon', item.url ? '🌐' : '📁');
  icon.setAttribute('aria-hidden', 'true');
  if (item.url) {
    const image = element('img', 'favicon');
    image.alt = '';
    image.width = 16;
    image.height = 16;
    image.loading = 'lazy';
    const url = new URL(chrome.runtime.getURL('_favicon/'));
    url.searchParams.set('pageUrl', item.url);
    url.searchParams.set('size', '32');
    image.addEventListener('error', () => { icon.textContent = '🌐'; });
    image.src = url.href;
    icon.textContent = '';
    icon.append(image);
  }
  return icon;
}

function render(focus = false, revealSelection = focus, focusSearch = null) {
  const paneFocused = Boolean(document.activeElement?.closest?.('.pane'));
  const searchFocused = document.activeElement?.className === 'search-input';
  const cursor = searchFocused ? document.activeElement.selectionStart : null;
  const scrollPositions = Array.from(panesElement.children, section => section.querySelector('.list')?.scrollTop || 0);
  panesElement.replaceChildren();
  panes.forEach((pane, i) => {
    const folder = nodes.get(pane.folder);
    const items = entries(pane);
    pane.selected = Math.max(0, Math.min(pane.selected, items.length - 1));
    const section = element('section', `pane${active === i ? ' active' : ''}`);
    section.tabIndex = i === active ? 0 : -1;
    section.setAttribute('aria-label', `${i ? 'Right' : 'Left'} bookmark pane`);
    section.addEventListener('focus', () => { if (active !== i) { active = i; render(true); } });
    const head = element('div', 'pane-head');
    const path = [];
    for (let node = folder; node; node = node.parent) path.unshift(node.title || 'Bookmarks');
    const breadcrumb = element('span', 'path', path.join(' / '));
    breadcrumb.title = path.join(' / ');
    head.append(breadcrumb);
    const searchBar = element('div', 'search-bar');
    if (pane.search) {
      const input = element('input', 'search-input');
      input.type = 'text';
      input.placeholder = 'Search titles and URLs… · Esc to return';
      input.value = pane.search.query;
      input.setAttribute('aria-label', 'Fuzzy search bookmarks in this folder and subfolders');
      input.addEventListener('input', () => {
        active = i;
        pane.search.query = input.value;
        pane.selected = 0;
        render(true);
      });
      const count = element('span', 'search-count', `${items.length} ${items.length === 1 ? 'match' : 'matches'}`);
      count.setAttribute('role', 'status');
      searchBar.append(input, count);
    }
    const list = element('div', 'list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', `${folder.title} bookmarks`);
    items.forEach((item, index) => {
      const row = element('button', `row${index === pane.selected ? ' selected' : ''}`);
      row.tabIndex = -1;
      row.id = `pane-${i}-item-${index}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === pane.selected));
      row.title = item.url || item.title;
      row.append(bookmarkIcon(item), element('span', 'title', item.title || item.url || 'Untitled'));
      row.append(element('span', 'detail', item.url ? hostname(item.url) : item.target ? 'Parent folder' : `${item.children?.length || 0} items`));
      row.addEventListener('click', () => { active = i; pane.selected = index; render(true, false, false); });
      row.addEventListener('dblclick', () => { active = i; pane.selected = index; openSelected(); });
      list.append(row);
    });
    if (!items.length) list.append(element('p', 'empty', pane.search ? 'No matching bookmarks.' : 'This folder is empty.'));
    if (items.length) section.setAttribute('aria-activedescendant', `pane-${i}-item-${pane.selected}`);
    const selected = items[pane.selected];
    const info = element('div', 'pane-foot');
    if (selected?.url) {
      const url = element('div', 'info-url', selected.url);
      url.title = selected.url;
      info.append(url, element('div', 'info-date', `Created: ${formatCreatedDate(selected.dateAdded)}`));
    } else {
      info.append(element('div', 'info-url', `${folder.children?.length || 0} items`));
    }
    section.append(head, list);
    if (pane.search) section.append(searchBar);
    section.append(info);
    panesElement.append(section);
    list.scrollTop = scrollPositions[i] || 0;
  });
  if (focus || searchFocused || paneFocused) {
    const input = (focusSearch ?? searchFocused) ? panesElement.children[active].querySelector('.search-input') : null;
    (input || panesElement.children[active]).focus({ preventScroll: true });
    if (input && cursor !== null) input.setSelectionRange(cursor, cursor);
    if (revealSelection) panesElement.children[active].querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }
  saveLocation();
}

function hostname(url) { try { return new URL(url).hostname || url; } catch { return url; } }

function formatCreatedDate(timestamp) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return 'Unknown';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function goUp() {
  const pane = panes[active];
  const folder = nodes.get(pane.folder);
  if (!folder.parent) return;
  pane.folder = folder.parent.id;
  pane.selected = entries(pane).findIndex(item => item.id === folder.id);
  render(true);
}

function openSelected(background = false) {
  const pane = panes[active];
  const item = entries(pane)[pane.selected];
  if (!item) return;
  message.textContent = '';
  if (!item.url) {
    if (background) return;
    if (item.target) return goUp();
    pane.folder = item.id;
    pane.selected = 0;
    render(true);
    return;
  }
  let url;
  try {
    url = new URL(item.url);
    if (!['http:', 'https:', 'ftp:', 'file:'].includes(url.protocol)) throw new Error();
  } catch { message.textContent = 'This bookmark uses an unsupported URL. Only web, FTP and file links can be opened.'; return; }
  chrome.tabs.create({ url: url.href, active: !background }).catch(error => { message.textContent = error.message; });
}

let deletingBookmark = false;

async function deleteSelected() {
  const item = entries(panes[active])[panes[active].selected];
  if (!item?.url || deletingBookmark) return;
  deletingBookmark = true;
  message.textContent = '';
  try {
    await chrome.bookmarks.remove(item.id);
    const folder = nodes.get(item.parent.id);
    if (folder?.children.some(child => child.id === item.id)) {
      for (const pane of panes) {
        if (pane.folder !== folder.id) continue;
        const removedIndex = entries(pane).findIndex(child => child.id === item.id);
        if (pane.selected > removedIndex) pane.selected--;
      }
      folder.children = folder.children.filter(child => child.id !== item.id);
      nodes.delete(item.id);
    }
    render(true, false);
  } catch (error) {
    message.textContent = `Could not delete bookmark: ${error.message}`;
  } finally {
    deletingBookmark = false;
  }
}

function movePage(direction) {
  const list = panesElement.children[active].querySelector('.list');
  const row = list?.querySelector('.row');
  if (!row) return;
  const style = getComputedStyle(list);
  const height = list.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
  const count = Math.max(1, Math.floor(height / (row.offsetHeight || 1)));
  const pane = panes[active];
  const previous = pane.selected;
  pane.selected = Math.max(0, Math.min(entries(pane).length - 1, pane.selected + direction * count));
  list.scrollTop += (pane.selected - previous) * row.offsetHeight;
}

function handleKeydown(event) {
  if (!event.target.closest('.pane') || event.altKey || event.ctrlKey || event.metaKey) return;
  const pane = panes[active];
  if (event.isComposing) return;
  if (event.key === 'Escape' && pane.search) {
    event.preventDefault(); stopSearch(); return;
  }
  if (event.target.className === 'search-input' && !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', 'Enter', 'Tab'].includes(event.key)) return;
  const last = entries(pane).length - 1;
  switch (event.key) {
    case '/': event.preventDefault(); startSearch(); return;
    case 'Tab': active = 1 - active; break;
    case 'ArrowDown': pane.selected = Math.min(last, pane.selected + 1); break;
    case 'ArrowUp': pane.selected = Math.max(0, pane.selected - 1); break;
    case 'PageDown': movePage(1); break;
    case 'PageUp': movePage(-1); break;
    case 'Home': pane.selected = 0; break;
    case 'End': pane.selected = last; break;
    case 'Backspace': case 'ArrowLeft': event.preventDefault(); goUp(); return;
    case 'Enter': case 'ArrowRight': event.preventDefault(); panesElement.children[active].focus({ preventScroll: true }); if (!event.repeat) openSelected(); return;
    case 'Delete': event.preventDefault(); if (!event.repeat) deleteSelected(); return;
    case 'b': event.preventDefault(); if (!event.repeat) openSelected(true); return;
    default: return;
  }
  event.preventDefault();
  render(true, true, false);
}

document.addEventListener('keydown', handleKeydown);

async function loadBookmarks(reset = false) {
  try {
    const tree = await chrome.bookmarks.getTree();
    installTree({ ...tree[0], title: 'Bookmarks' }, reset);
    if (reset) {
      restoreLocation();
      rememberLocation = true;
      render(true);
    }
  } catch (error) { message.textContent = `Could not load bookmarks: ${error.message}`; }
}

installTree(root);
if (globalThis.chrome?.bookmarks?.getTree) {
  loadBookmarks(true).then(() => render(true));
  let refresh;
  for (const name of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded']) {
    chrome.bookmarks[name].addListener(() => { clearTimeout(refresh); refresh = setTimeout(() => loadBookmarks(), 100); });
  }
} else {
  message.textContent = 'Install this folder using Load unpacked at chrome://extensions.';
  render(true);
}
