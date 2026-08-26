// LOCAL-PATCH: Salesmate pins an "Upcoming (N)" block above the history so the
// open work on a contact is the first thing you see instead of being buried
// under months of logged calls.
import { TaskRow } from '@/activities/tasks/components/TaskRow';
import { useTasks } from '@/activities/tasks/hooks/useTasks';
import { type ActivityTargetableObject } from '@/activities/types/ActivityTargetableEntity';
import { type Task } from '@/activities/types/Task';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  width: 100%;
`;

const StyledHeader = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledCard = styled.div`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  overflow: hidden;
`;

const MAX_UPCOMING_TASKS = 5;

const getDueTime = (task: Task): number =>
  isDefined(task.dueAt)
    ? new Date(task.dueAt).getTime()
    : Number.MAX_SAFE_INTEGER;

export const TimelineUpcomingSection = ({
  targetableObject,
}: {
  targetableObject: ActivityTargetableObject;
}) => {
  const { tasks } = useTasks({ targetableObjects: [targetableObject] });

  // Anything not marked done is still "upcoming" work on this contact —
  // including overdue tasks, which TaskRow already renders with a red due date.
  const openTasks = tasks
    .filter((task) => task.status !== 'DONE')
    .sort((taskA, taskB) => getDueTime(taskA) - getDueTime(taskB))
    .slice(0, MAX_UPCOMING_TASKS);

  if (openTasks.length === 0) {
    return null;
  }

  return (
    <StyledContainer>
      <StyledHeader>
        {t`Upcoming`} ({openTasks.length})
      </StyledHeader>
      <StyledCard>
        {openTasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </StyledCard>
    </StyledContainer>
  );
};
