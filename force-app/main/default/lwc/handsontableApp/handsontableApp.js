import { LightningElement, wire } from 'lwc';
import { getListUi } from 'lightning/uiListApi';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
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
    colHeaders = [];
    nestedHeaders = [];
    collapsibleColumns = [];
    error = null;
    _recordIds = [];
    _fieldApiNames = [];
    _objectInfo = null;
    _listData = null;

    @wire(getObjectInfo, { objectApiName: ACCOUNT_OBJECT })
    wiredObjectInfo({ data, error }) {
        if (data) {
            this._objectInfo = data;
            this._buildGrid();
        } else if (error) {
            console.error('Failed to load object info:', error);
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
            console.error('Failed to load Accounts:', error);
            this.error = error.body?.message || 'Failed to load Accounts';
        }
    }

    _getGroup(fieldName) {
        for (const prefix of GROUP_PREFIXES) {
            if (fieldName.startsWith(prefix)) return prefix;
        }
        return 'General';
    }

    _buildGrid() {
        if (!this._objectInfo || !this._listData) return;

        const records = this._listData.records.records;
        if (!records || records.length === 0) {
            this.error = 'No accounts found';
            return;
        }

        const fieldInfoMap = this._objectInfo.fields;

        // Only use fields that getListUi actually returns
        const firstRecord = records[0];
        const availableFields = [];
        for (const key in firstRecord.fields) {
            if (SKIP_FIELDS.includes(key)) continue;
            availableFields.push(key);
        }

        // Group fields
        const groups = {};
        const groupOrder = [];

        availableFields.forEach((f) => {
            const group = this._getGroup(f);
            if (!groups[group]) {
                groups[group] = [];
                groupOrder.push(group);
            }
            groups[group].push(f);
        });

        groupOrder.sort((a, b) => {
            if (a === 'General') return -1;
            if (b === 'General') return 1;
            return a.localeCompare(b);
        });

        for (const g of groupOrder) {
            groups[g].sort((a, b) => {
                if (a === 'Name') return -1;
                if (b === 'Name') return 1;
                return a.localeCompare(b);
            });
        }

        const orderedFields = [];
        groupOrder.forEach((g) => orderedFields.push(...groups[g]));

        this._fieldApiNames = orderedFields;

        // Nested headers
        const groupRow = [];
        const fieldRow = [];
        const collapsible = [];
        let colIdx = 0;

        groupOrder.forEach((g) => {
            const count = groups[g].length;
            groupRow.push({ label: g, colspan: count });
            collapsible.push({ row: -2, col: colIdx, collapsible: true });
            groups[g].forEach((f) => {
                const info = fieldInfoMap[f];
                fieldRow.push(info ? info.label : f);
            });
            colIdx += count;
        });

        this.nestedHeaders = [groupRow, fieldRow];
        this.collapsibleColumns = collapsible;

        // Column types from objectInfo metadata
        this.columns = orderedFields.map((f) => {
            const info = fieldInfoMap[f];
            if (!info) return { type: 'text', };

            const dt = info.dataType;

            if (dt === 'Picklist') {
                const values = [''];
                if (info.picklistValues) {
                    for (const pv of info.picklistValues) {
                        if (pv.active !== false) {
                            values.push(pv.label || pv.value);
                        }
                    }
                }
                return { type: 'dropdown', source: values, };
            }

            if (NUMERIC_SF_TYPES.includes(dt)) {
                return { type: 'numeric', };
            }

            if (dt === 'Boolean') {
                return { type: 'checkbox', };
            }

            return { type: 'text', };
        });

        // Data from list view records
        this._recordIds = records.map((r) => r.id);
        this.data = records.map((r) =>
            orderedFields.map((f) => {
                const val = r.fields[f]?.value;
                return val != null ? val : '';
            })
        );
        this.error = null;
    }

    handleCellChange(event) {
        const { row, col, newValue } = event.detail;
        const recordId = this._recordIds[row];
        const fieldName = this._fieldApiNames[col];

        if (!recordId || !fieldName) return;

        const fields = { Id: recordId };
        fields[fieldName] = newValue;

        updateRecord({ fields })
            .then(() => {
                console.log(`Saved: ${fieldName} = ${newValue}`);
            })
            .catch((err) => {
                console.error('Save failed:', err.body?.message || err);
            });
    }

    handleRowCreate(event) {
        const { index, amount } = event.detail;
        const grid = this.template.querySelector('c-hot-grid');

        for (let i = 0; i < amount; i++) {
            const rowIdx = index + i;

            // Insert placeholder so cellchange doesn't fire before ID is ready
            this._recordIds.splice(rowIdx, 0, null);

            // Read row data after paste fills it (next tick)
            // eslint-disable-next-line no-loop-func
            setTimeout(() => {
                // Build fields from current row data
                const fields = {};
                this._fieldApiNames.forEach((f, col) => {
                    const val = grid?.getDataAtCell?.(rowIdx, col);
                    if (val != null && val !== '') {
                        fields[f] = val;
                    }
                });

                // Account requires Name
                if (!fields.Name) fields.Name = 'New Account';

                createRecord({ apiName: 'Account', fields })
                    .then((record) => {
                        this._recordIds[rowIdx] = record.id;
                        console.log(`Created Account: ${record.id}`, fields);
                    })
                    .catch((err) => {
                        console.error('Create failed:', err.body?.message || err);
                    });
            }, 100);
        }
    }

    handleRowRemove(event) {
        const { index, amount } = event.detail;

        // Capture IDs before splicing (rows already removed from HT)
        const idsToDelete = this._recordIds.slice(index, index + amount);
        this._recordIds.splice(index, amount);

        idsToDelete.forEach((recordId) => {
            if (!recordId) return;
            deleteRecord(recordId)
                .then(() => {
                    console.log(`Deleted Account: ${recordId}`);
                })
                .catch((err) => {
                    console.error('Delete failed:', err.body?.message || err);
                });
        });
    }
}
