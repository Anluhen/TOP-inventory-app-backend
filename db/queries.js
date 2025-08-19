const pool = require("./pool");

/** Utility: run a single query with args */
async function q(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

/** Utility: run a transaction */
// async function tx(work) {
//   const client = await pool.connect();
//   try {
//     await client.query('BEGIN');
//     const result = await work(client);
//     await client.query('COMMIT');
//     return result;
//   } catch (err) {
//     await client.query('ROLLBACK');
//     throw err;
//   } finally {
//     client.release();
//   }
// }

/* --------------------------
   CRUD helpers (entities)
---------------------------*/

/** Create a project (status defaults to DRAFT by DDL) */
async function createProject({ project_name, project_cost = null, status = 'DRAFT' }) {
  const { rows } = await pool.query(
    `INSERT INTO projects (project_name, project_cost, status)
     VALUES ($1, $2, $3)
     RETURNING id::text`,
    [project_name, project_cost, status]
  );
  return rows[0];
};

// Update project 
async function updateProject(id, { project_name, project_cost, status }) {
  // build dynamic update safely
  const sets = [];
  const vals = [];
  let i = 1;

  if (project_name !== undefined) { sets.push(`project_name = $${i++}`); vals.push(project_name); }
  if (project_cost !== undefined) { sets.push(`project_cost = $${i++}`); vals.push(project_cost); }
  if (status !== undefined) { sets.push(`status = $${i++}`); vals.push(status); }

  if (sets.length === 0) return 0;

  vals.push(id);
  const { rowCount } = await pool.query(
    `UPDATE projects SET ${sets.join(', ')} WHERE id = $${i}`, vals
  );
  return rowCount; // 1 if updated, 0 if not found
};

/** Update project status (triggers will lock costs when setting to DONE) */
// async function setProjectStatus(projectId, status /* 'DRAFT' | 'DONE' */) {
//   const rows = await q(
//     `UPDATE projects SET status = $2 WHERE id = $1 RETURNING id, project_name, status, project_cost`,
//     [projectId, status]
//   );
//   return rows[0];
// }

/** Recalculate and cache project total (uses get_project_total_cost) */
// async function refreshProjectCachedTotal(projectId) {
//   const rows = await q(
//     `UPDATE projects
//        SET project_cost = get_project_total_cost($1)
//      WHERE id = $1
//    RETURNING id, project_name, status, project_cost`,
//     [projectId]
//   );
//   return rows[0];
// }

/** Create an item (MATERIAL or ITEM). baseCost can be null for non-leaf items */
// async function createItem({ name, baseCost = null, itemType = 'ITEM', unit = null }) {
//   const rows = await q(
//     `INSERT INTO items (name, base_cost, item_type, unit)
//      VALUES ($1, $2, $3, $4)
//      RETURNING id, name, base_cost, item_type, unit`,
//     [name, baseCost, itemType, unit]
//   );
//   return rows[0];
// }

/** Update an item base cost (useful to test locking behavior) */
// async function updateItemBaseCost(itemId, newBaseCost) {
//   const rows = await q(
//     `UPDATE items SET base_cost = $2 WHERE id = $1
//      RETURNING id, name, base_cost, item_type, unit`,
//     [itemId, newBaseCost]
//   );
//   return rows[0];
// }

/* --------------------------
   Relationships + Quantities
---------------------------*/

/** Add an item to a project with quantity */
// async function addItemToProject(projectId, itemId, qty) {
//   const rows = await q(
//     `INSERT INTO project_items (project_id, item_id, qty)
//      VALUES ($1, $2, $3)
//      ON CONFLICT (project_id, item_id) DO UPDATE SET qty = EXCLUDED.qty
//      RETURNING id, project_id, item_id, qty, locked_unit_cost, locked_total_cost`,
//     [projectId, itemId, qty]
//   );
//   return rows[0];
// }

/** Add a child component to a parent item (BOM edge) */
// async function addComponent(parentItemId, childItemId, qty) {
//   const rows = await q(
//     `INSERT INTO item_components (parent_item_id, child_item_id, qty)
//      VALUES ($1, $2, $3)
//      ON CONFLICT (parent_item_id, child_item_id) DO UPDATE SET qty = EXCLUDED.qty
//      RETURNING id, parent_item_id, child_item_id, qty`,
//     [parentItemId, childItemId, qty]
//   );
//   return rows[0];
// }

/* --------------------------
   Pricing helpers (use SQL functions)
---------------------------*/

/** Get the *current* rolled-up cost of an item via get_item_total_cost */
// async function getItemTotalCost(itemId) {
//   const rows = await q(
//     `SELECT get_item_total_cost($1)::numeric(18,4) AS total`,
//     [itemId]
//   );
//   return rows[0]?.total ?? 0;
// }

/** Get the project total; picks live vs locked based on status */
// async function getProjectTotalCost(projectId) {
//   const rows = await q(
//     `SELECT get_project_total_cost($1)::numeric(18,4) AS total`,
//     [projectId]
//   );
//   return rows[0]?.total ?? 0;
// }

/** Manually lock a project’s costs (normally done by trigger on status change) */
// async function lockProjectCosts(projectId) {
//   await q(`SELECT lock_project_costs($1)`, [projectId]);
//   // Optionally return updated project row
//   const rows = await q(`SELECT id, project_name, status, project_cost FROM projects WHERE id = $1`, [projectId]);
//   return rows[0];
// }

/* --------------------------
   Convenience fetchers
---------------------------*/

async function getProject(projectId) {
  const rows = await q(
    `SELECT id, project_name, status, project_cost FROM projects WHERE id = $1`,
    [projectId]
  );
  return rows[0] || null;
}

async function listProjects() {
  return q(
    `SELECT id, project_name, status, project_cost
    FROM projects
    ORDER BY id DESC`
  );
}

// async function getProjectItems(projectId) {
//   return q(
//     `SELECT
//         pi.id,
//         pi.project_id,
//         pi.item_id,
//         i.name,
//         i.item_type,
//         pi.qty,
//         pi.locked_unit_cost,
//         pi.locked_total_cost
//      FROM project_items pi
//      JOIN items i ON i.id = pi.item_id
//      WHERE pi.project_id = $1
//      ORDER BY i.name`,
//     [projectId]
//   );
// }

// async function getItemBOM(parentItemId) {
//   return q(
//     `SELECT
//         c.id,
//         c.parent_item_id,
//         c.child_item_id,
//         i.name AS child_name,
//         i.item_type AS child_type,
//         c.qty
//      FROM item_components c
//      JOIN items i ON i.id = c.child_item_id
//      WHERE c.parent_item_id = $1
//      ORDER BY i.name`,
//     [parentItemId]
//   );
// }

/* --------------------------
   Demo script (safe to delete)
---------------------------*/

// async function demo() {
//   console.log('> Starting demo...');

//   // Create a small BOM:
//   // Material: Bolt ($0.50)
//   // Material: Wood plank ($12)
//   // Item: Frame = 4 x Bolt + 2 x Wood plank
//   // Item: Table = 1 x Frame
//   // Project: Dining Table Project includes 3 x Table

//   const bolt = await createItem({ name: 'Bolt', baseCost: 0.5, itemType: 'MATERIAL', unit: 'pcs' });
//   const plank = await createItem({ name: 'Wood plank', baseCost: 12, itemType: 'MATERIAL', unit: 'pcs' });

//   const frame = await createItem({ name: 'Frame', itemType: 'ITEM' });
//   await addComponent(frame.id, bolt.id, 4);
//   await addComponent(frame.id, plank.id, 2);

//   const table = await createItem({ name: 'Table', itemType: 'ITEM' });
//   await addComponent(table.id, frame.id, 1);

//   const project = await createProject('Dining Table Project');
//   await addItemToProject(project.id, table.id, 3);

//   // Prices while DRAFT (live rollups)
//   const frameCostLive = await getItemTotalCost(frame.id);
//   const tableCostLive = await getItemTotalCost(table.id);
//   const projectLive = await getProjectTotalCost(project.id);

//   console.log('Live Frame cost  :', frameCostLive); // (4*0.50)+(2*12) = 1 + 24 = 25
//   console.log('Live Table cost  :', tableCostLive);  // 1*Frame = 25
//   console.log('Live Project cost:', projectLive);    // 3 * 25 = 75

//   // Mark project DONE (triggers lock snapshot into project_items.locked_* and cache projects.project_cost)
//   const done = await setProjectStatus(project.id, 'DONE');
//   console.log('Project status after DONE:', done.status);

//   // Totals after DONE (should equal live at the locking moment)
//   const projectLocked = await getProjectTotalCost(project.id);
//   console.log('Locked Project cost:', projectLocked); // expect 75.0000

//   // Change a material price globally to test snapshot immutability
//   await updateItemBaseCost(plank.id, 20); // from 12 -> 20 (Frame would become 4*0.5 + 2*20 = 41 live)

//   // Project total must remain the locked value
//   const projectStillLocked = await getProjectTotalCost(project.id);
//   console.log('After price change, Project cost (should remain locked):', projectStillLocked); // still 75.0000

//   // Show project items with locked columns
//   const items = await getProjectItems(project.id);
//   console.table(items);

//   console.log('> Demo complete.');
// }

// /* Run if executed directly */
// if (import.meta.url === `file://${process.argv[1]}`) {
//   demo()
//     .catch((err) => {
//       console.error('Demo error:', err);
//     })
//     .finally(async () => {
//       await pool.end();
//     });
// }

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
};