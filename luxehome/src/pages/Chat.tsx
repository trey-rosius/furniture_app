import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Camera, Mic, PlusCircle, Loader2, X, Volume2, MicOff, Waves } from 'lucide-react';
import { getDesignAdvice, ai } from '../services/geminiService';
import { Modality, LiveServerMessage } from '@google/genai';

interface Message {
  id: number;
  role: 'user' | 'agent';
  content: string;
  products?: {
    id: number;
    name: string;
    price: string;
    image: string;
  }[];
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: 'agent',
      content: "Hello! I'm your LuxeHome Design Agent. How can I help you elevate your space today?"
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Voice Mode Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: Message = {
      id: Date.now(),
      role: 'user',
      content: input
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const history = messages.map(m => ({
        role: m.role === 'agent' ? 'model' : 'user' as const,
        parts: [{ text: m.content }]
      }));

      const advice = await getDesignAdvice(input, history);
      
      const agentMsg: Message = {
        id: Date.now() + 1,
        role: 'agent',
        content: advice || "I'm sorry, I couldn't process that request. How else can I help?"
      };

      setMessages(prev => [...prev, agentMsg]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'agent',
        content: "I'm having trouble connecting to my design database. Please try again in a moment."
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Voice Mode Logic
  const startVoiceMode = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsVoiceMode(true);
      setIsVoiceActive(true);
      
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      
      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        callbacks: {
          onopen: () => {
            console.log("Live session opened");
            setupAudioCapture(stream);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
              const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
              const binaryString = atob(base64Audio);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const pcmData = new Int16Array(bytes.buffer);
              audioQueueRef.current.push(pcmData);
              if (!isPlayingRef.current) {
                playNextInQueue();
              }
            }
            
            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              isPlayingRef.current = false;
            }
          },
          onclose: () => {
            stopVoiceMode();
          },
          onerror: (err) => {
            console.error("Live session error:", err);
            stopVoiceMode();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "You are LuxeHome's AI Design Agent. You are an expert in architectural minimalist furniture and interior design. Your goal is to help users find the perfect pieces for their home. Be elegant, professional, and helpful. Keep your responses concise and conversational for voice interaction.",
        },
      });
      
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Failed to start voice mode:", err);
      alert("Microphone access is required for voice mode.");
    }
  };

  const setupAudioCapture = (stream: MediaStream) => {
    if (!audioContextRef.current) return;
    
    sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
    processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
    
    processorRef.current.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
      }
      
      const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
      if (sessionRef.current) {
        sessionRef.current.sendRealtimeInput({
          media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      }
    };
    
    sourceRef.current.connect(processorRef.current);
    processorRef.current.connect(audioContextRef.current.destination);
  };

  const playNextInQueue = () => {
    if (audioQueueRef.current.length === 0 || !audioContextRef.current) {
      isPlayingRef.current = false;
      return;
    }
    
    isPlayingRef.current = true;
    const pcmData = audioQueueRef.current.shift()!;
    const floatData = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      floatData[i] = pcmData[i] / 0x7FFF;
    }
    
    const buffer = audioContextRef.current.createBuffer(1, floatData.length, 16000);
    buffer.getChannelData(0).set(floatData);
    
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.onended = () => playNextInQueue();
    source.start();
  };

  const stopVoiceMode = () => {
    setIsVoiceMode(false);
    setIsVoiceActive(false);
    
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-73px)] relative max-w-5xl mx-auto w-full overflow-hidden bg-[#f8f8f6]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 md:p-10 space-y-8 scrollbar-hide">
        {messages.map((msg) => (
          <motion.div 
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex flex-col gap-2 ${msg.role === 'user' ? 'max-w-[80%] ml-auto' : 'max-w-[80%]'}`}
          >
            <div className={`flex items-center gap-2 mb-1 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              <span className={`text-[10px] font-bold tracking-widest uppercase ${msg.role === 'agent' ? 'text-[#e7b923]' : 'text-gray-400'}`}>
                {msg.role === 'agent' ? 'AI Design Agent' : 'You'}
              </span>
            </div>
            <div className={`p-5 rounded-2xl shadow-sm ${msg.role === 'agent' ? 'bg-[#f3f0e7] text-gray-700 rounded-tl-none' : 'bg-gray-600 text-white rounded-tr-none'}`}>
              <p className="text-base leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              {msg.products && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                  {msg.products.map((product) => (
                    <div key={product.id} className="bg-white p-2 rounded-lg border border-[#f3f0e7]">
                      <div 
                        className="aspect-square bg-gray-100 rounded mb-2 bg-cover bg-center" 
                        style={{ backgroundImage: `url(${product.image})` }}
                      ></div>
                      <p className="text-xs font-bold truncate">{product.name}</p>
                      <p className="text-[10px] text-[#e7b923]">{product.price}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        ))}
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col gap-2 max-w-[80%]"
          >
            <span className="text-[10px] font-bold tracking-widest uppercase text-[#e7b923]">AI Design Agent</span>
            <div className="p-5 rounded-2xl bg-[#f3f0e7] text-gray-400 rounded-tl-none flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm italic">Curating architectural selections...</span>
            </div>
          </motion.div>
        )}
      </div>

      <div className="p-6 md:px-10 md:pb-10 bg-gradient-to-t from-[#f8f8f6] via-[#f8f8f6] to-transparent">
        <div className="max-w-3xl mx-auto relative">
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            {['Show more like these', 'Change color filter', 'Check dimensions'].map((hint) => (
              <button 
                key={hint} 
                onClick={() => setInput(hint)}
                className="px-4 py-1.5 bg-[#f3f0e7]/60 hover:bg-[#f3f0e7] rounded-full text-[11px] font-semibold tracking-wide text-gray-600 transition-colors border border-transparent hover:border-[#e7b923]/20"
              >
                {hint}
              </button>
            ))}
          </div>
          <div className="relative flex items-center bg-white rounded-2xl shadow-xl border border-[#f3f0e7] p-2 pr-4 transition-shadow focus-within:shadow-2xl">
            <button className="p-3 text-gray-300 hover:text-[#e7b923] transition-colors">
              <PlusCircle className="w-6 h-6" />
            </button>
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Type your design query..." 
              className="flex-1 bg-transparent border-none focus:ring-0 text-gray-700 placeholder-gray-300 text-sm py-3 px-2"
            />
            <div className="flex items-center gap-2">
              <button className="p-2 text-gray-400 hover:text-[#e7b923] transition-colors">
                <Camera className="w-5 h-5" />
              </button>
              <div className="h-6 w-px bg-[#f3f0e7] mx-1"></div>
              <button 
                onClick={startVoiceMode}
                className="p-2 text-[#e7b923] relative hover:bg-[#f3f0e7] rounded-full transition-colors"
              >
                <Mic className="w-6 h-6" />
                <div className="absolute -right-1 bottom-1 flex items-end gap-[1px] h-2">
                  <div className="w-[2px] h-1 bg-[#e7b923] animate-pulse"></div>
                  <div className="w-[2px] h-2 bg-[#e7b923] animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-[2px] h-1.5 bg-[#e7b923] animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </button>
              <button 
                onClick={handleSend}
                disabled={isLoading}
                className="ml-2 bg-[#141414] text-white rounded-xl px-4 py-2 text-sm font-bold hover:bg-gray-700 transition-all shadow-lg shadow-black/10 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Voice Mode Overlay */}
      <AnimatePresence>
        {isVoiceMode && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-[#141414] flex flex-col items-center justify-center p-10"
          >
            <div className="absolute top-10 right-10">
              <button 
                onClick={stopVoiceMode}
                className="p-4 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
              >
                <X className="w-8 h-8" />
              </button>
            </div>

            <div className="flex flex-col items-center gap-12 text-center">
              <div className="relative">
                <div className="absolute -inset-20 bg-[#e7b923]/10 rounded-full blur-3xl animate-pulse"></div>
                <div className="w-48 h-48 rounded-full bg-[#1a1a1a] border-2 border-[#e7b923]/30 flex items-center justify-center relative z-10">
                  <Waves className="w-24 h-24 text-[#e7b923] animate-bounce" />
                </div>
                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <div 
                      key={i} 
                      className="w-1 bg-[#e7b923] rounded-full animate-wave"
                      style={{ 
                        height: `${Math.random() * 20 + 10}px`,
                        animationDelay: `${i * 0.1}s`
                      }}
                    ></div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-3xl font-light text-white tracking-tight">AI Design <span className="font-bold">Consultation</span></h3>
                <p className="text-[#e7b923] font-bold uppercase tracking-[0.3em] text-xs">Listening for your vision...</p>
              </div>

              <div className="flex gap-6 mt-8">
                <button className="p-6 bg-white/5 hover:bg-white/10 rounded-2xl text-white transition-all flex flex-col items-center gap-2">
                  <MicOff className="w-6 h-6 text-gray-500" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Mute</span>
                </button>
                <button className="p-6 bg-[#e7b923] hover:bg-[#e7b923]/90 rounded-2xl text-[#141414] transition-all flex flex-col items-center gap-2 shadow-xl shadow-[#e7b923]/20">
                  <Volume2 className="w-6 h-6" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Speaker</span>
                </button>
              </div>
            </div>

            <div className="absolute bottom-20 max-w-lg text-center">
              <p className="text-white/40 text-sm italic">"I'm looking for a minimalist oak dining table that seats eight..."</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Footer Context */}
      <footer className="px-6 md:px-20 py-4 border-t border-[#f3f0e7] bg-white/40 backdrop-blur-sm flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#f3f0e7] flex items-center justify-center overflow-hidden border border-[#f3f0e7]">
            <div 
              className="w-full h-full bg-center bg-cover" 
              style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuCLpXvfwf6d0Wm6i5tdoWHFPlE8IF6nGXaD1Ra6EKzCgzcJ-9lAEYE1RTlo-Vc6GNArkg9Nr-jvnwi4MBskjruYa7LYOrDlD8LDKvLB95gqcWOJDOnH3AgkjTK33ZAs2ZiwrxgejDmbA2rWhuiuYrnS3CdHkMWk8ZgB-zt_8Uw3HIOXB0ANhFQIqSDMDtZ8JzdutNNfY7SvaAIMoK7D-kT3-q5n9bER6yJdUhZDN6-9pIY5fS2BGjAO6Qfqh93cPTQLvy4Y_GShGh2w')" }}
            ></div>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Matching Context</p>
            <p className="text-xs font-bold text-gray-600">Eames-Style Velvet Sofa</p>
          </div>
        </div>
        <div className="hidden md:flex gap-6 items-center">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status: Active Design Session</span>
          <div className="flex gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#e7b923]"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-[#f3f0e7]"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-[#f3f0e7]"></div>
          </div>
        </div>
      </footer>
    </div>
  );
}
