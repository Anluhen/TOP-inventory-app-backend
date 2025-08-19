const { Router } = require("express");
const projectsRouter = Router();
const projectsController = require("../controllers/projectsController");
const { listProjects } = require("../db/queries");

projectsRouter.get('/', projectsController.listProjectsGet);
projectsRouter.get('/:id', projectsController.projectGet);
projectsRouter.post('/', projectsController.projectPost);
projectsRouter.put('/:id', projectsController.projectPut);

module.exports = projectsRouter;