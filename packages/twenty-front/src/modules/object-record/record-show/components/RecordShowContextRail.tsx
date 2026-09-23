// LOCAL-PATCH: Salesmate's right-hand context rail — Overview / Company /
// Deals. Twenty scatters the same information across tabs; Salesmate keeps it
// pinned beside the timeline so "is this person going cold?" is one glance.
import { useTimelineActivities } from '@/activities/timeline-activities/hooks/useTimelineActivities';
import { getTimelineEventCategory } from '@/activities/timeline-activities/utils/getTimelineEventCategory';
import { getPrimaryPhoneE164 } from '@/calls/utils/getPrimaryPhoneE164';
import { useObjectMetadataItems } from '@/object-metadata/hooks/useObjectMetadataItems';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { recordStoreFamilyState } from '@/object-record/record-store/states/recordStoreFamilyState';
import { useAtomFamilyStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilyStateValue';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';
import { Tag } from 'twenty-ui/components';
import { Avatar, IconCoins } from 'twenty-ui/display';
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

// LOCAL-PATCH (2026-09-11, direct request): "Add to QuickBooks" — flips
// Contact Type to Customer and hands name / email / phone / company to the
// studio-Mac QuickBooks bridge (tools/quickbooks-bridge), which drives the
// logged-in Safari session to create the customer in QuickBooks Online.
// v2 (2026-09-23): once the person's QuickBooks customer id is known
// (quickbooksNameId, stored automatically after a successful push), the card
// switches to "Open in QuickBooks" + "Create invoice".
const QUICKBOOKS_BRIDGE_ORIGIN = 'http://127.0.0.1:8788';

const StyledQuickBooksButton = styled.button`
  align-items: center;
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  display: flex;
  flex: 1;
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: center;
  padding: ${themeCssVariables.spacing[2]};

  &:hover:enabled {
    background: ${themeCssVariables.background.tertiary};
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
`;

const StyledQuickBooksButtonRow = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledQuickBooksHint = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  text-align: center;
`;

// Opens a bridge popup and keeps `busy` true until it closes.
const useQuickBooksPopup = () => {
  const [busy, setBusy] = useState(false);

  const open = (path: string, params: URLSearchParams) => {
    params.set('o', window.location.origin);
    const popup = window.open(
      `${QUICKBOOKS_BRIDGE_ORIGIN}${path}?${params.toString()}`,
      'crm-quickbooks',
      'popup=yes,width=520,height=380',
    );
    if (popup) {
      setBusy(true);
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (popup.closed || Date.now() - startedAt > 120_000) {
          window.clearInterval(timer);
          setBusy(false);
        }
      }, 700);
    }
  };

  return { busy, open };
};

const QuickBooksCard = ({
  recordId,
  firstName,
  lastName,
  displayName,
  companyName,
  email,
  phone,
  isCustomer,
  quickbooksNameId,
}: {
  recordId: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  isCustomer: boolean;
  quickbooksNameId: string | null;
}) => {
  const { updateOneRecord } = useUpdateOneRecord();
  const { busy, open } = useQuickBooksPopup();

  // The bridge popup reports the outcome; when a save produced a QuickBooks
  // customer id, persist it so this card upgrades to Open / Create invoice.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== QUICKBOOKS_BRIDGE_ORIGIN) return;
      const data = event.data as {
        source?: string;
        status?: string;
        nameId?: string | null;
      } | null;
      if (data?.source !== 'crm-quickbooks-bridge') return;
      if (data.status === 'saved' && isNonEmptyString(data.nameId)) {
        void updateOneRecord({
          objectNameSingular: CoreObjectNameSingular.Person,
          idToUpdate: recordId,
          updateOneRecordInput: { quickbooksNameId: data.nameId },
        }).catch(() => undefined);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [recordId, updateOneRecord]);

  const handleAddToQuickBooks = () => {
    if (!isCustomer) {
      void updateOneRecord({
        objectNameSingular: CoreObjectNameSingular.Person,
        idToUpdate: recordId,
        updateOneRecordInput: { contactType: 'CUSTOMER' },
      }).catch(() => undefined);
    }

    const params = new URLSearchParams();
    if (isNonEmptyString(displayName)) params.set('name', displayName);
    if (isNonEmptyString(firstName)) params.set('first', firstName);
    if (isNonEmptyString(lastName)) params.set('last', lastName);
    if (isNonEmptyString(companyName)) params.set('company', companyName);
    if (isNonEmptyString(email)) params.set('email', email);
    if (isNonEmptyString(phone)) params.set('phone', phone);

    open('/quickbooks', params);
  };

  const handleBridgeAction = (path: 'open' | 'invoice') => {
    const params = new URLSearchParams();
    if (isNonEmptyString(quickbooksNameId)) {
      params.set('nameId', quickbooksNameId);
    }
    if (isNonEmptyString(displayName)) params.set('name', displayName);
    open(`/${path}`, params);
  };

  return (
    <StyledCard>
      {/* Plain literals, not t`…`: LOCAL-PATCH strings are not in the
          compiled Lingui catalogs, so the t macro renders as a raw message
          id (same reason the AI briefing button uses plain strings). */}
      <StyledCardHeader>QuickBooks</StyledCardHeader>
      {isNonEmptyString(quickbooksNameId) ? (
        <>
          <StyledQuickBooksButtonRow>
            <StyledQuickBooksButton
              onClick={() => handleBridgeAction('open')}
              disabled={busy}
            >
              Open in QuickBooks
            </StyledQuickBooksButton>
            <StyledQuickBooksButton
              onClick={() => handleBridgeAction('invoice')}
              disabled={busy}
            >
              Create invoice
            </StyledQuickBooksButton>
          </StyledQuickBooksButtonRow>
          <StyledQuickBooksHint>
            Already in QuickBooks — open their page or start an invoice with
            them pre-selected (finishes in Safari).
          </StyledQuickBooksHint>
        </>
      ) : (
        <>
          <StyledQuickBooksButton
            onClick={handleAddToQuickBooks}
            disabled={busy}
          >
            <IconCoins size={15} />
            {busy ? 'Adding…' : 'Add to QuickBooks'}
          </StyledQuickBooksButton>
          <StyledQuickBooksHint>
            {isCustomer
              ? 'Creates this customer in QuickBooks (via Safari).'
              : 'Sets Contact Type to Customer and creates them in QuickBooks (via Safari).'}
          </StyledQuickBooksHint>
        </>
      )}
    </StyledCard>
  );
};

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
          category === 'texts' ||
          category === 'messages') &&
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

  const personName = recordStore?.name as
    | { firstName?: string | null; lastName?: string | null }
    | null
    | undefined;
  const personFirstName = asNonEmptyString(personName?.firstName);
  const personLastName = asNonEmptyString(personName?.lastName);
  const personDisplayName =
    asNonEmptyString(
      [personFirstName, personLastName].filter(isDefined).join(' ').trim(),
    ) ?? companyName;
  const personEmail = asNonEmptyString(recordStore?.emails?.primaryEmail);
  const personPhone = getPrimaryPhoneE164(recordStore?.phones);

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
        <QuickBooksCard
          recordId={objectRecordId}
          firstName={personFirstName}
          lastName={personLastName}
          displayName={personDisplayName}
          companyName={companyName}
          email={personEmail}
          phone={personPhone}
          isCustomer={asNonEmptyString(recordStore?.contactType) === 'CUSTOMER'}
          quickbooksNameId={asNonEmptyString(
            recordStore?.quickbooksNameId as string | null | undefined,
          )}
        />
      )}

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
