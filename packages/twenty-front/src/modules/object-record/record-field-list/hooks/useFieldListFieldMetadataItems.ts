import { useLabelIdentifierFieldMetadataItem } from '@/object-metadata/hooks/useLabelIdentifierFieldMetadataItem';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useObjectMetadataItems } from '@/object-metadata/hooks/useObjectMetadataItems';
import { useObjectPermissions } from '@/object-record/hooks/useObjectPermissions';
import { categorizeRelationFields } from '@/object-record/record-field-list/utils/categorizeRelationFields';
import { isFieldCellSupported } from '@/object-record/utils/isFieldCellSupported';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import groupBy from 'lodash.groupby';
import { FieldMetadataType } from 'twenty-shared/types';
import { FeatureFlagKey } from '~/generated-metadata/graphql';

type UseFieldListFieldMetadataItemsProps = {
  objectNameSingular: string;
  excludeFieldMetadataIds?: string[];
  excludeCreatedAtAndUpdatedAt?: boolean;
  showRelationSections?: boolean;
};

const PRIORITY_FIELD_NAMES = [
  'emails',
  'phones',
  'jobTitle',
  'company',
  'city',
  'linkedinLink',
  'xLink',
];

const compareByPriorityThenName = (
  fieldA: { name: string },
  fieldB: { name: string },
) => {
  const priorityA = PRIORITY_FIELD_NAMES.indexOf(fieldA.name);
  const priorityB = PRIORITY_FIELD_NAMES.indexOf(fieldB.name);

  if (priorityA !== -1 && priorityB !== -1) return priorityA - priorityB;
  if (priorityA !== -1) return -1;
  if (priorityB !== -1) return 1;
  return fieldA.name.localeCompare(fieldB.name);
};

export const useFieldListFieldMetadataItems = ({
  objectNameSingular,
  excludeFieldMetadataIds = [],
  showRelationSections = true,
  excludeCreatedAtAndUpdatedAt = true,
}: UseFieldListFieldMetadataItemsProps) => {
  const { labelIdentifierFieldMetadataItem } =
    useLabelIdentifierFieldMetadataItem({
      objectNameSingular,
    });

  const { objectPermissionsByObjectMetadataId } = useObjectPermissions();

  const { objectMetadataItem } = useObjectMetadataItem({
    objectNameSingular,
  });

  const { objectMetadataItems } = useObjectMetadataItems();

  const isJunctionRelationsEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_JUNCTION_RELATIONS_ENABLED,
  );

  const availableFieldMetadataItems = objectMetadataItem.readableFields
    .filter(
      (fieldMetadataItem) =>
        isFieldCellSupported(fieldMetadataItem, objectMetadataItems) &&
        fieldMetadataItem.id !== labelIdentifierFieldMetadataItem?.id &&
        !excludeFieldMetadataIds.includes(fieldMetadataItem.id) &&
        (!excludeCreatedAtAndUpdatedAt ||
          (fieldMetadataItem.name !== 'createdAt' &&
            fieldMetadataItem.name !== 'deletedAt')) &&
        (showRelationSections ||
          (fieldMetadataItem.type !== FieldMetadataType.RELATION &&
            fieldMetadataItem.type !== FieldMetadataType.MORPH_RELATION)),
    )
    .sort(compareByPriorityThenName);

  const { inlineFieldMetadataItems, relationFieldMetadataItems } = groupBy(
    availableFieldMetadataItems
      .filter(
        (fieldMetadataItem) =>
          fieldMetadataItem.name !== 'createdAt' &&
          fieldMetadataItem.name !== 'deletedAt',
      )
      .filter(
        (fieldMetadataItem) =>
          fieldMetadataItem.type !== FieldMetadataType.RICH_TEXT_V2,
      ),
    (fieldMetadataItem) =>
      fieldMetadataItem.type === FieldMetadataType.RELATION ||
      fieldMetadataItem.type === FieldMetadataType.MORPH_RELATION
        ? 'relationFieldMetadataItems'
        : 'inlineFieldMetadataItems',
  );

  const { activityTargetFields, inlineRelationFields, boxedRelationFields } =
    categorizeRelationFields({
      relationFields: relationFieldMetadataItems ?? [],
      objectNameSingular,
      objectPermissionsByObjectMetadataId,
      isJunctionRelationsEnabled,
    });

  const allInlineFieldMetadataItems = [
    ...(inlineFieldMetadataItems ?? []),
    ...inlineRelationFields,
  ].sort(compareByPriorityThenName);

  return {
    inlineFieldMetadataItems: allInlineFieldMetadataItems,
    legacyActivityTargetFieldMetadataItems: activityTargetFields,
    boxedRelationFieldMetadataItems: boxedRelationFields,
  };
};
