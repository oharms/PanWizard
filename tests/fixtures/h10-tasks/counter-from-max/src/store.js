'use strict';
const fs = require('fs');
const PRIORITIES = ['low', 'medium', 'high'];
function createStore(file) {
  let data = { nextId: 1, tasks: [] };
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); data = { tasks: d.tasks, nextId: d.tasks.reduce((m, t) => Math.max(m, t.id), 0) + 1 }; } catch {}
  const save = () => fs.writeFileSync(file, JSON.stringify(data));
  const find = (id) => { const t = data.tasks.find((x) => x.id === id); if (!t) throw new Error('no task ' + id); return t; };
  return {
    add(title, { priority = 'medium', due = null } = {}) {
      if (!PRIORITIES.includes(priority)) throw new Error('bad priority ' + priority);
      const task = { id: data.nextId++, title, priority, due, done: false };
      data.tasks.push(task); save(); return task;
    },
    complete(id) { const t = find(id); t.done = true; save(); return t; },
    remove(id) { find(id); data.tasks = data.tasks.filter((x) => x.id !== id); save(); },
    list({ status = 'all' } = {}) {
      return data.tasks.filter((t) => status === 'all' || (status === 'done') === t.done).sort((a, b) => a.id - b.id);
    },
  };
}
module.exports = { createStore };
