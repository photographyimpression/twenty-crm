import { useNavigatePageLayoutSidePanel } from '@/side-panel/pages/page-layout/hooks/useNavigatePageLayoutSidePanel';
import { PageLayoutLeftPanel } from '@/page-layout/components/PageLayoutLeftPanel';
import { PageLayoutTabList } from '@/page-layout/components/PageLayoutTabList';
import { PageLayoutTabListEffect } from '@/page-layout/components/PageLayoutTabListEffect';
import { PAGE_LAYOUT_LEFT_PANEL_CONTAINER_WIDTH } from '@/page-layout/constants/PageLayoutLeftPanelContainerWidth';
// LOCAL-PATCH: Salesmate-style right-hand context rail on record pages.
import {
  PAGE_LAYOUT_CONTEXT_RAIL_MIN_VIEWPORT_WIDTH,
  PAGE_LAYOUT_CONTEXT_RAIL_WIDTH,
} from '@/page-layout/constants/PageLayoutContextRailWidth';
import { RecordShowContextRail } from '@/object-record/record-show/components/RecordShowContextRail';
import { isSidePanelOpenedState } from '@/side-panel/states/isSidePanelOpenedState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useCreatePageLayoutTab } from '@/page-layout/hooks/useCreatePageLayoutTab';
import { useCurrentPageLayout } from '@/page-layout/hooks/useCurrentPageLayout';
import { useReorderPageLayoutTabs } from '@/page-layout/hooks/useReorderPageLayoutTabs';
import { PageLayoutMainContent } from '@/page-layout/PageLayoutMainContent';
import { isPageLayoutInEditModeComponentState } from '@/page-layout/states/isPageLayoutInEditModeComponentState';
import { pageLayoutTabSettingsOpenTabIdComponentState } from '@/page-layout/states/pageLayoutTabSettingsOpenTabIdComponentState';
import { getScrollWrapperInstanceIdFromPageLayoutId } from '@/page-layout/utils/getScrollWrapperInstanceIdFromPageLayoutId';
import { getTabListInstanceIdFromPageLayoutAndRecord } from '@/page-layout/utils/getTabListInstanceIdFromPageLayoutAndRecord';
import { getTabsByDisplayMode } from '@/page-layout/utils/getTabsByDisplayMode';
import { getTabsWithVisibleWidgets } from '@/page-layout/utils/getTabsWithVisibleWidgets';
import { shouldEnableTabEditingFeatures } from '@/page-layout/utils/shouldEnableTabEditingFeatures';
import { sortTabsByPosition } from '@/page-layout/utils/sortTabsByPosition';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';
import { activeTabIdComponentState } from '@/ui/layout/tab-list/states/activeTabIdComponentState';
import { ScrollWrapper } from '@/ui/utilities/scroll/components/ScrollWrapper';
import { useSetAtomComponentState } from '@/ui/utilities/state/jotai/hooks/useSetAtomComponentState';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { SidePanelPages } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { useIsMobile } from 'twenty-ui/utilities';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { PageLayoutType } from '~/generated-metadata/graphql';

const StyledContainer = styled.div<{
  hasPinnedTab: boolean;
  hasContextRail: boolean;
}>`
  display: grid;
  grid-template-columns: ${({ hasPinnedTab, hasContextRail }) =>
    [
      hasPinnedTab ? `${PAGE_LAYOUT_LEFT_PANEL_CONTAINER_WIDTH}px` : null,
      '1fr',
      hasContextRail ? `${PAGE_LAYOUT_CONTEXT_RAIL_WIDTH}px` : null,
    ]
      .filter(Boolean)
      .join(' ')};
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  width: 100%;

  /* Narrow windows keep the timeline readable and drop the rail instead. */
  @media (max-width: ${PAGE_LAYOUT_CONTEXT_RAIL_MIN_VIEWPORT_WIDTH}px) {
    grid-template-columns: ${({ hasPinnedTab }) =>
      hasPinnedTab ? `${PAGE_LAYOUT_LEFT_PANEL_CONTAINER_WIDTH}px 1fr` : '1fr'};
  }
`;

const StyledContextRailContainer = styled.div`
  height: 100%;
  min-height: 0;

  @media (max-width: ${PAGE_LAYOUT_CONTEXT_RAIL_MIN_VIEWPORT_WIDTH}px) {
    display: none;
  }
`;

const StyledTabsAndDashboardContainer = styled.div`
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const StyledPageLayoutTabListContainer = styled.div`
  padding-left: ${themeCssVariables.spacing[2]};
`;

const StyledScrollWrapperContainer = styled.div`
  flex: 1;
