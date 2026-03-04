import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  Filter,
  Plus,
  ArrowLeftRight,
  Loader2,
  Image as ImageIcon,
} from "lucide-react";
import PresignedImage from "../components/PresignedImage";

const defaultResults = [
  {
    id: 1,
    name: "Heritage Lounge Chair",
    material: "Natural Oak & Obsidian Leather",
    price: "$3,850.00",
    match: "98%",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuA9vmisL-EtpHJEkivf9ne79o1lc7MemxArvYwehUPJq4doxux1XB3Jqxcgi8xfRzbCu4zIlMA1WhoeEWeiF15HKZaOufC2f4zBRjdIZ_Q4nAF1iRuMzxO56k8N4HWPxoqInJRXWqr7gUJE3kUI1euGNcL7mCZWmuv_-ixleqyLvMpp6SP2A7Sk8gAvmIY-_MQmpTXIwkXnUGJSfGmzb0Kb9ogIP3me8hmgk7081-bCloX3h-_hKg-sK6fWDaKBvK41ixOuzWWpIS9d",
  },
  {
    id: 2,
    name: "Nordic Contour Stool",
    material: "Smoked Ash Wood",
    price: "$1,200.00",
    match: "95%",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuCUsMGRKjKdw7p1FShkWjHbnkNhvS7QCcge6T1HwlkYkrRJUxAoNzzlCUZNs9Mwi4Ruh9YNLHeZl9RDeunhN2E15JwbpVB3bXVMaKyd28yvetdxA5oGPlB5lIjFNYez6XDG6sFLFZCgZ3a047ImqXDzwNePsdKRroVNXmUhj92KoJeLNHL-dXNF-akBpt6nzNsG1mSIAmbrRGok3jmuZ0r5gvA705GnyQTNVEJzLinvI0kfdEwLd8Ice0lzigR5YPLpsjY-vtfucgk1",
  },
  {
    id: 3,
    name: "Metropolis Armchair",
    material: "Brushed Steel & Canvas",
    price: "$2,450.00",
    match: "92%",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuBfuhQqnXwqngXdGEosF0IS98M_qVZUkias6zoCJnXoGI5bISrJMcyiKjLQ0OiN5JJfWR-HXlgkzSLEjU1CXCaFARV21oTHXBVu3zZ9ah_ubFWnkn4OOhac9ceX0aSCnd38r41_hDu9EMiY_Q-pBDiltbW1WNvBOK3frX_OuBV9xQKWEYr1g1Jg0qzQNgAJBwNPlWLyuGSzFJH4yqSIpgsRR-iSrMERMsMrvzIP_5B1rPtrXZ1JmJc1XFCI9NvKWx7p1nIzofIfKY7F",
  },
];

