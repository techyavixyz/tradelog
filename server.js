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
  const timestamp = new Date().toISOString();
  console.log(chalk.blue(`➡️ [${timestamp}] [${req.method}] ${req.url}`));
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(chalk.red('❌ Error:'), err);
  res.status(500).json({ success: false, message: 'Internal server error' });
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
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters long" });
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }
    
    const hashed = await bcrypt.hash(password, 12);
    await connection.query("INSERT INTO users (email, password) VALUES (?,?)", [email, hashed]);
    console.log(chalk.green(`✅ New user registered: ${email}`));
    res.json({ success: true, message: "User registered" });
  } catch (err) {
    console.error(chalk.red('❌ Registration error:'), err);
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ success: false, message: "Email already exists" });
    } else {
      res.status(500).json({ success: false, message: "Registration failed" });
    }
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }
    
    const [rows] = await connection.query("SELECT * FROM users WHERE email=?", [email]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "24h" });
    console.log(chalk.green(`✅ User logged in: ${email}`));
    res.json({ success: true, token });
  } catch (err) {
    console.error(chalk.red('❌ Login error:'), err);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

// -------- Middleware --------
function authMiddleware(req, res, next) {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Missing or invalid authorization header" });
  }

  try {
    const decoded = jwt.verify(auth.split(" ")[1], JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error(chalk.yellow('⚠️ Invalid token:'), err.message);
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

// -------- Trades APIs --------
app.get("/api/trades", authMiddleware, async (req, res) => {
  try {
    const [rows] = await connection.query(
      "SELECT * FROM trades WHERE user_id=? ORDER BY trade_date DESC, id DESC", 
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(chalk.red('❌ Error fetching trades:'), err);
    res.status(500).json({ success: false, message: "Failed to fetch trades" });
  }
});

app.post("/api/trades", authMiddleware, async (req, res) => {
  try {
    const { date, symbol, strikePrice, optionType, quantity, buyPrice, sellPrice, pl, returnPct } = req.body;
    
    // Validation
    if (!date || !symbol || !strikePrice || !optionType || !quantity || !buyPrice || !sellPrice) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }
    
    if (quantity <= 0 || buyPrice <= 0 || sellPrice <= 0 || strikePrice <= 0) {
      return res.status(400).json({ success: false, message: "Numeric values must be greater than 0" });
    }
    
    if (!['Call', 'Put'].includes(optionType)) {
      return res.status(400).json({ success: false, message: "Option type must be Call or Put" });
    }
    
    await connection.query(
      "INSERT INTO trades (user_id, trade_date, symbol, strike_price, option_type, quantity, buy_price, sell_price, pl, return_pct) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [req.user.id, date, symbol.toUpperCase(), strikePrice, optionType, quantity, buyPrice, sellPrice, pl, returnPct]
    );
    
    console.log(chalk.green(`✅ Trade added for user ${req.user.email}: ${symbol} ${optionType}`));
    res.json({ success: true, message: "Trade added successfully" });
  } catch (err) {
    console.error(chalk.red('❌ Error adding trade:'), err);
    res.status(500).json({ success: false, message: "Failed to add trade" });
  }
});

app.put("/api/trades/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { date, symbol, strikePrice, optionType, quantity, buyPrice, sellPrice, pl, returnPct } = req.body;
    
    // Validation
    if (!date || !symbol || !strikePrice || !optionType || !quantity || !buyPrice || !sellPrice) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }
    
    if (quantity <= 0 || buyPrice <= 0 || sellPrice <= 0 || strikePrice <= 0) {
      return res.status(400).json({ success: false, message: "Numeric values must be greater than 0" });
    }
    
    if (!['Call', 'Put'].includes(optionType)) {
      return res.status(400).json({ success: false, message: "Option type must be Call or Put" });
    }
    
    const [result] = await connection.query(
      "UPDATE trades SET trade_date=?, symbol=?, strike_price=?, option_type=?, quantity=?, buy_price=?, sell_price=?, pl=?, return_pct=? WHERE id=? AND user_id=?",
      [date, symbol.toUpperCase(), strikePrice, optionType, quantity, buyPrice, sellPrice, pl, returnPct, id, req.user.id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Trade not found or access denied" });
    }
    
    console.log(chalk.green(`✅ Trade updated for user ${req.user.email}: ID ${id}`));
    res.json({ success: true, message: "Trade updated successfully" });
  } catch (err) {
    console.error(chalk.red('❌ Error updating trade:'), err);
    res.status(500).json({ success: false, message: "Failed to update trade" });
  }
});

app.delete("/api/trades/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await connection.query("DELETE FROM trades WHERE id=? AND user_id=?", [id, req.user.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Trade not found or access denied" });
    }
    
    console.log(chalk.green(`✅ Trade deleted for user ${req.user.email}: ID ${id}`));
    res.json({ success: true, message: "Trade deleted successfully" });
  } catch (err) {
    console.error(chalk.red('❌ Error deleting trade:'), err);
    res.status(500).json({ success: false, message: "Failed to delete trade" });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ 
    success: true, 
    message: "Server is running", 
    timestamp: new Date().toISOString() 
  });
});

// 404 handler for API routes
app.use("/api/*", (req, res) => {
  res.status(404).json({ success: false, message: "API endpoint not found" });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(chalk.green(`🚀 Server running at http://localhost:${PORT}`));
  console.log(chalk.blue(`📊 Dashboard: http://localhost:${PORT}/index.html`));
  console.log(chalk.blue(`🔐 Login: http://localhost:${PORT}/login.html`));
});
