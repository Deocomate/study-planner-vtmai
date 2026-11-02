'use strict';
// Removable demo data: every demo task is flagged is_demo = 1 and shown with a "Demo" badge.
const { get, all, run, tx } = require('./db');
const T = require('./time');
const { createTasks } = require('./tasks');
const { templateItems } = require('./importer');
const F = require('./files');

function loadDemo(user) {
  const ws = T.weekStartOf(T.todayStr());
  if (get('SELECT 1 AS x FROM tasks WHERE is_demo = 1 LIMIT 1')) return { created: 0, note: 'Demo data is already loaded.' };
  const nowKey = T.nowKey();
  const items = templateItems(ws, ['ben', 'shin']).filter((i) => !i.deadline || T.dtKey(i.deadline) > nowKey);
  const extra = [
    { child_id: 'ben', title: 'Demo: reading comprehension worksheet', subject: 'ESL', est_minutes: 40, deadline: `${T.addDays(ws, 5)}T18:00`, review_required: 1, resource_link: 'https://example.com/demo-exercise', work_link: 'https://example.com/demo-work-file' },
    { child_id: 'shin', title: 'Demo: fractions practice', subject: 'Maths', est_minutes: 30, deadline: `${T.addDays(ws, 4)}T18:00`, review_required: 1, resource_link: 'https://example.com/demo-exercise' },
  ];
  const ids = createTasks({ items: [...items, ...extra], childIds: ['ben', 'shin'], weekStart: ws, user, isDemo: 1 });
  return { created: ids.length };
}
function removeDemo() {
  return tx(() => {
    const ids = all('SELECT id FROM tasks WHERE is_demo = 1').map((r) => r.id);
    const files = all('SELECT DISTINCT file_id AS f FROM submissions WHERE file_id IS NOT NULL AND task_id IN (SELECT id FROM tasks WHERE is_demo = 1)').map((r) => r.f);
    run('DELETE FROM tasks WHERE is_demo = 1');
    F.deleteFileRows(files);
    return { removed: ids.length };
  });
}
module.exports = { loadDemo, removeDemo };
