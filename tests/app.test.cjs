const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(storage = new Map()) {
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.clientHeight = 212; this.offsetHeight = 20; this.scrollTop = 0; }
    append(...children) { children.forEach(child => { child.parent = this; }); this.children.push(...children); }
    replaceChildren() { this.children = []; }
    setAttribute() {}
    addEventListener(name, callback) { this.listeners[name] = callback; }
    focus() { this.focused = true; context.document.activeElement = this; }
    setSelectionRange() {}
    closest(selector) {
      return this.className?.split(' ').includes(selector.slice(1)) ? this : this.parent?.closest(selector);
    }
    querySelector(selector) {
      for (const child of this.children) {
        if (child.className?.split(' ').includes(selector.slice(1))) return child;
        const match = child.querySelector(selector);
        if (match) return match;
      }
      return null;
    }
    scrollIntoView() {}
  }
  const elements = new Map();
  const opened = [];
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, new Element());
        return elements.get(selector);
      },
      createElement: () => new Element(), addEventListener() {},
    },
    chrome: {
      tabs: { create: options => { opened.push(options); return Promise.resolve({}); } },
      runtime: { getURL: path => `chrome-extension://test/${path}` },
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    getComputedStyle: () => ({ paddingTop: '6px', paddingBottom: '6px' }),
    URL, console,
  });
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  run(`installTree({ id: 'root', title: 'Bookmarks', children: [
    { id: 'folder', title: 'Work', children: [
      { id: 'link', title: 'Example', url: 'https://example.com/' },
      { id: 'bad', title: 'Unsafe', url: 'javascript:alert(1)' }
    ] }
  ] });`);
  return { run, opened, elements };
}

test('panes navigate independently and going up restores folder selection', () => {
  const { run } = setup();
  run('openSelected()');
  assert.equal(run('panes[0].folder'), 'folder');
  assert.equal(run('panes[1].folder'), 'root');
  run('goUp()');
  assert.equal(run('panes[0].folder'), 'root');
  assert.equal(run('entries(panes[0])[panes[0].selected].id'), 'folder');
});

test('opens a selected bookmark in a new tab and blocks bookmarklets', () => {
  const { run, opened, elements } = setup();
  run('openSelected(); panes[0].selected = 1; openSelected()');
  assert.equal(opened.length, 1);
  assert.equal(opened[0].url, 'https://example.com/');
  assert.equal(opened[0].active, true);
  run('panes[0].selected = 2; openSelected()');
  assert.equal(opened.length, 1);
  assert.match(elements.get('#message').textContent, /unsupported URL/);
});

test('b opens a background tab without changing selection and ignores repeats, folders and search typing', () => {
  const { run, opened } = setup();
  const press = (extra = '') => run(`handleKeydown({ key: 'b', target: document.activeElement,
    preventDefault() {}, ${extra} })`);
  run('render(true)');
  press();
  assert.equal(run('panes[0].folder'), 'root');
  assert.equal(opened.length, 0);
  run('openSelected(); panes[0].selected = 1');
  press();
  assert.equal(opened.length, 1);
  assert.equal(opened[0].url, 'https://example.com/');
  assert.equal(opened[0].active, false);
  assert.equal(run('panes[0].selected'), 1);
  press('repeat: true');
  press('ctrlKey: true');
  run('startSearch()');
  press();
  assert.equal(opened.length, 1);
  run('panesElement.children[active].focus()');
  press();
  assert.equal(opened.length, 2);
  assert.equal(opened[1].active, false);
});

test('live refresh recovers when the current folder has been removed', () => {
  const { run } = setup();
  run(`openSelected(); installTree({id: 'root', title: 'Bookmarks', children: []}, false)`);
  assert.equal(run('panes[0].folder'), 'root');
  assert.equal(run('panes[0].selected'), 0);
});

test('restores both panes and selection by bookmark ID across page sessions', () => {
  const storage = new Map();
  const first = setup(storage);
  first.run('rememberLocation = true; openSelected(); panes[0].selected = 1; active = 1; render()');
  const second = setup(storage);
  second.run('restoreLocation(); render()');
  assert.equal(second.run('panes[0].folder'), 'folder');
  assert.equal(second.run('entries(panes[0])[panes[0].selected].id'), 'link');
  assert.equal(second.run('panes[1].folder'), 'root');
  assert.equal(second.run('active'), 1);
});

test('deleted saved folders and corrupt storage fall back safely', () => {
  const storage = new Map([['bookmarkCommander.location.v1', JSON.stringify({
    active: 1, panes: [{ folder: 'deleted', selectedId: 'missing' }, { folder: 'folder', selectedId: 'missing' }],
  })]]);
  const { run } = setup(storage);
  run('restoreLocation(); render()');
  assert.equal(run('panes[0].folder'), 'root');
  assert.equal(run('panes[1].folder'), 'folder');
  assert.equal(run('panes[1].selected'), 0);
  storage.set('bookmarkCommander.location.v1', '{invalid');
  assert.doesNotThrow(() => run('restoreLocation()'));
});

