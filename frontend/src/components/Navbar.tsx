import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ShoppingBag, User, Menu } from 'lucide-react';
import { useCart } from '../context/CartContext';

export default function Navbar() {
  const { cartCount } = useCart();
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-[#f8f8f6]/80 backdrop-blur-md border-b border-[#f3f0e7] px-6 md:px-10 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-12">
          <Link to="/" className="flex items-center gap-2">
            <div className="text-[#e7b923]">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <h1 className="text-xl font-black tracking-tighter uppercase">LuxeHome</h1>
          </Link>
          <nav className="hidden lg:flex items-center gap-8">
            <Link to="/" className="text-sm font-semibold hover:text-[#e7b923] transition-colors">Collections</Link>
            <Link to="/" className="text-sm font-semibold hover:text-[#e7b923] transition-colors">Living</Link>
            <Link to="/" className="text-sm font-semibold hover:text-[#e7b923] transition-colors">Bedroom</Link>
            <Link to="/" className="text-sm font-semibold hover:text-[#e7b923] transition-colors">Dining</Link>
            <Link to="/chat" className="text-sm font-semibold hover:text-[#e7b923] transition-colors">AI Agent</Link>
          </nav>
        </div>

        <div className="flex items-center gap-6">
          <form onSubmit={handleSearch} className="hidden md:flex relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search architectural pieces..." 
              className="pl-10 pr-4 py-2 bg-[#f3f0e7] border-none rounded-full text-sm w-64 focus:ring-2 focus:ring-[#e7b923]/50 transition-all"
            />
          </form>
          <div className="flex items-center gap-3">
            <button className="p-2 hover:bg-[#f3f0e7] rounded-full transition-colors">
              <User className="w-5 h-5" />
            </button>
            <button className="p-2 hover:bg-[#f3f0e7] rounded-full transition-colors relative">
              <ShoppingBag className="w-5 h-5" />
              {cartCount > 0 && (
                <span className="absolute top-0 right-0 w-4 h-4 bg-[#e7b923] text-[#141414] text-[10px] font-bold flex items-center justify-center rounded-full border border-[#f8f8f6]">
                  {cartCount}
                </span>
              )}
            </button>
            <button className="lg:hidden p-2 hover:bg-[#f3f0e7] rounded-full transition-colors">
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
