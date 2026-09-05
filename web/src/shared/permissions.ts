/**
 * ⚠️  GENERATED FILE — DO NOT EDIT.
 *
 * Copied from backend/src/shared by `npm run sync:shared`.
 * Edit the canonical file in backend/src/shared and re-run the sync.
 */

/**
 * Role-based access control.
 *
 * V1 uses CUSTOMER and ADMIN/STORE_OWNER only, but authorization is expressed
 * as permissions rather than role checks so that adding STORE_MANAGER, STAFF,
 * DELIVERY_AGENT or PHARMACIST later is a map entry, not a code change.
 *
 * IMPORTANT: a permission grants the *ability* to perform an action. It never
 * grants access to a *specific record*. Ownership ("is this the customer's own
 * order?") is checked separately, in the service layer, every time.
 */

import { UserRole } from './enums';

export const Permission = {
  /* catalog */
  CATALOG_READ: 'catalog:read',
  CATALOG_WRITE: 'catalog:write',

  /* inventory */
  INVENTORY_READ: 'inventory:read',
  INVENTORY_WRITE: 'inventory:write',

  /* orders */
  ORDER_CREATE: 'order:create',
  ORDER_READ_OWN: 'order:read_own',
  ORDER_READ_ALL: 'order:read_all',
  ORDER_CANCEL_OWN: 'order:cancel_own',
  ORDER_UPDATE_STATUS: 'order:update_status',
  ORDER_REFUND: 'order:refund',

  /* cart & addresses */
  CART_MANAGE: 'cart:manage',
  ADDRESS_MANAGE: 'address:manage',

  /* delivery */
  DELIVERY_AGENT_READ: 'delivery_agent:read',
  DELIVERY_AGENT_WRITE: 'delivery_agent:write',
  DELIVERY_ASSIGN: 'delivery:assign',
  DELIVERY_SELF_UPDATE: 'delivery:self_update',

  /* customers */
  CUSTOMER_READ: 'customer:read',
  CUSTOMER_WRITE: 'customer:write',

  /* config & coupons */
  CONFIG_READ: 'config:read',
  CONFIG_WRITE: 'config:write',
  COUPON_READ: 'coupon:read',
  COUPON_WRITE: 'coupon:write',

  /* reporting */
  DASHBOARD_READ: 'dashboard:read',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const CUSTOMER_PERMISSIONS: readonly Permission[] = [
  Permission.CATALOG_READ,
  Permission.ORDER_CREATE,
  Permission.ORDER_READ_OWN,
  Permission.ORDER_CANCEL_OWN,
  Permission.CART_MANAGE,
  Permission.ADDRESS_MANAGE,
];

const STORE_STAFF_PERMISSIONS: readonly Permission[] = [
  Permission.CATALOG_READ,
  Permission.INVENTORY_READ,
  Permission.INVENTORY_WRITE,
  Permission.ORDER_READ_ALL,
  Permission.ORDER_UPDATE_STATUS,
  Permission.DELIVERY_AGENT_READ,
  Permission.DELIVERY_ASSIGN,
  Permission.DASHBOARD_READ,
];

const STORE_MANAGER_PERMISSIONS: readonly Permission[] = [
  ...STORE_STAFF_PERMISSIONS,
  Permission.CATALOG_WRITE,
  Permission.DELIVERY_AGENT_WRITE,
  Permission.CUSTOMER_READ,
  Permission.COUPON_READ,
  Permission.CONFIG_READ,
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...STORE_MANAGER_PERMISSIONS,
  Permission.ORDER_REFUND,
  Permission.CUSTOMER_WRITE,
  Permission.CONFIG_WRITE,
  Permission.COUPON_WRITE,
];

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  [UserRole.CUSTOMER]: CUSTOMER_PERMISSIONS,
  [UserRole.ADMIN]: ADMIN_PERMISSIONS,
  [UserRole.STORE_OWNER]: ADMIN_PERMISSIONS,
  [UserRole.SUPER_ADMIN]: Object.values(Permission),
  [UserRole.STORE_MANAGER]: STORE_MANAGER_PERMISSIONS,
  [UserRole.STAFF]: STORE_STAFF_PERMISSIONS,
  [UserRole.DELIVERY_AGENT]: [Permission.DELIVERY_SELF_UPDATE, Permission.ORDER_READ_ALL],
  [UserRole.PHARMACIST]: STORE_STAFF_PERMISSIONS,
  [UserRole.RESTAURANT_MANAGER]: STORE_MANAGER_PERMISSIONS,
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

/** Roles allowed to sign in to the admin panel. */
export const ADMIN_PANEL_ROLES: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.STORE_OWNER,
  UserRole.SUPER_ADMIN,
  UserRole.STORE_MANAGER,
  UserRole.STAFF,
];

export function isAdminRole(role: UserRole): boolean {
  return ADMIN_PANEL_ROLES.includes(role);
}
