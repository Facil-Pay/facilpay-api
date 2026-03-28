/**
 * User role enumeration for role-based access control (RBAC)
 */
export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

/**
 * Role hierarchy utilities
 */
export const ROLE_HIERARCHY = {
  [UserRole.ADMIN]: [UserRole.ADMIN, UserRole.USER],
  [UserRole.USER]: [UserRole.USER],
};
