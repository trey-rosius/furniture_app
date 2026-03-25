import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { ArrowRight, Heart, Sparkles, Camera } from "lucide-react";

const trendingCollections = [
  {
    id: 1,
    title: "The Oatmeal Series",
    category: "Signature",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuAxkKvloUdFRSRlOEEFyKVEGpECtEI_giGNXyv2fq41WzLX5TJoNIAXL3Zu8gst8vXK-ifhC8PL1jeCrMRKa9yrCwp-jnmL6D9VPLw6ZSeb26eF-dzaZcg1pRAu4te1QW0Q44wSJdiw3k7BDBLpw4neNRAyJ6nyaJ07PFCs71e7-x8-vE3d8kvxxR92lql4xcM8FqbCXAX0_O8PYV2i63MV-3uKLFhkXHSiphPagdh5yLZ4nshCjGXOPGu4gr7E81EYbote0Mj5uYvq",
  },
  {
    id: 2,
    title: "Slate Modernism",
    category: "Essential",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuB4Lamfbv8OcZrRJ9wTLn3LbQh8YQVRi8Q6fWigJa8OMEQ-N1KhsdLMtx3BQsjuwxA60zV_MFw7TzZg5_d_UAXcvnsyvRrSCbt59DjgJVYLFH-X_MSw9UtC5wC2rGzPxKMgXbizouBSDfe7i60el4k8m2EWGutNXJO99Guqdydlx8qv7dAEAzYbuX_d5jZYVxafS_iDofcyNK0BCv9LVyRcCfPjhqpzOvUmthmtc33zF5JInkoo8_XV9_MTZqMQhp2GYKg-6diUzqXD",
  },
  {
    id: 3,
    title: "Brushed Gold Accents",
    category: "Luxe",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuB59QEN6k8plyVoYl0nWnJjS-ieZTvkN1ocYTt4fwuAig1nMhkgW7JosMHTo0rah3405muUsknQbI8JkZWhHD1OVkSCo2FNu9qA0Nu_cI3tNBOg-45GrilDKmC4x8AYUXqAjsZ8z_ALmPwSJiF1nhrpio5hH7PvzKp1IndJKwCEPxw72IDxzwd4ELKYwxkv-mtVR1nG_6-G7CIlWI1v9wd3Jp2RZjidTOl0HJaAWZpmvqrB8lXyUt4p3tk8lQyseIJdAGhj_AdjkSa7",
  },
];

const newArrivals = [
  {
    id: 1,
    name: "Nordic Shell Chair",
    material: "Natural Ash Wood",
    price: "$890",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuCis5MZ5BogyxcskWE6JP2f0K9HgYzdOhgUhteyb4KyfxbiECczqui9IcVWAu_5fX-fxVFktXo3VIYOTh5xpGsX89fUd4XEGqtvRPe79jPe62tDVrzZu9k6bDLgDmgMK0VQtV4edgXCkMkS033Gs1GMStOMjJ3wW9HLxc0tMqkJqOuN6UjCzu-i2yVZEBbj6BDhHGHbPlk9L_EdhcmQjjkzPYQTSB3DHRU4hvIBI8jtioW_0GymcEH1MW7zKBiPPtysQ7b_J5CAx0oZ",
  },
  {
    id: 2,
    name: "Halo Pendant Light",
    material: "Brushed Brass",
    price: "$1,250",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuApZbJKzBiQW5qz9QkXwR7GT8RvtH_nZzgo0PO-92DL4bRj8HcLRX1kN8QdDvem55roTPzrDDh_AMoc5RLpmSfex_e1uDST4bm1T5evWbi2SDGdlf44LEiyfH_xE7bbK89nIxt2Ioan514a7JObfNUC6ulOO_Gt7ygkdU4it2EoiaKuWn2BvBqwhXMw7MTQ-REnhROsQNGchTSAYHy9aptjziQvuhLEuH6VbzCK_fN7taWQz6VNPilnGh4GbqOg6mbx3jprZnrCU9rw",
  },
  {
    id: 3,
    name: "Baze Lounge Chair",
    material: "Slate Felt",
    price: "$1,420",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuCgqiENdOzj4blKd3Fx6mlLUBw17CI_xi6j9WkeXORdT2OXd9m2mqsG8SRcjAQqdXFIoAkNDdljrxsFtFsqmgP840IVjVIg8GnHq1y2cKsknAKvYGzcVbYNZKLY4n7hPjlhRBxzWqG4Hm5PjDcpiw4Odn_ApcpGojoZHpcEsTlrxtlPTU1STRj52kANzlDFhStIl9Hl4DNHXMG3pI_trP6mCBsl2Tl0yk0XrCxLiPKNSfwg4C2Y0qjig5vbnG4808E-o4PK66l514o_",
  },
  {
    id: 4,
    name: "Tessellation Coffee Table",
    material: "Travertine Stone",
    price: "$2,100",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuA2qQuKGfQae2UQ1qHRvyl4nJBOOMEGkEf-MqLZGtP_8-Un11mRGndjPKt7dZQpSrueEwQWjG7xRtNr-3F6IEBV2jp6haTr3Mt1rJbkLPSXV4veBf_VXiR9fGGexYWdjUfteV4ynCoCxDPEux-t2FlxIpxa44SiSJSQ9POS9Ci8GUByPP2qXW_urIzE6ehGvrpbYg97Zax0XSKC5yEp-vH_1R77H08pUe6IWEN5sC7vFoKDfk6gGlgdkltOuI4rF59Nn6qE27uSJH9O",
  },
];

