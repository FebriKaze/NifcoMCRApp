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
  LogOut,
  Sun,
  Moon,
  MapPin,
  Boxes,
  Clock3,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import logo from './image/logo.png';

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
 * Konversi kata bilangan Indonesia/English → digit. Dipakai sebelum pencarian
 * karena STT id-ID sering menghasilkan "sebelas" padahal user menyebut kode "11".
 * Mencakup 0–99 (ones, belasan, puluhan majemuk).
 */
const NORMALIZE_NUMBER_WORDS: [RegExp, string][] = [
  [/\bdua\s+belas\b/gi, '12'],
  [/\btiga\s+belas\b/gi, '13'],
  [/\bempat\s+belas\b/gi, '14'],
  [/\blima\s+belas\b/gi, '15'],
  [/\benam\s+belas\b/gi, '16'],
  [/\btujuh\s+belas\b/gi, '17'],
  [/\bdelapan\s+belas\b/gi, '18'],
  [/\bsembilan\s+belas\b/gi, '19'],
  [/\bthirteen\b/gi, '13'],
  [/\bfourteen\b/gi, '14'],
  [/\bfifteen\b/gi, '15'],
  [/\bsixteen\b/gi, '16'],
  [/\bseventeen\b/gi, '17'],
  [/\beighteen\b/gi, '18'],
  [/\bnineteen\b/gi, '19'],
  [/\bnol\b/gi, '0'],
  [/\bnul\b/gi, '0'],
  [/\bzero\b/gi, '0'],
  [/\boh\b/gi, '0'],
  [/\bsatu\b/gi, '1'],
  [/\bdua\b/gi, '2'],
  [/\btiga\b/gi, '3'],
  [/\bempat\b/gi, '4'],
  [/\blima\b/gi, '5'],
  [/\benam\b/gi, '6'],
  [/\btujuh\b/gi, '7'],
  [/\bdelapan\b/gi, '8'],
  [/\bsembilan\b/gi, '9'],
  [/\bsepuluh\b/gi, '10'],
  [/\bsebelas\b/gi, '11'],
  [/\bone\b/gi, '1'],
  [/\btwo\b/gi, '2'],
  [/\bthree\b/gi, '3'],
  [/\bfour\b/gi, '4'],
  [/\bfive\b/gi, '5'],
  [/\bsix\b/gi, '6'],
  [/\bseven\b/gi, '7'],
  [/\beight\b/gi, '8'],
  [/\bnine\b/gi, '9'],
  [/\beleven\b/gi, '11'],
  [/\btwelve\b/gi, '12'],
];

const ID_TENS: [RegExp, string][] = [
  [/\bdua\s+puluh\b/gi, '20'],
  [/\btiga\s+puluh\b/gi, '30'],
  [/\bempat\s+puluh\b/gi, '40'],
  [/\blima\s+puluh\b/gi, '50'],
  [/\benam\s+puluh\b/gi, '60'],
  [/\btujuh\s+puluh\b/gi, '70'],
  [/\bdelapan\s+puluh\b/gi, '80'],
  [/\bsembilan\s+puluh\b/gi, '90'],
  [/\btwenty\b/gi, '20'],
  [/\bthirty\b/gi, '30'],
  [/\bforty\b/gi, '40'],
  [/\bfifty\b/gi, '50'],
  [/\bsixty\b/gi, '60'],
  [/\bseventy\b/gi, '70'],
  [/\beighty\b/gi, '80'],
  [/\bninety\b/gi, '90'],
];

