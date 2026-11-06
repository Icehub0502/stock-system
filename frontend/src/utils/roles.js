// Role levels, lowest → highest. A higher role can do everything the lower ones can.
// technician < office < manager < owner < dev   (mirrors backend/src/middleware/auth.js)
// sales and accountant sit beside office and manager for what they may open; the server's rolePolicy.js takes away the rest
export const ROLE_RANK = { technician: 1, office: 2, sales: 2, manager: 3, accountant: 3, owner: 4, dev: 5 };

export const ROLE_LABEL = {
  technician: 'ช่าง',
  office: 'ออฟฟิศ',
  sales: 'ฝ่ายขาย',
  accountant: 'บัญชี',
  manager: 'ผู้จัดการ',
  owner: 'เจ้าของร้าน',
  dev: 'ผู้ดูแลระบบ',
};

export function roleRank(role) {
  return ROLE_RANK[role] || 0;
}

// true when the user's role is `minRole` or higher
export function hasRole(user, minRole) {
  return !!user && roleRank(user.role) >= roleRank(minRole);
}

// The accountant opens what a manager opens but changes nothing, so buttons that change things use canChange.
export function isReadOnly(user) {
  return user?.role === 'accountant';
}

export function canChange(user, minRole) {
  return hasRole(user, minRole) && !isReadOnly(user);
}

// Pages for moving stock: not for sales, and of no use to someone who cannot change anything
export function canMoveStock(user) {
  return user?.role !== 'sales' && user?.role !== 'accountant';
}

// An owner (not the developer account) sees the numbers only: overview, branch comparison and settings.
// This hides menus; it does not remove any permission.
export function isOwnerView(user) {
  return user?.role === 'owner';
}
