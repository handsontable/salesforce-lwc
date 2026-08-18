import { LightningElement, api } from 'lwc';
import { loadScript, loadStyle } from 'lightning/platformResourceLoader';
import HANDSONTABLE from '@salesforce/resourceUrl/handsontable';

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
