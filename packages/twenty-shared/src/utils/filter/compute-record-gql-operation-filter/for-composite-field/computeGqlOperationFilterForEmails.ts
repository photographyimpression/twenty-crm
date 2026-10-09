import {
  type CompositeFieldSubFieldName,
  type EmailsFilter,
  type PartialFieldMetadataItem,
  ViewFilterOperand as RecordFilterOperand,
  type RecordGqlOperationFilter,
} from '@/types';
import { CustomError } from '@/utils/errors';

import { type RecordFilter } from '@/utils/filter/turnRecordFilterGroupIntoGqlOperationFilter';
import { exactIlikePattern } from '@/utils/filter/utils/generateILikeFiltersForCompositeFields';
import { isNonEmptyString } from '@sniptt/guards';

export const computeGqlOperationFilterForEmails = ({
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
}): RecordGqlOperationFilter => {
  const isSubFieldFilter = isNonEmptyString(subFieldName);

  // Exact (wildcard-free, case-insensitive) pattern for IS/IS_NOT.
  const isExactMatchOperand =
    recordFilter.operand === RecordFilterOperand.IS ||
    recordFilter.operand === RecordFilterOperand.IS_NOT;
  const emailPattern = isExactMatchOperand
    ? exactIlikePattern(recordFilter.value)
    : `%${recordFilter.value}%`;

  if (isSubFieldFilter) {
    switch (subFieldName) {
      case 'primaryEmail': {
        switch (recordFilter.operand) {
          case RecordFilterOperand.CONTAINS:
          case RecordFilterOperand.IS:
            return {
              [correspondingFieldMetadataItem.name]: {
                primaryEmail: {
                  ilike: emailPattern,
                },
              } satisfies EmailsFilter,
            };
          case RecordFilterOperand.DOES_NOT_CONTAIN:
          case RecordFilterOperand.IS_NOT:
            return {
              not: {
                [correspondingFieldMetadataItem.name]: {
                  primaryEmail: {
                    ilike: emailPattern,
                  },
                } satisfies EmailsFilter,
              },
            };
          default:
            throw new Error(
              `Unknown operand ${recordFilter.operand} for ${correspondingFieldMetadataItem.type} filter`,
            );
        }
      }
      case 'additionalEmails': {
        switch (recordFilter.operand) {
          case RecordFilterOperand.CONTAINS:
          case RecordFilterOperand.IS:
            return {
              [correspondingFieldMetadataItem.name]: {
                additionalEmails: {
                  like: emailPattern,
                },
              } satisfies EmailsFilter,
            };
          case RecordFilterOperand.DOES_NOT_CONTAIN:
          case RecordFilterOperand.IS_NOT:
            return {
              or: [
                {
                  not: {
                    [correspondingFieldMetadataItem.name]: {
                      additionalEmails: {
                        like: emailPattern,
                      },
                    } satisfies EmailsFilter,
                  },
                },
                {
                  [correspondingFieldMetadataItem.name]: {
                    additionalEmails: {
                      is: 'NULL',
                    },
                  } satisfies EmailsFilter,
                },
              ],
            };
          default:
            throw new CustomError(
              `Unknown operand ${recordFilter.operand} for ${correspondingFieldMetadataItem.type} filter`,
              'UNKNOWN_OPERAND_FOR_FILTER',
            );
        }
      }
      default: {
        throw new CustomError(
          `Unknown subfield name ${subFieldName}`,
          'UNKNOWN_SUBFIELD_NAME',
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
              primaryEmail: {
                ilike: emailPattern,
              },
            } satisfies EmailsFilter,
          },
          {
            [correspondingFieldMetadataItem.name]: {
              additionalEmails: {
                like: emailPattern,
              },
            } satisfies EmailsFilter,
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
                primaryEmail: {
                  ilike: emailPattern,
                },
              } satisfies EmailsFilter,
            },
          },
          {
            or: [
              {
                not: {
                  [correspondingFieldMetadataItem.name]: {
                    additionalEmails: {
                      like: emailPattern,
                    },
                  } satisfies EmailsFilter,
                },
              },
              {
                [correspondingFieldMetadataItem.name]: {
                  additionalEmails: {
                    is: 'NULL',
                  },
                } satisfies EmailsFilter,
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
