const db = require("../db/queries");

async function listProjectsGet(req, res) {
  try {
    const rows = await db.listProjects();
    res.json(rows);
  } catch (err) {
    console.error('GET /projects error:', err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
}

async function projectGet(req, res) {
  try {
    const row = await db.getProject(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not Found' });
    res.json(row);
  } catch (err) {
    console.log('GET /projects/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
}

async function projectPost(req, res) {
  try {
    const { project_name, project_cost = null, status = 'DRAFT' } = req.body || {};
    if (!project_name) return res.status(400).json({ error: 'project_name is required' });

    const created = await db.createProject({ project_name, project_cost, status });
    res.status(201).json({ id: created.id });
  } catch (err) {
    console.error('POST /projects error:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
};

async function projectPut(req, res) {
  try {
    const { id } = req.params;
    const { project_name, project_cost, status } = req.body ?? {};
    const updated = await db.updateProject(id, { project_name, project_cost, status });
    if (!updated) return res.status(404).json({ error: 'Not Found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /projects/:id error:', err);
    res.status(500).json({ error: 'Failed to update project' });
  }
};

module.exports = {
  listProjectsGet,
  projectGet,
  projectPost,
  projectPut,
}