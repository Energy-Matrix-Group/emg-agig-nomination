// A batch's life, as the design drew it and the worker writes it: Imported, then Validated or Validation failed,
// Approved, Built, Uploaded, then Accepted or Rejected, with No response and Upload uncertain when AGIG's answer
// does not come or a file's fate is unknown, and the side states Duplicate, Superseded and Cancelled.

export const STATUS_LABELS = {
  IMPORTED: 'Loaded, being checked',
  VALIDATION_FAILED: 'Failed the checks',
  VALIDATED: 'Checked, waiting for approval',
  APPROVED: 'Approved',
  BUILT: 'File made, not sent yet',
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

export const PENDING = ['IMPORTED', 'VALIDATED', 'APPROVED', 'BUILT']; // loaded, not sent yet
export const IN_FLIGHT = ['UPLOADING', 'UPLOADED']; // with AGIG, no answer yet
export const NEEDS_ATTENTION = ['VALIDATION_FAILED', 'REJECTED', 'NO_RESPONSE', 'UPLOAD_UNCERTAIN'];
export const SET_ASIDE = ['DUPLICATE', 'CANCELLED', 'SUPERSEDED']; // never counted as the latest numbers
