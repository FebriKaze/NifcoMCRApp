import type { VercelRequest, VercelResponse } from "@vercel/node";
import fs from "fs";
import path from "path";

const SETTINGS_FILE = path.join("/tmp", "mcr-settings.json");

type Lang = "id-ID" | "en-US";

async function readSettings(): Promise<{ sttLang: Lang }> {
  try {
    const raw = await fs.promises.readFile(SETTINGS_FILE, "utf-8");
    const data = JSON.parse(raw);
    return { sttLang: data.sttLang === "en-US" ? "en-US" : "id-ID" };
  } catch {
    return { sttLang: "id-ID" };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "PUT") {
    const { sttLang } = req.body ?? {};
    if (sttLang !== "id-ID" && sttLang !== "en-US") {
      return res.status(400).json({ error: "sttLang harus id-ID atau en-US" });
    }
    try {
      await fs.promises.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
      await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify({ sttLang }, null, 2));
    } catch (error) {
      console.error("Error saving settings:", error);
      return res.status(500).json({ error: "Gagal menyimpan settings" });
    }
    return res.status(200).json({ sttLang });
  }

  try {
    res.status(200).json(await readSettings());
  } catch (error) {
    console.error("Error reading settings:", error);
    res.status(500).json({ error: "Gagal membaca settings" });
  }
}