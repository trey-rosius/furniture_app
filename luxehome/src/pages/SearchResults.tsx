import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { ChevronRight, Filter, Plus, ArrowLeftRight, Loader2 } from 'lucide-react';

const defaultResults = [
  {
    id: 1,
    name: 'Heritage Lounge Chair',
    material: 'Natural Oak & Obsidian Leather',
    price: '$3,850.00',
    match: '98%',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA9vmisL-EtpHJEkivf9ne79o1lc7MemxArvYwehUPJq4doxux1XB3Jqxcgi8xfRzbCu4zIlMA1WhoeEWeiF15HKZaOufC2f4zBRjdIZ_Q4nAF1iRuMzxO56k8N4HWPxoqInJRXWqr7gUJE3kUI1euGNcL7mCZWmuv_-ixleqyLvMpp6SP2A7Sk8gAvmIY-_MQmpTXIwkXnUGJSfGmzb0Kb9ogIP3me8hmgk7081-bCloX3h-_hKg-sK6fWDaKBvK41ixOuzWWpIS9d'
  },
  {
    id: 2,
    name: 'Nordic Contour Stool',
    material: 'Smoked Ash Wood',
    price: '$1,200.00',
    match: '95%',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCUsMGRKjKdw7p1FShkWjHbnkNhvS7QCcge6T1HwlkYkrRJUxAoNzzlCUZNs9Mwi4Ruh9YNLHeZl9RDeunhN2E15JwbpVB3bXVMaKyd28yvetdxA5oGPlB5lIjFNYez6XDG6sFLFZCgZ3a047ImqXDzwNePsdKRroVNXmUhj92KoJeLNHL-dXNF-akBpt6nzNsG1mSIAmbrRGok3jmuZ0r5gvA705GnyQTNVEJzLinvI0kfdEwLd8Ice0lzigR5YPLpsjY-vtfucgk1'
  },
  {
    id: 3,
    name: 'Metropolis Armchair',
    material: 'Brushed Steel & Canvas',
    price: '$2,450.00',
    match: '92%',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBfuhQqnXwqngXdGEosF0IS98M_qVZUkias6zoCJnXoGI5bISrJMcyiKjLQ0OiN5JJfWR-HXlgkzSLEjU1CXCaFARV21oTHXBVu3zZ9ah_ubFWnkn4OOhac9ceX0aSCnd38r41_hDu9EMiY_Q-pBDiltbW1WNvBOK3frX_OuBV9xQKWEYr1g1Jg0qzQNgAJBwNPlWLyuGSzFJH4yqSIpgsRR-iSrMERMsMrvzIP_5B1rPtrXZ1JmJc1XFCI9NvKWx7p1nIzofIfKY7F'
  },
  {
    id: 4,
    name: 'Silhouette Daybed',
    material: 'Polished Chrome & Calfskin',
    price: '$6,200.00',
    match: '89%',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuACniMsHAja3H9-CPD323IeZw20VOAxmYsT8-oj2eqTWcCM47Tk8Fpu4FUOp0I1OBZBDGXPwYcs6fzq5ectMDg8RKktZQajhkKOvFrYk8rAfKEt-QZqUv7kM4sILFHXbsL2sx36g-aDIcwEGPmV4hXxrCqhx1vLo7EDnJIT479t3ehktLFy7uUDbHt5Afyx_-UMWmcAKMR-O_LR1OV_d2KwQ3P0zTUv1FH5k715d-XLSABA4N8xiapDPG39A4vERq_E_Nazf1w8NpKY'
  },
  {
    id: 5,
    name: 'Zenith Dining Chair',
    material: 'Walnut Wood',
    price: '$850.00',
    match: '85%',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCV64uG2GdElpQ5GnfwUZK0weE6lcV1hej9IFp_AEIybxJ_IlVFVsFJJWYfMyNjn5h2NB4_oTPKQsuGtf1ZhYlJiT10YjCrY94AMSQh784l7jkbLHc7EmzGBQ3ffDSk29YyiorKJAb00vQbW91bbDhRRgKm6uJl364rOfKtK3Jmev8dNMGVLLuMrGhrelDmv4_qbVf_Cfa9ebzCRhM_WAu56-H8nrSEUxfdxx5G3RmHHG72lmcjopbK5rOiopJEzrLnnVmVzU1NaWYv'
  },
  {
    id: 6,
    name: 'Eclipse Arch Lamp',
    material: 'Matte Onyx Finish',
    price: '$1,100.00',
    match: '82%',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBq5gn-5wXQySVi8HTzSnYSNE9_MiFdlqK5D4aJnCvpvSAkt2qRBClDIdkv8ze25h-NRmGodbIhlyi7CobZBLCPyJE2V9IqsWeUfuIOkwG1VjMp7XRt6zUKnn8s2WgcXhdooqf1giIylI58G7RLG3tn5A_FovTjogx9k320iQdcfn3vU4ajPKdV5nKYoAnyZKd0a2edftl2RXWaOF58Bgc98FinClRIbXhPjPIveXjPdoXLnqoVzvlTcbJHF-389t-RzcZSRRQrxFhg'
  },
  {
    id: 7,
    name: 'Verdant Lounge',
    material: 'Forest Velvet & Brass',
    price: '$1,950.00',
    match: '78%',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB6rgWuRkScVucU0mrzGSXUIXqRkorPIpQd6-oa13AT27os5lUoWH_OyFijDb0HdV1hZR1xbs5HAeT-1Ei66X2tmd3Ls7IXSqwdhV87N9zqXvri-5QzFvY7yp93gUJLmxuhC9udbRgtqy1wv-UgxBnJCxzimwfDqV-P_h9LflhUZ5yVCOnqKofx_ZxzCqrqKtwjF_ST1UPscbF96ELVvakcbr3RPxdxQeDiSe394XV-Ych56hMEytzuwnar6G0YdmYs3j1Hf4lcAHEc'
  },
  {
    id: 8,
    name: 'Monolith Modular Sofa',
    material: 'Heather Grey Linen',
    price: '$5,800.00',
    match: '75%',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAV7D9nAkZ9cClBzCOZ7pO9t2U7FVz4ka51WD0CfHO82SgViZXo8zpDNIqYi1dTBk4qTFBc4cY4NubpO359indY0nTq4lJfI_tDttu173GEE5NNkgR42I5DETLMOHdiUjG51-lBHwyfwXi0NN8hoi54lVnNHc0h65ZfV-pHUoaxcGM7Bgv0hpuoawi588FDaKY3-0Ar8-gNE143YYuuWYexBlLQqQmqUKMs5_0UDUkyvlWNzWUOHqv4RpiCnQRKpteXw0sa0vBzgsQy'
  }
];

