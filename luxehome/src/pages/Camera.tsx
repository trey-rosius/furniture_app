import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';
import { X, Zap, Settings, Plus, Minus, Sparkles, Image as ImageIcon, Loader2, Check } from 'lucide-react';
import { analyzeFurnitureImage } from '../services/geminiService';

export default function Camera() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function startCamera() {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' } 
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error("Camera access error:", err);
        setError("Camera access denied. Please check your permissions.");
      }
    }

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current || isAnalyzing) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (context) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const base64Image = canvas.toDataURL('image/jpeg').split(',')[1];
      
      setIsAnalyzing(true);
      try {
        const results = await analyzeFurnitureImage(base64Image);
        // Store results in session storage or state management to pass to SearchResults
        sessionStorage.setItem('visualSearchResults', JSON.stringify(results));
        navigate('/search');
      } catch (err) {
        console.error("Analysis error:", err);
        setIsAnalyzing(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-[#141414] flex flex-col overflow-hidden">
      <canvas ref={canvasRef} className="hidden" />
      
      {/* Top Navigation Bar */}
      <header className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-8 py-6 bg-gradient-to-b from-black/40 to-transparent">
        <div className="flex items-center gap-4 text-white">
          <button 
            onClick={() => navigate(-1)}
            className="flex items-center justify-center rounded-full bg-white/10 backdrop-blur-md p-2 hover:bg-white/20 transition-all"
          >
            <X className="w-6 h-6" />
          </button>
          <h2 className="text-lg font-medium leading-tight tracking-tight">Visual Search</h2>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md text-white border border-white/20">
            <Zap className="w-5 h-5" />
          </button>
          <button className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md text-white border border-white/20">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Camera Viewport */}
      <main className="relative flex-1 bg-gray-900 overflow-hidden flex items-center justify-center">
        {error ? (
          <div className="text-white text-center p-10">
            <p className="text-xl font-light mb-4">{error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-[#e7b923] text-[#141414] font-bold rounded-full"
            >
              Retry
            </button>
          </div>
        ) : (
          <video 
            ref={videoRef}
            autoPlay 
            playsInline 
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        <div className="absolute inset-0 bg-black/20 pointer-events-none"></div>

        {/* Scanning Rectangle */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative z-10 w-72 h-72 md:w-96 md:h-96 border-[1.5px] border-white/40 rounded-xl bg-white/5 backdrop-blur-[1px]"
        >
          {/* Brushed Gold Corners */}
          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-[#e7b923] rounded-tl-lg"></div>
          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-[#e7b923] rounded-tr-lg"></div>
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-[#e7b923] rounded-bl-lg"></div>
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-[#e7b923] rounded-br-lg"></div>
          
          {/* Scanning Line */}
          <motion.div 
            animate={{ top: ['0%', '100%', '0%'] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
            className="absolute left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#e7b923]/50 to-transparent opacity-50 shadow-[0_0_15px_rgba(231,185,35,0.5)]"
          ></motion.div>

          {/* Focus Label */}
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 whitespace-nowrap bg-white/90 backdrop-blur-md px-4 py-1.5 rounded-full text-[12px] font-bold text-gray-600 tracking-widest uppercase">
            {isAnalyzing ? 'Analyzing Aesthetic...' : 'Aligning Object...'}
          </div>
        </motion.div>

        {/* Analysis Overlay */}
        <AnimatePresence>
          {isAnalyzing && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-white"
            >
              <Loader2 className="w-12 h-12 text-[#e7b923] animate-spin mb-6" />
              <h3 className="text-2xl font-light tracking-tight mb-2">Architectural <span className="font-bold">Analysis</span></h3>
              <p className="text-white/60 text-sm uppercase tracking-[0.3em]">Identifying materials & geometry</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Interface Controls */}
      <footer className="absolute bottom-0 left-0 right-0 z-20 pb-12 pt-8 px-10 bg-gradient-to-t from-black/60 via-black/30 to-transparent">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          {/* Gallery Button */}
          <div className="flex flex-col items-center gap-2 group cursor-pointer">
            <div className="h-14 w-14 rounded-xl border-2 border-white/30 overflow-hidden bg-white p-0.5 transition-transform active:scale-95">
              <div 
                className="w-full h-full bg-center bg-cover rounded-[0.8rem]"
                style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuC3czPzyQ8XennWDbM4rZNnsOCtUUGouXofrcNBusyb1CfIFm72cFxo9-ORcoe1S1RwN3GVOCGIq6mzlOh5k2BtcXJrlftBsstLVCLcorSAR7BVC154-Fy-vnq_O4O3bXHCFB7DNo7MetaqbJd2FlHCO6EH3Dc_6zH36XuwBZBh03kip25KmNBdupna78_3-3BgSsaHNOfbECXjPDw9NA8BzShHKHhqZOk1RbcOmno7pVkJJVI8eH8cWtoBS3IcVnzq1ksCTBqoJNhH')" }}
              ></div>
            </div>
            <span className="text-[11px] font-bold text-white uppercase tracking-widest opacity-80">Gallery</span>
          </div>

          {/* Shutter Button Container */}
          <div className="relative flex items-center justify-center">
            <button 
              onClick={handleCapture}
              disabled={isAnalyzing}
              className="relative h-20 w-20 rounded-full bg-white flex items-center justify-center p-1 transition-transform hover:scale-105 active:scale-90 disabled:opacity-50"
            >
              <div className="h-full w-full rounded-full border-2 border-[#e7b923] bg-transparent flex items-center justify-center">
                <div className="h-14 w-14 rounded-full bg-white border border-gray-200 flex items-center justify-center">
                  {isAnalyzing && <Loader2 className="w-6 h-6 text-[#e7b923] animate-spin" />}
                </div>
              </div>
            </button>
            <div className="absolute -top-12">
              <p className="text-white text-sm font-medium">Tap to identify</p>
            </div>
          </div>

          {/* Auto-Detect Toggle */}
          <div className="flex flex-col items-center gap-2">
            <button className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e7b923] text-[#141414] shadow-lg shadow-[#e7b923]/20 transition-colors">
              <Sparkles className="w-7 h-7" />
            </button>
            <span className="text-[11px] font-bold text-white uppercase tracking-widest opacity-80">Auto-Detect</span>
          </div>
        </div>

        {/* Bottom Tab Indicator */}
        <div className="mt-8 flex justify-center gap-8">
          <button className="text-white text-xs font-bold uppercase tracking-[0.2em] border-b-2 border-[#e7b923] pb-1">Furniture</button>
          <button className="text-white/40 text-xs font-bold uppercase tracking-[0.2em] pb-1 hover:text-white transition-colors">Decor</button>
          <button className="text-white/40 text-xs font-bold uppercase tracking-[0.2em] pb-1 hover:text-white transition-colors">Lighting</button>
        </div>
      </footer>

      {/* Side Zoom Control */}
      <div className="absolute right-6 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-6 py-4 px-2 rounded-full bg-black/20 backdrop-blur-md border border-white/10">
        <button className="text-white opacity-60 hover:opacity-100"><Plus className="w-5 h-5" /></button>
        <div className="h-32 w-0.5 bg-white/20 relative rounded-full">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-3 bg-white rounded-full shadow-lg"></div>
        </div>
        <button className="text-white opacity-60 hover:opacity-100"><Minus className="w-5 h-5" /></button>
      </div>
    </div>
  );
}
