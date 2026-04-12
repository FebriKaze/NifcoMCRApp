/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Package, 
  Mic, 
  History, 
  Settings, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Volume2, 
  VolumeX,
  User,
  Database,
  RefreshCw,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types & Interfaces ---

interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  stock: number;
  rack: string;
  description?: string;
  status?: 'Nifco Product' | 'low' | 'critical';
}

interface LogEntry {
  id: string;
  timestamp: string;
  command: string;
  match?: string;
  status: 'success' | 'not_found' | 'error';
}

// --- Mock Data ---

const INITIAL_INVENTORY: InventoryItem[] = [];

/** Microsoft Edge (Chromium) — perilaku Web Speech sedikit beda dari Chrome. */
const isChromiumEdge = (): boolean =>
  typeof navigator !== 'undefined' && /Edg\//.test(navigator.userAgent);

/** Konstruktor STT: Edge mendukung `SpeechRecognition` standar; tetap fallback webkit. */
const getSpeechRecognitionConstructor = (): (new () => any) | null => {
  const w = window as unknown as {
    SpeechRecognition?: new () => any;
    webkitSpeechRecognition?: new () => any;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Awalan kategori di nama barang (filter daftar inventaris). */
const INVENTORY_LINE_PREFIXES = {
  lastshot: 'LASTSHOT',
  standar: 'STANDAR SAMPLE',
} as const;

const alnumCompact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Edit distance pendek — untuk salah dengar kecil vs SKU di sheet. */
const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
};

/**
 * Safari + id-ID sering mengubah "J nol" / "j0" jadi kata bahasa ("journal", "jurnal").
 * Normalisasi sebelum pencarian — bukan AI, hanya pola umum di gudang/SKU.
 */
const normalizeVoiceTranscriptForCodes = (raw: string): string => {
  let s = raw.trim();
  const pairs: [RegExp, string][] = [
    [/\bjournal(s)?\b/gi, 'j 0'],
    [/\bjurnal(s)?\b/gi, 'j 0'],
    [/\bjernal(s)?\b/gi, 'j 0'],
    [/\bjay\s+oh\b/gi, 'j 0'],
    [/\bj\s+oh\b/gi, 'j 0'],
    [/\bjay\s+zero\b/gi, 'j 0'],
    [/\bj\s+zero\b/gi, 'j 0'],
    [/\bj\s+number\s+0\b/gi, 'j 0'],
    [/\bje\s+nol\b/gi, 'j 0'],
    [/\bje\s+nul\b/gi, 'j 0'],
    [/\bj\s+nol\b/gi, 'j 0'],
    [/\bj\s+nul\b/gi, 'j 0'],
    [/\bgen\s+0\b/gi, 'j 0'],
    [/\bten\s+0\b/gi, 't 0'],
    [/\btee\s+nol\b/gi, 't 0'],
    [/\btee\s+0\b/gi, 't 0'],
  ];
  for (const [re, rep] of pairs) s = s.replace(re, rep);
  return s.replace(/\s+/g, ' ').trim();
};

/** Varian teks untuk cocokkan SKU setelah STT Safari sering salah (mis. tes11 → t11). */
const skuTranscriptVariants = (compact: string): string[] => {
  const out = new Set<string>();
  if (!compact) return [];
  out.add(compact);
  let v = compact.replace(/^tes(?=\d)/i, 't');
  out.add(v);
  v = compact.replace(/^test(?=\d)/i, 't');
  out.add(v);
  v = compact.replace(/^te(?=\d)/i, 't');
  out.add(v);
  v = compact.replace(/^tee(?=\d)/i, 't');
  out.add(v);
  return [...out];
};

const transcriptSegmentBestConfidence = (res: any): { j: number; transcript: string } => {
  const nAlt = typeof res?.length === 'number' ? res.length : 1;
  let bestJ = 0;
  let bestConf = -1;
  for (let j = 0; j < nAlt; j++) {
    const alt = res[j];
    const c = typeof alt?.confidence === 'number' ? alt.confidence : 0;
    if (c > bestConf) {
      bestConf = c;
      bestJ = j;
    }
  }
  return { j: bestJ, transcript: res[bestJ]?.transcript ?? '' };
};

/** Skor seberapa cocok teks dengan SKU/nama di inventaris (untuk pilih hipotesis STT). */
const scoreTranscriptAgainstInventory = (text: string, inventory: InventoryItem[]): number => {
  const fixed = normalizeVoiceTranscriptForCodes(text);
  const lower = fixed.toLowerCase();
  const compactPhrase = alnumCompact(lower);
  const variants = new Set<string>([
    ...skuTranscriptVariants(compactPhrase),
    ...skuTranscriptVariants(alnumCompact(fixed)),
  ]);
  let max = 0;
  for (const item of inventory) {
    const skuA = alnumCompact(item.sku);
    const nameA = alnumCompact(item.name);
    for (const v of variants) {
      if (v.length < 1) continue;
      if (v === skuA) max = Math.max(max, 100 + v.length);
      else if (skuA.includes(v) || v.includes(skuA)) max = Math.max(max, 55 + Math.min(v.length, skuA.length));
      else if (nameA.includes(v)) max = Math.max(max, 22 + v.length);
      if (skuA.length <= 12 && v.length <= 16 && v.length >= 2) {
        const d = levenshtein(skuA, v);
        if (d <= 2) max = Math.max(max, 48 - d * 14);
      }
    }
  }
  return max;
};

/** Pilih transkrip terbaik: hasil utama + variasi segmen terakhir + normalisasi. */
const pickBestTranscriptForSearch = (primary: string, event: any, inventory: InventoryItem[]): string => {
  const candidates = new Set<string>();
  const add = (t: string) => {
    const x = t.trim();
    if (!x) return;
    candidates.add(x);
    candidates.add(normalizeVoiceTranscriptForCodes(x));
  };
  add(primary);

  if (event?.results?.length) {
    const n = event.results.length;
    const lastIdx = n - 1;
    const lastSlice = event.results[lastIdx];
    const nAlt = typeof lastSlice?.length === 'number' ? lastSlice.length : 1;
    if (nAlt > 1) {
      let prefix = '';
      for (let i = 0; i < lastIdx; i++) {
        prefix += transcriptSegmentBestConfidence(event.results[i]).transcript;
      }
      for (let j = 0; j < nAlt; j++) {
        add(prefix + (lastSlice[j]?.transcript ?? ''));
      }
    }
  }

  let best = normalizeVoiceTranscriptForCodes(primary);
  let bestScore = scoreTranscriptAgainstInventory(primary, inventory);
  for (const c of candidates) {
    const sc = scoreTranscriptAgainstInventory(c, inventory);
    if (sc > bestScore) {
      bestScore = sc;
      best = normalizeVoiceTranscriptForCodes(c);
    }
  }
  return best.trim();
};

/** Ejaan huruf (Indonesia) — TTS Safari + id-ID jauh lebih stabil daripada membacakan string mentah. */
const ID_LETTER_NAMES: Record<string, string> = {
  A: 'a',
  B: 'be',
  C: 'ce',
  D: 'de',
  E: 'e',
  F: 'ef',
  G: 'ge',
  H: 'ha',
  I: 'i',
  J: 'je',
  K: 'ka',
  L: 'el',
  M: 'em',
  N: 'en',
  O: 'o',
  P: 'pe',
  Q: 'ki',
  R: 'er',
  S: 'es',
  T: 'te',
  U: 'u',
  V: 've',
  W: 'we',
  X: 'eks',
  Y: 'ye',
  Z: 'zet',
};

const ID_DIGIT_NAMES = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];