export default function SearchResults() {
  const [results, setResults] = useState(defaultResults);
  const [analysis, setAnalysis] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem('visualSearchResults');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.recommendations) {
          const mapped = data.recommendations.map((item: any, idx: number) => ({
            id: 100 + idx,
            name: item.name,
            material: item.material,
            price: item.price,
            match: item.matchPercentage || '95%',
            image: defaultResults[idx % defaultResults.length].image // Use existing images for visual demo
          }));
          setResults(mapped);
          setAnalysis(data.analysis);
        }
      } catch (e) {
        console.error("Error parsing visual search results", e);
      }
    }
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 py-10">
      {/* Breadcrumbs & Header */}
      <div className="mb-12">
        <nav className="flex items-center gap-2 text-xs uppercase tracking-widest text-gray-500 mb-6">
          <Link to="/" className="hover:text-[#e7b923]">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <Link to="/camera" className="hover:text-[#e7b923]">Visual Search</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-[#e7b923] font-bold">Analysis Results</span>
        </nav>
        
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-2xl">
            <h1 className="text-4xl md:text-5xl font-light tracking-tight mb-4">Search <span className="font-bold">Results</span></h1>
            <p className="text-gray-500 text-lg">
              {analysis || "AI-curated selections inspired by your uploaded imagery. We found architectural pieces matching your aesthetic."}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl border-2 border-[#e7b923]/30 p-1 bg-white shadow-xl overflow-hidden group">
              <img 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuC69Ko6_cWbwnkEn1C46TdzxyUhzyq3uU17wHvcV7yg0X-9dpDE64k7riMmy8yrB3swtbzj4hsgNM84tIeNhnnTmjt0XlGPydD-cCIVPF0XtR3hklAwPNqMcqTbvErARNBe1bwYPhbAzokhushKEdRKwdDTyfq8wIXj7HwW41t8Lz9ddcuIiBF7U2RTO9voMI9Ina3rqT7hWwNOP0B84EJzb6dlnxWZG4JrS0LPYnjDp3MP6PsA-qU7BOIgUyxS5XSzdCgf7w4ZZ0VZ" 
                alt="Source"
                className="w-full h-full object-cover rounded-lg group-hover:scale-110 transition-transform duration-500"
                referrerPolicy="no-referrer"
              />
            </div>
            <span className="text-xs font-bold uppercase tracking-tighter text-gray-500">Source<br/>Image</span>
          </div>
        </div>
      </div>

      {/* Filters Section */}
      <div className="flex flex-wrap items-center justify-between gap-4 py-6 border-y border-[#f3f0e7] mb-10">
        <div className="flex flex-wrap gap-2">
          {['Category', 'Material', 'Price Range'].map((filter) => (
            <button key={filter} className="px-5 py-2 rounded-full border border-[#f3f0e7] bg-white text-sm font-medium flex items-center gap-2 hover:border-[#e7b923] transition-all">
              {filter} <ChevronRight className="w-4 h-4 rotate-90" />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500 hidden sm:block">Sort by:</span>
          <button className="px-5 py-2 rounded-full bg-[#e7b923] text-[#141414] text-sm font-bold flex items-center gap-2 shadow-lg shadow-[#e7b923]/20">
            Highest Match <ArrowLeftRight className="w-4 h-4 rotate-90" />
          </button>
        </div>
      </div>

      {/* Product Grid */}
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
                <img 
                  src={item.image} 
                  alt={item.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute top-4 left-4 bg-[#f3f0e7]/90 backdrop-blur text-[#e7b923] text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest border border-[#e7b923]/20">
                  {item.match} Match
                </div>
                <button className="absolute bottom-4 right-4 w-10 h-10 bg-white/90 backdrop-blur rounded-full flex items-center justify-center opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-medium leading-tight group-hover:text-[#e7b923] transition-colors">{item.name}</h3>
                <p className="text-gray-500 text-sm font-light">{item.material}</p>
                <p className="text-gray-900 font-semibold pt-1">{item.price}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      {/* Pagination/Footer Actions */}
      <div className="mt-20 flex flex-col items-center gap-6">
        <button className="px-12 py-4 bg-[#141414] text-white font-bold rounded-lg hover:bg-[#e7b923] hover:text-[#141414] transition-all uppercase tracking-widest text-sm shadow-xl">
          Load More Discoveries
        </button>
        <p className="text-gray-500 text-xs uppercase tracking-[0.3em]">Showing {results.length} of 24 matches</p>
      </div>
    </div>
  );
}
