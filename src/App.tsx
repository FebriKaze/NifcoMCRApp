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
  status?: 'healthy' | 'low' | 'critical';
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
          status: item.stock < 10 ? 'critical' : item.stock < 50 ? 'low' : 'healthy'
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
          status: newStock < 10 ? 'critical' : newStock < 50 ? 'low' : 'healthy'
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
  const silenceTimerRef = useRef<any>(null);

  const initRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setErrorMessage('Browser Anda tidak mendukung Web Speech API. Gunakan Chrome (Android) atau Safari (iOS).');
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'id-ID';

    recognition.onresult = (event: any) => {
      const result = event.results[0][0].transcript;
      setTranscript(result);
      handleVoiceSearch(result);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      setIsListening(false);
      
      // Pesan error yang lebih ramah user
      if (event.error === 'not-allowed') {
        setErrorMessage('Izin mikrofon ditolak. Silakan cek pengaturan browser HP Anda.');
      } else if (event.error === 'network') {
        setErrorMessage('Masalah koneksi internet.');
      } else if (event.error === 'no-speech') {
        setErrorMessage('Tidak ada suara yang terdengar.');
      } else {
        setErrorMessage(`Error: ${event.error}`);
      }
    };

    return recognition;
  };

  useEffect(() => {
    recognitionRef.current = initRecognition();
  }, []);

  // --- Logic: Voice Search & Matching ---

  const handleVoiceSearch = async (text: string) => {
    console.log('Processing voice search for:', text);
    const lowerText = text.toLowerCase().trim();
    
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
          addLog(text, itemToUpdate.name, 'success');
        }
        return;
      }
    }

    // Daftar kata-kata pengisi (filler words) yang akan diabaikan
    const fillerWords = ['cari', 'tampilkan', 'ada', 'berapa', 'stok', 'dimana', 'lokasi', 'barang', 'tolong', 'cek', 'di', 'rak', 'unit'];
    
    // Membersihkan transcript dari kata pengisi untuk mendapatkan keyword murni
    const keywords = lowerText.split(' ').filter(word => !fillerWords.includes(word) && word.length > 2);
    
    console.log('Keywords detected:', keywords);

    // Logika pencarian: Mencari item yang mengandung keyword terbanyak atau kecocokan parsial
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

    if (match) {
      console.log('Match found:', match.name);
      setVoiceResult(match);
      if (voiceEnabled) {
        speak(`Barang ditemukan. ${match.name} berada di ${match.rack}.`);
      }
      addLog(text, match.name, 'success');
    } else {
      console.log('No match found for:', text);
      setVoiceResult(null);
      if (voiceEnabled) {
        speak('Maaf, barang tidak ditemukan dalam sistem.');
      }
      addLog(text, undefined, 'not_found');
    }
  };

  const speak = (text: string) => {
    if (!window.speechSynthesis) return;
    
    // Batalkan suara sebelumnya agar tidak menumpuk (penting untuk iOS)
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'id-ID';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Tambahkan sedikit delay untuk iOS agar sistem audio siap
    setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 100);
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

    // --- KHUSUS IOS: Unlock Audio & Speech ---
    if (window.speechSynthesis) {
      const msg = new SpeechSynthesisUtterance('');
      window.speechSynthesis.speak(msg);
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setErrorMessage('Browser ini tidak mendukung fitur suara.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      let lastProcessedTranscript = '';
      let hasTriggeredSearch = false;
      
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'id-ID';

      const triggerSearch = (text: string) => {
        if (hasTriggeredSearch || !text.trim()) return;
        hasTriggeredSearch = true;
        setTranscript(text);
        handleVoiceSearch(text);
      };

      const resetSilenceTimer = (final = false) => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        if (!final) {
          silenceTimerRef.current = setTimeout(() => {
            console.log('Silence detected, processing last transcript...');
            triggerSearch(lastProcessedTranscript);
            recognition.stop();
          }, 1500);
        }
      };

      recognition.onstart = () => {
        setIsListening(true);
        setTranscript('Mulai mendengarkan...');
        resetSilenceTimer();
      };

      recognition.onsoundstart = () => {
        setTranscript('Suara terdeteksi...');
        resetSilenceTimer();
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcriptText = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript = transcriptText;
          } else {
            interimTranscript += transcriptText;
          }
        }

        const currentText = finalTranscript || interimTranscript;
        if (currentText) {
          lastProcessedTranscript = currentText;
        }

        if (finalTranscript) {
          resetSilenceTimer(true);
          triggerSearch(finalTranscript);
          recognition.stop();
        } else if (interimTranscript) {
          setTranscript(interimTranscript + '...');
          resetSilenceTimer();
        }
      };

      recognition.onend = () => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        // Jika belum sempat trigger search (misal karena timeout), paksa trigger sekarang
        if (!hasTriggeredSearch && lastProcessedTranscript) {
          triggerSearch(lastProcessedTranscript);
        }
        setIsListening(false);
      };

      recognition.onerror = (event: any) => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        console.error('Recognition Error:', event.error);
        setIsListening(false);
        
        if (event.error === 'not-allowed') {
          setErrorMessage('Izin mikrofon ditolak. Cek Pengaturan > Safari > Mikrofon.');
        } else if (event.error === 'no-speech') {
          // Abaikan error no-speech jika kita sudah punya transcript sementara
          if (!lastProcessedTranscript) {
            setErrorMessage('Tidak ada suara terdeteksi. Coba bicara lebih keras.');
          }
        } else if (event.error === 'network') {
          setErrorMessage('Koneksi internet bermasalah.');
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

  // --- Filtered Inventory ---
  
  const filteredInventory = useMemo(() => {
    return inventory.filter(item => 
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.rack.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [inventory, searchQuery]);

  // --- UI Components ---

  const NavButton = ({ tab, icon: Icon, label }: { tab: typeof activeTab, icon: any, label: string }) => (
    <button 
      onClick={() => setActiveTab(tab)}
      className={`relative flex flex-col items-center gap-1 transition-all duration-300 ${
        activeTab === tab ? 'text-amber-500' : 'text-slate-400 hover:text-white'
      }`}
    >
      <Icon size={24} strokeWidth={activeTab === tab ? 2.5 : 2} />
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      {activeTab === tab && (
        <motion.div 
          layoutId="nav-indicator"
          className="absolute -bottom-2 w-1 h-1 bg-amber-500 rounded-full"
        />
      )}
    </button>
  );

  return (
    <div className="min-h-screen bg-[#0B1221] text-[#dce2f8] font-sans selection:bg-amber-500/30">
      {/* Header */}
      <header className="fixed top-0 w-full h-16 bg-[#0B1221]/80 backdrop-blur-md z-50 flex items-center justify-between px-6 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 rounded-lg">
            <Package className="text-amber-500" size={20} />
          </div>
          <h1 className="text-sm font-black tracking-[0.2em] uppercase text-amber-500">QC MCR</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 rounded-full">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">System Ready</span>
          </div>
          <div className="w-8 h-8 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center overflow-hidden">
            <User size={16} className="text-slate-400" />
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
                <h2 className="text-3xl font-extrabold tracking-tight">Voice Command</h2>
                <p className="text-slate-400 text-sm">Sebutkan nama barang untuk mencari lokasi</p>
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
                  className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 ${
                    isListening 
                      ? 'bg-amber-500 text-[#0B1221] shadow-[0_0_40px_rgba(245,158,11,0.4)]' 
                      : 'bg-[#162032] text-amber-500 border border-amber-500/20 hover:border-amber-500/50'
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
                <div className="bg-[#162032] p-6 rounded-2xl border border-white/5 text-center min-h-20 flex items-center justify-center">
                  {transcript ? (
                    <p className="text-lg font-medium italic text-slate-300">"{transcript}"</p>
                  ) : (
                    <p className="text-slate-500 text-sm italic">Menunggu perintah suara...</p>
                  )}
                </div>

                {/* Result Card */}
                {voiceResult && (
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-amber-500 p-8 rounded-3xl text-[#0B1221] shadow-2xl shadow-amber-500/20"
                  >
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Barang Ditemukan</span>
                        <h3 className="text-3xl font-black tracking-tighter">{voiceResult.name}</h3>
                      </div>
                      <div className="bg-[#0B1221]/10 p-2 rounded-xl">
                        <CheckCircle2 size={24} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">Lokasi Rak</p>
                        <p className="text-xl font-black">{voiceResult.rack}</p>
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
                <h2 className="text-2xl font-bold">Inventory List</h2>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input 
                    type="text"
                    placeholder="Cari nama, SKU, atau rak..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[#162032] border-none rounded-xl py-4 pl-12 pr-4 text-sm focus:ring-2 focus:ring-amber-500/50 transition-all outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-4">
                {filteredInventory.map(item => (
                  <div key={item.id} className="bg-[#162032] p-5 rounded-2xl border border-white/5 hover:border-amber-500/30 transition-all group">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-lg">{item.name}</h3>
                          <span className="text-[10px] font-mono bg-slate-800 px-2 py-0.5 rounded text-slate-400">{item.sku}</span>
                        </div>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                        item.status === 'healthy' ? 'bg-emerald-500/10 text-emerald-500' :
                        item.status === 'low' ? 'bg-amber-500/10 text-amber-500' :
                        'bg-red-500/10 text-red-500'
                      }`}>
                        {item.status}
                      </div>
                    </div>
                    <div className="mt-6 flex justify-between items-end">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Lokasi</p>
                        <p className="font-bold text-amber-500">{item.rack}</p>
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
              <h2 className="text-2xl font-bold">Activity Logs</h2>
              <div className="space-y-3">
                {logs.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">Belum ada aktivitas suara</div>
                ) : (
                  logs.map(log => (
                    <div key={log.id} className="bg-[#162032] p-4 rounded-xl border border-white/5 flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${
                        log.status === 'success' ? 'bg-emerald-500/10 text-emerald-500' :
                        log.status === 'not_found' ? 'bg-amber-500/10 text-amber-500' :
                        'bg-red-500/10 text-red-500'
                      }`}>
                        {log.status === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">"{log.command}"</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">
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
              <h2 className="text-2xl font-bold">Settings</h2>
              
              {/* Profile Card */}
              <div className="bg-[#162032] p-6 rounded-2xl border border-white/5 flex items-center gap-6">
                <div className="w-16 h-16 rounded-2xl bg-amber-500 flex items-center justify-center text-[#0B1221]">
                  <User size={32} strokeWidth={2.5} />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Alex Vanguard</h3>
                  <p className="text-slate-400 text-sm">Lead Logistics Engineer</p>
                  <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mt-1 block">ID: 77-ALPHA</span>
                </div>
              </div>

              {/* Google Sheets Integration Status */}
              <div className="bg-[#162032] p-6 rounded-2xl border border-white/5 space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <Database className="text-amber-500" size={20} />
                    <h3 className="font-bold">Google Sheets API</h3>
                  </div>
                  <div className={`w-3 h-3 rounded-full ${inventory.length > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                </div>
                
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">Masukkan URL Web App dari Google Apps Script:</p>
                  <input 
                    type="text"
                    placeholder="https://script.google.com/macros/s/.../exec"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    className="w-full bg-[#0B1221] border border-white/10 rounded-xl py-3 px-4 text-xs font-mono text-amber-500 focus:ring-1 focus:ring-amber-500 transition-all outline-none"
                  />
                  <button 
                    onClick={handleSaveUrl}
                    disabled={isSyncing}
                    className="w-full py-3 bg-amber-500 text-[#0B1221] rounded-xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-amber-400 transition-all disabled:opacity-50"
                  >
                    {isSyncing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    {isSyncing ? 'Syncing...' : 'Save & Sync Data'}
                  </button>
                </div>

                <div className="bg-[#0B1221] p-4 rounded-xl border border-white/5 space-y-3">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    <span>Status Koneksi</span>
                    <span className={inventory.length > 0 ? 'text-emerald-500' : 'text-red-500'}>
                      {inventory.length > 0 ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    <span>Total Items</span>
                    <span className="text-amber-500">{inventory.length}</span>
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="space-y-4">
                <div className="bg-[#162032] p-5 rounded-2xl border border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-slate-800 rounded-lg text-slate-400">
                      {voiceEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                    </div>
                    <div>
                      <p className="font-bold">Voice Feedback</p>
                      <p className="text-xs text-slate-500">Bacakan hasil pencarian otomatis</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setVoiceEnabled(!voiceEnabled)}
                    className={`w-12 h-6 rounded-full relative transition-all duration-300 ${voiceEnabled ? 'bg-amber-500' : 'bg-slate-700'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300 ${voiceEnabled ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>
              </div>

              <button className="w-full py-4 bg-red-500/10 text-red-500 rounded-2xl font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-red-500/20 transition-all">
                <LogOut size={16} />
                Logout Session
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Floating Bottom Navigation */}
      <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-md bg-[#162032]/80 backdrop-blur-xl border border-white/5 rounded-full py-4 px-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-50">
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