export default function SearchResults() {
  const [results, setResults] = useState<any[]>([]);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = sessionStorage.getItem("visualSearchResults");
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setSourceKey(data.sourceKey);

        if (data.recommendations && data.recommendations.length > 0) {
          const mapped = data.recommendations.map((item: any, idx: number) => ({
            id: item.PK || 100 + idx,
            name: item.productName || item.name,
            material: item.subCategory || item.material || item.category,
            price:
              typeof item.price === "number"
                ? `$${item.price.toLocaleString()}`
                : item.price || "$0.00",
            match: item.matchPercentage || `${95 - idx}%`,
            image: item.image_uri || item.imageFile,
          }));
          setResults(mapped);
          setAnalysis(data.analysis);
        } else {
          setResults(defaultResults);
        }
      } catch (e) {
        console.error("Error parsing visual search results", e);
        setResults(defaultResults);
      }
    } else {
      setResults(defaultResults);
    }
    setLoading(false);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 py-10">
      {/* Breadcrumbs & Header */}
      <div className="mb-12">
        <nav className="flex items-center gap-2 text-xs uppercase tracking-widest text-gray-500 mb-6">
          <Link to="/" className="hover:text-[#e7b923]">
            Home
          </Link>
          <ChevronRight className="w-3 h-3" />
          <Link to="/camera" className="hover:text-[#e7b923]">
            Visual Search
          </Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-[#e7b923] font-bold">Analysis Results</span>
        </nav>

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-2xl">
            <h1 className="text-4xl md:text-5xl font-light tracking-tight mb-4">
              Search <span className="font-bold">Results</span>
            </h1>
            <p className="text-gray-500 text-lg">
              {analysis ||
                "AI-curated selections inspired by your uploaded imagery. We found architectural pieces matching your aesthetic."}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl border-2 border-[#e7b923]/30 p-1 bg-white shadow-xl overflow-hidden group">
              {sourceKey ? (
                <PresignedImage
                  uri={sourceKey}
                  alt="Source"
                  className="w-full h-full object-cover rounded-lg group-hover:scale-110 transition-transform duration-500"
                />
              ) : (
                <div className="w-full h-full bg-gray-100 flex items-center justify-center rounded-lg">
                  <ImageIcon className="w-6 h-6 text-gray-300" />
                </div>
              )}
            </div>
            <span className="text-xs font-bold uppercase tracking-tight text-gray-500">
              Source
              <br />
              Image
            </span>
          </div>
        </div>
      </div>

      {/* Filters Section */}
      <div className="flex flex-wrap items-center justify-between gap-4 py-6 border-y border-[#f3f0e7] mb-10">
        <div className="flex flex-wrap gap-2">
          {["Category", "Material", "Price Range"].map((filter) => (
            <button
              key={filter}
              className="px-5 py-2 rounded-full border border-[#f3f0e7] bg-white text-sm font-medium flex items-center gap-2 hover:border-[#e7b923] transition-all"
            >
              {filter} <ChevronRight className="w-4 h-4 rotate-90" />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500 hidden sm:block">
            Sort by:
          </span>
          <button className="px-5 py-2 rounded-full bg-[#e7b923] text-[#141414] text-sm font-bold flex items-center gap-2 shadow-lg shadow-[#e7b923]/20">
            Highest Match <ArrowLeftRight className="w-4 h-4 rotate-90" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 grayscale opacity-50">
          <Loader2 className="w-12 h-12 text-[#e7b923] animate-spin mb-4" />
          <p className="text-sm font-bold uppercase tracking-widest text-gray-400">
            Loading your aesthetic match...
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-8 gap-y-12">
          {results.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="group cursor-pointer"
            >
              <Link to={`/product/${item.id}`}>
                <div className="relative aspect-[3/4] bg-[#f3f0e7] rounded-xl overflow-hidden mb-5">
                  <PresignedImage
                    uri={item.image}
                    alt={item.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  />
                  <div className="absolute top-4 left-4 bg-[#f3f0e7]/90 backdrop-blur text-[#e7b923] text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest border border-[#e7b923]/20">
                    {item.match} Match
                  </div>
                  <button className="absolute bottom-4 right-4 w-10 h-10 bg-white/90 backdrop-blur rounded-full flex items-center justify-center opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-medium leading-tight group-hover:text-[#e7b923] transition-colors line-clamp-2">
                    {item.name}
                  </h3>
                  <p className="text-gray-500 text-sm font-light uppercase tracking-wide">
                    {item.material}
                  </p>
                  <p className="text-gray-900 font-semibold pt-1">
                    {item.price}
                  </p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}

      {/* Pagination/Footer Actions */}
      <div className="mt-20 flex flex-col items-center gap-6">
        <button className="px-12 py-4 bg-[#141414] text-white font-bold rounded-lg hover:bg-[#e7b923] hover:text-[#141414] transition-all uppercase tracking-widest text-sm shadow-xl">
          Load More Discoveries
        </button>
        <p className="text-gray-500 text-xs uppercase tracking-[0.3em]">
          Showing {results.length} results
        </p>
      </div>
    </div>
  );
}
