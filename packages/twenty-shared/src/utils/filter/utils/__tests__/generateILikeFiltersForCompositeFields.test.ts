import {
  generateILikeFiltersForCompositeFields,
  generateTokenGroupedILikeFiltersForCompositeFields,
} from '@/utils/filter/utils/generateILikeFiltersForCompositeFields';

describe('generateILikeFiltersForCompositeFields', () => {
  it('should format composite filters for simple filter string', () => {
    expect(
      generateILikeFiltersForCompositeFields('john', 'baseField', [
        'subField1',
        'subField2',
      ]),
    ).toEqual([
      {
        baseField: {
          subField1: {
            ilike: '%john%',
          },
        },
      },
      {
        baseField: {
          subField2: {
            ilike: '%john%',
          },
        },
      },
    ]);
  });
  it('should format composite filters for complex filter string', () => {
    expect(
      generateILikeFiltersForCompositeFields('john doe', 'name', [
        'firstName',
        'lastName',
      ]),
    ).toEqual([
      {
        name: {
          firstName: {
            ilike: '%john%',
          },
        },
      },
      {
        name: {
          lastName: {
            ilike: '%john%',
          },
        },
      },
      {
        name: {
          firstName: {
            ilike: '%doe%',
          },
        },
      },
      {
        name: {
          lastName: {
            ilike: '%doe%',
          },
        },
      },
    ]);
  });
});

describe('generateTokenGroupedILikeFiltersForCompositeFields', () => {
  it('should produce a single OR group for a single-token filter string', () => {
    expect(
      generateTokenGroupedILikeFiltersForCompositeFields('john', 'name', [
        'firstName',
        'lastName',
      ]),
    ).toEqual([
      {
        or: [
          { name: { firstName: { ilike: '%john%' } } },
          { name: { lastName: { ilike: '%john%' } } },
        ],
      },
    ]);
  });

  // Regression: "Melissa de Repentigny" used to OR every token across subfields,
  // and the common token "de" matched almost every record, returning all rows.
  // Each token must now match in at least one subfield, AND-ed across tokens.
  it('should produce one OR group per token for a multi-word filter string', () => {
    expect(
      generateTokenGroupedILikeFiltersForCompositeFields(
        'Melissa de Repentigny',
        'name',
        ['firstName', 'lastName'],
      ),
    ).toEqual([
      {
        or: [
          { name: { firstName: { ilike: '%Melissa%' } } },
          { name: { lastName: { ilike: '%Melissa%' } } },
        ],
      },
      {
        or: [
          { name: { firstName: { ilike: '%de%' } } },
          { name: { lastName: { ilike: '%de%' } } },
        ],
      },
      {
        or: [
          { name: { firstName: { ilike: '%Repentigny%' } } },
          { name: { lastName: { ilike: '%Repentigny%' } } },
        ],
      },
    ]);
  });

  it('should ignore empty tokens produced by extra whitespace', () => {
    expect(
      generateTokenGroupedILikeFiltersForCompositeFields('john  doe', 'name', [
        'firstName',
        'lastName',
      ]),
    ).toHaveLength(2);
  });
});
