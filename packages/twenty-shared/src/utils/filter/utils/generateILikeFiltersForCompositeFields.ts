import { type RecordGqlOperationFilter } from '@/types';

// Escapes LIKE/ILIKE wildcards in a user value so an exact-match pattern
// (no surrounding %) can't accidentally match via a literal % or _ in the
// input. Postgres' default LIKE escape character is the backslash.
export const escapeIlikePattern = (value: string): string =>
  value.replace(/([%_\\])/g, '\\$1');

// Exact, case-insensitive match pattern for a user value: ILIKE with no
// wildcards. Used by the IS / IS_NOT operands on text-family fields so
// "JACOB" matches "Jacob" but not "Jacobos" (board card 2026-10-07).
export const exactIlikePattern = (value: string): string =>
  escapeIlikePattern(value);

export const generateILikeFiltersForCompositeFields = (
  filterString: string,
  baseFieldName: string,
  subFields: string[],
  emptyCheck = false,
) => {
  if (emptyCheck) {
    return subFields.map((subField) => {
      return {
        or: [
          {
            [baseFieldName]: {
              [subField]: {
                is: 'NULL',
              },
            },
          },
          {
            [baseFieldName]: {
              [subField]: {
                ilike: '',
              },
            },
          },
        ],
      };
    });
  }

  return filterString
    .split(' ')
    .reduce((previousValue: RecordGqlOperationFilter[], currentValue) => {
      return [
        ...previousValue,
        ...subFields.map((subField) => {
          return {
            [baseFieldName]: {
              [subField]: {
                ilike: `%${currentValue}%`,
              },
            },
          };
        }),
      ];
    }, []);
};

// Groups the ilike filters per token so a multi-word search behaves like
// "contains all words" instead of "contains any word". Each whitespace-separated
// token must match at least one subfield (OR within a token), and every token must
// match (AND across tokens). A single-token search collapses to a single OR group.
// Without this, "Melissa de Repentigny" OR-ed every token across firstName/lastName,
// and the common token "de" matched ~everyone, so the filter returned all rows.
export const generateTokenGroupedILikeFiltersForCompositeFields = (
  filterString: string,
  baseFieldName: string,
  subFields: string[],
  exactMatch = false,
): RecordGqlOperationFilter[] => {
  return filterString
    .split(' ')
    .filter((token) => token.length > 0)
    .map((token) => {
      const pattern = exactMatch ? exactIlikePattern(token) : `%${token}%`;

      return {
        or: subFields.map((subField) => {
          return {
            [baseFieldName]: {
              [subField]: {
                ilike: pattern,
              },
            },
          };
        }),
      };
    });
};
