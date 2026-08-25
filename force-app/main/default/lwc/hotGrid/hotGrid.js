import { LightningElement, api } from 'lwc';
import { loadScript, loadStyle } from 'lightning/platformResourceLoader';
import HANDSONTABLE from '@salesforce/resourceUrl/handsontable';

const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/**
 * Escapes HTML markup so it renders as literal text. Pure string operations, no
 * DOM APIs, so Lightning Web Security distortions have nothing to interfere with.
 */
function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/**
 * Default sanitizer handed to Handsontable.
 *
 * Handsontable 18 ships without a built-in sanitizer, and Lightning Web Security
 * only sanitizes writes to shared DOM elements - not to a component's own Shadow
 * DOM, which is where the grid lives. Without a sanitizer, header labels,
 * context-menu labels, dropdown options and pasted HTML reach `innerHTML` as-is.
 *
 * @param {string} content Raw HTML Handsontable is about to write.
 * @param {string} context Write surface, e.g. `header`, `contextMenu`, `CopyPaste.paste`.
 * @returns {string} Content safe to assign to `innerHTML`.
 */
function defaultSanitizer(content, context) {
    // The paste payload is a whole HTML document, not a single label, so escaping
    // it would leave an unusable blob. Drop it instead: Handsontable then reads the
    // `text/plain` flavor of the clipboard, which carries the same cells.
    if (context === 'CopyPaste.paste') {
        return '';
    }

    return escapeHtml(content);
}

export default class HotGrid extends LightningElement {
    _hot = null;
    _initialized = false;
    _data = [];
    _columns = [];
    _colHeaders = [];
    _nestedHeaders = [];
    _collapsibleColumns = [];
    _sanitizer = defaultSanitizer;

    @api
    get data() { return this._data; }
    set data(value) {
        this._data = value ? [...value] : [];
        if (this._hot) {
            this._hot.updateSettings({ data: JSON.parse(JSON.stringify(this._data)) });
        }
    }

    @api
    get columns() { return this._columns; }
    set columns(value) {
        this._columns = value ? [...value] : [];
        if (this._hot) {
            this._hot.updateSettings({ columns: this._columns.length ? this._columns : undefined });
        }
    }

    @api
    get colHeaders() { return this._colHeaders; }
    set colHeaders(value) {
        this._colHeaders = value ? [...value] : [];
        if (this._hot) {
            this._hot.updateSettings({ colHeaders: this._colHeaders.length ? this._colHeaders : true });
        }
    }

    @api
    get nestedHeaders() { return this._nestedHeaders; }
    set nestedHeaders(value) {
        this._nestedHeaders = value ? [...value] : [];
        if (this._hot && this._nestedHeaders.length) {
            this._hot.updateSettings({ nestedHeaders: this._nestedHeaders });
        }
    }

    @api
    get collapsibleColumns() { return this._collapsibleColumns; }
    set collapsibleColumns(value) {
        this._collapsibleColumns = value ? [...value] : [];
        if (this._hot && this._collapsibleColumns.length) {
            this._hot.updateSettings({ collapsibleColumns: this._collapsibleColumns });
        }
    }

    @api
    get sanitizer() { return this._sanitizer; }
    set sanitizer(value) {
        // `false` is Handsontable's opt-out: write raw HTML on purpose, no warning.
        this._sanitizer = (typeof value === 'function' || value === false)
            ? value : defaultSanitizer;
        if (this._hot) {
            this._hot.updateSettings({ sanitizer: this._sanitizer });
        }
    }

    @api
    getDataAtCell(row, col) {
        return this._hot ? this._hot.getDataAtCell(row, col) : null;
    }

    renderedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        loadStyle(this, `${HANDSONTABLE}/handsontable.min.css`)
            .then(() => loadStyle(this, `${HANDSONTABLE}/ht-theme-main.min.css`))
            .then(() => loadScript(this, `${HANDSONTABLE}/handsontable.full.min.js`))
            .then(() => {
                const container = this.template.querySelector('.grid-container');
                if (container) {
                    this._initializeGrid(container);
                }
            })
            .catch((error) => {
                console.error('HotGrid: failed to load', error?.message || error);
            });
    }

    disconnectedCallback() {
        if (this._hot) {
            this._hot.destroy();
            this._hot = null;
        }
    }

    _initializeGrid(container) {
        if (this._hot) return;

        const HT = window.Handsontable;

        const settings = {
            data: JSON.parse(JSON.stringify(this._data)),
            columns: this._columns.length ? this._columns : undefined,
            rowHeaders: true,
            height: 'auto',
            autoWrapRow: true,
            autoWrapCol: true,
            headerClassName: 'htLeft',
            manualColumnResize: true,
            contextMenu: true,
            copyPaste: true,
            fillHandle: true,
            hiddenColumns: true,
            licenseKey: 'non-commercial-and-evaluation',
            sanitizer: this._sanitizer,
            afterCreateRow: (index, amount) => {
                this.dispatchEvent(new CustomEvent('rowcreate', {
                    detail: { index, amount },
                }));
            },
            afterRemoveRow: (index, amount) => {
                this.dispatchEvent(new CustomEvent('rowremove', {
                    detail: { index, amount },
                }));
            },
            afterChange: (changes, source) => {
                if (!changes || source === 'loadData') return;
                changes.forEach(([row, col, oldValue, newValue]) => {
                    if (oldValue !== newValue) {
                        this.dispatchEvent(new CustomEvent('cellchange', {
                            detail: { row, col, oldValue, newValue },
                        }));
                    }
                });
            },
        };

        if (this._nestedHeaders.length) {
            settings.nestedHeaders = this._nestedHeaders;
            settings.collapsibleColumns = this._collapsibleColumns.length
                ? this._collapsibleColumns : true;
        } else {
            settings.colHeaders = this._colHeaders.length ? this._colHeaders : true;
            settings.columnSorting = true;
        }

        this._hot = new HT(container, settings);
    }
}
