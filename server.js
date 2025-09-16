import express from "express";
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import chalk from "chalk";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Logger middleware
app.use((req, res, next) => {
  console.log(chalk.blue(`➡️ [${req.method}] ${req.url}`));
  next();
});

// 🔐 SSL Config Handling (local + Vercel)
let sslConfig = undefined;
if (process.env.DB_CA_CERT_CONTENT) {
  // Vercel: cert in env variable (strict)
  sslConfig = { ca: process.env.DB_CA_CERT_CONTENT, rejectUnauthorized: true, minVersion: "TLSv1.2" };
} else if (process.env.DB_CA_CERT && fs.existsSync(process.env.DB_CA_CERT)) {
  // Local: read cert file (safe mode)
  sslConfig = { ca: fs.readFileSync(process.env.DB_CA_CERT), rejectUnauthorized: true, minVersion: "TLSv1.2" };
} else {
  // Local fallback: disable verification (⚠️ NOT for production)
  console.log(chalk.yellow("⚠️ No CA cert found. Falling back to rejectUnauthorized: false (DEV ONLY)."));
  sslConfig = { rejectUnauthorized: false };
}

// DB connection
console.log(chalk.yellow("🔌 Connecting to database..."));
const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: sslConfig
});
console.log(chalk.green("✅ DB connection established!"));

// Ensure Schema
await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
await connection.query(`USE ${process.env.DB_NAME}`);

async function ensureSchema() {
  // Users
  await connection.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Trades
  await connection.query(`
    CREATE TABLE IF NOT EXISTS trades (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trade_date DATE NOT NULL,
      symbol VARCHAR(50) NOT NULL,
      strike_price DECIMAL(10,2) NOT NULL,
      option_type ENUM('Call','Put') NOT NULL,
      quantity INT NOT NULL,
      buy_price DECIMAL(10,2) NOT NULL,
      sell_price DECIMAL(10,2) NOT NULL,
      pl DECIMAL(12,2) NOT NULL,
      return_pct DECIMAL(6,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add user_id if missing
  const [cols] = await connection.query(`SHOW COLUMNS FROM trades LIKE 'user_id'`);
  if (cols.length === 0) {
    console.log(chalk.yellow("⚙️ Adding user_id column to trades..."));
    await connection.query(`ALTER TABLE trades ADD COLUMN user_id INT AFTER id`);
    await connection.query(
      `ALTER TABLE trades ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`
    );
    console.log(chalk.green("✅ user_id column added and linked to users table"));
  }
}

await ensureSchema();
console.log(chalk.green("✅ Users & Trades tables ready!"));

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

// -------- AUTH APIs --------
app.post("/auth/register", async (req, res) => {
  const { email, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  try {
    await connection.query("INSERT INTO users (email, password) VALUES (?,?)", [email, hashed]);
    res.json({ success: true, message: "User registered" });
  } catch (err) {
    console.error(err);
    res.status(400).json({ success: false, message: "User already exists" });
  }
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await connection.query("SELECT * FROM users WHERE email=?", [email]);
  if (rows.length === 0) return res.status(401).json({ success: false, message: "Invalid credentials" });

  const user = rows[0];
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ success: false, message: "Invalid credentials" });

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "1h" });
  res.json({ success: true, token });
});

// -------- Middleware --------
function authMiddleware(req, res, next) {
  const auth = req.headers["authorization"];
  if (!auth) return res.status(401).json({ message: "Missing token" });

  try {
    const decoded = jwt.verify(auth.split(" ")[1], JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

// -------- Trades APIs --------
app.get("/api/trades", authMiddleware, async (req, res) => {
  const [rows] = await connection.query("SELECT * FROM trades WHERE user_id=? ORDER BY id DESC", [req.user.id]);
  res.json(rows);
});

app.post("/api/trades", authMiddleware, async (req, res) => {
  const { date, symbol, strikePrice, optionType, quantity, buyPrice, sellPrice, pl, returnPct } = req.body;
  await connection.query(
    "INSERT INTO trades (user_id, trade_date, symbol, strike_price, option_type, quantity, buy_price, sell_price, pl, return_pct) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [req.user.id, date, symbol, strikePrice, optionType, quantity, buyPrice, sellPrice, pl, returnPct]
  );
  res.json({ success: true });
});

app.put("/api/trades/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { date, symbol, strikePrice, optionType, quantity, buyPrice, sellPrice, pl, returnPct } = req.body;
  await connection.query(
    "UPDATE trades SET trade_date=?, symbol=?, strike_price=?, option_type=?, quantity=?, buy_price=?, sell_price=?, pl=?, return_pct=? WHERE id=? AND user_id=?",
    [date, symbol, strikePrice, optionType, quantity, buyPrice, sellPrice, pl, returnPct, id, req.user.id]
  );
  res.json({ success: true });
});

app.delete("/api/trades/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  await connection.query("DELETE FROM trades WHERE id=? AND user_id=?", [id, req.user.id]);
  res.json({ success: true });
});

// Start server
app.listen(process.env.PORT || 3000, () => {
  console.log(chalk.green(`🚀 Server running at http://localhost:${process.env.PORT || 3000}`));
});