test('reopening restores searches in both panes and Escape restores pre-search selection', () => {
  const storage = new Map();
  const first = setup(storage);
  first.run(`rememberLocation = true; openSelected(); panes[0].selected = 2;
    startSearch(); panes[0].search.query = 'example';
    active = 1; startSearch(); panes[1].search.query = 'javascript'; render();`);
  const second = setup(storage);
  second.run('restoreLocation(); render()');
  assert.equal(second.run('active'), 1);
  assert.equal(second.run('panes[0].search.query'), 'example');
  assert.equal(second.run('panes[1].search.query'), 'javascript');
  assert.equal(second.run('entries(panes[1])[panes[1].selected].id'), 'bad');
  second.run('active = 0; stopSearch()');
  assert.equal(second.run('panes[0].folder'), 'folder');
  assert.equal(second.run('entries(panes[0])[panes[0].selected].id'), 'bad');
});

test('restored search with no remaining matches stays open safely', () => {
  const storage = new Map();
  const first = setup(storage);
  first.run(`rememberLocation = true; active = 1; startSearch(); panes[1].search.query = 'missing'; render()`);
  const second = setup(storage);
  second.run('restoreLocation(); render()');
  assert.equal(second.run('panes[1].search.query'), 'missing');
  assert.equal(second.run('entries(panes[1]).length'), 0);
  assert.equal(second.run('panes[1].selected'), 0);
});

test('page movement uses visible row capacity and stops at the first and last items', () => {
  const { run, elements } = setup();
  run(`installTree({ id: 'root', title: 'Bookmarks', children:
    Array.from({length: 25}, (_, i) => ({id: String(i), title: 'Folder ' + i, children: []}))
  })`);
  const list = { clientHeight: 217, querySelector: () => ({ offsetHeight: 20 }) };
  elements.get('#panes').children[0].querySelector = () => list;
  run('movePage(1)');
  assert.equal(run('panes[0].selected'), 10);
  run('movePage(1)');
  assert.equal(run('panes[0].selected'), 20);
  run('movePage(1)');
  assert.equal(run('panes[0].selected'), 24);
  run('movePage(-1)');
  assert.equal(run('panes[0].selected'), 14);
  list.clientHeight = 112;
  run('movePage(-1)');
  assert.equal(run('panes[0].selected'), 9);
  run('movePage(-1); movePage(-1)');
  assert.equal(run('panes[0].selected'), 0);
});

test('Delete removes a bookmark from both panes and keeps nearby selections', async () => {
  const { run } = setup();
  run(`chrome.bookmarks = { remove: async id => { globalThis.removedId = id; } };
    openSelected(); panes[0].selected = 1;
    panes[1].folder = 'folder'; panes[1].selected = 2;`);
  await run('deleteSelected()');
  assert.equal(run('removedId'), 'link');
  assert.equal(run('nodes.has("link")'), false);
  assert.equal(run('entries(panes[0])[panes[0].selected].id'), 'bad');
  assert.equal(run('entries(panes[1])[panes[1].selected].id'), 'bad');
  await run('deleteSelected()');
  assert.equal(run('panes[0].selected'), 0);
});

test('Delete ignores folders and parent entries and reports API failures', async () => {
  const { run, elements } = setup();
  run(`chrome.bookmarks = { remove: async () => { throw new Error('Managed bookmark'); } }`);
  await run('deleteSelected()');
  assert.equal(run('nodes.has("folder")'), true);
  run('openSelected()');
  await run('deleteSelected()');
  assert.equal(run('nodes.has("folder")'), true);
  run('panes[0].selected = 1');
  await run('deleteSelected()');
  assert.equal(run('nodes.has("link")'), true);
  assert.match(elements.get('#message').textContent, /Managed bookmark/);
  assert.equal(run('deletingBookmark'), false);
});

test('creation dates handle valid, missing and invalid timestamps', () => {
  const { run } = setup();
  assert.equal(run('formatCreatedDate(undefined)'), 'Unknown');
  assert.equal(run('formatCreatedDate(NaN)'), 'Unknown');
  assert.equal(run('formatCreatedDate(1e20)'), 'Unknown');
  assert.match(run('formatCreatedDate(1735732800000)'), /2025/);
});

test('fuzzy search matches titles and URLs recursively and leaves the other pane alone', () => {
  const { run } = setup();
  run(`startSearch(); panes[0].search.query = 'EXMPL';`);
  assert.equal(run('entries(panes[0]).length'), 1);
  assert.equal(run('entries(panes[0])[0].id'), 'link');
  run(`panes[0].search.query = 'https://ex';`);
  assert.equal(run('entries(panes[0])[0].id'), 'link');
  assert.equal(run('entries(panes[1])[0].id'), 'folder');
  run(`panes[0].search.query = 'zzzz';`);
  assert.equal(run('entries(panes[0]).length'), 0);
});

