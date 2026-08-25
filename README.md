# Salesforce LWC Handsontable

Handsontable data grid running as a Lightning Web Component, connected to live Salesforce Account data with full CRUD support. **No workaround code** — the grid runs on its built-in Shadow DOM and Lightning Web Security support (Handsontable 18.0.1+).

## Features

- Handsontable embedded in LWC (Lightning's default synthetic Shadow DOM, Lightning Web Security; the native opt-in also works - see Shadow DOM mode below)
- Live read/write from Salesforce Accounts via Lightning Data Service (no Apex)
- Auto-detected field types — picklists become dropdowns, numbers become numeric, booleans become checkboxes
- Column grouping with collapsible columns
- Row create/delete synced to Salesforce
- Built-in copy/paste, cell editors, selection, and context menu — no Locker/LWS workarounds
- HTML sanitized by default (headers, menus, dropdowns, `text/html` paste) — overridable per grid

## Project structure

```
force-app/main/default/
├── lwc/
│   ├── hotGrid/             # Handsontable wrapper (loads resources, creates the grid)
│   └── handsontableApp/     # App component (Salesforce data + column config)
├── staticresources/
│   ├── handsontable/        # Handsontable JS/CSS (unpacked files, not a zip)
│   └── handsontable.resource-meta.xml
├── flexipages/              # "Handsontable Demo" Lightning app page
├── tabs/                    # Tab for the page
└── permissionsets/          # Makes the tab visible
```

## Prerequisites

- [Salesforce CLI (sf)](https://developer.salesforce.com/tools/salesforcecli)
- A Salesforce org (Developer Edition, Sandbox, or Starter Trial)
- Account records in the "All Accounts" list view (Developer Editions ship with samples)
- Handsontable with Shadow DOM support (18.0.1 or later; the bundled build is a prerelease with the fixes from [handsontable#13194](https://github.com/handsontable/handsontable/pull/13194))

## Setup

### 1. Authorize your Salesforce org

```bash
sf org login web --alias my-org --set-default
```

### 2. Deploy

```bash
sf project deploy start --source-dir force-app/main/default --target-org my-org
```

### 3. Make the demo tab visible

```bash
sf org assign permset --name Handsontable_Demo --target-org my-org
```

### 4. Open the demo

```bash
sf org open --target-org my-org --path "/lightning/n/Handsontable_Demo"
```

## Components

### hotGrid

Handsontable wrapper. Loads the static resources through `lightning/platformResourceLoader`, then creates the grid inside the component's Shadow DOM (`lwc:dom="manual"`). Exposes `@api` properties:

| Property | Description |
|---|---|
| `data` | 2D array of cell values |
| `columns` | Column type definitions (text, numeric, dropdown, checkbox) |
| `col-headers` | Column headers |
| `nested-headers` | Grouped column headers |
| `collapsible-columns` | Collapsible column group config |
| `sanitizer` | HTML sanitizer function, or `false` to opt out. Defaults to a built-in escaping sanitizer — see [Sanitization](#sanitization) |

Events: `cellchange`, `rowcreate`, `rowremove`

### handsontableApp

Connects the grid to Salesforce Account data using Lightning Data Service only:

- `getObjectInfo` — field metadata (types, labels, picklist values)
- `getListUi` — record data from the "All Accounts" list view
- `updateRecord` / `createRecord` / `deleteRecord` — CRUD synced on grid events

## Sanitization

Handsontable 18 has no built-in sanitizer: HTML written to the DOM — header labels, context-menu labels, dropdown options, the `text/html` clipboard paste payload — passes through unchanged unless you configure the [`sanitizer`](https://handsontable.com/docs/javascript-data-grid/api/options/#sanitizer) option.

Lightning Web Security does not cover this. LWS sanitizes `innerHTML` writes to *shared* DOM elements, and leaves writes to a component's own Shadow DOM unrestricted — which is exactly where the grid lives (`lwc:dom="manual"` inside `hotGrid`). A header label such as `{ label: 'Group<img src=x onerror="...">' }` would execute.

So `hotGrid` sets a default sanitizer that escapes HTML markup into literal text:

- Pure string operations, no DOM APIs, so LWS distortions have nothing to interfere with — no extra static resource needed.
- For the `CopyPaste.paste` context the payload is a whole HTML document rather than a single label, so it is dropped instead of escaped. Handsontable then reads the `text/plain` flavor of the clipboard, which carries the same cells.
- Only the `text/html` clipboard flavor is routed through the sanitizer. Handsontable reads and parses its own `application/ht-source-data-json-html` flavor — the one it writes when you copy from a grid — before and independently of the sanitizer, so that branch is not covered.

What it does not cover: writes that render raw HTML by design stay the caller's responsibility — the `html` cell type or a custom `renderer` on a `columns` entry (Handsontable writes those with sanitization deliberately disabled), and `allowHtml: true` on `dropdown`/`autocomplete` columns. Left at their defaults, option lists in those editors are stripped of tags and rendered as text, so the picklist columns in this demo are covered.

Override it from the parent component's JavaScript when you need rich HTML — for example with DOMPurify uploaded as its own static resource:

```js
// in the parent component
sanitizer = (html, context) => DOMPurify.sanitize(html);
```

```html
<c-hot-grid data={data} sanitizer={sanitizer}></c-hot-grid>
```

The value has to be a function, so it must come from a parent component's JavaScript — a template attribute or Lightning App Builder can only supply strings. Pass `false` to write raw HTML deliberately and silence Handsontable's warning about DOM writes without a sanitizer. Its paste warning is separate and fires whenever the sanitizer is not a function, `false` included.

## Shadow DOM mode

Lightning Experience renders LWC components with the synthetic Shadow DOM polyfill by default. This project sets no `shadowSupportMode`, so the grid runs in that default mode (verified in a Developer Edition org). Handsontable also works with the native opt-in (`static shadowSupportMode = 'native'`), with one change: Salesforce's `loadStyle` injects CSS into `document.head`, which a native shadow root ignores. Inject the two stylesheets into the component's shadow tree instead - append `<link>` elements inside the `lwc:dom="manual"` container and wait for their `load` events before creating the grid.

## Updating the Handsontable build

Replace the files in `force-app/main/default/staticresources/handsontable/` with a newer release (`dist/handsontable.full.min.js`, `styles/handsontable.min.css`, `styles/ht-theme-main.min.css`) and redeploy the `staticresources` directory. Load both stylesheets — without the base stylesheet the cell editor renders in wrong positions.

## License

Uses `licenseKey: 'non-commercial-and-evaluation'` — replace with your commercial key for production use.
