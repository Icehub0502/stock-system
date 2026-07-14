import React from 'react';
import RepairNoticePage from '../pages/RepairNoticePage';

// Wraps the checklist form (RepairNoticePage, in "embedded" mode) in a modal
// instead of navigating to a full page — used from RepairNoticeListPage's
// "แจ้งซ่อม" button so editing an existing repair notice doesn't leave the list.
export default function RepairNoticeModal({ id, onClose, onSaved }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card xlarge repair-notice-modal" onClick={(e) => e.stopPropagation()}>
        <RepairNoticePage id={id} onClose={onClose} onSaved={onSaved} embedded />
      </div>
    </div>
  );
}
