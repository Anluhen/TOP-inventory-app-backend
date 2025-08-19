const dotenv = require('dotenv');
const { Client } = require("pg");

dotenv.config({ path: '.env.local' }); // <-- ensures DATABASE_URL is set for this script

const createTablesSQL = `
CREATE TABLE projects (
  id BIGSERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','DONE')),
  project_cost NUMERIC(18,4), 
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE items (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  base_cost NUMERIC(18,4),      -- for MATERIALs or mixed items
  item_type TEXT NOT NULL CHECK (item_type IN ('ITEM','MATERIAL')),
  unit TEXT,                    -- optional (e.g., 'pcs', 'kg', 'm')
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Project↔Item (with quantity)
CREATE TABLE project_items (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGSERIAL NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_id BIGSERIAL NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  qty NUMERIC(18,6) NOT NULL CHECK (qty > 0),
  locked_unit_cost  NUMERIC(18,4),
  locked_total_cost NUMERIC(18,4),
  UNIQUE (project_id, item_id)  -- prevent duplicates
);

-- Item↔Item components (BOM edges with quantity)
CREATE TABLE item_components (
  id BIGSERIAL PRIMARY KEY,
  parent_item_id BIGSERIAL NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  child_item_id  BIGSERIAL NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  qty NUMERIC(18,6) NOT NULL CHECK (qty > 0),
  CHECK (parent_item_id <> child_item_id),
  UNIQUE (parent_item_id, child_item_id) -- prevent duplicate edges
);

-- Useful indexes
CREATE INDEX idx_project_items_project ON project_items(project_id);
CREATE INDEX idx_project_items_item    ON project_items(item_id);
CREATE INDEX idx_item_components_parent ON item_components(parent_item_id);
CREATE INDEX idx_item_components_child  ON item_components(child_item_id);
`;

const otherSQL = `
-- Computes current rolled-up cost of a single item (base_cost + children)
CREATE OR REPLACE FUNCTION get_item_total_cost(p_item_id BIGSERIAL)
RETURNS NUMERIC AS $$
WITH RECURSIVE bom AS (
  SELECT i.id, i.base_cost, 1::NUMERIC AS factor
  FROM items i
  WHERE i.id = p_item_id

  UNION ALL

  SELECT c.child_item_id, i.base_cost, bom.factor * c.qty
  FROM bom
  JOIN item_components c ON c.parent_item_id = bom.id
  JOIN items i           ON i.id = c.child_item_id
)
SELECT COALESCE(
  SUM(CASE WHEN ic.id IS NULL THEN b.base_cost * b.factor ELSE 0 END),
  0
)
FROM bom b
LEFT JOIN item_components ic ON ic.parent_item_id = b.id;
$$ LANGUAGE SQL STABLE;

-- While DRAFT → compute live totals
-- While DONE  → use locked snapshot on project_items
CREATE OR REPLACE FUNCTION get_project_total_cost(p_project_id BIGSERIAL)
RETURNS NUMERIC AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM projects WHERE id = p_project_id;

  IF v_status = 'DONE' THEN
    RETURN COALESCE(
      (SELECT SUM(locked_total_cost)
         FROM project_items
        WHERE project_id = p_project_id),
      0
    );
  ELSE
    RETURN COALESCE(
      (SELECT SUM(pi.qty * get_item_total_cost(pi.item_id))
         FROM project_items pi
        WHERE pi.project_id = p_project_id),
      0
    );
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Snapshot current costs into project_items.*locked_* and cache projects.project_cost
CREATE OR REPLACE FUNCTION lock_project_costs(p_project_id BIGSERIAL)
RETURNS VOID AS $$
BEGIN
  -- Lock each item’s current unit cost
  UPDATE project_items pi
     SET locked_unit_cost  = get_item_total_cost(pi.item_id),
         locked_total_cost = pi.qty * get_item_total_cost(pi.item_id)
   WHERE pi.project_id = p_project_id;

  -- Cache the project total from the locked values
  UPDATE projects p
     SET project_cost = COALESCE((
           SELECT SUM(locked_total_cost)
             FROM project_items
            WHERE project_id = p_project_id
         ), 0)
   WHERE p.id = p_project_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_projects_lock_on_done()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'DRAFT'
     AND NEW.status = 'DONE' THEN
    PERFORM lock_project_costs(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_lock_on_done ON projects;
CREATE TRIGGER projects_lock_on_done
BEFORE UPDATE OF status ON projects
FOR EACH ROW
EXECUTE FUNCTION trg_projects_lock_on_done();

-- Disallow INSERT/UPDATE/DELETE in project_items when project is DONE
CREATE OR REPLACE FUNCTION trg_project_items_block_when_done()
RETURNS TRIGGER AS $$
DECLARE v_status TEXT;
BEGIN
  -- Figure project id for each operation
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_status FROM projects WHERE id = NEW.project_id;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT status INTO v_status FROM projects WHERE id = NEW.project_id;
  ELSE -- DELETE
    SELECT status INTO v_status FROM projects WHERE id = OLD.project_id;
  END IF;

  IF v_status = 'DONE' THEN
    RAISE EXCEPTION 'Cannot modify items of a DONE project (project_id=%)',
      COALESCE(NEW.project_id, OLD.project_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_items_block_when_done_ins ON project_items;
CREATE TRIGGER project_items_block_when_done_ins
BEFORE INSERT ON project_items
FOR EACH ROW
EXECUTE FUNCTION trg_project_items_block_when_done();

DROP TRIGGER IF EXISTS project_items_block_when_done_upd ON project_items;
CREATE TRIGGER project_items_block_when_done_upd
BEFORE UPDATE ON project_items
FOR EACH ROW
EXECUTE FUNCTION trg_project_items_block_when_done();

DROP TRIGGER IF EXISTS project_items_block_when_done_del ON project_items;
CREATE TRIGGER project_items_block_when_done_del
BEFORE DELETE ON project_items
FOR EACH ROW
EXECUTE FUNCTION trg_project_items_block_when_done();
`;

async function createSchema() {
  console.log("Seeding...")
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect().then(() => console.log("createTables connected"));
    await client.query(createTablesSQL);
  } catch (err) {
    console.error('Error creating schema:', err);
  } finally {
    await client.end().then(() => console.log("createTables done"));
  }
}

createSchema();