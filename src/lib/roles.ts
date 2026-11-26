export const STAFF_ROLES = ["admin", "ops_manager", "estimator", "site_supervisor", "inspector", "yard_logistics", "hse_training", "finance"] as const;
export const CLIENT_ROLES = ["client_admin", "client_user", "client_consultant", "client_hse", "client_finance", "client_viewer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type ClientRole = (typeof CLIENT_ROLES)[number];
export type Role = StaffRole | ClientRole;
export const isStaffRole = (r: string): r is StaffRole => (STAFF_ROLES as readonly string[]).includes(r);

/*
 * What each client role may do. Viewers read everything their company can see and act on nothing.
 * Requesters raise requests, instructions, findings, tickets and upload evidence. Approvers also sign.
 */
export type ClientCaps = { label: "viewer" | "requester" | "approver"; request: boolean; approves: string[]; invite: boolean };
export function clientCaps(role: string): ClientCaps {
  switch (role) {
    case "client_admin": return { label: "approver", request: true, approves: ["measurement", "hold_point", "variation", "completion", "inspection", "document", "claim"], invite: true };
    case "client_consultant": return { label: "approver", request: true, approves: ["measurement", "hold_point", "inspection", "document"], invite: false };
    case "client_finance": return { label: "approver", request: true, approves: ["variation", "claim"], invite: false };
    case "client_hse": return { label: "approver", request: true, approves: ["document"], invite: false };
    case "client_user": return { label: "requester", request: true, approves: [], invite: false };
    default: return { label: "viewer", request: false, approves: [], invite: false };
  }
}
