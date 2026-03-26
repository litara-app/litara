import { Modal, ScrollArea } from '@mantine/core';
import { SettingsContent } from './SettingsContent';

interface SettingsModalProps {
  opened: boolean;
  onClose: () => void;
}

export function SettingsModal({ opened, onClose }: SettingsModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Settings"
      size="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <SettingsContent />
    </Modal>
  );
}
