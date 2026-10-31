export const ROLE_RANK = { viewer: 1, member: 2, manager: 3, owner: 4 };

export const ROLE_LABEL = {
  owner: 'Chủ phòng',
  manager: 'Quản lý',
  member: 'Thành viên',
  viewer: 'Chỉ xem',
};

export const ROLE_BADGE = {
  owner: 'bg-amber-100 text-amber-800',
  manager: 'bg-indigo-100 text-indigo-800',
  member: 'bg-emerald-100 text-emerald-800',
  viewer: 'bg-slate-200 text-slate-700',
};

export function roleRank(role) {
  return ROLE_RANK[role] || 0;
}

export function roleLabel(role) {
  return ROLE_LABEL[role] || 'Chưa có quyền';
}

export const INVITE_ROLES = [
  { id: 'viewer', label: 'Chỉ xem', desc: 'Xem sổ, không tick "đã nộp" được.' },
  { id: 'member', label: 'Thành viên', desc: 'Xem sổ và tự tick "đã nộp" cho phần của mình.' },
  { id: 'manager', label: 'Quản lý', desc: 'Như thành viên, thêm được ghi khoản, mời người và quản lý thành viên cấp dưới.' },
];
