import { Router } from 'express';
import { getUnits, dataSourceStatus } from './dataSource.js';
import { BadRequest, buildSimulation as build, unitById, listUnits, RULES_VERSION } from './service.js';
import { simulate } from './engine.js';

export const combatRouter = Router();

/** Validate + resolve a /simulate body into engine input (server unit set). Throws BadRequest. */
export const buildSimulation = (body) => build(body, getUnits());

/* ---------------------------------------------------------------- routes */

combatRouter.get('/units', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
  res.json({ units: listUnits(getUnits(), q), source: dataSourceStatus() });
});

combatRouter.get('/units/:id', (req, res) => {
  let u;
  try { u = unitById(req.params.id, getUnits()); } catch { u = null; }
  if (!u) return res.status(404).json({ error: `Unknown unit "${req.params.id}"` });
  res.json({ unit: u });
});

combatRouter.post('/simulate', (req, res) => {
  let input;
  try {
    input = buildSimulation(req.body);
  } catch (err) {
    if (err instanceof BadRequest) return res.status(400).json({ error: err.message });
    throw err;
  }
  try {
    res.json(simulate(input));
  } catch (err) {
    res.status(500).json({ error: `Simulation failed: ${err.message}` });
  }
});

combatRouter.get('/rules', (_req, res) => res.json({ rulesVersion: RULES_VERSION }));

// Unexpected errors inside this router: answer in the shared { error } shape.
combatRouter.use((err, _req, res, _next) => {
  const status = err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: status < 500 ? 'Bad request' : 'Internal error' });
});
