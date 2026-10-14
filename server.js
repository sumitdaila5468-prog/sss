require("dotenv").config();

const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_PASSWORD_HASH = ADMIN_PASSWORD ? bcrypt.hashSync(ADMIN_PASSWORD, 12) : null;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!ADMIN_PASSWORD || !SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error("Missing ADMIN_PASSWORD or SESSION_SECRET. Copy .env.example to .env and configure both.");
  process.exit(1);
}

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

app.use(session({
  name: "makro_admin_session",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 60 * 1000
  }
}));

const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, "polling.sqlite");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    display_order INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_name TEXT NOT NULL,
    candidate_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(candidate_id) REFERENCES candidates(id)
  );
  CREATE TABLE IF NOT EXISTS demo_scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS demo_scenario_results (
    scenario_id INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    percent REAL NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY(scenario_id, candidate_id),
    FOREIGN KEY(scenario_id) REFERENCES demo_scenarios(id) ON DELETE CASCADE,
    FOREIGN KEY(candidate_id) REFERENCES candidates(id)
  );
`);

const candidateCount = db.prepare("SELECT COUNT(*) AS n FROM candidates").get().n;
if (candidateCount === 0) {
  const insert = db.prepare("INSERT INTO candidates (name, display_order) VALUES (?, ?)");
  const defaults = ["Candidate 1", "Candidate 2", "Candidate 3", "Candidate 4"];
  const tx = db.transaction(() => defaults.forEach((name, i) => insert.run(name, i + 1)));
  tx();
}


const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir, { index: "index.html" }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 15 minutes and try again." }
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) return next();
  return res.status(401).json({ error: "Admin login required." });
}

app.get("/api/candidates", (req, res) => {
  const rows = db.prepare("SELECT id, name FROM candidates ORDER BY display_order, id").all();
  res.json(rows);
});

app.post("/api/vote", (req, res) => {
  const voterName = String(req.body.voterName || "").trim();
  const candidateId = Number(req.body.candidateId);

  if (voterName.length < 2 || voterName.length > 80) {
    return res.status(400).json({ error: "Please enter a name between 2 and 80 characters." });
  }
  if (!Number.isInteger(candidateId)) {
    return res.status(400).json({ error: "Please select one candidate." });
  }
  const candidate = db.prepare("SELECT id FROM candidates WHERE id = ?").get(candidateId);
  if (!candidate) return res.status(400).json({ error: "Selected candidate was not found." });

  const insertVote = db.transaction(() => {
    db.prepare("INSERT INTO votes (voter_name, candidate_id) VALUES (?, ?)").run(voterName, candidateId);
  });
  try {
    insertVote();
  } catch (err) {
    return res.status(500).json({ error: "Could not save your vote. Please try again." });
  }
  res.json({ ok: true, message: "आपका मत सफलतापूर्वक दर्ज किया गया है।" });
});

app.get("/api/public-results", (req, res) => {
  // This is deliberately simulated data and is NOT derived from actual votes.
  // It must remain visibly labelled as simulated on the public page.
  const candidates = db.prepare("SELECT id, name FROM candidates ORDER BY display_order, id").all();
  const percentages = candidates.map((_, i) => i === 1 ? 68 : 32 / Math.max(1, candidates.length - 1));
  res.json({
    simulated: true,
    label: "SIMULATED FUN RESULTS - NOT ACTUAL VOTES",
    results: candidates.map((c, i) => ({
      candidateId: c.id,
      name: c.name,
      percent: Math.round(percentages[i] * 10) / 10
    }))
  });
});

app.post("/api/admin/login", loginLimiter, async (req, res) => {
  const password = String(req.body.password || "");
  // Compare against a server-side bcrypt hash, never a client-side password.
  const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  if (!valid) return res.status(401).json({ error: "Incorrect password." });

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Could not create secure session." });
    req.session.isAdmin = true;
    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).json({ error: "Could not save session." });
      res.json({ ok: true });
    });
  });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("makro_admin_session", {
      httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production"
    });
    res.json({ ok: true });
  });
});

app.get("/api/admin/me", (req, res) => {
  res.json({ isAdmin: req.session?.isAdmin === true });
});

app.get("/api/admin/results", requireAdmin, (req, res) => {
  const results = db.prepare(`
    SELECT c.id AS candidateId, c.name,
      COUNT(v.id) AS votes
    FROM candidates c
    LEFT JOIN votes v ON v.candidate_id = c.id
    GROUP BY c.id, c.name
    ORDER BY c.display_order, c.id
  `).all();

  const voters = db.prepare(`
    SELECT v.id, v.voter_name AS voterName, c.name AS votedFor, v.created_at AS createdAt
    FROM votes v
    JOIN candidates c ON c.id = v.candidate_id
    ORDER BY v.id DESC
  `).all();

  res.json({ totalVotes: voters.length, results, voters });
});

// Admin-only candidate editor API: replace all names safely.
app.put("/api/admin/candidates", requireAdmin, (req, res) => {
  const names = req.body.names;
  if (!Array.isArray(names) || names.length < 2 || names.length > 12) {
    return res.status(400).json({ error: "Provide between 2 and 12 candidate names." });
  }
  const cleaned = names.map(n => String(n).trim()).filter(n => n.length >= 2 && n.length <= 80);
  if (cleaned.length !== names.length || new Set(cleaned.map(n => n.toLowerCase())).size !== cleaned.length) {
    return res.status(400).json({ error: "Names must be 2 to 80 characters and unique." });
  }

  const update = db.transaction(() => {
    const existingVotes = db.prepare("SELECT COUNT(*) AS n FROM votes").get().n;
    if (existingVotes > 0) throw new Error("CANDIDATES_LOCKED_AFTER_VOTES");
    db.prepare("DELETE FROM candidates").run();
    const insert = db.prepare("INSERT INTO candidates (name, display_order) VALUES (?, ?)");
    cleaned.forEach((name, i) => insert.run(name, i + 1));
  });
  try {
    update();
    res.json({ ok: true });
  } catch (e) {
    if (e.message === "CANDIDATES_LOCKED_AFTER_VOTES") {
      return res.status(409).json({ error: "Candidate names are locked after the first vote to protect records." });
    }
    res.status(500).json({ error: "Could not update candidates." });
  }
});

function normalizeDemoScenario(input) {
  const candidates = db.prepare("SELECT id FROM candidates ORDER BY display_order, id").all();
  if (!Array.isArray(input) || input.length !== candidates.length) {
    return { error: "Percentage data must include every actual option once." };
  }
  const candidateIds = new Set(candidates.map(c => c.id));
  const seen = new Set();
  const items = [];
  let totalCents = 0;
  for (const item of input) {
    const candidateId = Number(item.candidateId);
    const percent = Number(item.percent);
    if (!candidateIds.has(candidateId) || seen.has(candidateId)) return { error: "Invalid or duplicate option in scenario." };
    seen.add(candidateId);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return { error: "Percentages must be between 0 and 100." };
    const cents = Math.round(percent * 100);
    if (Math.abs(percent * 100 - cents) > 0.000001) return { error: "Percentages may have at most two decimal places." };
    totalCents += cents;
    items.push({ candidateId, percent: cents / 100, count: cents, cents });
  }
  if (seen.size !== candidateIds.size) return { error: "Percentage data must include every actual option once." };
  if (totalCents !== 10000) return { error: "Demo percentages must total exactly 100.00%." };
  return { items };
}

app.get("/api/admin/simulations", requireAdmin, (req, res) => {
  const scenarios = db.prepare("SELECT id, name, is_active, created_at, updated_at FROM demo_scenarios ORDER BY id DESC").all();
  const result = scenarios.map((scenario) => {
    const rows = db.prepare(`
      SELECT r.candidate_id AS candidateId, c.name AS candidateName, r.percent, r.count
      FROM demo_scenario_results r
      JOIN candidates c ON c.id = r.candidate_id
      WHERE r.scenario_id = ?
      ORDER BY c.display_order, c.id
    `).all(scenario.id);
    return {
      id: scenario.id,
      name: scenario.name,
      isActive: scenario.is_active === 1,
      createdAt: scenario.created_at,
      updatedAt: scenario.updated_at,
      total: 10000,
      results: rows
    };
  });
  res.json(result);
});

app.post("/api/admin/simulations", requireAdmin, (req, res) => {
  const name = String(req.body.name || "").trim();
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Scenario name must be 2 to 80 characters." });
  const normalized = normalizeDemoScenario(req.body.percentages);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  try {
    const insertScenario = db.transaction(() => {
      const info = db.prepare("INSERT INTO demo_scenarios (name) VALUES (?)").run(name);
      const id = info.lastInsertRowid;
      const insertResult = db.prepare("INSERT INTO demo_scenario_results (scenario_id, candidate_id, percent, count) VALUES (?, ?, ?, ?)");
      normalized.items.forEach((item) => insertResult.run(id, item.candidateId, item.percent, item.count));
      return id;
    });
    const id = insertScenario();
    res.status(201).json({ ok: true, id });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return res.status(409).json({ error: "A scenario with this name already exists." });
    res.status(500).json({ error: "Could not create scenario." });
  }
});

app.put("/api/admin/simulations/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid scenario." });
  const name = String(req.body.name || "").trim();
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Scenario name must be 2 to 80 characters." });
  const normalized = normalizeDemoScenario(req.body.percentages);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const existing = db.prepare("SELECT id FROM demo_scenarios WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Scenario not found." });
  try {
    db.transaction(() => {
      db.prepare("UPDATE demo_scenarios SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id);
      db.prepare("DELETE FROM demo_scenario_results WHERE scenario_id = ?").run(id);
      const insertResult = db.prepare("INSERT INTO demo_scenario_results (scenario_id, candidate_id, percent, count) VALUES (?, ?, ?, ?)");
      normalized.items.forEach((item) => insertResult.run(id, item.candidateId, item.percent, item.count));
    })();
    res.json({ ok: true });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return res.status(409).json({ error: "A scenario with this name already exists." });
    res.status(500).json({ error: "Could not update scenario." });
  }
});

app.post("/api/admin/simulations/:id/activate", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid scenario." });
  if (req.body.confirmActivation !== true) return res.status(400).json({ error: "Explicit confirmation is required." });
  const existing = db.prepare("SELECT id FROM demo_scenarios WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Scenario not found." });
  db.transaction(() => {
    db.prepare("UPDATE demo_scenarios SET is_active = 0").run();
    db.prepare("UPDATE demo_scenarios SET is_active = 1, updated_at = datetime('now') WHERE id = ?").run(id);
  })();
  res.json({ ok: true });
});

app.post("/api/admin/simulations/:id/deactivate", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid scenario." });
  db.prepare("UPDATE demo_scenarios SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.delete("/api/admin/simulations/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid scenario." });
  db.transaction(() => {
    db.prepare("DELETE FROM demo_scenario_results WHERE scenario_id = ?").run(id);
    db.prepare("DELETE FROM demo_scenarios WHERE id = ?").run(id);
  })();
  res.json({ ok: true });
});

app.get("/api/simulation-results", (req, res) => {
  const scenario = db.prepare("SELECT id, name FROM demo_scenarios WHERE is_active = 1 ORDER BY updated_at DESC, id DESC LIMIT 1").get();
  if (!scenario) return res.json({ active: false });
  const rows = db.prepare(`
    SELECT r.candidate_id AS candidateId, c.name, r.percent, r.count
    FROM demo_scenario_results r
    JOIN candidates c ON c.id = r.candidate_id
    WHERE r.scenario_id = ?
    ORDER BY c.display_order, c.id
  `).all(scenario.id);
  res.json({
    active: true,
    scenario: { id: scenario.id, name: scenario.name },
    total: 10000,
    banner: "डेमो परिणाम — वास्तविक मतदान के परिणाम नहीं",
    results: rows
  });
});

app.get("/admin", (req, res) => res.sendFile(path.join(publicDir, "admin.html")));

app.listen(PORT, () => {
  console.log(`Village Makro Poll running at http://localhost:${PORT}`);
});
