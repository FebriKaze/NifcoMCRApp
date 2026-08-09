import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'inventory.xlsx');

const rows = [
  ['1', 'LS J0239-BO', 'TB-01', 'RACK 6-8'],
  ['2', 'LS J0240-BO', 'DB-02', 'RACK 2-8'],
  ['3', 'LS T11KW-BO', 'BB-02', 'RACK 7-32'],
];

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inventory');
  ws.addRow(['NO', 'NAMA BARANG', 'SKU', 'RAK']);
  for (const r of rows) ws.addRow(r);
  await wb.xlsx.writeFile(FILE);
  console.log(`Seed written: ${FILE}`);
}

main();