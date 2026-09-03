// LOCAL-PATCH: Salesmate's "Showing: All | Activities | Deals | …" pill row
// that filters the single unified timeline in place.
import { type TimelineEventCategory } from '@/activities/timeline-activities/utils/getTimelineEventCategory';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledContainer = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledLabel = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  margin-right: ${themeCssVariables.spacing[1]};
`;

// The selected pill uses the tag palette rather than a solid fill: those are
// the only tokens with a background/text pair that stays legible in both themes.
const StyledPill = styled.button<{ isActive: boolean }>`
  background: ${({ isActive }) =>
    isActive
      ? themeCssVariables.tag.background.blue
      : themeCssVariables.background.transparent.lighter};
  border: 1px solid
    ${({ isActive }) =>
      isActive
        ? themeCssVariables.color.blue
        : themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.pill};
  color: ${({ isActive }) =>
    isActive
      ? themeCssVariables.tag.text.blue
      : themeCssVariables.font.color.secondary};
  cursor: pointer;
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${({ isActive }) =>
    isActive
      ? themeCssVariables.font.weight.semiBold
      : themeCssVariables.font.weight.regular};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[3]};
  white-space: nowrap;

  &:hover {
    border-color: ${themeCssVariables.border.color.strong};
  }
`;

export type TimelineFilter = TimelineEventCategory | 'all';

type TimelineFilterPillsProps = {
  activeFilter: TimelineFilter;
  onFilterChange: (filter: TimelineFilter) => void;
  countsByCategory: Record<TimelineEventCategory, number>;
  totalCount: number;
};

const getCategoryLabel = (category: TimelineEventCategory): string => {
  switch (category) {
    case 'activities':
      return t`Activities`;
    case 'deals':
      return t`Deals`;
    case 'notes':
      return t`Notes`;
    case 'emails':
      return t`Emails`;
    case 'texts':
      return t`Texts`;
    case 'calls':
      return t`Calls`;
    case 'messages':
      return t`Messages`;
    case 'files':
      return t`Files`;
    case 'updates':
      return t`Updates`;
  }
};

export const TimelineFilterPills = ({
  activeFilter,
  onFilterChange,
  countsByCategory,
  totalCount,
}: TimelineFilterPillsProps) => {
  // Only offer a pill the user can actually land on — an empty filter is a
  // dead end, and Salesmate's fixed row of eight would be mostly dead here.
  // LOCAL-PATCH (board card 2026-09-02): Calls and Texts are ALWAYS shown on
  // a record with any timeline content — the phone/SMS history lives in older
  // pages of the timeline, so their counts can read 0 on the first page while
  // the filter is still exactly what the user looks for ("there should be one
  // for Calls as well").
  const PINNED_CATEGORIES: TimelineEventCategory[] = ['calls', 'texts'];

  const availableCategories = (
    Object.keys(countsByCategory) as TimelineEventCategory[]
  ).filter(
    (category) =>
      countsByCategory[category] > 0 ||
      (totalCount > 0 && PINNED_CATEGORIES.includes(category)),
  );

  if (availableCategories.length < 2) {
    return null;
  }

  return (
    <StyledContainer>
      <StyledLabel>{t`Showing:`}</StyledLabel>
      <StyledPill
        type="button"
        isActive={activeFilter === 'all'}
        onClick={() => onFilterChange('all')}
      >
        {t`All`} {totalCount}
      </StyledPill>
      {availableCategories.map((category) => (
        <StyledPill
          key={category}
          type="button"
          isActive={activeFilter === category}
          onClick={() => onFilterChange(category)}
        >
          {getCategoryLabel(category)} {countsByCategory[category]}
        </StyledPill>
      ))}
    </StyledContainer>
  );
};