test('fuzzy search rejects scattered letters in unrelated titles and URLs', () => {
  const { run } = setup();
  assert.equal(run(`fuzzyScore('youtube', 'So you want to build an embedded LInux System?')`), Infinity);
  assert.equal(run(`fuzzyScore('youtube', 'https://jaycarlson.net/embedded-linux/')`), Infinity);
  assert.equal(run(`fuzzyScore('youtube', 'https://www.youtube.com/watch?v=123')`), 0);
  assert.equal(run(`fuzzyScore('ytube', 'YouTube')`), 2);
  assert.equal(run(`fuzzyScore('youtube', 'You-Tube')`), 1);
});

test('closing search restores the original selection and scroll position', () => {
  const { run, elements } = setup();
  run('openSelected(); panes[0].selected = 2');
  elements.get('#panes').children[0].querySelector = selector => selector === '.list' ? { scrollTop: 180 } : null;
  run('startSearch(); panes[0].search.query = "example"; panes[0].selected = 0');
  const list = { scrollTop: 0 };
  // Provide a list for the newly rendered pane, including after stopSearch renders again.
  const container = elements.get('#panes');
  const originalAppend = container.append.bind(container);
  container.append = section => {
    section.querySelector = selector => selector === '.list' ? list : null;
    originalAppend(section);
  };
  run('stopSearch()');
  assert.equal(run('panes[0].folder'), 'folder');
  assert.equal(run('panes[0].selected'), 2);
  assert.equal(run('panes[0].search'), undefined);
  assert.equal(list.scrollTop, 180);
});

test('bookmark refresh preserves keyboard focus in the active pane', () => {
  const { run, elements } = setup();
  run(`active = 1;
    document.activeElement = { closest: selector => selector === '.pane' ? {} : null };
    installTree(root, false);`);
  assert.equal(elements.get('#panes').children[1].focused, true);
  assert.equal(elements.get('#panes').children[0].focused, undefined);
});

test('search navigation and result clicks focus results so Delete removes the selection', async () => {
  for (const action of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', 'Tab', 'Enter', 'click']) {
    const { run, elements } = setup();
    run(`chrome.bookmarks = { remove: async id => { globalThis.removedId = id; } };
      startSearch(); panes[0].search.query = 'example'; render(true);`);
    assert.equal(run('document.activeElement.className'), 'search-input');
    if (action === 'click') {
      elements.get('#panes').children[0].querySelector('.row').listeners.click();
    } else {
      run(`handleKeydown({ target: document.activeElement, key: ${JSON.stringify(action)}, preventDefault() {} })`);
    }
    assert.equal(run('document.activeElement.className.includes("pane")'), true, action);
    assert.equal(run('panes[0].search.query'), 'example');
    if (action === 'Tab') run('active = 0; render(true)');
    run(`handleKeydown({ target: document.activeElement, key: 'Delete', preventDefault() {} })`);
    await run('Promise.resolve()');
    assert.equal(run('removedId'), 'link', action);
    assert.equal(run('document.activeElement.className.includes("pane")'), true);
    run('startSearch()');
    assert.equal(run('document.activeElement.className'), 'search-input');
  }
});

test('Delete stays a text editing key while the search field is focused', () => {
  const { run } = setup();
  run(`startSearch(); handleKeydown({ target: document.activeElement, key: 'Delete',
    preventDefault() { throw new Error('Delete should edit the query'); } });`);
  assert.equal(run('nodes.has("link")'), true);
});

test('PageDown and PageUp navigate and scroll results while search input has focus', () => {
  const { run, elements } = setup();
  run(`installTree({id: 'root', title: 'Bookmarks', children:
    Array.from({length: 30}, (_, i) => ({id: String(i), title: 'Match ' + i, url: 'https://example.com/' + i}))
  }); startSearch(); panes[0].search.query = 'match';`);
  const list = { clientHeight: 212, scrollTop: 0, querySelector: () => ({ offsetHeight: 20 }) };
  const container = elements.get('#panes');
  const append = container.append.bind(container);
  const wire = section => {
    section.querySelector = selector => selector === '.list' ? list : null;
    return section;
  };
  container.children.forEach(wire);
  container.append = section => append(wire(section));
  run(`globalThis.searchEvent = {
    target: {className: 'search-input', closest: () => ({})},
    key: 'PageDown', preventDefault() { this.prevented = true; }
  }; handleKeydown(searchEvent);`);
  assert.equal(run('panes[0].selected'), 10);
  assert.equal(list.scrollTop, 200);
  assert.equal(run('searchEvent.prevented'), true);
  const searchBar = container.children[0].children.find(child => child.className === 'search-bar');
  assert.equal(searchBar.children[1].textContent, '30 matches');
  run(`searchEvent.key = 'PageUp'; handleKeydown(searchEvent)`);
  assert.equal(run('panes[0].selected'), 0);
  assert.equal(list.scrollTop, 0);
  run(`searchEvent.key = 'End'; handleKeydown(searchEvent)`);
  assert.equal(run('panes[0].selected'), 29);
  run(`searchEvent.key = 'Home'; handleKeydown(searchEvent)`);
  assert.equal(run('panes[0].selected'), 0);
});
