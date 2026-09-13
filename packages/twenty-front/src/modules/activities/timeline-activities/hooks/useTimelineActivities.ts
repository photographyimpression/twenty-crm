import { useEffect } from 'react';

import { useLinkedObjectsTitle } from '@/activities/timeline-activities/hooks/useLinkedObjectsTitle';
import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { type ActivityTargetableObject } from '@/activities/types/ActivityTargetableEntity';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { useGenerateDepthRecordGqlFieldsFromObject } from '@/object-record/graphql/record-gql-fields/hooks/useGenerateDepthRecordGqlFieldsFromObject';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { capitalize, isDefined } from 'twenty-shared/utils';

// do we need to test this?
export const useTimelineActivities = (
  targetableObject: ActivityTargetableObject,
) => {
  const targetableObjectFieldIdName = `target${capitalize(targetableObject.targetObjectNameSingular)}Id`;

  const { objectMetadataItem: timelineActivityMetadata } =
    useObjectMetadataItem({
      objectNameSingular: CoreObjectNameSingular.TimelineActivity,
    });

  const hasTimelineActivityField = timelineActivityMetadata.fields.some(
    (field) =>
      isDefined(field.morphRelations) &&
      field.morphRelations.some(
        (morphRelation) =>
          morphRelation.targetObjectMetadata?.nameSingular ===
          targetableObject.targetObjectNameSingular,
      ),
  );

  const { recordGqlFields: depthOneRecordGqlFields } =
    useGenerateDepthRecordGqlFieldsFromObject({
      objectNameSingular: CoreObjectNameSingular.TimelineActivity,
      depth: 1,
    });

  const {
    records: timelineActivities,
    loading: loadingTimelineActivities,
    fetchMoreRecords,
    refetch: refetchTimelineActivities,
  } = useFindManyRecords<TimelineActivity>({
    skip: !hasTimelineActivityField,
    objectNameSingular: CoreObjectNameSingular.TimelineActivity,
    filter: {
      [targetableObjectFieldIdName]: {
        eq: targetableObject.id,
      },
    },
    orderBy: [
      {
        createdAt: 'DescNullsFirst',
      },
    ],
    recordGqlFields: depthOneRecordGqlFields,
    fetchPolicy: 'cache-and-network',
  });

  // LOCAL-PATCH (board card 18c3aba7 — "the transcript should pop into the
  // timeline automatically"): call/SMS notes are created server-side at
  // hangup, but the open page never re-fetched, so nothing appeared until a
  // manual reload. Poll the open record's timeline every 20s — cheap (one
  // paginated query) and scoped to the timeline widget only.
  useEffect(() => {
    if (!hasTimelineActivityField) return;
    const interval = setInterval(() => {
      void refetchTimelineActivities();
    }, 20_000);
    return () => clearInterval(interval);
  }, [hasTimelineActivityField, refetchTimelineActivities]);

  const activityIds = timelineActivities
    .filter((timelineActivity) => timelineActivity.name.match(/note|task/i))
    .map((timelineActivity) => timelineActivity.linkedRecordId)
    .filter(isDefined);

  useLinkedObjectsTitle(activityIds);

  const loading = loadingTimelineActivities;

  return {
    timelineActivities,
    loading,
    fetchMoreRecords,
  };
};
