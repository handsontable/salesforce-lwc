import { LightningElement, wire } from 'lwc';
import { getListInfoByName, getListRecordsByName } from 'lightning/uiListsApi';
import { getObjectInfo, getPicklistValuesByRecordType } from 'lightning/uiObjectInfoApi';
import { updateRecord, createRecord, deleteRecord } from 'lightning/uiRecordApi';
import ACCOUNT_OBJECT from '@salesforce/schema/Account';

const LIST_VIEW = 'AllAccounts';
const PAGE_SIZE = 50;
const NEW_ACCOUNT_NAME = 'New Account';
const NUMERIC_SF_TYPES = ['Currency', 'Double', 'Int', 'Percent', 'Long'];
const GROUP_PREFIXES = ['Billing', 'Shipping'];

// Starts with a digit (after an optional + or "("), then digits, letters, spaces and ().,#- — so
// "(512) 757-9999", "+48 22 123 45 67" and "1-800-FLOWERS x12" pass, "abc" doesn't.
const PHONE_PATTERN = /^[+(]?[0-9][0-9A-Za-z ().,#-]{6,}$/;
const FIELD_VALIDATORS = {
    Phone: (value, callback) => callback(value === null || value === '' || PHONE_PATTERN.test(String(value))),
};

export default class HandsontableApp extends LightningElement {
    data = [];
    columns = [];
    nestedHeaders = [];
    collapsibleColumns = [];
    error = null;
    // One entry per physical grid row: { id, saved, deleting, deleted }. `saved` settles once the record exists.
    _rows = [];
    _fieldApiNames = [];
    _objectInfo = null;
    _listFields = undefined;
    _optionalFields = undefined;
    _listViewName = undefined;
    _listRecords = null;
    _picklists = null;
    _recordTypeId = undefined;
    _loaded = false;

    @wire(getObjectInfo, { objectApiName: ACCOUNT_OBJECT })
    wiredObjectInfo({ data, error }) {
        if (data) {
            this._objectInfo = data;
            this._recordTypeId = data.defaultRecordTypeId;
            this._buildGrid();
        } else if (error) {
            this.error = this._messageFrom(error, 'Failed to load Account metadata');
        }
    }

    @wire(getPicklistValuesByRecordType, {
        objectApiName: ACCOUNT_OBJECT,
        recordTypeId: '$_recordTypeId',
    })
    wiredPicklists({ data, error }) {
        if (data || error) {
            this._picklists = data ? data.picklistFieldValues : {};
            this._buildGrid();
        }
    }

    // The list adapters take the object as a string; with the schema import they never send a request.
    @wire(getListInfoByName, { objectApiName: ACCOUNT_OBJECT.objectApiName, listViewApiName: LIST_VIEW })
    wiredListInfo({ data, error }) {
        if (data) {
            this._listFields = data.displayColumns.map((column) => column.fieldApiName);
            this._optionalFields = this._listFields.map((field) => `${ACCOUNT_OBJECT.objectApiName}.${field}`);
            this._listViewName = LIST_VIEW;
            this._buildGrid();
        } else if (error) {
            this.error = this._messageFrom(error, 'Failed to load the list view');
        }
    }

    // Columns go in `optionalFields`: without them LDS returns records with no values, and in `fields` one
    // unresolvable field fails the request. `$_listViewName` holds the wire until the columns arrive.
    @wire(getListRecordsByName, {
        objectApiName: ACCOUNT_OBJECT.objectApiName,
        listViewApiName: '$_listViewName',
        optionalFields: '$_optionalFields',
        pageSize: PAGE_SIZE,
    })
    wiredAccounts({ data, error }) {
        if (data) {
            this._listRecords = data;
            this._buildGrid();
        } else if (error) {
            this.error = this._messageFrom(error, 'Failed to load Accounts');
        }
    }

    _columnFor(fieldApiName, fieldInfo) {
        if (!fieldInfo) {
            return { type: 'text' };
        }

        if (fieldInfo.dataType === 'Picklist') {
            const picklist = this._picklists ? this._picklists[fieldApiName] : null;
            const values = [''];

            (picklist ? picklist.values : []).forEach((entry) => {
                values.push(entry.value);
            });

            return { type: 'dropdown', source: values };
        }

        if (NUMERIC_SF_TYPES.includes(fieldInfo.dataType)) {
            return { type: 'numeric' };
        }

        if (fieldInfo.dataType === 'Boolean') {
            return { type: 'checkbox' };
        }

        return { type: 'text' };
    }

    _groupOf(fieldName) {
        const prefix = GROUP_PREFIXES.find((candidate) => fieldName.startsWith(candidate));

        return prefix || 'General';
    }

    _buildGrid() {
        // Build once: a wire refresh after a save would reset the grid's sorting, filters, and scroll.
        if (this._loaded || !this._objectInfo || !this._listFields || !this._listRecords || !this._picklists) {
            return;
        }

        const records = this._listRecords.records;

        if (!records || records.length === 0) {
            this.error = 'No accounts found';

            return;
        }

        const fieldInfoMap = this._objectInfo.fields;
        // Relationship columns such as Owner.Alias have no field info, so they're left out.
        const availableFields = this._listFields.filter((field) => fieldInfoMap[field]);

        const groups = {};
        const groupOrder = [];

        availableFields.forEach((field) => {
            const group = this._groupOf(field);

            if (!groups[group]) {
                groups[group] = [];
                groupOrder.push(group);
            }

            groups[group].push(field);
        });

        groupOrder.sort((a, b) => {
            if (a === 'General') {
                return -1;
            }

            if (b === 'General') {
                return 1;
            }

            return a.localeCompare(b);
        });

        const orderedFields = [];

        groupOrder.forEach((group) => orderedFields.push(...groups[group]));

        const groupRow = [];
        const fieldRow = [];
        const collapsible = [];
        let colIndex = 0;

        groupOrder.forEach((group) => {
            const fields = groups[group];

            groupRow.push({ label: group, colspan: fields.length });
            collapsible.push({ row: -2, col: colIndex, collapsible: true });

            fields.forEach((field) => {
                fieldRow.push(fieldInfoMap[field].label);
            });

            colIndex += fields.length;
        });

        this.nestedHeaders = [groupRow, fieldRow];
        this.collapsibleColumns = collapsible;
        // Read-only: fields the user can't edit (field-level security, formula fields), and dependent picklists
        // such as BillingStateCode, whose valid values depend on another field in the row.
        this.columns = orderedFields.map((field) => ({
            ...this._columnFor(field, fieldInfoMap[field]),
            ...(FIELD_VALIDATORS[field] ? { validator: FIELD_VALIDATORS[field] } : {}),
            ...(fieldInfoMap[field].updateable === false || fieldInfoMap[field].controllerName
                ? { readOnly: true } : {}),
        }));

        this._fieldApiNames = orderedFields;
        this._rows = records.map((record) => ({ id: record.id, saved: Promise.resolve(), deleting: false, deleted: false }));
        this.data = records.map((record) => orderedFields.map((field) => {
            const value = record.fields[field]?.value;

            return value != null ? value : '';
        }));
        this.error = null;
        this._loaded = true;
    }

    _messageFrom(error, fallback) {
        const recordErrors = error?.body?.output?.errors;

        if (recordErrors && recordErrors.length) {
            return recordErrors.map((entry) => entry.message).join(' ');
        }

        return error?.body?.message || fallback;
    }

    _grid() {
        return this.template.querySelector('c-hot-grid');
    }

    handleCellChange(event) {
        const { physicalRow, col, newValue, valid } = event.detail;
        const row = this._rows[physicalRow];
        const fieldName = this._fieldApiNames[col];

        // An invalid value stays in the grid, marked red, and is never sent to Salesforce.
        if (!row || !fieldName || !valid) {
            return;
        }

        if (row.deleting || row.deleted) {
            this.error = 'This Account is being deleted, so the change was not saved';

            return;
        }

        // A new row's edits wait for its record to exist.
        row.saved
            .then(() => updateRecord({ fields: { Id: row.id, [fieldName]: newValue === '' ? null : newValue } }))
            .then(() => {
                this.error = null;
            })
            .catch((error) => {
                this.error = this._messageFrom(error, 'Save failed');
            });
    }

    handleRowCreate(event) {
        const { physicalIndex, amount } = event.detail;
        const nameCol = this._fieldApiNames.indexOf('Name');

        for (let i = 0; i < amount; i++) {
            const row = { id: null, saved: null, deleting: false, deleted: false };

            row.saved = createRecord({ apiName: ACCOUNT_OBJECT.objectApiName, fields: { Name: NEW_ACCOUNT_NAME } })
                .then((record) => {
                    const index = this._rows.indexOf(row);

                    row.id = record.id;

                    if (index !== -1 && nameCol !== -1) {
                        this._grid()?.setValueIfEmpty(index, nameCol, NEW_ACCOUNT_NAME);
                    }
                });
            row.saved.catch((error) => {
                this.error = this._messageFrom(error, 'Create failed');
            });

            this._rows.splice(physicalIndex + i, 0, row);
        }
    }

    // The grid keeps each row until Salesforce confirms its delete, so a refused delete leaves the row in place.
    handleRowRemoveRequest(event) {
        const rows = event.detail.physicalRows
            .map((physicalRow) => this._rows[physicalRow])
            .filter((row) => row && !row.deleting);

        rows.forEach((row) => {
            row.deleting = true;
        });

        // A row whose create failed has no record, so it goes without a delete call.
        Promise.allSettled(rows.map((row) => row.saved.then(() => deleteRecord(row.id), () => undefined)))
            .then((results) => {
                const failed = results.find((result) => result.status === 'rejected');

                rows.forEach((row, i) => {
                    row.deleting = false;
                    row.deleted = results[i].status === 'fulfilled';
                });
                this._removeDeletedRows();
                this.error = failed ? this._messageFrom(failed.reason, 'Delete failed') : null;
            });
    }

    // A deleted row hidden by a filter can't be removed from the grid; it goes with the next removal.
    _removeDeletedRows() {
        const indexes = this._rows.map((row, index) => (row.deleted ? index : -1)).filter((index) => index !== -1);
        const removed = this._grid()?.removeRows(indexes) || [];

        removed.sort((a, b) => b - a).forEach((index) => this._rows.splice(index, 1));
    }
}