const spellCharForIndonesianTts = (c: string): string => {
  if (/\d/.test(c)) return ID_DIGIT_NAMES[Number(c)] ?? c;
  const u = c.toUpperCase();
  if (/[A-Z]/.test(u)) return ID_LETTER_NAMES[u] ?? c;
  return c;
};

/**
 * Token alfanumerik (huruf + angka, mis. T11KW) dieja per karakter dengan kata Indonesia
 * supaya output suara selaras dengan yang tertulis (bukan "tes sebelas", dll.).
 */
const spellAlphanumericTokenForSpeech = (token: string): string => {
  return [...token].map(spellCharForIndonesianTts).join(', ');
};

const expandCodeTokensForSpeech = (text: string): string => {
  return text.replace(
    /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{2,}\b/g,
    (token) => spellAlphanumericTokenForSpeech(token)
  );
};

/** Potong teks panjang — iOS sering memotong atau mengacaukan satu utterance panjang. */
const splitIntoSpeakChunks = (text: string, maxLen = 140): string[] => {
  const raw = text.trim();
  if (!raw) return [];
  const parts = raw.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  for (const segment of parts) {
    if (segment.length <= maxLen) {
      chunks.push(segment);
      continue;
    }
    let pos = 0;
    while (pos < segment.length) {
      let end = Math.min(pos + maxLen, segment.length);
      if (end < segment.length) {
        const sp = segment.lastIndexOf(' ', end);
        if (sp > pos + 24) end = sp;
      }
      const piece = segment.slice(pos, end).trim();
      if (piece) chunks.push(piece);
      pos = end;
      while (pos < segment.length && segment[pos] === ' ') pos++;
    }
  }
  return chunks.filter(Boolean);
};

