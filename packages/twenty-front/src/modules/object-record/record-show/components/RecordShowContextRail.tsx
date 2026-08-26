// LOCAL-PATCH: Salesmate's right-hand context rail — Overview / Company /
// Deals. Twenty scatters the same information across tabs; Salesmate keeps it
// pinned beside the timeline so "is this person going cold?" is one glance.
import { useTimelineActivities } from '@/activities/timeline-activities/hooks/useTimelineActivities';
import { getTimelineEventCategory } from '@/activities/timeline-activities/utils/getTimelineEventCategory';
import { useObjectMetadataItems } from '@/object-metadata/hooks/useObjectMetadataItems';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { recordStoreFamilyState } from '@/object-record/record-store/states/recordStoreFamilyState';
import { useAtomFamilyStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilyStateValue';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';
import { Tag } from 'twenty-ui/components';
import { Avatar } from 'twenty-ui/display';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { dateLocaleState } from '~/localization/states/dateLocaleState';
import { convertCurrencyMicrosToCurrencyAmount } from '~/utils/convertCurrencyToCurrencyMicros';
import { beautifyPastDateRelativeToNow } from '~/utils/date-utils';

const StyledRail = styled.div`
  background: ${themeCssVariables.background.secondary};
  border-left: 1px solid ${themeCssVariables.border.color.medium};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  height: 100%;
  overflow-y: auto;
  padding: ${themeCssVariables.spacing[4]};
`;

const StyledCard = styled.div`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledCardHeader = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

const StyledCount = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-weight: ${themeCssVariables.font.weight.regular};
`;

const StyledRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const StyledRowLabel = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledRowValue = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledCompanyRow = styled(Link)`
  align-items: center;
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const StyledDealRow = styled(Link)`
  align-items: center;
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  padding-top: ${themeCssVariables.spacing[2]};
  text-decoration: none;

  &:first-of-type {
    border-top: none;
    padding-top: 0;
  }
`;

const StyledDealName = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledDealAmount = styled.span`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  white-space: nowrap;
`;

const StyledEmpty = styled.span`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.sm};
`;

const MAX_DEALS = 5;

// Narrows the loosely typed ObjectRecord bag down to a usable string.
const asNonEmptyString = (value: unknown): string | null =>
  isNonEmptyString(value) ? value : null;

type OverviewRow = { label: string; value: string };

const OverviewCard = ({ rows }: { rows: OverviewRow[] }) => (
  <StyledCard>
    <StyledCardHeader>{t`Overview`}</StyledCardHeader>
    {rows.map(({ label, value }) => (
      <StyledRow key={label}>
        <StyledRowLabel>{label}</StyledRowLabel>
        <StyledRowValue>{value}</StyledRowValue>
      </StyledRow>
    ))}
  </StyledCard>
);

export const RecordShowContextRail = ({
  objectNameSingular,
  objectRecordId,
}: {
  objectNameSingular: string;
  objectRecordId: string;
}) => {
  const recordStore = useAtomFamilyStateValue(
    recordStoreFamilyState,
    objectRecordId,
  );
  const { objectMetadataItems } = useObjectMetadataItems();
  const { localeCatalog } = useAtomStateValue(dateLocaleState);

  const { timelineActivities } = useTimelineActivities({
    id: objectRecordId,
    targetObjectNameSingular: objectNameSingular,
  });

  const isPerson = objectNameSingular === CoreObjectNameSingular.Person;

  const { records: deals } = useFindManyRecords<ObjectRecord>({
    skip: !isPerson,
    objectNameSingular: CoreObjectNameSingular.Opportunity,
    filter: { pointOfContactId: { eq: objectRecordId } },
    limit: MAX_DEALS,
  });

  const linkedObjectNameSingularById = useMemo(
    () =>
      Object.fromEntries(
        objectMetadataItems.map((objectMetadataItem) => [
          objectMetadataItem.id,
          objectMetadataItem.nameSingular,
        ]),
      ),
    [objectMetadataItems],
  );

  // timelineActivities arrive newest-first, so the first match in each bucket
  // is the most recent one.
  const lastDates = useMemo(() => {
    let lastEmail: string | undefined;
    let lastCall: string | undefined;
    let lastCommunication: string | undefined;

    for (const event of timelineActivities) {
      const category = getTimelineEventCategory({
        event,
        linkedObjectNameSingularById,
      });

      if (category === 'emails' && !isDefined(lastEmail)) {
        lastEmail = event.createdAt;
      }
      if (category === 'calls' && !isDefined(lastCall)) {
        lastCall = event.createdAt;
      }
      if (
        (category === 'emails' ||
          category === 'calls' ||
          category === 'texts') &&
        !isDefined(lastCommunication)
      ) {
        lastCommunication = event.createdAt;
      }
    }

    return { lastEmail, lastCall, lastCommunication };
  }, [timelineActivities, linkedObjectNameSingularById]);

  const beautify = (date: string | undefined) =>
    isDefined(date) ? beautifyPastDateRelativeToNow(date, localeCatalog) : '—';

  const overviewRows: OverviewRow[] = [
    {
      label: t`Created`,
      value: beautify(recordStore?.createdAt),
    },
    {
      label: t`Last communication`,
      value: beautify(lastDates.lastCommunication),
    },
    { label: t`Last email`, value: beautify(lastDates.lastEmail) },
    { label: t`Last call`, value: beautify(lastDates.lastCall) },
  ];

  const company = recordStore?.company as
    | { id?: string; name?: string | null }
    | null
    | undefined;
  const companyId = asNonEmptyString(company?.id);
  const companyName = asNonEmptyString(company?.name);

  const formatAmount = (deal: ObjectRecord): string => {
    const amountMicros = deal.amount?.amountMicros;

    if (!isDefined(amountMicros)) {
      return '';
    }

    const amount = convertCurrencyMicrosToCurrencyAmount(amountMicros);

    return isDefined(amount) ? `$${Math.round(amount).toLocaleString()}` : '';
  };

  return (
    <StyledRail>
      <OverviewCard rows={overviewRows} />

      {isPerson && (
        <StyledCard>
          <StyledCardHeader>{t`Company`}</StyledCardHeader>
          {isDefined(companyId) && isDefined(companyName) ? (
            <StyledCompanyRow to={`/object/company/${companyId}`}>
              <Avatar
                placeholder={companyName}
                placeholderColorSeed={companyId}
                size="sm"
                type="squared"
              />
              {companyName}
            </StyledCompanyRow>
          ) : (
            <StyledEmpty>{t`No company linked`}</StyledEmpty>
          )}
        </StyledCard>
      )}

      {isPerson && (
        <StyledCard>
          <StyledCardHeader>
            {t`Deals`}
            <StyledCount>{deals.length}</StyledCount>
          </StyledCardHeader>
          {deals.length === 0 ? (
            <StyledEmpty>{t`No deals yet`}</StyledEmpty>
          ) : (
            deals.map((deal) => (
              <StyledDealRow
                key={deal.id}
                to={`/object/opportunity/${deal.id}`}
              >
                <StyledDealName>
                  {asNonEmptyString(deal.name) ?? t`Untitled`}
                </StyledDealName>
                {isDefined(asNonEmptyString(deal.stage)) ? (
                  <Tag color="gray" text={String(deal.stage)} preventShrink />
                ) : (
                  <StyledDealAmount>{formatAmount(deal)}</StyledDealAmount>
                )}
              </StyledDealRow>
            ))
          )}
        </StyledCard>
      )}
    </StyledRail>
  );
};
