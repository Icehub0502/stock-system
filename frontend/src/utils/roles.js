// Role levels, lowest → highest. A higher role can do everything the lower ones can.
// technician < office < manager < owner < dev   (mirrors backend/src/middleware/auth.js)
export const ROLE_RANK = { technician: 1, office: 2, manager: 3, owner: 4, dev: 5 };

export const ROLE_LABEL = {
  technician: 'ช่าง',
  office: 'ออฟฟิศ',
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
