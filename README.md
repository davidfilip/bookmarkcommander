# Bookmark Commander

A keyboard-first Chrome bookmark manager inspired by Midnight Commander. Browse two folders side by side, search your bookmarks, and open links in new tabs.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the repository folder containing `manifest.json`.
4. Click the Bookmark Commander toolbar icon. Pin it in Chrome’s Extensions menu for easy access.

No dependencies, build step, or server are required. The interface runs in an extension tab and uses your live Chrome bookmarks.

After updating the files, refresh the Bookmark Commander tab. If the manifest, permissions, toolbar icon, or background script changed, first reload the extension at `chrome://extensions`.

## Browse

Each pane has its own folder, selection, and search. **Tab** switches the active pane; **Enter** enters a folder or opens a bookmark in a new tab.

Website favicons appear beside bookmarks. The information bar below each pane shows the selected link’s URL and creation date, when Chrome provides one. The interface uses a Dracula-inspired dark palette.

Clicking selects an item without moving the list. Double-clicking opens it. Moving the mouse over rows does not highlight them.

## Keyboard controls

| Key | Action |
| --- | --- |
| Tab / Shift+Tab | Switch panes |
| ↑ / ↓ | Select the previous / next item |
| Page Up / Page Down | Move by the number of rows that fit in the active pane |
| Home / End | Select the first / last item |
| Enter | Enter a folder or open a bookmark in a new tab |
| → | Same as Enter when outside the search field |
| Backspace / ← | Go to the parent folder when outside the search field |
| Delete | Remove the selected bookmark from Chrome when outside the search field |
| / | Start searching in the active pane |
| Esc | Close search and return to the previous selection and scroll position |

**Delete removes the actual Chrome bookmark immediately, without a confirmation dialog.** Folders and the parent-folder entry (`..`) are left intact. There is no undo command in the extension.

## Search

Press **/** and type in the search field at the bottom of the active pane. Results include bookmarks in the current folder and all its subfolders, matched against either the title or URL. The number of matches appears beside the field.

Matching ignores case and spaces in the query. Exact substring matches rank first. Fuzzy matches allow a small number of skipped characters: for example, `ytube` matches `YouTube`. Letters scattered widely through an unrelated title are excluded. This is character matching, rather than typo correction or semantic search.

While typing, **↑ / ↓**, **Page Up / Page Down**, and **Home / End** navigate results. **Enter** opens the selected result in a new tab. **Esc** restores your position before starting the search. The other pane remains independent.

## Remembered state

Reopening the extension restores:

- The folder and selected item in each pane.
- Each pane’s search query and selected result.
- Which pane was active.
- The pre-search position used when pressing Esc.

State is stored locally in the extension’s storage for the current Chrome profile. It does not sync between devices. Missing folders fall back to the bookmark root; missing selected items fall back to the first available item.

## Permissions and data

| Permission | Purpose |
| --- | --- |
| `bookmarks` | Read the bookmark tree, follow changes, and delete selected bookmarks |
| `favicon` | Display website icons through Chrome’s favicon service |

The extension has no analytics, third-party scripts, or external backend. Bookmark titles and URLs render as text. Navigation and search state stay on your device; Chrome manages any bookmark syncing configured in your profile.

The URL opener accepts HTTP, HTTPS, FTP, and file URLs. Whether FTP or file links open successfully depends on Chrome. Executable bookmarklets and other URL schemes are not opened.

## Development

The extension uses plain HTML, CSS, and JavaScript with Manifest V3.

| File | Purpose |
| --- | --- |
| `app.js` | Bookmark browsing, search, keyboard controls, deletion, and saved state |
| `index.html` | Extension page |
| `style.css` | Layout and theme |
| `background.js` | Opens the interface from the toolbar action |
| `manifest.json` | Extension configuration and permissions |
| `tests/app.test.cjs` | Logic tests with mocked browser APIs and DOM elements |
| `tools/generate-icons.py` | Generates the PNG extension icons using Python’s standard library |

Run the tests with Node.js:

```sh
node --test tests/app.test.cjs
```

Regenerate the icons with Python 3:

```sh
python3 tools/generate-icons.py
```

The tests cover application logic; they do not replace checking layout, focus, scrolling, and Chrome integration in the loaded extension.

## License

[MIT](LICENSE) © 2026 David Filip.
