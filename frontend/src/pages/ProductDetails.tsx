import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, ShoppingCart, Truck, ShieldCheck, View, X, ArrowRight, CreditCard, Check } from 'lucide-react';
import { useCart } from '../context/CartContext';

export default function ProductDetails() {
  const { addToCart } = useCart();
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedFinish, setSelectedFinish] = useState(0);
  const [isAdded, setIsAdded] = useState(false);

  const product = {
    id: 10,
    name: 'Svelto Modular Sofa',
    price: '$4,250.00',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBpJo5OweS6X1eNMffcT_zvkoMP4eLM2B6-uGzkqHDlrCXoQtfnQC8TnVpqE-5GBpaY9-boMpGOrq1MT9ZJaxVFgWO3iYBDyGMaZWYAa7w6cNbOImVfoQ_jcFCeoeH6uVQqi9UYI10UvoSYBBJFqbxsQ39mYskVnlGaZIcrF-3I7vECdAOEoxnJxGY796nlQZWGVMscUCrwRnptpCywLiwBGD3vMMXIW00pdhHROh4L-VOG_ViewRQIYiX46EsijBJttIXlF9muYU1y'
  };

  const finishes = [
    { name: 'Cloud', color: '#E5E4E2' },
    { name: 'Onyx', color: '#4A4A4A' },
    { name: 'Walnut', color: '#8B7D6B' }
  ];

  const handleAddToCart = () => {
    addToCart(product);
    setIsAdded(true);
    setTimeout(() => setIsAdded(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Image Section */}
        <div className="space-y-4">
          <nav className="flex items-center gap-2 text-xs uppercase tracking-widest text-gray-500 mb-6">
            <a href="#" className="hover:text-[#e7b923] transition-colors">Furniture</a>
            <span>/</span>
            <a href="#" className="hover:text-[#e7b923] transition-colors">Living Room</a>
            <span>/</span>
            <span className="text-gray-900 font-bold">{product.name}</span>
          </nav>
          
          <div className="relative group aspect-[4/5] rounded-xl overflow-hidden bg-gray-200">
            <div 
              className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
              style={{ backgroundImage: `url(${product.image})` }}
            ></div>
            <button className="absolute bottom-6 right-6 flex items-center gap-2 px-6 py-3 bg-white/90 backdrop-blur-md rounded-full text-gray-900 shadow-xl hover:bg-[#e7b923] hover:text-white transition-all group/ar">
              <View className="w-5 h-5 text-[#e7b923] group-hover/ar:text-white" />
              <span className="text-sm font-bold uppercase tracking-wider">View in AR</span>
            </button>
          </div>

          <div className="grid grid-cols-4 gap-4">
            {[
              'https://lh3.googleusercontent.com/aida-public/AB6AXuCeTvmVjrSIPDNXWmyVKCwnsXzCHRtDG5m7pW1JEvRmXf9BPiYUVFAzm1kQb-CVFCKjdFE0BdhLZUxk30Lne2pg5FEic48n63ERuJrxOWAAjVmxNQxfcjXUliSVPZ619KH37ku2dv75E36e-bkLO7NouKHhHneoea2o4qf6t0XjRCwMfMlcfUGitSJWdcGlu1xFrMZW3QvjcrDXFg6pB3oIDmTkOVXkLBnDylh8c_sPRhLARblg3y1G6FvYZcGGrosK9x35wN8mnfTj',
              'https://lh3.googleusercontent.com/aida-public/AB6AXuAOhIHUFPEhHrq4LArHsWUD_1dvxYm7ImthlqCx6cSXYKWGAbgiD2i5TkAZ_yJZqQZU2W7n9rO6BFv8XEL-JCa70pK7AHKKzD3LPs-VBR_hnsyYfxTbRvNZSvA1YL5-HogTM5KIQBBiHbuRF7j6Y1ZTVwKMOLtGbJj40zp9XN-v-PgeICzLV0Uyzjq44lOSx_bPB0KpoN0yVBo_0r6stBB9HKBL5wBQvwVL31K7-0PEBTussWxh6EL0FFUNfYFa6Ah713vwqKLMXUBK',
              'https://lh3.googleusercontent.com/aida-public/AB6AXuBSRcrdCPxjFzech4KVEqHvHdyrP42d_9uzhZjdToSThukw8gMw6tH71xSgy6b1-IpyguwX69SyReYGqExYcTMW5N_YAbNh_zB0fsJHUQRtXwdQLvTeCWm31_4WLTVRpQ0CcujEeufyvBRsQTh-PSpiA5RfvrucOGOBxCunmcP93gLQxHBabW6-siEw1X6c4WndGlRYYQpGTTA2wsee3vOEYeGGY7wPvLuIlD8i_BSmftgf7y46fFXQJ5cLpPFeuDXBLGOzD2b-9IFg'
            ].map((img, i) => (
              <div 
                key={i} 
                className={`aspect-square rounded-lg bg-cover bg-center cursor-pointer transition-all ${i === 0 ? 'border-2 border-[#e7b923]' : 'opacity-60 hover:opacity-100'}`}
                style={{ backgroundImage: `url(${img})` }}
              ></div>
            ))}
            <div className="aspect-square rounded-lg bg-gray-100 flex items-center justify-center text-gray-400">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
            </div>
          </div>
        </div>

        {/* Product Details */}
        <div className="flex flex-col justify-center">
          <div className="border-b border-[#e7b923]/10 pb-8 mb-8">
            <h1 className="text-5xl font-extrabold tracking-tight text-gray-900 mb-4 leading-tight">{product.name}</h1>
            <p className="text-xl text-gray-500 font-light leading-relaxed mb-6">An architectural silhouette draped in premium Belgian bouclé fabric. Designed for the minimalist modern home where comfort meets high-fidelity form.</p>
            <div className="flex items-center gap-4">
              <span className="text-3xl font-bold text-[#e7b923]">{product.price}</span>
              <span className="px-3 py-1 bg-[#e7b923]/10 text-[#e7b923] text-xs font-bold rounded-full uppercase tracking-tighter">In Stock</span>
            </div>
          </div>

          <div className="space-y-8">
            <div>
              <h4 className="text-xs uppercase tracking-[0.2em] font-bold text-gray-400 mb-4">Select Finish</h4>
              <div className="flex gap-4">
                {finishes.map((finish, i) => (
                  <button 
                    key={i}
                    onClick={() => setSelectedFinish(i)}
                    className={`w-12 h-12 rounded-full border-2 p-0.5 transition-all ${selectedFinish === i ? 'border-[#e7b923]' : 'border-transparent hover:border-[#e7b923]/50'}`}
                  >
                    <div className="w-full h-full rounded-full" style={{ backgroundColor: finish.color }}></div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button className="flex items-center justify-center gap-3 h-14 border border-[#e7b923] text-[#e7b923] rounded-xl font-bold uppercase tracking-widest hover:bg-[#e7b923]/5 transition-colors">
                <Heart className="w-5 h-5" />
                Save
              </button>
              <button 
                onClick={handleAddToCart}
                className={`flex items-center justify-center gap-3 h-14 rounded-xl font-bold uppercase tracking-widest shadow-lg transition-all ${isAdded ? 'bg-green-500 text-white shadow-green-500/20' : 'bg-[#e7b923] text-white shadow-[#e7b923]/20 hover:bg-[#e7b923]/90'}`}
              >
                {isAdded ? <Check className="w-5 h-5" /> : <ShoppingCart className="w-5 h-5" />}
                {isAdded ? 'Added' : 'Add to Bag'}
              </button>
            </div>

            <button 
              onClick={() => setShowCheckout(true)}
              className="w-full h-16 bg-gray-900 text-white rounded-xl font-bold uppercase tracking-[0.2em] shadow-2xl hover:bg-gray-800 transition-all flex items-center justify-center gap-3"
            >
              Buy Now
            </button>

            <div className="bg-[#e7b923]/5 p-6 rounded-xl border border-[#e7b923]/10 space-y-4">
              <div className="flex items-start gap-4">
                <Truck className="w-6 h-6 text-[#e7b923]" />
                <div>
                  <p className="text-sm font-bold">Complimentary White Glove Delivery</p>
                  <p className="text-xs text-gray-500">Includes professional assembly and packaging removal.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <ShieldCheck className="w-6 h-6 text-[#e7b923]" />
                <div>
                  <p className="text-sm font-bold">10-Year Frame Warranty</p>
                  <p className="text-xs text-gray-500">Crafted with kiln-dried solid oak and reinforced steel joins.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Checkout Modal */}
      <AnimatePresence>
        {showCheckout && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCheckout(false)}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
            ></motion.div>
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-white/20"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-[#e7b923] rounded-md flex items-center justify-center text-white">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <span className="font-bold text-gray-800">Secure Checkout</span>
                </div>
                <button onClick={() => setShowCheckout(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-3">
                  <button className="flex items-center justify-center h-12 bg-black rounded-lg hover:opacity-90 transition-opacity">
                    <span className="text-white font-bold">Apple Pay</span>
                  </button>
                  <button className="flex items-center justify-center h-12 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                    <span className="text-gray-800 font-bold">Google Pay</span>
                  </button>
                </div>

                <div className="relative flex items-center py-2">
                  <div className="flex-grow border-t border-gray-100"></div>
                  <span className="flex-shrink mx-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Or pay by card</span>
                  <div className="flex-grow border-t border-gray-100"></div>
                </div>

                <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Email Address</label>
                    <input 
                      type="email" 
                      className="w-full h-12 px-4 bg-gray-50 border-transparent rounded-lg focus:bg-white focus:border-[#e7b923] focus:ring-0 text-sm transition-all" 
                      placeholder="alex@aurum.com" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Card Information</label>
                    <div className="flex flex-col border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-200">
                      <div className="relative">
                        <input className="w-full h-12 px-4 border-none focus:ring-0 text-sm" placeholder="Card number" />
                        <CreditCard className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300" />
                      </div>
                      <div className="flex divide-x divide-gray-200">
                        <input className="w-1/2 h-12 px-4 border-none focus:ring-0 text-sm" placeholder="MM / YY" />
                        <input className="w-1/2 h-12 px-4 border-none focus:ring-0 text-sm" placeholder="CVC" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="checkbox" id="save-card" className="rounded text-[#e7b923] focus:ring-[#e7b923] h-4 w-4 border-gray-300" />
                    <label htmlFor="save-card" className="text-xs text-gray-500 font-medium">Save card for future premium purchases</label>
                  </div>
                  <button className="w-full h-14 bg-[#e7b923] text-white font-bold rounded-xl shadow-xl shadow-[#e7b923]/30 hover:shadow-[#e7b923]/40 transition-all flex items-center justify-between px-6 mt-4">
                    <span>Pay {product.price}</span>
                    <ArrowRight className="w-5 h-5" />
                  </button>
                </form>
              </div>

              <div className="px-6 py-4 bg-gray-50 text-center">
                <p className="text-[10px] text-gray-400 uppercase tracking-widest leading-loose">
                  Your transaction is encrypted with 256-bit SSL security.<br/>
                  LUXEHOME does not store complete card details.
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
