import { getLabelIdentifierFieldMetadataItem } from '@/object-metadata/utils/getLabelIdentifierFieldMetadataItem';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { hasAnySoftDeleteFilterOnViewComponentSelector } from '@/object-record/record-filter/states/hasAnySoftDeleteFilterOnView';
import { useUpsertRecordsInStore } from '@/object-record/record-store/hooks/useUpsertRecordsInStore';
import { useRecordTableContextOrThrow } from '@/object-record/record-table/contexts/RecordTableContext';
import { useCreateNewIndexRecord } from '@/object-record/record-table/hooks/useCreateNewIndexRecord';
import { RecordTableActionRow } from '@/object-record/record-table/record-table-row/components/RecordTableActionRow';
import { isRecordTableCreateDisabled } from '@/object-record/record-table/utils/isRecordTableCreateDisabled';
import { useLoadRecordsToVirtualRows } from '@/object-record/record-table/virtualization/hooks/useLoadRecordsToVirtualRows';
import { totalNumberOfRecordsToVirtualizeComponentState } from '@/object-record/record-table/virtualization/states/totalNumberOfRecordsToVirtualizeComponentState';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { useAtomComponentSelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentSelectorValue';
import { useAtomComponentStateCallbackState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateCallbackState';
import { t } from '@lingui/core/macro';
import { useStore } from 'jotai';
import { useCallback, useRef, useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { IconPlus } from 'twenty-ui/display';
import { FieldMetadataType } from '~/generated-metadata/graphql';

// Impression fork: split a typed "First Last" into name parts, keeping any
// trailing words as the last name ("Mary Jane Watson" → "Mary" / "Jane
// Watson"). Local to this row so it doesn't change the shared splitFullName
// util that paste handling and its tests depend on.
const splitTypedName = (
  fullName: string,
): { firstName: string; lastName: string } => {
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  };
};

export const RecordTableNoRecordGroupAddNew = () => {
  const { objectMetadataItem } = useRecordTableContextOrThrow();

  const { createNewIndexRecord } = useCreateNewIndexRecord({
    objectMetadataItem,
  });

  const objectPermissions = useObjectPermissionsForObject(
    objectMetadataItem.id,
  );

  const hasObjectUpdatePermissions = objectPermissions.canUpdateObjectRecords;

  const hasAnySoftDeleteFilterOnView = useAtomComponentSelectorValue(
    hasAnySoftDeleteFilterOnViewComponentSelector,
  );

  // Read/advance the virtualized-row count from the live jotai store (not a
  // render-time snapshot) so back-to-back adds insert at N, N+1, N+2… instead
  // of all colliding at a stale N and overwriting each other.
  const store = useStore();
  const totalNumberOfRecordsToVirtualizeCallbackState =
    useAtomComponentStateCallbackState(
      totalNumberOfRecordsToVirtualizeComponentState,
    );

  const { loadRecordsToVirtualRows } = useLoadRecordsToVirtualRows();
  const { upsertRecordsInStore } = useUpsertRecordsInStore();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();

  const inputRef = useRef<HTMLInputElement>(null);
  const [inlineValue, setInlineValue] = useState('');
  // Ref (not state) so back-to-back Enters can't double-submit before the
  // async create resolves.
  const isSubmittingRef = useRef(false);

  const labelIdentifierFieldMetadataItem =
    getLabelIdentifierFieldMetadataItem(objectMetadataItem);
  const labelIdentifierType = labelIdentifierFieldMetadataItem?.type;

  // Inline typing only makes sense when the record's title is a name you can
  // type: a FullName (person) or a plain Text (company, opportunity, …).
  const supportsInlineCreate =
    labelIdentifierType === FieldMetadataType.FULL_NAME ||
    labelIdentifierType === FieldMetadataType.TEXT;

  const insertCreatedRecordIntoTable = useCallback(
    (createdRecord: Awaited<ReturnType<typeof createNewIndexRecord>>) => {
      upsertRecordsInStore({ partialRecords: [createdRecord] });

      const currentCount = store.get(
        totalNumberOfRecordsToVirtualizeCallbackState,
      );

      if (isDefined(currentCount)) {
        loadRecordsToVirtualRows({
          records: [createdRecord],
          startingRealIndex: currentCount,
        });
        store.set(
          totalNumberOfRecordsToVirtualizeCallbackState,
          currentCount + 1,
        );
      }
    },
    [
      store,
      totalNumberOfRecordsToVirtualizeCallbackState,
      upsertRecordsInStore,
      loadRecordsToVirtualRows,
    ],
  );

  const handleButtonClick = useCallback(async () => {
    const createdRecord = await createNewIndexRecord({
      position: 'last',
    });

    insertCreatedRecordIntoTable(createdRecord);
  }, [createNewIndexRecord, insertCreatedRecordIntoTable]);

  const submitInlineRecord = useCallback(async () => {
    const trimmedValue = inlineValue.trim();

    if (trimmedValue === '' || isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    // Clear immediately so you can start typing the next contact right away.
    setInlineValue('');

    const fieldName = labelIdentifierFieldMetadataItem?.name;

    const nameValue =
      labelIdentifierType === FieldMetadataType.FULL_NAME
        ? splitTypedName(trimmedValue)
        : trimmedValue;

    try {
      const createdRecord = await createNewIndexRecord(
        {
          position: 'last',
          ...(isDefined(fieldName) && { [fieldName]: nameValue }),
        },
        { stayOnIndex: true },
      );

      insertCreatedRecordIntoTable(createdRecord);

      // eslint-disable-next-line lingui/no-unlocalized-strings
      enqueueSuccessSnackBar({ message: `Added ${trimmedValue}` });
    } catch {
      // The create failed — put the typed name back so it isn't silently lost
      // (unless the user already started typing the next contact into the
      // cleared field) and tell them, so the empty input isn't mistaken for a
      // success.
      setInlineValue((current) => (current === '' ? trimmedValue : current));
      // eslint-disable-next-line lingui/no-unlocalized-strings
      enqueueErrorSnackBar({
        message: `Couldn't add "${trimmedValue}" — please try again.`,
      });
    } finally {
      isSubmittingRef.current = false;
      inputRef.current?.focus();
    }
  }, [
    inlineValue,
    labelIdentifierFieldMetadataItem?.name,
    labelIdentifierType,
    createNewIndexRecord,
    insertCreatedRecordIntoTable,
    enqueueSuccessSnackBar,
    enqueueErrorSnackBar,
  ]);

  const handleInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitInlineRecord();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setInlineValue('');
      inputRef.current?.blur();
    }
  };

  if (hasAnySoftDeleteFilterOnView) {
    return null;
  }

  if (!hasObjectUpdatePermissions) {
    return null;
  }

  if (isRecordTableCreateDisabled(objectMetadataItem.nameSingular)) {
    return null;
  }

  if (supportsInlineCreate) {
    // eslint-disable-next-line lingui/no-unlocalized-strings
    const placeholder = `Add a ${objectMetadataItem.labelSingular.toLowerCase()}… (press Enter)`;

    return (
      <RecordTableActionRow
        LeftIcon={IconPlus}
        text={placeholder}
        variant="input"
        inputRef={inputRef}
        inputValue={inlineValue}
        inputPlaceholder={placeholder}
        onInputChange={setInlineValue}
        onInputKeyDown={handleInputKeyDown}
        onClick={() => inputRef.current?.focus()}
      />
    );
  }

  return (
    <RecordTableActionRow
      onClick={handleButtonClick}
      LeftIcon={IconPlus}
      text={t`Add New`}
    />
  );
};
