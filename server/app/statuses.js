// A batch's life, as the design drew it: Validated, Approved, Built, Uploaded, then Accepted or Rejected, with the
// side states Duplicate, Superseded and Cancelled. A failed or rejected batch is never edited: the lines are
// corrected and published again, and the new batch supersedes it. (IMPORTED and VALIDATION_FAILED are in the
// design's CHECK constraint but never written here: the checks run before a batch is made, so a batch with an
// error never exists.)

export const STATUS_LABELS = {
  IMPORTED: 'Imported',
  VALIDATION_FAILED: 'Failed the checks',
  VALIDATED: 'Waiting for approval',
  APPROVED: 'Approved',
  BUILT: 'Ready to send',
  UPLOADING: 'Uploading',
  UPLOADED: 'Sent, waiting for AGIG',
  UPLOAD_UNCERTAIN: 'Upload uncertain',
  ACCEPTED: 'Accepted by AGIG',
  REJECTED: 'Rejected by AGIG',
  NO_RESPONSE: 'No answer from AGIG',
  DUPLICATE: 'Same as the accepted nomination',
  SUPERSEDED: 'Superseded',
  CANCELLED: 'Cancelled',
};

export const PENDING = ['VALIDATED', 'APPROVED', 'BUILT']; // made, not sent yet: a newer batch supersedes these
export const IN_FLIGHT = ['UPLOADING', 'UPLOADED']; // with AGIG, no answer yet
export const NEEDS_ATTENTION = ['REJECTED', 'NO_RESPONSE', 'UPLOAD_UNCERTAIN'];
export const CANCELLABLE = ['IMPORTED', 'VALIDATION_FAILED', 'VALIDATED', 'APPROVED', 'BUILT', 'DUPLICATE'];
export const SET_ASIDE = ['DUPLICATE', 'CANCELLED', 'SUPERSEDED']; // never counted as the latest numbers
