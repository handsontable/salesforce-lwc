import { LightningElement, api } from 'lwc';
import { loadScript, loadStyle } from 'lightning/platformResourceLoader';
import HANDSONTABLE from '@salesforce/resourceUrl/handsontable';

// Handsontable 18+ ships no built-in HTML sanitizer, and Lightning Web
// Security sanitizes writes to shared DOM — not to this component's own
// shadow root, where the grid writes. This allowlist keeps basic inline
// formatting, strips every attribute except class (the grid's menus mark
// checked items with a span.selected the theme CSS targets), and drops
// script-bearing elements outright; swap in a library such as DOMPurify
// (loaded as another static resource) for a richer policy.
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'SPAN']);
const ALLOWED_ATTRS = new Set(['class']);
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED']);

const LOCK_ICON_PATH = 'M4.5 7V5a3.5 3.5 0 0 1 7 0v2h.5A1 1 0 0 1 13 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 '
    + '1 0 0 1 1-1h.5Zm1.5 0h4V5a2 2 0 0 0-4 0v2Z';

// Pure string operations: nothing here for a DOM-API sandbox to distort.
function escapeHtml(content) {
    return String(content)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function sanitizeHtml(content) {
    try {
        const doc = new DOMParser().parseFromString(String(content), 'text/html');

        const walk = (node) => {
            [...node.children].forEach((child) => {
                if (DROPPED_TAGS.has(child.tagName)) {
                    child.remove();
                } else if (ALLOWED_TAGS.has(child.tagName)) {
                    [...child.attributes].forEach((attr) => {
                        if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) {
                            child.removeAttribute(attr.name);
                        }
                    });
                    walk(child);
                } else {
                    // keep the text, drop the markup
                    child.replaceWith(doc.createTextNode(child.textContent || ''));
                }
            });
        };

        walk(doc.body);

        return doc.body.innerHTML;
    } catch (e) {
        // Fail closed: if a sandboxed host distorts the DOM APIs above,
        // escaped text renders wrong at worst — it cannot execute.
        return escapeHtml(content);
    }
}

function isBlank(value) {
    return value === null || value === undefined || value === '';
}

export default class HotGrid extends LightningElement {
    _hot = null;
    _initialized = false;
    _syncRemoval = false;
    _clearUndoAfterChange = false;
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

    // Shows a value Salesforce set (such as a new record's name) in a cell the user hasn't filled.
    @api
    setValueIfEmpty(physicalRow, col, value) {
        const current = this._hot ? this._hot.getSourceDataAtCell(physicalRow, col) : undefined;

        if (this._hot && (current === null || current === undefined || current === '')) {
            this._hot.setSourceDataAtCell(physicalRow, col, value);
        }
    }