const pickIndonesianVoice = (): SpeechSynthesisVoice | undefined => {
  const list = window.speechSynthesis.getVoices();
  const idVoices = list.filter((v) => v.lang?.toLowerCase().startsWith('id'));
  if (idVoices.length === 0) return undefined;
  const premium = idVoices.find(
    (v) => /premium|enhanced|natural/i.test(v.name) || v.localService === true
  );
  return premium ?? idVoices[0];
};

const itemMatchesInventoryLineFilter = (
  name: string,
  filter: 'all' | 'lastshot' | 'standar'
): boolean => {
  const n = name.trim();
  if (filter === 'all') return true;
  const upper = n.toUpperCase();
  if (filter === 'lastshot') return upper.startsWith(INVENTORY_LINE_PREFIXES.lastshot);
  return upper.startsWith(INVENTORY_LINE_PREFIXES.standar.toUpperCase());
};

// --- Main Application Component ---

export default function App() {
  const [activeTab, setActiveTab] = useState<'inventory' | 'voice' | 'logs' | 'settings'>('voice');
  const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_INVENTORY);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [voiceResult, setVoiceResult] = useState<InventoryItem | null>(null);
  const [transcript, setTranscript] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [inventoryLineFilter, setInventoryLineFilter] = useState<'all' | 'lastshot' | 'standar'>('all');
  const [speechRecognitionLang, setSpeechRecognitionLang] = useState<'id-ID' | 'en-US'>(() => {
    try {
      const s = localStorage.getItem('mcr_stt_lang');
      if (s === 'en-US' || s === 'id-ID') return s;
    } catch (_) {}
    return 'id-ID';
  });
  const [sheetUrl, setSheetUrl] = useState('https://script.google.com/macros/s/AKfycbz1kWrk2PdmbnI1vbMFWXxd8sxIRQ74jB9SIJiDJr2JOMOFvrivLrsAzzP6VgXcpzp_/exec');
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // --- Data Initialization (Google Sheets Integration) ---

  const fetchData = async () => {
    if (!sheetUrl) {
      setErrorMessage('Silakan masukkan URL Google Apps Script di tab Config.');
      return;
    }
    setIsSyncing(true);
    setErrorMessage(null);
    try {
      const response = await fetch(sheetUrl);
      const data = await response.json();
      
      if (Array.isArray(data)) {
        // Tambahkan status berdasarkan stok
        const enrichedData = data.map(item => ({
          ...item,
          status: item.stock < 10 ? 'critical' : item.stock < 50 ? 'low' : 'Nifco Product'
        }));
        setInventory(enrichedData);
      } else {
        setErrorMessage('Gagal mengambil data. Pastikan URL Web App benar.');
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage('Terjadi kesalahan koneksi ke Google Sheets.');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (sheetUrl) {
      fetchData();
    }
  }, []);

  const handleSaveUrl = () => {
    localStorage.setItem('mcr_sheet_url', sheetUrl);
    fetchData();
    alert('URL tersimpan dan sinkronisasi dimulai.');
  };

  // --- Update Data ke Google Sheets ---
  const updateStock = async (id: string, newStock: number) => {
    if (!sheetUrl) return false;
    setIsSyncing(true);
    try {
      const response = await fetch(sheetUrl, {
        method: 'POST',
        mode: 'no-cors', // Penting untuk Google Apps Script POST
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, stock: newStock })
      });
      
      // Karena no-cors, kita tidak bisa baca response body, 
      // tapi kita asumsikan berhasil jika tidak ada error network
      setInventory(prev => prev.map(item => 
        item.id === id ? { 
          ...item, 
          stock: newStock,
          status: newStock < 10 ? 'critical' : newStock < 50 ? 'low' : 'Nifco Product'
        } : item
      ));
      return true;
    } catch (error) {
      console.error('Error updating stock:', error);
      setErrorMessage('Gagal memperbarui stok.');
      return false;
    } finally {
      setIsSyncing(false);
    }
  };

  // --- Voice Recognition Setup ---
  
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakGenerationRef = useRef(0);
  const lastRecognitionEventRef = useRef<any>(null);
  /** Jeda diam (ms) setelah suara berhenti baru jalankan pencarian — Safari sering memutus kalimat terlalu cepat jika lebih pendek. */
  const VOICE_END_SILENCE_MS = 2400;

  const initRecognition = () => {
    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) {
      setErrorMessage('Browser tidak mendukung Web Speech API. Gunakan Chrome atau Edge (desktop/Android).');
      return null;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'id-ID';

    recognition.onresult = () => {};
    recognition.onend = () => {};
    recognition.onerror = () => {};

    return recognition;
  };

  useEffect(() => {
    recognitionRef.current = initRecognition();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('mcr_stt_lang', speechRecognitionLang);
    } catch (_) {}
  }, [speechRecognitionLang]);

  // Safari memuat daftar suara (voices) async — pakai event agar getVoices() terisi.
  useEffect(() => {
    if (!window.speechSynthesis) return;
    const load = () => {
      try {
        window.speechSynthesis.getVoices();
      } catch (_) {}
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  // --- Logic: Voice Search & Matching ---

  const handleVoiceSearch = async (text: string) => {
    const normalizedInput = normalizeVoiceTranscriptForCodes(text.trim());
    console.log('Processing voice search for:', normalizedInput);
    const lowerText = normalizedInput.toLowerCase().trim();
    
    if (!lowerText) return;

    // Deteksi perintah update stok
    // Contoh: "update stok hex bolts jadi 50" atau "set stok hex bolts ke 50"
    const updateMatch = lowerText.match(/(?:update|set|ubah|ganti)\s+stok\s+(.+)\s+(?:jadi|ke|menjadi)\s+(\d+)/i);
    
    if (updateMatch) {
      const itemNameQuery = updateMatch[1].trim();
      const newStock = parseInt(updateMatch[2]);
      
      const itemToUpdate = inventory.find(item => 
        item.name.toLowerCase().includes(itemNameQuery) || 
        item.sku.toLowerCase().includes(itemNameQuery)
      );

      if (itemToUpdate) {
        const success = await updateStock(itemToUpdate.id, newStock);
        if (success) {
          if (voiceEnabled) {
            speak(`Stok ${itemToUpdate.name} berhasil diperbarui menjadi ${newStock} unit.`);
          }
          addLog(normalizedInput, itemToUpdate.name, 'success');
        }
        return;
      }
    }

    // Daftar kata-kata pengisi (filler words) yang akan diabaikan
    const fillerWords = ['cari', 'tampilkan', 'ada', 'berapa', 'stok', 'dimana', 'lokasi', 'barang', 'tolong', 'cek', 'di', 'rak', 'unit'];
    
    /** Token pendek seperti j0, t1 tetap dipakai (STT sering mengembalikan kode 2–4 huruf). */
    const looksLikeSkuToken = (w: string) =>
      /^([a-z]{1,5}\d|\d+[a-z])([a-z0-9]*)$/i.test(w) && w.length <= 20;

    const keywords = lowerText
      .split(/\s+/)
      .filter((word) => {
        if (!word || fillerWords.includes(word)) return false;
        if (word.length > 2) return true;
        return looksLikeSkuToken(word);
      });
    
    console.log('Keywords detected:', keywords);

    // Logika pencarian: Mencari item yang mengandung keyword terbanyak atau kecocokan parsial
    const compactPhrase = alnumCompact(lowerText);
    const keywordBlob = alnumCompact(keywords.join(' '));
    const transcriptVariants = new Set<string>([
      ...skuTranscriptVariants(compactPhrase),
      ...skuTranscriptVariants(keywordBlob),
    ]);

    const skuAwareScore = (item: InventoryItem): number => {
      const skuA = alnumCompact(item.sku);
      const nameA = alnumCompact(item.name);
      let best = 0;
      for (const v of transcriptVariants) {
        if (v.length < 2) continue;
        if (v === skuA) best = Math.max(best, 100 + v.length);
        else if (skuA.includes(v) || v.includes(skuA)) best = Math.max(best, 50 + Math.min(v.length, skuA.length));
        else if (nameA.includes(v)) best = Math.max(best, 20 + v.length);
      }
      return best;
    };

    let match = inventory.find(item => {
      const itemName = item.name.toLowerCase();
      const itemSku = item.sku.toLowerCase();
      
      // 1. Cek apakah keyword murni ada di nama barang (Partial Match)
      const hasKeywordMatch = keywords.length > 0 && keywords.some(kw => itemName.includes(kw) || itemSku.includes(kw));
      
      // 2. Cek apakah seluruh kalimat mengandung nama barang atau SKU
      const hasFullMatch = lowerText.includes(itemName) || lowerText.includes(itemSku);
      
      // 3. Cek apakah nama barang mengandung seluruh kalimat (kebalikan dari #2)
      const hasReverseMatch = itemName.includes(lowerText) || itemSku.includes(lowerText);
      
      return hasKeywordMatch || hasFullMatch || hasReverseMatch;
    });

    if (!match) {
      let bestItem: InventoryItem | null = null;
      let bestScore = 0;
      for (const item of inventory) {
        const sc = skuAwareScore(item);
        if (sc > bestScore) {
          bestScore = sc;
          bestItem = item;
        }
      }
      if (bestItem && bestScore >= 50) match = bestItem;
    }

    if (match) {
      console.log('Match found:', match.name);
      setVoiceResult(match);
      if (voiceEnabled) {
        speak(`Barang ditemukan. ${match.name} berada di ${match.rack}.`);
      }
      addLog(normalizedInput, match.name, 'success');
    } else {
      console.log('No match found for:', normalizedInput);
      setVoiceResult(null);
      if (voiceEnabled) {
        speak('Maaf, barang tidak ditemukan dalam sistem.');
      }
      addLog(normalizedInput, undefined, 'not_found');
    }
  };

  const speak = (text: string) => {
    if (!window.speechSynthesis) return;

    const gen = ++speakGenerationRef.current;
    window.speechSynthesis.cancel();

    let sanitizedText = expandCodeTokensForSpeech(text)
      .replace(/\bKW\b/gi, 'ka, we')
      .replace(/-/g, ' ');

    const chunks = splitIntoSpeakChunks(sanitizedText, 130);
    if (chunks.length === 0) return;

    const edge = isChromiumEdge();
    let index = 0;
    const speakNext = () => {
      if (speakGenerationRef.current !== gen) return;
      if (index >= chunks.length) return;
      const chunk = chunks[index++];
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = 'id-ID';
      utterance.rate = 0.86;
      utterance.pitch = 1;
      utterance.volume = 1;
      // Edge: set `voice` sering bikin gagal diam / salah engine; cukup pakai lang + suara default.
      if (!edge) {
        const voice = pickIndonesianVoice();
        if (voice) utterance.voice = voice;
      }
      utterance.onstart = () => {
        try {
          window.speechSynthesis.resume();
        } catch (_) {}
      };
      utterance.onend = () => {
        if (speakGenerationRef.current !== gen) return;
        window.setTimeout(speakNext, 90);
      };
      utterance.onerror = () => {
        if (speakGenerationRef.current !== gen) return;
        window.setTimeout(speakNext, 90);
      };
      window.speechSynthesis.speak(utterance);
    };

    window.setTimeout(() => {
      if (speakGenerationRef.current !== gen) return;
      try {
        window.speechSynthesis.resume();
      } catch (_) {}
      speakNext();
    }, 240);
  };

  const addLog = (command: string, match?: string, status: LogEntry['status'] = 'success') => {
    const newLog: LogEntry = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString(),
      command,
      match,
      status
    };
    setLogs(prev => [newLog, ...prev].slice(0, 50));
  };

  const toggleListening = () => {
    setErrorMessage(null);

    if (isListening) {
      try {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        recognitionRef.current?.abort(); // Abort lebih keras daripada stop
      } catch (e) {}
      setIsListening(false);
      setTranscript('');
      return;
    }

    // Unlock TTS ringan untuk Safari/iOS; di Edge sering mengganggu jalur audio recognition.
    if (window.speechSynthesis && !isChromiumEdge()) {
      try {
        window.speechSynthesis.resume();
      } catch (_) {}
      const unlock = new SpeechSynthesisUtterance(' ');
      unlock.volume = 0.01;
      window.speechSynthesis.speak(unlock);
    }

    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) {
      setErrorMessage('Browser ini tidak mendukung fitur suara.');
      return;
    }

    const startRecognitionSession = () => {
    try {
      const recognition = new Ctor();
      let lastProcessedTranscript = '';
      let hasTriggeredSearch = false;
      let heardSpeech = false;

      /** Gabungkan segmen; pilih alternatif STT dengan confidence tertinggi per segmen (WebKit). */
      const transcriptFromEvent = (event: any) => {
        let line = '';
        for (let i = 0; i < event.results.length; i++) {
          const slice = event.results[i];
          const nAlt = typeof slice.length === 'number' ? slice.length : 1;
          let bestJ = 0;
          let bestConf = -1;
          for (let j = 0; j < nAlt; j++) {
            const alt = slice[j];
            const c = typeof alt?.confidence === 'number' ? alt.confidence : 0;
            if (c > bestConf) {
              bestConf = c;
              bestJ = j;
            }
          }
          line += slice[bestJ]?.transcript ?? '';
        }
        return line.trim();
      };

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = speechRecognitionLang;
      try {
        // Edge Chromium kadang tidak mengisi alternatif; nilai besar aman di try/catch.
        recognition.maxAlternatives = isChromiumEdge() ? 3 : 5;
      } catch (_) {}

      const triggerSearch = (text: string) => {
        if (hasTriggeredSearch || !text.trim()) return;
        hasTriggeredSearch = true;
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        const picked = pickBestTranscriptForSearch(text, lastRecognitionEventRef.current, inventory);
        setTranscript(picked);
        try {
          recognition.stop();
        } catch (_) {}
        handleVoiceSearch(picked);
      };

      const scheduleEndAfterSilence = () => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          console.log('Silence detected, processing full transcript...');
          triggerSearch(lastProcessedTranscript);
        }, VOICE_END_SILENCE_MS);
      };

      recognition.onstart = () => {
        setIsListening(true);
        setTranscript('Mulai mendengarkan...');
      };

      recognition.onspeechstart = () => {
        heardSpeech = true;
      };

      recognition.onsoundstart = () => {
        setTranscript('Suara terdeteksi...');
      };

      recognition.onresult = (event: any) => {
        lastRecognitionEventRef.current = event;
        const combined = transcriptFromEvent(event);
        if (!combined) return;

        lastProcessedTranscript = combined;
        heardSpeech = true;
        setTranscript(combined + (event.results[event.results.length - 1].isFinal ? '' : '…'));
        // Jangan proses di isFinal — WebKit menandai final terlalu awal; tunggu jeda bicara.
        scheduleEndAfterSilence();
      };

      recognition.onend = () => {
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        // Akhir sesi tanpa timer (mis. diputus browser): proses jika ada teks dan belum diproses
        if (!hasTriggeredSearch && lastProcessedTranscript) {
          triggerSearch(lastProcessedTranscript);
        }
        setIsListening(false);
      };

      recognition.onerror = (event: any) => {
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        console.error('Recognition Error:', event.error);
        setIsListening(false);
        
        if (event.error === 'not-allowed') {
          setErrorMessage(
            isChromiumEdge()
              ? 'Mikrofon ditolak. Di Edge: ikon gembok di alamat → Izin untuk situs ini → Mikrofon → Izinkan.'
              : 'Izin mikrofon ditolak. Cek pengaturan mikrofon peramban Anda.'
          );
        } else if (event.error === 'no-speech') {
          if (!heardSpeech && !lastProcessedTranscript) {
            setErrorMessage('Tidak ada suara terdeteksi. Coba bicara lebih keras.');
          }
        } else if (event.error === 'aborted') {
          // User menutup mic — tidak perlu pesan
        } else if (event.error === 'network') {
          setErrorMessage(
            isChromiumEdge()
              ? 'Layanan ucapan Edge butuh internet. Cek koneksi, nonaktifkan VPN, atau di edge://settings/languages aktifkan layanan bicara online.'
              : 'Koneksi internet bermasalah.'
          );
        } else {
          setErrorMessage(`Gagal (${event.error}). Coba refresh halaman.`);
        }
      };

      recognitionRef.current = recognition;
      setVoiceResult(null);
      recognition.start();
      
    } catch (error) {
      console.error('Critical Start Error:', error);
      setErrorMessage('Gagal menjalankan perekam suara.');
      setIsListening(false);
    }
    };

    if (isChromiumEdge() && navigator.mediaDevices?.getUserMedia) {
      void navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach((t) => t.stop());
          startRecognitionSession();
        })
        .catch(() => {
          setErrorMessage(
            'Edge: izinkan mikrofon untuk situs ini (ikon gembok → Mikrofon), lalu ketuk mic lagi.'
          );
        });
      return;
    }

    startRecognitionSession();
  };

  // --- Filtered Inventory ---
  
  const filteredInventory = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return inventory.filter(item => {
      if (!itemMatchesInventoryLineFilter(item.name, inventoryLineFilter)) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        item.rack.toLowerCase().includes(q)
      );
    });
  }, [inventory, searchQuery, inventoryLineFilter]);

  // --- UI Components ---

  const NavButton = ({ tab, icon: Icon, label }: { tab: typeof activeTab, icon: any, label: string }) => (
    <button 
      onClick={() => setActiveTab(tab)}
      className={`cursor-pointer relative flex flex-col items-center gap-1 transition-all duration-300 ${
        activeTab === tab ? 'text-orange-500' : 'text-slate-400 hover:text-slate-800'
      }`}
    >
      <Icon size={24} strokeWidth={activeTab === tab ? 2.5 : 2} />
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      {activeTab === tab && (
        <motion.div 
          layoutId="nav-indicator"
          className="absolute -bottom-2 w-1 h-1 bg-orange-500 rounded-full"
        />
      )}
    </button>
  );

  return (
    <div className="min-h-screen bg-orange-500 text-orange-950 font-sans selection:bg-white/30">
      {/* Header */}
      <header className="fixed top-0 w-full h-16 bg-orange-500/90 backdrop-blur-md z-50 flex items-center justify-between px-6 border-b border-orange-400">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-lg">
            <Package className="text-white" size={20} />
          </div>
          <h1 className="text-sm font-black tracking-[0.2em] uppercase text-white">QC MCR</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-white/20 rounded-full">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="text-[10px] font-bold text-white uppercase tracking-widest">System Ready</span>
          </div>
          <div className="w-8 h-8 rounded-full bg-orange-600 border border-orange-400 flex items-center justify-center overflow-hidden">
            <User size={16} className="text-white" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-24 pb-32 px-6 max-w-4xl mx-auto">
        <AnimatePresence mode="wait">
          {activeTab === 'voice' && (
            <motion.div 
              key="voice"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center gap-12"
            >
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-extrabold tracking-tight text-white">Voice Command</h2>
                <p className="text-orange-100 text-sm">Sebutkan nama barang untuk mencari lokasi</p>
              </div>

              {/* Mic Button */}
              <div className="relative">
                <AnimatePresence>
                  {isListening && (
                    <motion.div 
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1.5, opacity: 0.2 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                      className="absolute inset-0 bg-amber-500 rounded-full"
                    />
                  )}
                </AnimatePresence>
                <button 
                  onClick={toggleListening}
                  className={`cursor-pointer relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 ${
                    isListening 
                      ? 'bg-white text-orange-500 shadow-[0_0_40px_rgba(255,255,255,0.4)]' 
                      : 'bg-white text-orange-400 border border-transparent shadow-xl hover:shadow-2xl'
                  }`}
                >
                  <Mic size={40} strokeWidth={2.5} />
                </button>
              </div>

              <div className="w-full space-y-6">
                {/* Error Message Display */}
                {errorMessage && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-red-500 text-xs"
                  >
                    <AlertTriangle size={16} />
                    <p>{errorMessage}</p>
                  </motion.div>
                )}

                {/* Transcript Display */}
                <div className="bg-white p-6 rounded-2xl shadow-xl border border-transparent text-center min-h-20 flex items-center justify-center">
                  {transcript ? (
                    <p className="text-lg font-medium italic text-orange-950">"{transcript}"</p>
                  ) : (
                    <p className="text-slate-400 text-sm italic">Menunggu perintah suara...</p>
                  )}
                </div>

                {/* Result Card */}
                {voiceResult && (
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-white p-8 rounded-3xl text-orange-950 shadow-xl"
                  >
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-500">Barang Ditemukan</span>
                        <h3 className="text-3xl font-black tracking-tighter text-slate-800">{voiceResult.name}</h3>
                      </div>
                      <div className="bg-orange-100 p-2 rounded-xl text-orange-500">
                        <CheckCircle2 size={24} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Lokasi Rak</p>
                        <p className="text-xl font-black text-orange-600">{voiceResult.rack}</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'inventory' && (
            <motion.div 
              key="inventory"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              <div className="flex flex-col gap-4">
                <h2 className="text-2xl font-bold text-white">Inventory List</h2>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { id: 'all' as const, label: 'Semua' },
                      { id: 'lastshot' as const, label: INVENTORY_LINE_PREFIXES.lastshot },
                      { id: 'standar' as const, label: INVENTORY_LINE_PREFIXES.standar },
                    ] as const
                  ).map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setInventoryLineFilter(id)}
                      className={`rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wide transition-all ${
                        inventoryLineFilter === id
                          ? 'bg-white text-orange-600 shadow-lg'
                          : 'bg-white/15 text-white hover:bg-white/25'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    type="text"
                    placeholder="Cari nama, SKU, atau rak..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white text-orange-950 border-none shadow-xl rounded-xl py-4 pl-12 pr-4 text-sm focus:ring-2 focus:ring-white/80 transition-all outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div className="grid gap-4">
                {filteredInventory.map(item => (
                  <div key={item.id} className="cursor-pointer bg-white p-5 rounded-2xl shadow-lg border border-transparent hover:border-orange-200 transition-all group">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-lg text-slate-800">{item.name}</h3>
                          <span className="text-[10px] font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-500">{item.sku}</span>
                        </div>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                        item.status === 'Nifco Product' ? 'bg-emerald-100 text-emerald-600' :
                        item.status === 'low' ? 'bg-orange-100 text-orange-600' :
                        'bg-red-100 text-red-600'
                      }`}>
                        {item.status}
                      </div>
                    </div>
                    <div className="mt-6 flex justify-between items-end">
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Lokasi</p>
                        <p className="font-bold text-orange-500">{item.rack}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'logs' && (
            <motion.div 
              key="logs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-bold text-white">Activity Logs</h2>
              <div className="space-y-3">
                {logs.length === 0 ? (
                  <div className="text-center py-12 text-orange-100">Belum ada aktivitas suara</div>
                ) : (
                  logs.map(log => (
                    <div key={log.id} className="bg-white shadow-md p-4 rounded-xl border border-transparent flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${
                        log.status === 'success' ? 'bg-emerald-100 text-emerald-600' :
                        log.status === 'not_found' ? 'bg-orange-100 text-orange-600' :
                        'bg-red-100 text-red-600'
                      }`}>
                        {log.status === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-800">"{log.command}"</p>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">
                          {log.timestamp} • {log.status === 'success' ? `Matched: ${log.match}` : 'No Match Found'}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              <h2 className="text-2xl font-bold text-white">Settings</h2>
              
              {/* Profile Card */}
              <div className="bg-white p-6 shadow-md rounded-2xl border border-transparent flex items-center gap-6">
                <div className="w-16 h-16 rounded-2xl bg-orange-100 flex items-center justify-center text-orange-600">
                  <User size={32} strokeWidth={2.5} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-800">Alvin P</h3>
                  <p className="text-slate-500 text-sm">QC MCR</p>
                </div>
              </div>

              {/* Google Sheets Integration Status */}
              <div className="bg-white p-6 shadow-md rounded-2xl border border-transparent space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <Database className="text-orange-500" size={20} />
                    <h3 className="font-bold text-slate-800">Google Sheets API</h3>
                  </div>
                  <div className={`w-3 h-3 rounded-full ${inventory.length > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                </div>
                
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">Masukkan URL Web App dari Google Apps Script:</p>
                  <input 
                    type="text"
                    placeholder="https://script.google.com/macros/s/.../exec"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs font-mono text-orange-600 focus:ring-1 focus:ring-orange-500 transition-all outline-none"
                  />
                  <button 
                    onClick={handleSaveUrl}
                    disabled={isSyncing}
                    className="cursor-pointer w-full py-3 bg-orange-500 text-white shadow-md rounded-xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-orange-600 transition-all disabled:opacity-50"
                  >
                    {isSyncing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    {isSyncing ? 'Syncing...' : 'Save & Sync Data'}
                  </button>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    <span>Status Koneksi</span>
                    <span className={inventory.length > 0 ? 'text-emerald-500' : 'text-red-500'}>
                      {inventory.length > 0 ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    <span>Total Items</span>
                    <span className="text-orange-600 font-black">{inventory.length}</span>
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="space-y-4">
                <div className="bg-white p-5 shadow-md rounded-2xl border border-transparent flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-orange-100 rounded-lg text-orange-600">
                      {voiceEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">Voice Feedback</p>
                      <p className="text-xs text-slate-500">Bacakan hasil pencarian otomatis</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setVoiceEnabled(!voiceEnabled)}
                    className={`cursor-pointer w-12 h-6 rounded-full relative transition-all duration-300 ${voiceEnabled ? 'bg-orange-500' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-300 ${voiceEnabled ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>

                <div className="bg-white p-5 shadow-md rounded-2xl border border-transparent space-y-3">
                  <div>
                    <p className="font-bold text-slate-800">Bahasa mikrofon (pengenalan suara)</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Safari sering salah dengar kode seperti J0 jika pakai Indonesia saja (mis. terdengar &quot;journal&quot;).
                      Untuk SKU huruf+angka, coba <span className="font-semibold text-slate-700">English (US)</span>.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSpeechRecognitionLang('id-ID')}
                      className={`cursor-pointer flex-1 rounded-xl py-3 text-xs font-bold uppercase tracking-wide transition-all ${
                        speechRecognitionLang === 'id-ID'
                          ? 'bg-orange-500 text-white shadow-md'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Indonesia
                    </button>
                    <button
                      type="button"
                      onClick={() => setSpeechRecognitionLang('en-US')}
                      className={`cursor-pointer flex-1 rounded-xl py-3 text-xs font-bold uppercase tracking-wide transition-all ${
                        speechRecognitionLang === 'en-US'
                          ? 'bg-orange-500 text-white shadow-md'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      English (US)
                    </button>
                  </div>
                </div>
              </div>

              <button className="cursor-pointer w-full py-4 bg-white text-red-500 shadow-md rounded-2xl font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-red-50 transition-all">
                <LogOut size={16} />
                Logout Session
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Floating Bottom Navigation */}
      <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-md bg-white/90 backdrop-blur-xl border border-transparent rounded-full py-4 px-8 shadow-[0_20px_50px_rgba(234,88,12,0.3)] z-50">
        <div className="flex justify-between items-center">
          <NavButton tab="inventory" icon={Package} label="Items" />
          <NavButton tab="voice" icon={Mic} label="Voice" />
          <NavButton tab="logs" icon={History} label="Logs" />
          <NavButton tab="settings" icon={Settings} label="Config" />
        </div>
      </nav>
    </div>
  );
}
