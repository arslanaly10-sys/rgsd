export const STAFF_ROLES = ["admin", "ops_manager", "estimator", "site_supervisor", "inspector", "yard_logistics", "hse_training", "finance"] as const;
export const CLIENT_ROLES = ["client_admin", "client_user", "client_consultant", "client_hse", "client_finance"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type ClientRole = (typeof CLIENT_ROLES)[number];
export type Role = StaffRole | ClientRole;
export const isStaffRole = (r: string): r is StaffRole => (STAFF_ROLES as readonly string[]).includes(r);
