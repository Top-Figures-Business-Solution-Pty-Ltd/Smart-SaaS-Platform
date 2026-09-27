export const GRANTS_YEAR_BOARDS = ['FY 2024', 'FY 2025', 'FY 2026', 'FY 2027'];

export function getCurrentGrantsYearBoard() {
  const current = String(window.smart_accounting?.current_view || '').trim();
  if (GRANTS_YEAR_BOARDS.includes(current)) return current;
  return 'FY 2026';
}
