import { type WorkflowTriggerType } from '@/workflow/types/Workflow';

export const SMS_RECEIVED_TRIGGER_LABEL = 'SMS received';

// Custom system trigger backed by DATABASE_EVENT with a non-standard
// eventName. The Telnyx webhook handler dispatches workflows whose
// trigger.settings.eventName matches "sms.received".
export const SMS_RECEIVED_TRIGGER: {
  defaultLabel: typeof SMS_RECEIVED_TRIGGER_LABEL;
  type: WorkflowTriggerType;
  icon: string;
} = {
  defaultLabel: SMS_RECEIVED_TRIGGER_LABEL,
  type: 'DATABASE_EVENT',
  icon: 'IconMessage',
};
