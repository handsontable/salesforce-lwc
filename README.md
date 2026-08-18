# Salesforce LWC Handsontable

Handsontable data grid running as a Lightning Web Component, connected to live Salesforce Account data with full CRUD support. **No workaround code** — the grid runs on its built-in Shadow DOM and Lightning Web Security support (Handsontable 18.1.0+).

## Features

- Handsontable embedded in LWC (Lightning's default synthetic Shadow DOM, Lightning Web Security; the native opt-in also works - see Shadow DOM mode below)
- Live read/write from Salesforce Accounts via Lightning Data Service (no Apex)
- Auto-detected field types — picklists become dropdowns, numbers become numeric, booleans become checkboxes
- Column grouping with collapsible columns
- Row create/delete synced to Salesforce
- Built-in copy/paste, cell editors, selection, and context menu — no Locker/LWS workarounds

## Project structure

```
force-app/main/default/
├── lwc/
│   ├── hotGrid/             # Handsontable wrapper (loads resources, creates the grid)
│   └── handsontableApp/     # App component (Salesforce data + column config)
├── staticresources/
│   ├── handsontable/        # Handsontable JS/CSS (unpacked files, not a zip)
│   └── handsontable.resource-meta.xml
├── flexipages/              # "Handsontable Grid" Lightning app page
├── tabs/                    # Tab for the page
└── permissionsets/          # Makes the tab visible
```

## Prerequisites

- [Salesforce CLI (sf)](https://developer.salesforce.com/tools/salesforcecli)
- A Salesforce org (Developer Edition, Sandbox, or Starter Trial)
- Account records in the "All Accounts" list view (Developer Editions ship with samples)
- Handsontable with Shadow DOM support (the bundled build is the official 18.1.0 release, which includes the fixes from [handsontable#13194](https://github.com/handsontable/handsontable/pull/13194))

## Setup

### 1. Authorize your Salesforce org

```bash
sf org login web --alias my-org --set-default
```

### 2. Deploy

```bash
sf project deploy start --source-dir force-app/main/default --target-org my-org
```

### 3. Make the tab visible

```bash
sf org assign permset --name Handsontable_Grid --target-org my-org
```

### 4. Open the grid

```bash
sf org open --target-org my-org --path "/lightning/n/Handsontable_Grid"
```

## Components

### hotGrid

Handsontable wrapper. Loads the static resources through `lightning/platformResourceLoader`, then creates the grid inside the component's Shadow DOM (`lwc:dom="manual"`). Exposes `@api` properties:

| Property | Description |
|---|---|
| `data` | 2D array of cell values |
| `columns` | Column type definitions (text, numeric, dropdown, checkbox) |
| `nested-headers` | Grouped column headers |
| `collapsible-columns` | Collapsible column group config |

Events: `cellchange`, `rowcreate`, `rowremoverequest`

`rowremoverequest` fires from `beforeRemoveRow`, which returns `false` to cancel the grid's own removal. The app component owns `data`, so it removes the row optimistically and puts it back when the org refuses the delete.

### handsontableApp

Connects the grid to Salesforce Account data using Lightning Data Service only:

- `getObjectInfo` — field metadata (types and labels)
- `getPicklistValuesByRecordType` — picklist values for dropdown sources; `getObjectInfo` reports that a field is a picklist but does not list its values
- `getListUi` — record data from the "All Accounts" list view
- `updateRecord` / `createRecord` / `deleteRecord` — CRUD synced on grid events

## Shadow DOM mode

Lightning Experience renders LWC components with the synthetic Shadow DOM polyfill by default. This project sets no `shadowSupportMode`, so the grid runs in that default mode (verified in a Developer Edition org). Handsontable also works with the native opt-in (`static shadowSupportMode = 'native'`), with one change: Salesforce's `loadStyle` injects CSS into `document.head`, which a native shadow root ignores. Inject the two stylesheets into the component's shadow tree instead - append `<link>` elements inside the `lwc:dom="manual"` container and wait for their `load` events before creating the grid.

## Updating the Handsontable build

Replace the files in `force-app/main/default/staticresources/handsontable/` with a newer release (`dist/handsontable.full.min.js`, `styles/handsontable.min.css`, `styles/ht-theme-main.min.css`) and redeploy the `staticresources` directory. Load both stylesheets — without the base stylesheet the cell editor renders in wrong positions.

## License

Uses `licenseKey: 'non-commercial-and-evaluation'` — replace with your commercial key for production use.
