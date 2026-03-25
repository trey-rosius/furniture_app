import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="bg-[#141414] text-gray-400 px-6 md:px-10 py-16">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 border-b border-gray-800 pb-16">
          <div className="space-y-6">
            <div className="flex items-center gap-2 text-white">
              <svg className="w-6 h-6 text-[#e7b923]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              <h2 className="text-lg font-bold uppercase tracking-widest">LuxeHome</h2>
            </div>
            <p className="text-sm leading-relaxed">
              Elevating the concept of home through architectural precision and minimalist design. Based in Stockholm, shipping globally.
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-white text-sm font-bold uppercase tracking-widest">Shop</h4>
            <ul className="text-sm space-y-2">
              <li><Link to="/" className="hover:text-[#e7b923]">New Arrivals</Link></li>
              <li><Link to="/" className="hover:text-[#e7b923]">Best Sellers</Link></li>
              <li><Link to="/" className="hover:text-[#e7b923]">Living Room</Link></li>
              <li><Link to="/" className="hover:text-[#e7b923]">Bedroom</Link></li>
            </ul>
          </div>

          <div className="space-y-4">
            <h4 className="text-white text-sm font-bold uppercase tracking-widest">About</h4>
            <ul className="text-sm space-y-2">
              <li><Link to="/" className="hover:text-[#e7b923]">Our Story</Link></li>
              <li><Link to="/" className="hover:text-[#e7b923]">Sustainability</Link></li>
              <li><Link to="/" className="hover:text-[#e7b923]">Architect Program</Link></li>
              <li><Link to="/" className="hover:text-[#e7b923]">Careers</Link></li>
            </ul>
          </div>

          <div className="space-y-6">
            <h4 className="text-white text-sm font-bold uppercase tracking-widest">Newsletter</h4>
            <p className="text-xs">Join for exclusive early access to our seasonal collections.</p>
            <div className="flex">
              <input 
                type="email" 
                placeholder="Email Address" 
                className="bg-gray-800 border-none text-xs w-full focus:ring-1 focus:ring-[#e7b923] rounded-l-lg"
              />
              <button className="bg-[#e7b923] text-[#141414] px-4 py-2 text-xs font-bold rounded-r-lg">Join</button>
            </div>
          </div>
        </div>

        <div className="pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] uppercase tracking-widest font-bold">
          <p>© 2024 LUXEHOME INTERNATIONAL. ALL RIGHTS RESERVED.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white">Instagram</a>
            <a href="#" className="hover:text-white">Pinterest</a>
            <a href="#" className="hover:text-white">Twitter</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
