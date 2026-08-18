// LOCAL-PATCH: status strip (update loop)
// (fork-only) StatusStrip mounted once in the top bar's right button group.
// Upstream twenty does not have src/modules/status-strip — on merge, keep or
// drop this import + its usage below with the rest of the local patch.

import { type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { ObjectSortDropdownButton } from '@/object-record/object-sort-dropdown/components/ObjectSortDropdownButton';
import { useIsPrefetchLoading } from '@/prefetch/hooks/useIsPrefetchLoading';
import { StatusStrip } from '@/status-strip/components/StatusStrip';
import { TopBar } from '@/ui/layout/top-bar/components/TopBar';
import { QueryParamsFiltersEffect } from '@/views/components/QueryParamsFiltersEffect';
import { QueryParamsSortsEffect } from '@/views/components/QueryParamsSortsEffect';
import { ViewBarPageTitle } from '@/views/components/ViewBarPageTitle';
import { ViewBarSkeletonLoader } from '@/views/components/ViewBarSkeletonLoader';
import { ViewPickerDropdown } from '@/views/view-picker/components/ViewPickerDropdown';

import { ObjectFilterDropdownComponentInstanceContext } from '@/object-record/object-filter-dropdown/states/contexts/ObjectFilterDropdownComponentInstanceContext';
import { VIEW_SORT_DROPDOWN_ID } from '@/object-record/object-sort-dropdown/constants/ViewSortDropdownId';
import { ObjectSortDropdownComponentInstanceContext } from '@/object-record/object-sort-dropdown/states/context/ObjectSortDropdownComponentInstanceContext';
import { QueryParamsCleanupEffect } from '@/views/components/QueryParamsCleanupEffect';
import { ViewBarAnyFieldFilterEffect } from '@/views/components/ViewBarAnyFieldFilterEffect';
import { ViewBarFilterDropdown } from '@/views/components/ViewBarFilterDropdown';
import { ViewBarRecordFieldEffect } from '@/views/components/ViewBarRecordFieldEffect';
import { ViewBarRecordFilterEffect } from '@/views/components/ViewBarRecordFilterEffect';
import { ViewBarRecordFilterGroupEffect } from '@/views/components/ViewBarRecordFilterGroupEffect';
import { ViewBarRecordSortEffect } from '@/views/components/ViewBarRecordSortEffect';
import { ViewBarFilterDropdownIds } from '@/views/constants/ViewBarFilterDropdownIds';
import { UpdateViewButtonGroup } from './UpdateViewButtonGroup';
import { ViewBarDetails } from './ViewBarDetails';

type ViewBarProps = {
  viewBarId: string;
  className?: string;
  optionsDropdownButton: ReactNode;
};

export const ViewBar = ({
  viewBarId,
  className,
  optionsDropdownButton,
}: ViewBarProps) => {
  const { objectNamePlural } = useParams();
  const loading = useIsPrefetchLoading();

  if (!objectNamePlural) {
    return;
  }

  return (
    <ObjectSortDropdownComponentInstanceContext.Provider
      value={{ instanceId: VIEW_SORT_DROPDOWN_ID }}
    >
      <ViewBarRecordFilterGroupEffect />
      <ViewBarAnyFieldFilterEffect />
      <ViewBarRecordFieldEffect />
      <ViewBarRecordFilterEffect />
      <ViewBarRecordSortEffect />
      <QueryParamsFiltersEffect />
      <QueryParamsSortsEffect />
      <QueryParamsCleanupEffect />
      <ViewBarPageTitle />
      <TopBar
        className={className}
        leftComponent={
          loading ? <ViewBarSkeletonLoader /> : <ViewPickerDropdown />
        }
        rightComponent={
          <>
            {/* LOCAL-PATCH: status strip (update loop) — see src/modules/status-strip */}
            <StatusStrip />
            <ObjectFilterDropdownComponentInstanceContext.Provider
              value={{ instanceId: ViewBarFilterDropdownIds.MAIN }}
            >
              <ViewBarFilterDropdown />
            </ObjectFilterDropdownComponentInstanceContext.Provider>
            <ObjectSortDropdownButton />
            {optionsDropdownButton}
          </>
        }
        bottomComponent={
          <ViewBarDetails
            hasFilterButton
            viewBarId={viewBarId}
            objectNamePlural={objectNamePlural}
            rightComponent={<UpdateViewButtonGroup />}
          />
        }
      />
    </ObjectSortDropdownComponentInstanceContext.Provider>
  );
};
