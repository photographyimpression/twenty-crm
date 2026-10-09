import {
  ViewFilterOperand as RecordFilterOperand,
  type CompositeFieldSubFieldName,
  type LinksFilter,
  type PartialFieldMetadataItem,
} from '@/types';
import { CustomError } from '@/utils/errors';
import { type RecordFilter } from '@/utils/filter/turnRecordFilterGroupIntoGqlOperationFilter';
import { exactIlikePattern } from '@/utils/filter/utils/generateILikeFiltersForCompositeFields';
import { isNonEmptyString } from '@sniptt/guards';

export const computeGqlOperationFilterForLinks = ({
  recordFilter,
  correspondingFieldMetadataItem,
  subFieldName,
}: {
  recordFilter: Omit<RecordFilter, 'id'>;
  correspondingFieldMetadataItem: Pick<
    PartialFieldMetadataItem,
    'name' | 'type'
  >;
  subFieldName: CompositeFieldSubFieldName | null | undefined;
}) => {
  const isSubFieldFilter = isNonEmptyString(subFieldName);

  // Exact (wildcard-free, case-insensitive) pattern for IS/IS_NOT.
  const isExactMatchOperand =
    recordFilter.operand === RecordFilterOperand.IS ||
    recordFilter.operand === RecordFilterOperand.IS_NOT;
  const linkPattern = isExactMatchOperand
    ? exactIlikePattern(recordFilter.value)
    : `%${recordFilter.value}%`;

  if (isSubFieldFilter) {
    switch (subFieldName) {
      case 'primaryLinkLabel':
      case 'primaryLinkUrl': {
        switch (recordFilter.operand) {
          case RecordFilterOperand.CONTAINS:
          case RecordFilterOperand.IS:
            return {
              [correspondingFieldMetadataItem.name]: {
                [subFieldName]: {
                  ilike: linkPattern,
                },
              } satisfies LinksFilter,
            };
          case RecordFilterOperand.DOES_NOT_CONTAIN:
          case RecordFilterOperand.IS_NOT:
            return {
              not: {
                [correspondingFieldMetadataItem.name]: {
                  [subFieldName]: {
                    ilike: linkPattern,
                  },
                } satisfies LinksFilter,
              },
            };
          default:
            throw new CustomError(
              `Unknown operand ${recordFilter.operand} for ${correspondingFieldMetadataItem.type} filter`,
              'UNKNOWN_OPERAND_FOR_FILTER',
            );
        }
      }
      case 'secondaryLinks': {
        switch (recordFilter.operand) {
          case RecordFilterOperand.CONTAINS:
          case RecordFilterOperand.IS:
            return {
              [correspondingFieldMetadataItem.name]: {
                secondaryLinks: {
                  like: linkPattern,
                },
              } satisfies LinksFilter,
            };
          case RecordFilterOperand.DOES_NOT_CONTAIN:
          case RecordFilterOperand.IS_NOT:
            return {
              or: [
                {
                  not: {
                    [correspondingFieldMetadataItem.name]: {
                      secondaryLinks: {
                        like: linkPattern,
                      },
                    } satisfies LinksFilter,
                  },
                },
                {
                  [correspondingFieldMetadataItem.name]: {
                    secondaryLinks: {
                      is: 'NULL',
                    },
                  } satisfies LinksFilter,
                },
              ],
            };
          default:
            throw new Error(
              `Unknown operand ${recordFilter.operand} for ${correspondingFieldMetadataItem.type} filter`,
            );
        }
      }
      default: {
        throw new Error( // TODO
          `Unknown subfield name ${subFieldName}`,
          // 'UNKNOWN_SUBFIELD_NAME',
        );
      }
    }
  }

  switch (recordFilter.operand) {
    case RecordFilterOperand.CONTAINS:
    case RecordFilterOperand.IS:
      return {
        or: [
          {
            [correspondingFieldMetadataItem.name]: {
              primaryLinkUrl: {
                ilike: linkPattern,
              },
            } satisfies LinksFilter,
          },
          {
            [correspondingFieldMetadataItem.name]: {
              primaryLinkLabel: {
                ilike: linkPattern,
              },
            } satisfies LinksFilter,
          },
          {
            [correspondingFieldMetadataItem.name]: {
              secondaryLinks: {
                like: linkPattern,
              },
            } satisfies LinksFilter,
          },
        ],
      };
    case RecordFilterOperand.DOES_NOT_CONTAIN:
    case RecordFilterOperand.IS_NOT:
      return {
        and: [
          {
            not: {
              [correspondingFieldMetadataItem.name]: {
                primaryLinkLabel: {
                  ilike: linkPattern,
                },
              } satisfies LinksFilter,
            },
          },
          {
            not: {
              [correspondingFieldMetadataItem.name]: {
                primaryLinkUrl: {
                  ilike: linkPattern,
                },
              } satisfies LinksFilter,
            },
          },
          {
            or: [
              {
                not: {
                  [correspondingFieldMetadataItem.name]: {
                    secondaryLinks: {
                      like: linkPattern,
                    },
                  } satisfies LinksFilter,
                },
              },
              {
                [correspondingFieldMetadataItem.name]: {
                  secondaryLinks: {
                    is: 'NULL',
                  },
                } satisfies LinksFilter,
              },
            ],
          },
        ],
      };
    default:
      throw new Error(
        `Unknown operand ${recordFilter.operand} for ${correspondingFieldMetadataItem.type} filter`,
      );
  }
};
