'use strict';
const RANK = { high: 0, medium: 1, low: 2 };
const byDueThenId = (a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.id - b.id);
function overdue(tasks, today) {
  return tasks.filter((t) => !t.done && t.due && t.due < today).sort(byDueThenId);
}
function byPriority(tasks) {
  return tasks.filter((t) => !t.done).sort((a, b) => {
    if (RANK[a.priority] !== RANK[b.priority]) return RANK[a.priority] - RANK[b.priority];
    if (a.due && !b.due) return 1;
    if (!a.due && b.due) return -1;
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    return a.id - b.id;
  });
}
function field(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(tasks) {
  return ['id,title,priority,due,done', ...tasks.map((t) => [t.id, t.title, t.priority, t.due, t.done].map(field).join(','))].join('\n');
}
module.exports = { overdue, byPriority, toCSV };