    /**
     * Removes rows after Salesforce has deleted their records. A row hidden by a filter can't be removed.
     *
     * @param {number[]} physicalRows
     * @returns {number[]} The rows removed.
     */
    @api
    removeRows(physicalRows) {
        const removable = this._hot
            ? physicalRows.filter((physicalRow) => this._hot.toVisualRow(physicalRow) !== null)
            : [];

        if (!removable.length) {
            return [];
        }

        this._syncRemoval = true;

        try {
            this._hot.alter('remove_row', removable.map((physicalRow) => [this._hot.toVisualRow(physicalRow), 1]));
        } finally {
            this._syncRemoval = false;
        }

        // Undo entries hold visual row indexes, which the removal just shifted; replaying one would change
        // a different record.
        this._clearUndo();

        return removable;
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
            multiColumnSorting: true,
            filters: true,
            dropdownMenu: ['filter_by_condition', 'filter_by_value', 'filter_action_bar'],
            manualColumnResize: true,
            contextMenu: {
                items: {
                    row_above: {},
                    row_below: {},
                    sp1: '---------',
                    // The grid removes rows only after Salesforce deletes their records (see `removeRows`).
                    remove_row: {
                        callback: (key, selection) => this._requestRowRemoval(selection),
                    },
                    sp2: '---------',
                    undo: {},
                    redo: {},
                    sp3: '---------',
                    copy: {},
                    cut: {},
                },
            },
            copyPaste: true,
            fillHandle: true,
            sanitizer: sanitizeHtml,
            licenseKey: 'non-commercial-and-evaluation',
            afterChange: (changes, source) => {
                if (!changes || source === 'loadData') {
                    return;
                }

                // Rows go out by physical index, which sorting and filtering don't change.
                changes.forEach(([row, col, oldValue, newValue]) => {
                    if (oldValue !== newValue && !(isBlank(oldValue) && isBlank(newValue))) {
                        this.dispatchEvent(new CustomEvent('cellchange', {
                            detail: {
                                physicalRow: this._hot.toPhysicalRow(row),
                                col,
                                newValue,
                                valid: this._isValid(row, col, newValue),
                            },
                        }));
                    }
                });

                // Undoing a paste that added rows would blank their cells while the records stay.
                if (this._clearUndoAfterChange) {
                    this._clearUndoAfterChange = false;
                    this._clearUndo();
                }
            },
            afterGetColHeader: (col, th) => this._markReadOnlyHeader(col, th),
            afterCreateRow: (index, amount, source) => {
                if (source === 'auto') {
                    this._clearUndoAfterChange = true;
                }

                this.dispatchEvent(new CustomEvent('rowcreate', {
                    detail: { physicalIndex: this._hot.toPhysicalRow(index), amount },
                }));
            },
            // Undoing an insert would remove the row from the grid only, so it becomes a removal request.
            beforeUndo: (action) => {
                if (action.actionType !== 'insert_row') {
                    return undefined;
                }

                const physicalRows = [];

                for (let row = action.index; row < action.index + action.amount; row++) {
                    physicalRows.push(this._hot.toPhysicalRow(row));
                }

                this._dispatchRemoveRequest(physicalRows);
                this._clearUndo();

                return false;
            },
            // Every other removal goes through the context menu's request or `removeRows`.
            beforeRemoveRow: () => (this._syncRemoval ? undefined : false),
        };

        if (this._nestedHeaders.length) {
            settings.nestedHeaders = this._nestedHeaders;
            settings.collapsibleColumns = this._collapsibleColumns.length
                ? this._collapsibleColumns : true;
        }

        this._hot = new window.Handsontable(container, settings);
    }

    // Runs the column's validator here instead of reading the result from cell meta: for a row a paste adds while
    // a filter is on, that meta belongs to another row. Its column settings (validator, source) are the same.
    _isValid(visualRow, col, value) {
        const meta = this._hot.getCellMeta(visualRow, col);
        const validator = this._hot.getCellValidator(meta);
        let valid = true;

        if (typeof validator === 'function') {
            validator.call(meta, value, (result) => {
                valid = result;
            });
        }

        return valid;
    }

    _clearUndo() {
        this._hot?.getPlugin('undoRedo')?.clear();
    }

    _requestRowRemoval(selection) {
        const physicalRows = new Set();

        selection.forEach(({ start, end }) => {
            for (let row = Math.max(Math.min(start.row, end.row), 0); row <= Math.max(start.row, end.row); row++) {
                physicalRows.add(this._hot.toPhysicalRow(row));
            }
        });

        this._dispatchRemoveRequest([...physicalRows]);
    }

    _dispatchRemoveRequest(physicalRows) {
        this.dispatchEvent(new CustomEvent('rowremoverequest', { detail: { physicalRows } }));
    }

    // Adds a lock icon to the bottom header of a read-only column.
    _markReadOnlyHeader(col, th) {
        const label = th.querySelector('.colHeader');
        const existing = th.querySelector('.hot-lock');
        const tr = th.parentElement;
        const isBottomHeader = tr !== null && tr === tr.parentElement?.lastElementChild;
        const locked = col >= 0 && isBottomHeader && this._columns[col]?.readOnly === true;

        if (!label) {
            return;
        }

        if (!locked) {
            existing?.remove();

            return;
        }

        if (!existing) {
            const svgNs = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(svgNs, 'svg');
            const title = document.createElementNS(svgNs, 'title');
            const path = document.createElementNS(svgNs, 'path');

            svg.setAttribute('viewBox', '0 0 16 16');
            svg.setAttribute('width', '12');
            svg.setAttribute('height', '12');
            svg.setAttribute('class', 'hot-lock');
            svg.setAttribute('role', 'img');
            svg.setAttribute('aria-label', 'Read-only');
            title.textContent = 'Read-only';
            path.setAttribute('d', LOCK_ICON_PATH);
            svg.appendChild(title);
            svg.appendChild(path);
            label.appendChild(svg);
        }
    }
}