`;

export const PageLayoutRendererContent = () => {
  const { currentPageLayout } = useCurrentPageLayout();

  const { isInSidePanel, layoutType, targetRecordIdentifier } =
    useLayoutRenderingContext();

  const isPageLayoutInEditMode = useAtomComponentStateValue(
    isPageLayoutInEditModeComponentState,
  );

  const activeTabId = useAtomComponentStateValue(activeTabIdComponentState);

  const { createPageLayoutTab } = useCreatePageLayoutTab(currentPageLayout?.id);
  const { reorderTabs } = useReorderPageLayoutTabs(currentPageLayout?.id ?? '');
  const setPageLayoutTabSettingsOpenTabId = useSetAtomComponentState(
    pageLayoutTabSettingsOpenTabIdComponentState,
  );
  const { navigatePageLayoutSidePanel } = useNavigatePageLayoutSidePanel();

  const isMobile = useIsMobile();

  // The record side panel eats the same horizontal room the rail needs, and it
  // always wins: it holds whatever the user just clicked into.
  const isSidePanelOpened = useAtomStateValue(isSidePanelOpenedState);

  if (!isDefined(currentPageLayout)) {
    return null;
  }

  const handleAddTab =
    isPageLayoutInEditMode &&
    shouldEnableTabEditingFeatures(currentPageLayout.type)
      ? () => {
          const newTabId = createPageLayoutTab(t`Untitled`);
          setPageLayoutTabSettingsOpenTabId(newTabId);
          navigatePageLayoutSidePanel({
            sidePanelPage: SidePanelPages.PageLayoutTabSettings,
            focusTitleInput: true,
          });
        }
      : undefined;

  const canEnableTabEditing =
    isPageLayoutInEditMode &&
    shouldEnableTabEditingFeatures(currentPageLayout.type);

  const tabsWithVisibleWidgets = getTabsWithVisibleWidgets({
    tabs: currentPageLayout.tabs,
    isMobile,
    isInSidePanel,
    isEditMode: isPageLayoutInEditMode,
  });

  const { tabsToRenderInTabList, pinnedLeftTab } = getTabsByDisplayMode({
    tabs: tabsWithVisibleWidgets,
    pageLayoutType: currentPageLayout.type,
    isMobile,
    isInSidePanel,
  });

  const tabListInstanceId = getTabListInstanceIdFromPageLayoutAndRecord({
    pageLayoutId: currentPageLayout.id,
    layoutType,
    targetRecordIdentifier,
  });

  const sortedTabs = sortTabsByPosition(tabsToRenderInTabList);

  // The rail only makes sense next to a record, on a full page, with room for
  // it — never on dashboards, in the side panel, or on mobile.
  const hasContextRail =
    currentPageLayout.type === PageLayoutType.RECORD_PAGE &&
    !isInSidePanel &&
    !isMobile &&
    !isSidePanelOpened &&
    isDefined(targetRecordIdentifier);

  return (
    <StyledContainer
      hasPinnedTab={isDefined(pinnedLeftTab)}
      hasContextRail={hasContextRail}
    >
      {isDefined(pinnedLeftTab) && (
        <PageLayoutLeftPanel pinnedLeftTabId={pinnedLeftTab.id} />
      )}

      <StyledTabsAndDashboardContainer>
        <PageLayoutTabListEffect
          tabs={sortedTabs}
          componentInstanceId={tabListInstanceId}
          defaultTabToFocusOnMobileAndSidePanelId={
            currentPageLayout.defaultTabToFocusOnMobileAndSidePanelId ??
            undefined
          }
        />
        {(sortedTabs.length > 1 || isPageLayoutInEditMode) && (
          <StyledPageLayoutTabListContainer>
            <PageLayoutTabList
              tabs={sortedTabs}
              behaveAsLinks={!isInSidePanel && !isPageLayoutInEditMode}
              componentInstanceId={tabListInstanceId}
              onAddTab={handleAddTab}
              isReorderEnabled={canEnableTabEditing}
              onReorder={canEnableTabEditing ? reorderTabs : undefined}
              pageLayoutType={currentPageLayout.type}
            />
          </StyledPageLayoutTabListContainer>
        )}

        <StyledScrollWrapperContainer>
          <ScrollWrapper
            componentInstanceId={getScrollWrapperInstanceIdFromPageLayoutId(
              currentPageLayout.id,
            )}
            defaultEnableXScroll={false}
          >
            {isDefined(activeTabId) && (
              <PageLayoutMainContent tabId={activeTabId} />
            )}
          </ScrollWrapper>
        </StyledScrollWrapperContainer>
      </StyledTabsAndDashboardContainer>

      {hasContextRail && isDefined(targetRecordIdentifier) && (
        <StyledContextRailContainer>
          <RecordShowContextRail
            objectNameSingular={targetRecordIdentifier.targetObjectNameSingular}
            objectRecordId={targetRecordIdentifier.id}
          />
        </StyledContextRailContainer>
      )}
    </StyledContainer>
  );
};
