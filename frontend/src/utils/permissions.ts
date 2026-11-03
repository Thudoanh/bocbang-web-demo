import type { Permission } from "../types/domain";

const rank: Record<Permission, number> = { read: 1, comment: 2, edit: 3, owner: 4 };
export const can = (actual: Permission, required: Permission) => rank[actual] >= rank[required];
