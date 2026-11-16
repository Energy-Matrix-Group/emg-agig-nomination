import { httpError } from '../platform/kit.js';

// The portal decides who may open this app. Inside it, everyone who can open it may look at everything. Changing
// anything (publishing a nomination, entering a Spot award, acting on a batch or an alert, editing reference data)
// is for the ops team: people whose company role is Ops Trader or Manager, and administrators (a portal
// administrator, or the Administrator role). The role tells this app who someone is (docs/ARCHITECTURE.md, 3.1);
// the rule is this app's own, and lives here and nowhere else.
const OPERATOR_ROLES = new Set(['ops-trader', 'manager', 'administrator']);

export const OPERATOR_DENIED = 'Only the ops team can change nominations here. Ask an administrator if you need to.';

export function canOperate(user) {
  return Boolean(user?.isPortalAdmin) || OPERATOR_ROLES.has(user?.role);
}

export function requireOperator(user) {
  if (!canOperate(user)) throw httpError(403, OPERATOR_DENIED);
}

// Who did something, as the audit trail and the batch columns record it.
export function actorOf(user) {
  return String(user?.email || user?.displayName || 'unknown').slice(0, 100);
}