/** Ubah "dua puluh satu" / "twenty five" → "21" / "25". */
const normalizeCompoundTens = (s: string): string => {
  const TENS: Record<string, string> = {
    '20': 'dua puluh', '30': 'tiga puluh', '40': 'empat puluh',
    '50': 'lima puluh', '60': 'enam puluh', '70': 'tujuh puluh',
    '80': 'delapan puluh', '90': 'sembilan puluh',
    twenty: 'twenty', thirty: 'thirty', forty: 'forty',
    fifty: 'fifty', sixty: 'sixty', seventy: 'seventy',
    eighty: 'eighty', ninety: 'ninety',
  };
  const ONES: Record<string, string> = {
    '1': 'satu', '2': 'dua', '3': 'tiga', '4': 'empat', '5': 'lima',
    '6': 'enam', '7': 'tujuh', '8': 'delapan', '9': 'sembilan',
    one: 'one', two: 'two', three: 'three', four: 'four', five: 'five',
    six: 'six', seven: 'seven', eight: 'eight', nine: 'nine',
  };
  let out = s;
  for (const [digit, tensWord] of Object.entries(TENS)) {
    for (const [oneDigit, oneWord] of Object.entries(ONES)) {
      out = out.replace(new RegExp(`\\b${tensWord}\\s+${oneWord}\\b`, 'gi'), `${digit.slice(0, 1)}${oneDigit}`);
    }
  }
  return out;
};

/**
 * Safari + id-ID sering mengubah "J nol" / "j0" jadi kata bahasa ("journal", "jurnal").
 * Normalisasi sebelum pencarian — bukan AI, hanya pola umum di gudang/SKU.
 */
