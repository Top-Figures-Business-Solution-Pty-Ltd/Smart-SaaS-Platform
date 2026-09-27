export function isAdminLike() {
  const user = String(frappe?.session?.user || '').trim();
  if (user === 'Administrator') return true;
  const roles = (frappe?.boot?.user?.roles) || frappe?.user_roles || [];
  const roleSet = new Set(Array.isArray(roles) ? roles.map(String) : []);
  return roleSet.has('System Manager') || roleSet.has('Automation Manager');
}
