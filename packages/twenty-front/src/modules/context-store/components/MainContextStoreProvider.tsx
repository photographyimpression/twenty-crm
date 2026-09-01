import { MainContextStoreProviderEffect } from '@/context-store/components/MainContextStoreProviderEffect';
import { metadataStoreState } from '@/metadata-store/states/metadataStoreState';
import { useIsSettingsPage } from '@/navigation/hooks/useIsSettingsPage';
import { useLastVisitedView } from '@/navigation/hooks/useLastVisitedView';
import { objectMetadataItemsState } from '@/object-metadata/states/objectMetadataItemsState';
import { useShowAuthModal } from '@/ui/layout/hooks/useShowAuthModal';
import { useAtomFamilyStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilyStateValue';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { coreViewsState } from '@/views/states/coreViewState';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { AppPath } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { ViewKey, ViewType } from '~/generated-metadata/graphql';
import { isMatchingLocation } from '~/utils/isMatchingLocation';

const getViewId = (
  viewIdFromQueryParams: string | null,
  indexViewId?: string,
  lastVisitedViewId?: string,
) => {
  if (isDefined(viewIdFromQueryParams)) {
    return viewIdFromQueryParams;
  }

  if (isDefined(lastVisitedViewId)) {
    return lastVisitedViewId;
  }

  if (isDefined(indexViewId)) {
    return indexViewId;
  }

  return undefined;
};

// LOCAL-PATCH: never open a non-list view as an object's landing page.
// Fields-widget views ("Person Record Page Fields") are internal layout views,
// but the view picker lists them and selecting one poisons the localStorage
// last-visited map — after that, clicking "People" in the sidebar lands on a
// weird fields page instead of the table (board card 2026-08-31). Accept only
// real list views (table/kanban/calendar) as "last visited"; anything else
// falls through to the INDEX view.
const LIST_VIEW_TYPES = new Set<string>([
  ViewType.TABLE,
  ViewType.KANBAN,
  ViewType.CALENDAR,
]);

const isListViewId = (
  viewId: string | undefined,
  objectMetadataId: string | undefined,
  coreViews: { id: string; type: string; objectMetadataId: string }[],
) => {
  if (!isDefined(viewId)) {
    return false;
  }

  const view = coreViews.find(
    (view) =>
      view.id === viewId &&
      (!isDefined(objectMetadataId) ||
        view.objectMetadataId === objectMetadataId),
  );

  return isDefined(view) && LIST_VIEW_TYPES.has(view.type);
};

export const MainContextStoreProvider = () => {
  const location = useLocation();
  const isRecordIndexPage = isMatchingLocation(
    location,
    AppPath.RecordIndexPage,
  );
  const isRecordShowPage = isMatchingLocation(location, AppPath.RecordShowPage);
  const isSettingsPage = useIsSettingsPage();

  const objectNamePlural = useParams().objectNamePlural ?? '';
  const objectNameSingular = useParams().objectNameSingular ?? '';

  const [searchParams] = useSearchParams();
  const viewIdQueryParam = searchParams.get('viewId');

  const objectMetadataItems = useAtomStateValue(objectMetadataItemsState);
  const metadataStore = useAtomFamilyStateValue(metadataStoreState, 'views');
  const coreViews = useAtomStateValue(coreViewsState);

  const objectMetadataItem = objectMetadataItems.find(
    (objectMetadataItem) =>
      objectMetadataItem.namePlural === objectNamePlural ||
      objectMetadataItem.nameSingular === objectNameSingular,
  );

  const { getLastVisitedViewIdFromObjectNamePlural } = useLastVisitedView();

  const lastVisitedViewId = getLastVisitedViewIdFromObjectNamePlural(
    objectMetadataItem?.namePlural ?? '',
  );

  const indexViewId = coreViews.find(
    (view) =>
      view.objectMetadataId === objectMetadataItem?.id &&
      view.key === ViewKey.INDEX,
  )?.id;

  // LOCAL-PATCH: a poisoned last-visited entry (a fields-widget view) must not
  // hijack the object's landing page — see isListViewId above.
  const usableLastVisitedViewId = isListViewId(
    lastVisitedViewId,
    objectMetadataItem?.id,
    coreViews,
  )
    ? lastVisitedViewId
    : undefined;

  const viewId = getViewId(
    viewIdQueryParam,
    indexViewId,
    usableLastVisitedViewId,
  );
  const showAuthModal = useShowAuthModal();

  const shouldComputeContextStore =
    (isRecordIndexPage || isRecordShowPage || isSettingsPage) &&
    !showAuthModal &&
    metadataStore.status === 'up-to-date';

  if (!shouldComputeContextStore) {
    return null;
  }

  return (
    <MainContextStoreProviderEffect
      viewId={viewId}
      objectMetadataItem={objectMetadataItem}
      isRecordIndexPage={isRecordIndexPage}
      isRecordShowPage={isRecordShowPage}
      isSettingsPage={isSettingsPage}
    />
  );
};