export default function Home() {
  return (
    <div className="pb-20">
      {/* Hero Section */}
      <section className="px-6 md:px-10 py-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="flex flex-col gap-8"
          >
            <div className="space-y-4">
              <span className="text-[#e7b923] font-bold tracking-[0.2em] uppercase text-xs">
                Summer 2024 Collection
              </span>
              <h1 className="text-5xl md:text-7xl font-extralight leading-[1.1] tracking-tight font-serif">
                Architectural{" "}
                <span className="italic font-normal">Elegance</span> for Modern
                Living
              </h1>
              <p className="text-gray-500 text-lg max-w-md font-light leading-relaxed">
                Experience curated minimalist furniture designed for
                sophisticated, high-fidelity living spaces.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Link
                to="/search"
                className="bg-[#e7b923] text-[#141414] px-8 py-4 rounded-lg font-bold text-sm tracking-widest uppercase hover:bg-[#e7b923]/90 transition-all shadow-lg shadow-[#e7b923]/20"
              >
                Shop Collection
              </Link>
              <Link
                to="/chat"
                className="bg-[#141414] text-white px-8 py-4 rounded-lg font-bold text-sm tracking-widest uppercase hover:bg-gray-800 transition-all flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-[#e7b923]" />
                Chat with AI
              </Link>
            </div>
            <div className="flex items-center gap-8 pt-4 border-t border-[#f3f0e7]">
              <div>
                <p className="text-2xl font-bold">12k+</p>
                <p className="text-xs text-gray-500 uppercase tracking-widest">
                  Designs
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold">4.9</p>
                <p className="text-xs text-gray-500 uppercase tracking-widest">
                  Rating
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold">24h</p>
                <p className="text-xs text-gray-500 uppercase tracking-widest">
                  Delivery
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            className="relative group"
          >
            <div className="absolute -inset-4 bg-[#e7b923]/5 rounded-2xl -z-10 blur-2xl group-hover:bg-[#e7b923]/10 transition-colors"></div>
            <div
              className="w-full aspect-[4/5] bg-cover bg-center rounded-2xl shadow-2xl transition-transform duration-700 hover:scale-[1.01]"
              style={{
                backgroundImage:
                  'url("https://lh3.googleusercontent.com/aida-public/AB6AXuBmouXSdMonbIblNodW5aNQ-s6qxaEu4s3V7QZQlajIXpFs8DEWBCt1mxXkg2GM2EYR06HIc8fqZdYNEgztE1sc16FsCGQPE2k1GdJL8ozxjBDV43uyH9FPzMrBxSjwI2jAqs6lw6GhsOdzDWV3QDaVczrWxmbUmWahei8W8HQA3El0IddlJXH4k78T9mHDjpDWvfI9jRAcUcCkrU7fo3ML4hL1rLaDKRvNNQyEfvreCxUb-rtksmGTi988xv7FQsuR1k5r9YkxpP5b")',
              }}
            ></div>
            <div className="absolute bottom-6 left-6 right-6 bg-white/80 backdrop-blur-lg p-6 rounded-xl border border-white/20">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-[#e7b923] uppercase tracking-widest">
                    Featured Piece
                  </p>
                  <p className="text-lg font-semibold">
                    The Marfa Sculptural Sofa
                  </p>
                </div>
                <p className="text-xl font-bold">$4,250</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Trending Collections */}
      <section className="px-6 md:px-10 py-20 bg-[#f3f0e7]/30">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-end mb-12">
            <div className="space-y-2">
              <h2 className="text-3xl font-light font-serif">
                Trending Collections
              </h2>
              <p className="text-gray-500 text-sm uppercase tracking-widest">
                Curated by our top architects
              </p>
            </div>
            <Link
              to="/search"
              className="text-[#e7b923] font-bold text-sm tracking-widest uppercase border-b-2 border-[#e7b923] pb-1"
            >
              Explore All
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {trendingCollections.map((collection) => (
              <motion.div
                key={collection.id}
                whileHover={{ y: -10 }}
                className="group cursor-pointer"
              >
                <div className="relative overflow-hidden rounded-xl aspect-[3/4] mb-4">
                  <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors z-10"></div>
                  <div
                    className="w-full h-full bg-cover bg-center transition-transform duration-1000 group-hover:scale-110"
                    style={{ backgroundImage: `url(${collection.image})` }}
                  ></div>
                  <div className="absolute bottom-0 left-0 p-8 z-20 text-white w-full translate-y-4 group-hover:translate-y-0 transition-transform">
                    <p className="text-xs font-bold uppercase tracking-widest opacity-80 mb-2">
                      {collection.category}
                    </p>
                    <h3 className="text-2xl font-light font-serif">
                      {collection.title}
                    </h3>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* New Arrivals */}
      <section className="px-6 md:px-10 py-20 max-w-7xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl font-light font-serif">New Arrivals</h2>
          <div className="flex justify-center gap-8 text-xs font-bold uppercase tracking-widest text-gray-400">
            <span className="text-[#e7b923] cursor-pointer border-b border-[#e7b923]">
              All
            </span>
            <span className="hover:text-[#141414] cursor-pointer transition-colors">
              Tables
            </span>
            <span className="hover:text-[#141414] cursor-pointer transition-colors">
              Chairs
            </span>
            <span className="hover:text-[#141414] cursor-pointer transition-colors">
              Lighting
            </span>
            <span className="hover:text-[#141414] cursor-pointer transition-colors">
              Storage
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-10">
          {newArrivals.map((product) => (
            <Link
              key={product.id}
              to={`/product/${product.id}`}
              className="group"
            >
              <div className="relative overflow-hidden rounded-lg aspect-square mb-4 bg-[#f3f0e7] flex items-center justify-center p-8">
                <img
                  src={product.image}
                  alt={product.name}
                  className="max-h-full object-contain group-hover:scale-105 transition-transform duration-500"
                  referrerPolicy="no-referrer"
                />
                <button className="absolute top-4 right-4 text-gray-400 hover:text-[#e7b923] transition-colors">
                  <Heart className="w-5 h-5" />
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-[#141414] text-white py-3 text-xs font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity text-center">
                  Add to Cart
                </div>
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">{product.name}</h4>
                <p className="text-xs text-gray-500">{product.material}</p>
                <p className="text-[#e7b923] font-bold pt-1">{product.price}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* AI Design Agent Floating Button */}
      {/* Floating Buttons Container */}
      <div className="fixed bottom-8 right-8 z-[100] flex flex-col gap-4 items-end">
        {/* Visual Search Button */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 }}
        >
          <Link
            to="/camera"
            className="flex items-center justify-center w-14 h-14 bg-[#e7b923] text-[#141414] rounded-full shadow-2xl hover:scale-110 transition-all group relative border-4 border-white"
          >
            <div className="absolute inset-0 rounded-full bg-white/20 animate-ping group-hover:hidden"></div>
            <Camera className="w-6 h-6" />
            <div className="absolute right-full mr-4 px-3 py-1 bg-[#141414] text-white text-[10px] font-bold uppercase tracking-widest rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              Visual Search
            </div>
          </Link>
        </motion.div>

        {/* AI Design Agent Button */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.7 }}
        >
          <Link
            to="/chat"
            className="flex items-center gap-3 bg-[#141414] text-white px-6 py-4 rounded-full shadow-2xl hover:scale-105 transition-all group relative"
          >
            <div className="absolute inset-0 rounded-full bg-[#e7b923]/20 animate-pulse group-hover:animate-none"></div>
            <div className="absolute -inset-1 rounded-full bg-[#e7b923]/10 blur-md group-hover:bg-[#e7b923]/20 transition-all"></div>
            <Sparkles className="w-5 h-5 text-[#e7b923]" />
            <span className="text-sm font-bold tracking-tight">
              AI Design Agent
            </span>
            <div className="h-2 w-2 rounded-full bg-[#e7b923] animate-bounce"></div>
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
