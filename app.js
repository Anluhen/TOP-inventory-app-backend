require("dotenv").config();
const express = require("express");
const app = express();
const cors = require('cors');

const projectsRouter = require("./routes/projectsRouter");

const PORT = process.env.PORT;

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

app.use(express.json());

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || 'http:localhost:3000',
    credentials: true,
  })
);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use("/projects", projectsRouter)