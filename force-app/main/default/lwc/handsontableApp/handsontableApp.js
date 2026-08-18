import { LightningElement, wire } from 'lwc';
import { getListUi } from 'lightning/uiListApi';
import { getObjectInfo, getPicklistValuesByRecordType } from 'lightning/uiObjectInfoApi';
import { updateRecord, createRecord, deleteRecord } from 'lightning/uiRecordApi';
import ACCOUNT_OBJECT from '@salesforce/schema/Account';

const SKIP_FIELDS = ['Id', 'OwnerId', 'Owner', 'CreatedById', 'LastModifiedById',
    'LastModifiedDate', 'CreatedDate', 'SystemModstamp', 'IsDeleted',
    'LastViewedDate', 'LastReferencedDate', 'MasterRecordId',
    'PhotoUrl', 'CleanStatus', 'OperatingHoursId'];

const NUMERIC_SF_TYPES = ['Currency', 'Double', 'Int', 'Percent', 'Long'];
const GROUP_PREFIXES = ['Billing', 'Shipping'];

export default class HandsontableApp extends LightningElement {
    data = [];
    columns = [];
    nestedHeaders = [];
    collapsibleColumns = [];
    error = null;
    _recordIds = [];
    _fieldApiNames = [];
    _objectInfo = null;
    _listData = null;
    _picklists = null;
    _recordTypeId = undefined;

    @wire(getObjectInfo, { objectApiName: ACCOUNT_OBJECT })
    wiredObjectInfo({ data, error }) {
        if (data) {
            this._objectInfo = data;
            this._recordTypeId = data.defaultRecordTypeId;
            this._buildGrid();
        } else if (error) {
            this.error = error.body?.message || 'Failed to load Account metadata';
        }
    }

    @wire(getPicklistValuesByRecordType, {
        objectApiName: ACCOUNT_OBJECT,
        recordTypeId: '$_recordTypeId',
    })
    wiredPicklists({ data, error }) {
        if (data) {
            this._picklists = data.picklistFieldValues;
            this._buildGrid();
        } else if (error) {
            this._picklists = {};
            this._buildGrid();
        }
    }

    @wire(getListUi, {
        objectApiName: ACCOUNT_OBJECT,
        listViewApiName: 'AllAccounts',
        pageSize: 50,
    })
    wiredAccounts({ data, error }) {
        if (data) {
            this._listData = data;
            this._buildGrid();
        } else if (error) {
            this.error = error.body?.message || 'Failed to load Accounts';
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
        if (!this._objectInfo || !this._listData || !this._picklists) {
            return;
        }

        const records = this._listData.records.records;

        if (!records || records.length === 0) {
            this.error = 'No accounts found';

            return;
        }

        const fieldInfoMap = this._objectInfo.fields;
        const availableFields = Object.keys(records[0].fields)
            .filter((field) => !SKIP_FIELDS.includes(field));

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
                const info = fieldInfoMap[field];

                fieldRow.push(info ? info.label : field);
            });

            colIndex += fields.length;
        });

        this.nestedHeaders = [groupRow, fieldRow];
        this.collapsibleColumns = collapsible;
        this.columns = orderedFields.map((field) => this._columnFor(field, fieldInfoMap[field]));

        this._fieldApiNames = orderedFields;
        this._recordIds = records.map((record) => record.id);
        this.data = records.map((record) => orderedFields.map((field) => {
            const value = record.fields[field]?.value;

            return value != null ? value : '';
        }));
        this.error = null;
    }

    _messageFrom(error, fallback) {
        const recordErrors = error?.body?.output?.errors;

        if (recordErrors && recordErrors.length) {
            return recordErrors.map((entry) => entry.message).join(' ');
        }

        return error?.body?.message || fallback;
    }

    handleCellChange(event) {
        const { row, col, newValue } = event.detail;
        const recordId = this._recordIds[row];
        const fieldName = this._fieldApiNames[col];

        if (!recordId || !fieldName) {
            return;
        }

        updateRecord({ fields: { Id: recordId, [fieldName]: newValue } })
            .catch((error) => {
                this.error = this._messageFrom(error, 'Save failed');
            });
    }

    handleRowCreate(event) {
        const { index, amount } = event.detail;
        const grid = this.template.querySelector('c-hot-grid');

        for (let i = 0; i < amount; i++) {
            const rowIndex = index + i;

            this._recordIds.splice(rowIndex, 0, null);

            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => {
                const fields = {};

                this._fieldApiNames.forEach((field, col) => {
                    const value = grid?.getDataAtCell?.(rowIndex, col);

                    if (value != null && value !== '') {
                        fields[field] = value;
                    }
                });

                if (!fields.Name) {
                    fields.Name = 'New Account';
                }

                createRecord({ apiName: 'Account', fields })
                    .then((record) => {
                        this._recordIds[rowIndex] = record.id;
                    })
                    .catch((error) => {
                        this.error = this._messageFrom(error, 'Create failed');
                    });
            }, 100);
        }
    }

    handleRowRemoveRequest(event) {
        const { index, amount } = event.detail;
        const removedIds = this._recordIds.slice(index, index + amount);
        const removedRows = this.data.slice(index, index + amount);

        this._recordIds.splice(index, amount);
        this.data = [...this.data.slice(0, index), ...this.data.slice(index + amount)];
        this.error = null;

        Promise.all(removedIds.map((recordId) => (recordId ? deleteRecord(recordId) : Promise.resolve())))
            .catch((error) => {
                this._recordIds.splice(index, 0, ...removedIds);
                this.data = [
                    ...this.data.slice(0, index),
                    ...removedRows,
                    ...this.data.slice(index),
                ];
                this.error = this._messageFrom(error, 'Delete failed');
            });
    }
}