const normalizeVoiceTranscriptForCodes = (raw: string): string => {
  let s = normalizeCompoundTens(raw.trim());
  const pairs: [RegExp, string][] = [
    ...NORMALIZE_NUMBER_WORDS,
    [/\bjournal(s)?\b/gi, 'j 0'],
    [/\bjurnal(s)?\b/gi, 'j 0'],
    [/\bjernal(s)?\b/gi, 'j 0'],
    [/\bjay\b/gi, 'j'],
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

/** Variasi teks untuk mencocokkan SKU setelah STT Safari sering salah (mis. tes11 → t11). */
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
      if (skuA) {
        if (v === skuA) max = Math.max(max, 100 + v.length);
        else if (skuA.includes(v) || v.includes(skuA)) max = Math.max(max, 55 + Math.min(v.length, skuA.length));
        if (skuA.length <= 12 && v.length <= 16 && v.length >= 2) {
          const d = levenshtein(skuA, v);
          if (d <= 2) max = Math.max(max, 48 - d * 14);
        }
      }
      if (nameA.includes(v)) max = Math.max(max, 22 + v.length);
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

/** Ejaan huruf (Indonesia) — TTS Safari + id-ID jauh lebih stabil daripada membaca string mentah. */
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
 * Token alfanumerik (huruf + angka, mis. T11KW) diucapkan per karakter dengan kata Indonesia
 * supaya keluaran suara sejalan dengan yang tertulis (bukan "tes sebelas", dst.).
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
  if (filter === 'lastshot')
    return upper.startsWith(INVENTORY_LINE_PREFIXES.lastshot) || upper.startsWith('LS');
  return upper.startsWith(INVENTORY_LINE_PREFIXES.standar.toUpperCase());
};

// --- Ambient background (glassmorphism light) ---

function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      <motion.div
        className="blob -top-40 -left-40 h-[420px] w-[420px] bg-emerald-400/20 dark:bg-emerald-500/15"
        animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="blob top-1/4 -right-40 h-[480px] w-[480px] bg-sky-400/20 dark:bg-indigo-500/15"
        animate={{ x: [0, -50, 0], y: [0, 50, 0] }}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="blob bottom-0 left-1/4 h-[380px] w-[380px] bg-violet-400/20 dark:bg-cyan-500/10"
        animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
        transition={{ duration: 21, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

/** Toggle switch kecil bergaya modern. */
function Theme({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      className={`focus-ring relative h-7 cursor-pointer rounded-full transition-colors duration-300 ${
        on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
      }`}
      style={{ width: '3.25rem' }}
    >
      <motion.div
        className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-md"
        animate={{ left: on ? 'calc(100% - 1.25rem - 4px)' : '4px' }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      />
    </button>
  );
}

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
  const [inventoryPage, setInventoryPage] = useState(1);
  const INVENTORY_PAGE_SIZE = 10;
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const s = localStorage.getItem('mcr_theme');
      if (s === 'dark') return true;
      if (s === 'light') return false;
    } catch (_) {}
    return true;
  });
  const [speechRecognitionLang, setSpeechRecognitionLang] = useState<'id-ID' | 'en-US'>(() => {
    try {
      const s = localStorage.getItem('mcr_stt_lang');
      if (s === 'en-US' || s === 'id-ID') return s;
    } catch (_) {}
    return 'id-ID';
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    try {
      localStorage.setItem('mcr_theme', dark ? 'dark' : 'light');
    } catch (_) {}
  }, [dark]);

  // --- Data Initialization (File Excel Lokal) ---

  const fetchData = async () => {
    setIsSyncing(true);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/inventory');
      const data = await response.json();

      if (Array.isArray(data)) {
        setInventory(data);
      } else {
        setErrorMessage('Gagal membaca data. Pastikan data/inventory.xlsx ada.');
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage('Terjadi kesalahan koneksi ke server. Jalankan server Express (npm run dev).');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sttLang: speechRecognitionLang }),
    }).catch(() => {});
  }, [speechRecognitionLang]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (data && (data.sttLang === 'id-ID' || data.sttLang === 'en-US')) {
          setSpeechRecognitionLang(data.sttLang);
        }
      } catch (_) {}
    })();
  }, []);

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
        if (skuA) {
          if (v === skuA) best = Math.max(best, 100 + v.length);
          else if (skuA.includes(v) || v.includes(skuA)) best = Math.max(best, 50 + Math.min(v.length, skuA.length));
        }
        if (nameA.includes(v)) best = Math.max(best, 40 + v.length);
      }
      // Kecocokan frasa utuh dengan nama barang (menangani perintah yang memuat nama lengkap)
      if (compactPhrase.length >= 3) {
        if (nameA.includes(compactPhrase)) best = Math.max(best, 60 + compactPhrase.length);
        else if (compactPhrase.includes(nameA)) best = Math.max(best, 90 + nameA.length);
      }
      return best;
    };

    let match = inventory.find((item) => {
      const itemName = item.name.toLowerCase();
      const itemSku = item.sku.toLowerCase();

      // 1. Cek apakah keyword murni ada di nama barang (Partial Match)
      const hasKeywordMatch = keywords.length > 0 && keywords.some((kw) => itemName.includes(kw) || (itemSku && itemSku.includes(kw)));

      // 2. Cek apakah seluruh kalimat mengandung nama barang atau SKU
      const hasFullMatch = lowerText.includes(itemName) || Boolean(itemSku && itemSku.length >= 3 && lowerText.includes(itemSku));

      // 3. Cek apakah nama barang mengandung seluruh kalimat (kebalikan dari #2)
      const hasReverseMatch = itemName.includes(lowerText) || Boolean(itemSku && itemSku.includes(lowerText));

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
      // Edge: set `voice` sering membuat gagal diam / salah engine; cukup pakai lang + suara default.
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
      status,
    };
    setLogs((prev) => [newLog, ...prev].slice(0, 50));
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
          // Chrome kadang tidak mengisi alternatif; nilai besar aman di try/catch.
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
            'Edge: izinkan mikrofon untuk situs ini (ikon kunci → Mikrofon), lalu ketuk mic lagi.'
          );
        });
      return;
    }

    startRecognitionSession();
  };

  // --- Filtered Inventory ---

  const filteredInventory = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return inventory.filter((item) => {
      if (!itemMatchesInventoryLineFilter(item.name, inventoryLineFilter)) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        item.rack.toLowerCase().includes(q)
      );
    });
  }, [inventory, searchQuery, inventoryLineFilter]);

  const totalInventoryPages = Math.max(1, Math.ceil(filteredInventory.length / INVENTORY_PAGE_SIZE));

  useEffect(() => {
    setInventoryPage((page) => Math.min(page, totalInventoryPages));
  }, [totalInventoryPages]);

  useEffect(() => {
    setInventoryPage(1);
  }, [searchQuery, inventoryLineFilter]);

  const pagedInventory = useMemo(() => {
    const start = (inventoryPage - 1) * INVENTORY_PAGE_SIZE;
    return filteredInventory.slice(start, start + INVENTORY_PAGE_SIZE);
  }, [filteredInventory, inventoryPage]);

  const goToInventoryPage = (page: number) => {
    setInventoryPage(Math.min(Math.max(1, page), totalInventoryPages));
  };

  const visibleInventoryPages = useMemo(() => {
    const pages: (number | '...')[] = [];
    const add = (p: number) => {
      if (p >= 1 && p <= totalInventoryPages && pages[pages.length - 1] !== p) pages.push(p);
    };
    add(1);
    for (let p = inventoryPage - 2; p <= inventoryPage + 2; p++) add(p);
    add(totalInventoryPages);
    const spaced: (number | '...')[] = [];
    pages.forEach((p, i) => {
      if (i > 0 && typeof p === 'number' && typeof pages[i - 1] === 'number' && p - (pages[i - 1] as number) > 1) {
        spaced.push('...');
      }
      spaced.push(p);
    });
    return spaced;
  }, [inventoryPage, totalInventoryPages]);

  // --- UI Components ---

  const NavButton = ({ tab, icon: Icon, label }: { tab: typeof activeTab; icon: any; label: string }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`focus-ring relative flex cursor-pointer flex-col items-center gap-1 rounded-2xl px-4 py-2 transition-all duration-300 ${
        activeTab === tab ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
      }`}
    >
      {activeTab === tab && (
        <motion.div
          layoutId="nav-indicator"
          className="absolute inset-0 rounded-2xl bg-emerald-500/10 dark:bg-emerald-400/10"
          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        />
      )}
      <Icon size={22} strokeWidth={activeTab === tab ? 2.5 : 2} className="relative z-10 transition-colors" />
      <span className="relative z-10 text-[10px] font-bold uppercase tracking-widest">{label}</span>
    </button>
  );

  const statusChip = (status?: string) => {
    if (status === 'low')
      return 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300';
    if (status === 'critical')
      return 'bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300';
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300';
  };

  return (
    <div className="relative min-h-screen bg-slate-100 text-slate-900 transition-colors duration-500 dark:bg-[#060911] dark:text-slate-100">
      <AmbientBackground />

      {/* Header */}
      <header className="fixed top-0 z-50 w-full border-b border-slate-200/70 bg-white/60 backdrop-blur-2xl dark:border-white/10 dark:bg-[#060911]/60">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 items-center justify-center overflow-hidden rounded-xl">
              <img src={logo} alt="QC MCR" className="h-8 w-auto object-contain" />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-black tracking-[0.18em] uppercase">QC MCR</h1>
              <p className="text-[9px] font-semibold uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">
                Voice Inventory
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-slate-200/70 bg-white/60 px-3 py-1.5 backdrop-blur sm:flex dark:border-white/10 dark:bg-white/5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/60" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Ready
              </span>
            </div>
            <button
              onClick={() => setDark(!dark)}
              aria-label="Ganti tema"
              className="focus-ring flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-slate-200/70 bg-white/60 text-slate-500 backdrop-blur transition-colors hover:text-emerald-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-md">
              <User size={16} />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-4xl px-5 pt-24 pb-32">
        <AnimatePresence mode="wait">
          {activeTab === 'voice' && (
            <motion.div
              key="voice"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="flex flex-col items-center gap-10"
            >
              <div className="space-y-2 text-center">
                <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                  <span className="text-gradient">Voice Command</span>
                </h2>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  Sebutkan nama barang untuk menemukan lokasinya
                </p>
              </div>

              {/* Mic Button */}
              <div className="relative">
                <AnimatePresence>
                  {isListening && (
                    <>
                      <motion.div
                        key="ring-1"
                        initial={{ scale: 0.8, opacity: 0.6 }}
                        animate={{ scale: 1.9, opacity: 0 }}
                        transition={{ repeat: Infinity, duration: 1.6, ease: 'easeOut' }}
                        className="absolute inset-0 rounded-full bg-emerald-400/40"
                      />
                      <motion.div
                        key="ring-2"
                        initial={{ scale: 0.8, opacity: 0.5 }}
                        animate={{ scale: 1.6, opacity: 0 }}
                        transition={{ repeat: Infinity, duration: 1.6, delay: 0.4, ease: 'easeOut' }}
                        className="absolute inset-0 rounded-full bg-teal-400/40"
                      />
                    </>
                  )}
                </AnimatePresence>
                <motion.button
                  onClick={toggleListening}
                  whileTap={{ scale: 0.94 }}
                  aria-label="Cari lewat suara"
                  className={`focus-ring relative z-10 flex h-24 w-24 cursor-pointer items-center justify-center rounded-full transition-all duration-500 ${
                    isListening
                      ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-[0_0_60px] shadow-emerald-500/50'
                      : 'bg-white text-emerald-500 shadow-xl ring-1 ring-slate-200/80 hover:shadow-2xl dark:bg-white/10 dark:text-emerald-400 dark:ring-white/10'
                  }`}
                >
                  <Mic size={36} strokeWidth={2.2} />
                </motion.button>
              </div>

              <div className="w-full space-y-5">
                {/* Error Message */}
                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="glass-subtle flex items-start gap-3 rounded-2xl border-red-300/60 p-4 text-red-600 dark:border-red-400/20 dark:text-red-300"
                  >
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <p className="text-xs leading-relaxed">{errorMessage}</p>
                  </motion.div>
                )}

                {/* Transcript */}
                <div className="glass-subtle min-h-16 p-5">
                  <div className="flex items-center justify-center gap-3">
                    {isListening && (
                      <div className="flex items-end gap-[3px]">
                        {[0, 1, 2, 3].map((i) => (
                          <motion.span
                            key={i}
                            className="w-1 rounded-full bg-emerald-400"
                            animate={{ height: [6, 18, 6] }}
                            transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15, ease: 'easeInOut' }}
                          />
                        ))}
                      </div>
                    )}
                    {transcript ? (
                      <p className="text-sm italic text-slate-700 dark:text-slate-200">&quot;{transcript}&quot;</p>
                    ) : (
                      <p className="text-sm italic text-slate-400 dark:text-slate-500">Menunggu perintah suara...</p>
                    )}
                  </div>
                </div>

                {/* Result Card */}
                <AnimatePresence>
                  {voiceResult && (
                    <motion.div
                      key={voiceResult.id}
                      initial={{ scale: 0.92, opacity: 0, y: 8 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      exit={{ scale: 0.96, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                      className="glass relative overflow-hidden rounded-3xl p-7"
                    >
                      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-emerald-400/20 blur-3xl dark:bg-emerald-400/10" />
                      <div className="relative">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">
                            <CheckCircle2 size={12} /> Barang Ditemukan
                          </span>
                          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            SKU {voiceResult.sku}
                          </span>
                        </div>

                        <h3 className="text-2xl font-black tracking-tight sm:text-3xl">{voiceResult.name}</h3>

                        <div className="mt-6 flex items-center gap-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-4 text-white shadow-lg shadow-emerald-500/25">
                          <MapPin size={22} strokeWidth={2.4} />
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">
                              Lokasi Rak
                            </p>
                            <p className="text-lg font-black tracking-wider">{voiceResult.rack}</p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {activeTab === 'inventory' && (
            <motion.div
              key="inventory"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-extrabold tracking-tight">Inventory</h2>
                  <span className="rounded-xl border border-slate-200/70 bg-white/60 px-3 py-1.5 text-xs font-bold backdrop-blur dark:border-white/10 dark:bg-white/5">
                    {filteredInventory.length} item
                  </span>
                </div>

                {/* Filter pills */}
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
                      className={`focus-ring cursor-pointer rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wide transition-all duration-200 ${
                        inventoryLineFilter === id
                          ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25'
                          : 'border border-slate-200/70 bg-white/60 text-slate-600 backdrop-blur hover:text-emerald-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="text"
                    placeholder="Cari nama, SKU, atau rak..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="focus-ring w-full rounded-2xl border border-slate-200/70 bg-white/70 py-4 pl-12 pr-4 text-sm shadow-lg shadow-slate-200/40 outline-none backdrop-blur placeholder:text-slate-400 transition-all focus:border-emerald-400 dark:border-white/10 dark:bg-white/5 dark:shadow-none"
                  />
                </div>
              </div>

              {/* Item list */}
              <div className="grid gap-4">
                {pagedInventory.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="glass group relative cursor-pointer overflow-hidden rounded-2xl p-5 transition-transform duration-300 hover:-translate-y-0.5"
                  >
                    <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-emerald-500 to-teal-600 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-bold">{item.name}</h3>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-slate-300">
                            {item.sku}
                          </span>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${statusChip(item.status)}`}>
                        {item.status ?? 'Nifco Product'}
                      </span>
                    </div>
                    <div className="mt-5 flex items-center gap-2 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      <MapPin size={15} />
                      {item.rack}
                    </div>
                  </motion.div>
                ))}

                {filteredInventory.length === 0 && (
                  <div className="glass flex flex-col items-center gap-3 rounded-3xl py-14 text-center">
                    <Boxes size={36} className="text-slate-300 dark:text-slate-600" />
                    <p className="text-sm font-medium text-slate-400">Tidak ada item ditemukan</p>
                  </div>
                )}
              </div>

              {/* Pagination */}
              {filteredInventory.length > INVENTORY_PAGE_SIZE && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-400">
                    Menampilkan {Math.min(INVENTORY_PAGE_SIZE, filteredInventory.length)} dari {filteredInventory.length} item
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => goToInventoryPage(inventoryPage - 1)}
                      disabled={inventoryPage === 1}
                      className="focus-ring cursor-pointer rounded-xl border border-slate-200/70 bg-white/60 px-3 py-2 text-xs font-bold text-slate-600 backdrop-blur transition-all hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                    >
                      Prev
                    </button>
                    {visibleInventoryPages.map((page, i) =>
                      page === '...' ? (
                        <span key={`ellipsis-${i}`} className="px-1 text-xs font-bold text-slate-400">
                          …
                        </span>
                      ) : (
                        <button
                          key={page}
                          type="button"
                          onClick={() => goToInventoryPage(page)}
                          className={`focus-ring h-9 w-9 cursor-pointer rounded-xl text-xs font-black transition-all duration-200 ${
                            page === inventoryPage
                              ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25'
                              : 'border border-slate-200/70 bg-white/60 text-slate-600 backdrop-blur hover:text-emerald-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
                          }`}
                        >
                          {page}
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => goToInventoryPage(inventoryPage + 1)}
                      disabled={inventoryPage === totalInventoryPages}
                      className="focus-ring cursor-pointer rounded-xl border border-slate-200/70 bg-white/60 px-3 py-2 text-xs font-bold text-slate-600 backdrop-blur transition-all hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'logs' && (
            <motion.div
              key="logs"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-extrabold tracking-tight">Activity Logs</h2>

              {logs.length === 0 ? (
                <div className="glass flex flex-col items-center gap-3 rounded-3xl py-16 text-center">
                  <Clock3 size={38} className="text-slate-300 dark:text-slate-600" />
                  <p className="text-sm font-medium text-slate-400">Belum ada aktivitas suara</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {logs.map((log) => (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="glass-subtle flex items-center gap-4 rounded-2xl p-4"
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                          log.status === 'success'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : log.status === 'not_found'
                              ? 'bg-amber-500/15 text-amber-500'
                              : 'bg-red-500/15 text-red-500'
                        }`}
                      >
                        {log.status === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">&quot;{log.command}&quot;</p>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          {log.timestamp} ·{' '}
                          {log.status === 'success' ? `Matched: ${log.match}` : 'No Match Found'}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-extrabold tracking-tight">Settings</h2>

              {/* Profile Card */}
              <div className="glass flex items-center gap-5 rounded-3xl p-6">
                <div className="relative">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/30">
                    <User size={30} strokeWidth={2.5} />
                  </div>
                  <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white bg-emerald-500 dark:border-[#060911]" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Alvin P</h3>
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Quality Control · MCR</p>
                </div>
              </div>

              {/* Tampilan */}
              <div className="glass flex items-center justify-between gap-4 rounded-3xl p-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
                    {dark ? <Moon size={20} /> : <Sun size={20} />}
                  </div>
                  <div>
                    <p className="text-sm font-bold">Tema Tampilan</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {dark ? 'Mode gelap' : 'Mode terang'}
                    </p>
                  </div>
                </div>
                <Theme on={!dark} onToggle={() => setDark(!dark)} label="Toggle tema" />
              </div>

              {/* Excel Data Source */}
              <div className="glass space-y-4 rounded-3xl p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
                      <Database size={20} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold">Sumber Data Excel</h3>
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        data/inventory.xlsx
                      </p>
                    </div>
                  </div>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      inventory.length > 0 ? 'bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/60' : 'bg-red-500'
                    }`}
                  />
                </div>

                <div className="rounded-2xl border border-slate-200/70 bg-white/50 p-4 backdrop-blur dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="space-y-2.5 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    <div className="flex justify-between">
                      <span>Status Koneksi</span>
                      <span className={inventory.length > 0 ? 'text-emerald-500' : 'text-red-500'}>
                        {inventory.length > 0 ? 'Connected' : 'Disconnected'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Items</span>
                      <span className="font-black text-emerald-500">{inventory.length}</span>
                    </div>
                  </div>
                  <button
                    onClick={fetchData}
                    disabled={isSyncing}
                    className="focus-ring mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3 text-[11px] font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-500/25 transition-all hover:brightness-110 disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                    {isSyncing ? 'Loading...' : 'Refresh Data'}
                  </button>
                </div>
              </div>

              {/* Voice */}
              <div className="space-y-4">
                <div className="glass flex items-center justify-between gap-4 rounded-3xl p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
                      {voiceEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                    </div>
                    <div>
                      <p className="text-sm font-bold">Voice Feedback</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Bacakan hasil pencarian otomatis
                      </p>
                    </div>
                  </div>
                  <Theme
                    on={voiceEnabled}
                    onToggle={() => setVoiceEnabled(!voiceEnabled)}
                    label="Toggle voice feedback"
                  />
                </div>

                <div className="glass space-y-4 rounded-3xl p-5">
                  <div>
                    <p className="text-sm font-bold">Bahasa Mikrofon</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Safari sering salah dengar kode seperti J0 jika menggunakan Indonesia saja. Untuk SKU
                      huruf+angka, coba English (US).
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {(
                      [
                        { id: 'id-ID' as const, label: 'Indonesia' },
                        { id: 'en-US' as const, label: 'English (US)' },
                      ] as const
                    ).map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setSpeechRecognitionLang(id)}
                        className={`focus-ring flex-1 cursor-pointer rounded-xl py-3 text-xs font-bold uppercase tracking-wide transition-all duration-200 ${
                          speechRecognitionLang === id
                            ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25'
                            : 'border border-slate-200/70 bg-white/50 text-slate-600 backdrop-blur hover:border-emerald-400/50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button className="focus-ring flex w-full cursor-pointer items-center justify-center gap-2 rounded-3xl border border-red-300/60 bg-white/50 py-4 text-xs font-black uppercase tracking-widest text-red-600 backdrop-blur transition-all hover:bg-red-50 dark:border-red-400/20 dark:bg-white/[0.03] dark:text-red-400 dark:hover:bg-red-500/10">
                <LogOut size={16} />
                Logout Session
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Floating Bottom Navigation */}
      <nav className="fixed bottom-6 left-1/2 z-50 w-[92%] max-w-md -translate-x-1/2">
        <div className="glass flex items-center justify-between rounded-[1.75rem] px-3 py-2">
          <NavButton tab="inventory" icon={Boxes} label="Items" />
          <NavButton tab="voice" icon={Mic} label="Voice" />
          <NavButton tab="logs" icon={History} label="Logs" />
          <NavButton tab="settings" icon={Settings} label="Config" />
        </div>
      </nav>
    </div>
  );
}