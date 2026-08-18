import type { VercelRequest, VercelResponse } from "@vercel/node";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HEADER_MAP: Record<string, "id" | "name" | "sku" | "rack"> = {
  NO: "id",
  NAMA: "name",
  "NAMA BARANG": "name",
  BARANG: "name",
  SKU: "sku",
  RAK: "rack",
  LOKASI: "rack",
};

function resolveInventoryFile(): string {
  const candidates = [
    path.join(process.cwd(), "data", "inventory.xlsx"),
    path.join(__dirname, "..", "data", "inventory.xlsx"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

async function loadInventory() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolveInventoryFile());
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

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const items = await loadInventory();
    res.status(200).json(items);
  } catch (error) {
    console.error("Error reading inventory.xlsx:", error);
    res.status(500).json({ error: "Gagal membaca data/inventory.xlsx" });
  }
}