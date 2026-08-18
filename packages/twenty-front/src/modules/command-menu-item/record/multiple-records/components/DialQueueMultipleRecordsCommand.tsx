import { CommandMenuItemDisplay } from '@/command-menu-item/display/components/CommandMenuItemDisplay';
import { DialQueueModalContent } from '@/calls/components/DialQueueModalContent';
import { useFindManyRecordsSelectedInContextStore } from '@/context-store/hooks/useFindManyRecordsSelectedInContextStore';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { useState } from 'react';

const DIAL_QUEUE_MODAL_ID = 'dial-queue-modal';

// Bulk-selection command: "Call queue" — power-dial the selected people one
// by one through the in-CRM WebRTC dialer (GHL-style).
export const DialQueueMultipleRecordsCommand = () => {
  const { records, loading, totalCount } =
    useFindManyRecordsSelectedInContextStore({ limit: 100 });

  const { openModal, closeModal } = useModal();
  const [isOpen, setIsOpen] = useState(false);

  const handleClick = () => {
    setIsOpen(true);
    openModal(DIAL_QUEUE_MODAL_ID);
  };

  const handleClose = () => {
    closeModal(DIAL_QUEUE_MODAL_ID);
    setIsOpen(false);
  };

  return (
    <>
      <CommandMenuItemDisplay
        onClick={handleClick}
        disabled={loading || records.length === 0}
      />
      {isOpen && (
        <ModalStatefulWrapper
          modalInstanceId={DIAL_QUEUE_MODAL_ID}
          size="small"
          padding="none"
          isClosable
          onClose={handleClose}
          renderInDocumentBody
        >
          <DialQueueModalContent
            records={records}
            onClose={handleClose}
            key={totalCount}
          />
        </ModalStatefulWrapper>
      )}
    </>
  );
};
