import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import ExcelJS from "exceljs";

dotenv.config();

const INVENTORY_FILE = path.join(process.cwd(), "data", "inventory.xlsx");

const HEADER_MAP: Record<string, "id" | "name" | "sku" | "rack"> = {
  NO: "id",
  NAMA: "name",
  "NAMA BARANG": "name",
  BARANG: "name",
  SKU: "sku",
  RAK: "rack",
  LOKASI: "rack",
};

async function loadInventory() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(INVENTORY_FILE);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const columns = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const header = String(cell.value ?? "").trim().toUpperCase();
    const key = HEADER_MAP[header];
    if (key) columns.set(key, col);
  });

  const col = (row: ExcelJS.Row, key: string) => {
    const index = columns.get(key);
    if (!index) return undefined;
    const v = row.getCell(index).value;
    return v === null || v === undefined ? "" : String(v).trim();
  };

  const items = [];
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const name = col(row, "name");
    if (!name) continue;
    items.push({
      id: col(row, "id") ?? String(i),
      name,
      sku: col(row, "sku") ?? "",
      rack: col(row, "rack") ?? "",
      status: "Nifco Product",
    });
  }
  return items;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- API: INVENTORY (dari file Excel lokal) ---
  app.get("/api/inventory", async (req, res) => {
    try {
      const items = await loadInventory();
      res.json(items);
    } catch (error) {
      console.error("Error reading inventory.xlsx:", error);
      res.status(500).json({ error: "Gagal membaca data/inventory.xlsx" });
    }
  });

  // --- VITE MIDDLEWARE ---
  
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

startServer();
