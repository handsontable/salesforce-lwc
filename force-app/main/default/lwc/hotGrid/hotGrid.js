import { LightningElement, api } from 'lwc';
import { loadScript, loadStyle } from 'lightning/platformResourceLoader';
import HANDSONTABLE from '@salesforce/resourceUrl/handsontable';

// Handsontable 18+ ships no built-in HTML sanitizer, and Lightning Web
// Security sanitizes writes to shared DOM — not to this component's own
// shadow root, where the grid writes. This allowlist keeps basic inline
// formatting, strips every attribute, and drops script-bearing elements
// outright; swap in a library such as DOMPurify (loaded as another
// static resource) for a richer policy.
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'SPAN']);
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED']);

function sanitizeHtml(content) {
    const doc = new DOMParser().parseFromString(String(content), 'text/html');

    const walk = (node) => {
        [...node.children].forEach((child) => {
            if (DROPPED_TAGS.has(child.tagName)) {
                child.remove();
            } else if (ALLOWED_TAGS.has(child.tagName)) {
                [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
                walk(child);
            } else {
                // keep the text, drop the markup
                child.replaceWith(doc.createTextNode(child.textContent || ''));
            }
        });
    };

    walk(doc.body);

    return doc.body.innerHTML;
}

export default class HotGrid extends LightningElement {
    _hot = null;
    _initialized = false;
    _data = [];
    _columns = [];
    _nestedHeaders = [];
    _collapsibleColumns = [];

    @api
    get data() {
        return this._data;
    }
    set data(value) {
        this._data = value ? [...value] : [];

        if (this._hot) {
            this._hot.updateSettings({ data: JSON.parse(JSON.stringify(this._data)) });
        }
    }

    @api
    get columns() {
        return this._columns;
    }
    set columns(value) {
        this._columns = value ? [...value] : [];

        if (this._hot) {
            this._hot.updateSettings({ columns: this._columns.length ? this._columns : undefined });
        }
    }

    @api
    get nestedHeaders() {
        return this._nestedHeaders;
    }
    set nestedHeaders(value) {
        this._nestedHeaders = value ? [...value] : [];

        if (this._hot && this._nestedHeaders.length) {
            this._hot.updateSettings({ nestedHeaders: this._nestedHeaders });
        }
    }

    @api
    get collapsibleColumns() {
        return this._collapsibleColumns;
    }
    set collapsibleColumns(value) {
        this._collapsibleColumns = value ? [...value] : [];

        if (this._hot && this._collapsibleColumns.length) {
            this._hot.updateSettings({ collapsibleColumns: this._collapsibleColumns });
        }
    }

    @api
    getDataAtCell(row, col) {
        return this._hot ? this._hot.getDataAtCell(row, col) : null;
    }

    renderedCallback() {
        if (this._initialized) {
            return;
        }
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
        if (this._hot) {
            return;
        }

        const settings = {
            data: JSON.parse(JSON.stringify(this._data)),
            columns: this._columns.length ? this._columns : undefined,
            colHeaders: true,
            rowHeaders: true,
            height: 'auto',
            columnSorting: true,
            manualColumnResize: true,
            contextMenu: true,
            copyPaste: true,
            fillHandle: true,
            sanitizer: sanitizeHtml,
            licenseKey: 'non-commercial-and-evaluation',
            afterChange: (changes, source) => {
                if (!changes || source === 'loadData') {
                    return;
                }

                changes.forEach(([row, col, oldValue, newValue]) => {
                    if (oldValue !== newValue) {
                        this.dispatchEvent(new CustomEvent('cellchange', {
                            detail: { row, col, oldValue, newValue },
                        }));
                    }
                });
            },
            afterCreateRow: (index, amount) => {
                this.dispatchEvent(new CustomEvent('rowcreate', { detail: { index, amount } }));
            },
            beforeRemoveRow: (index, amount) => {
                this.dispatchEvent(new CustomEvent('rowremoverequest', { detail: { index, amount } }));

                return false;
            },
        };

        if (this._nestedHeaders.length) {
            settings.nestedHeaders = this._nestedHeaders;
            settings.collapsibleColumns = this._collapsibleColumns.length
                ? this._collapsibleColumns : true;
        }

        this._hot = new window.Handsontable(container, settings);
    }
}
