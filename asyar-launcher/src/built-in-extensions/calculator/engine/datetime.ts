function parseDate(input: string): Date | null {
  if (input.toLowerCase() === 'today') return new Date();
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(date: Date): string {
  // Returns YYYY-MM-DD local time adjusted
  const offset = date.getTimezoneOffset();
  const adjustedDate = new Date(date.getTime() - (offset * 60 * 1000));
  return adjustedDate.toISOString().split('T')[0];
}

export function daysBetween(dateA: string, dateB: string): string | null {
  const a = parseDate(dateA);
  const b = parseDate(dateB);
  if (!a || !b) return null;
  const msDiff = b.getTime() - a.getTime();
  const daysDiff = Math.abs(Math.round(msDiff / (1000 * 60 * 60 * 24)));
  return `${daysDiff} days`;
}

export function addDays(date: string, days: number): string | null {
  const d = parseDate(date);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export function subtractDays(date: string, days: number): string | null {
  return addDays(date, -days);
}

export function evaluateDatetime(expression: string): string | null {
  const norm = expression.toLowerCase().trim();

  // Pattern 1: {date} + {n} days
  let m = norm.match(/^(.+)\s+\+\s+(\d+)\s+days?$/);
  if (m) return addDays(m[1], parseInt(m[2], 10));

  // Pattern 2: {date} - {n} days
  m = norm.match(/^(.+)\s+-\s+(\d+)\s+days?$/);
  if (m) return subtractDays(m[1], parseInt(m[2], 10));

  // Pattern 3: days between {date} and {date}
  m = norm.match(/^days\s+between\s+(.+)\s+and\s+(.+)$/);
  if (m) return daysBetween(m[1], m[2]);

  // Pattern 4: days until {date}
  m = norm.match(/^days\s+until\s+(.+)$/);
  if (m) return daysBetween("today", m[1]);

  return null;
}
