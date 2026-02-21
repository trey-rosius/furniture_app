import React, { useState, useRef, useEffect } from 'react';
import { generateClient } from 'aws-amplify/api';
import { UploadCloud, Search, Play, Image as ImageIcon, Send } from 'lucide-react';

const client = generateClient();

export default function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Agent State
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentResponse, setAgentResponse] = useState('');
  const [isAgentLoading, setIsAgentLoading] = useState(false);

  // Manual Push State
  const [pushRequestId, setPushRequestId] = useState('test-123');
  const [pushProductName, setPushProductName] = useState('Fake Modern Sofa');

  const addLog = (message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${time}] ${message}`]);
  };

  const getImageUrl = (uri: string) => {
    if (!uri) return '';
    if (uri.startsWith('s3://')) {
      const bucketAndKey = uri.replace('s3://', '');
      const parts = bucketAndKey.split('/');
      const bucket = parts[0];
      const key = parts.slice(1).join('/');
      return `https://${bucket}.s3.amazonaws.com/${key}`;
    }
    return uri;
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
      addLog(`Selected file: ${e.target.files[0].name}`);
    }
  };

  const triggerCatalogProcessing = async () => {
    addLog('Triggering catalog processing...');
    try {
      const response = await client.graphql({
        query: `mutation TriggerCatalogProcessing { triggerCatalogProcessing }`
      });
      addLog(`Catalog processing response: ${JSON.stringify(response)}`);
    } catch (err) {
      addLog(`Error triggering catalog: ${JSON.stringify(err)}`);
    }
  };

  const startVisualSearch = async () => {
    if (!selectedFile) {
      addLog('No file selected!');
      return;
    }

    setIsUploading(true);
    setIsSearching(true);
    setResults([]);
    
    try {
      addLog(`Requesting upload URL for ${selectedFile.name}...`);
      
      const response = await client.graphql({
        query: `mutation GetUploadUrl($fileName: String!, $contentType: String!) {
          getUploadUrl(fileName: $fileName, contentType: $contentType) {
            url
            key
          }
        }`,
        variables: {
          fileName: selectedFile.name,
          contentType: selectedFile.type || 'image/jpeg'
        }
      });
      
      //@ts-ignore
      const { url, key } = response.data.getUploadUrl;
      addLog(`URL received. Target key: ${key}`);

      // Setup subscription BEFORE uploading to avoid missing the event
      addLog(`Subscribing to results...`);
      const sub = client.graphql({
        query: `subscription OnSearchResult {
          onSearchResult {
            status
            message
            results {
              productName
              category
              subCategory
              price
              image_uri
            }
          }
        }`
      }).subscribe({
        next: ({ data }) => {
          //@ts-ignore
          const resPayload = data.onSearchResult;
          if (resPayload.status === 'ERROR') {
            addLog(`❌ SEARCH ERROR: ${resPayload.message}`);
            setResults([]);
          } else {
            addLog(`🎉 REAL-TIME RESULTS RECEIVED! Status: ${resPayload.status}`);
            const items = resPayload.results || [];
            setResults(items);
            addLog(`${resPayload.message} (Found ${items.length} matched products)`);
          }
          setIsSearching(false);
          sub.unsubscribe();
        },
        error: (err) => {
          addLog(`Subscription error: ${JSON.stringify(err)}`);
          setIsSearching(false);
        }
      });

      addLog(`Uploading file to S3...`);
      const uploadRes = await fetch(url, {
        method: 'PUT',
        body: selectedFile,
        headers: { 'Content-Type': selectedFile.type || 'image/jpeg' }
      });
      
      if (uploadRes.ok) {
        addLog('Upload successful! Waiting for Vector Search to finish...');
      } else {
        addLog(`Upload failed: ${uploadRes.statusText}`);
        setIsSearching(false);
      }
      setIsUploading(false);

    } catch (err: any) {
      addLog(`Error during visual search flow: ${err.message || JSON.stringify(err)}`);
      setIsUploading(false);
      setIsSearching(false);
    }
  };

  const invokeAgent = async () => {
    if (!agentPrompt) return;
    setIsAgentLoading(true);
    setAgentResponse('');
    addLog(`Invoking agent with prompt: ${agentPrompt}`);
    try {
      const response = await client.graphql({
        query: `mutation InvokeAgent($prompt: String!) {
          invokeAgent(prompt: $prompt) {
            message
          }
        }`,
        variables: { prompt: agentPrompt }
      });
      //@ts-ignore
      const result = response.data.invokeAgent.message;
      setAgentResponse(result);
      addLog(`Agent response: ${result}`);
    } catch (err: any) {
      addLog(`Error invoking agent: ${err.message || JSON.stringify(err)}`);
    }
    setIsAgentLoading(false);
  };
  const manualSubscribeAndPush = async () => {
    addLog(`Subscribing specifically to manual push`);
    
    // 1. Subscribe
    const sub = client.graphql({
      query: `subscription OnSearchResult {
        onSearchResult {
          status
          message
          results {
            productName
            category
            subCategory
            price
            image_uri
          }
        }
      }`
    }).subscribe({
      next: ({ data }) => {
        //@ts-ignore
        const resPayload = data.onSearchResult;
        if (resPayload.status === 'ERROR') {
          addLog(`❌ MANUAL PUSH ERROR EVENT RECEIVED! | Msg: ${resPayload.message}`);
          setResults([]);
        } else {
          addLog(`🎉 MANUAL PUSH RECEIVED! | Status: ${resPayload.status}`);
          const items = resPayload.results || [];
          setResults(items);
          addLog(`${resPayload.message} (Product: ${items[0]?.productName})`);
        }
        sub.unsubscribe();
      },
      error: (err) => {
        addLog(`Subscription error: ${JSON.stringify(err)}`);
      }
    });

    addLog('Waiting 2 seconds before pushing (simulating search delay)...');
    
    // 2. Wait a bit, then Push
    setTimeout(async () => {
      addLog(`Pushing result...`);
      try {
        const res = await client.graphql({
          query: `mutation PushTestResult($productName: String!) {
            pushSearchResult(
              status: "SUCCESS",
              message: "Fake push succeeded.",
              results: [
                {
                  productName: $productName,
                  category: "Living Room",
                  subCategory: "Couches",
                  price: 999.99,
                  imageFile: "fake_sofa.jpg",
                  image_uri: "s3://fake/fake_sofa.jpg",
                  level: "Premium",
                  original_productId: "prod-001"
                }
              ]
            ) {
              status
            }
          }`,
          variables: { 
            productName: pushProductName 
          }
        });
        addLog(`Push successful: ${JSON.stringify(res)}`);
      } catch (err) {
        addLog(`Push failed: ${JSON.stringify(err)}`);
      }
    }, 2000);
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>Furniture AI Explorer</h1>
        <p>Real-time visual search & catalog processing testing console</p>
      </header>

      <div className="grid">
        <div className="glass-panel">
          <h2 className="section-title"><Search className="text-accent" /> Test Visual Search</h2>
          
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div className="file-input-wrapper">
              <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#fff' }}>
                <ImageIcon size={18} /> Choose Image
              </button>
              <input type="file" accept="image/*" onChange={handleFileChange} />
            </div>
            {selectedFile && <span style={{ color: 'var(--text-muted)' }}>{selectedFile.name}</span>}
          </div>

          <button 
            className="btn" 
            onClick={startVisualSearch} 
            disabled={!selectedFile || isUploading || isSearching}
            style={{ marginTop: '1rem' }}
          >
            {isUploading ? 'Uploading...' : isSearching ? 'Searching...' : <><UploadCloud size={18} /> Upload & Search</>}
          </button>

          {isSearching && !isUploading && (
            <div style={{ marginTop: '1rem', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div className="spinner"></div> Waiting for AppSync subscription...
            </div>
          )}

          <div style={{ marginTop: '2rem' }}>
            <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>Search Results</h3>
            {results.length === 0 && !isSearching ? (
              <p style={{ color: 'var(--text-muted)' }}>No results yet. Upload an image to test.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '400px', overflowY: 'auto' }}>
                {results.map((r, i) => (
                  <div key={i} className="product-card">
                    <div className="product-image">
                       <img 
                         src={getImageUrl(r.image_uri)} 
                         alt={r.productName} 
                         onError={(e) => {
                           (e.target as HTMLImageElement).src = 'https://via.placeholder.com/80?text=No+Image';
                         }}
                       />
                    </div>
                    <div className="product-info">
                      <h3>{r.productName || 'Unknown Product'}</h3>
                      <p>{r.category} {r.subCategory ? `> ${r.subCategory}` : ''}</p>
                      {r.price && <div className="price-tag">${parseFloat(r.price).toFixed(2)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* Manual Subscription Test */}
          <div className="glass-panel">
             <h2 className="section-title"><Send className="text-accent" /> Test Subscription directly</h2>
             <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
               Manually subscribes to a request ID and pushes a dummy object immediately to test realtime flow end-to-end bypassing AWS Bedrock.
             </p>
             
             <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
               <input 
                 value={pushRequestId} 
                 onChange={e => setPushRequestId(e.target.value)}
                 placeholder="Request ID"
                 style={{ flex: 1, padding: '0.5rem', borderRadius: '0.25rem', border: 'none', outline: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff' }}
               />
               <input 
                 value={pushProductName} 
                 onChange={e => setPushProductName(e.target.value)}
                 placeholder="Product Name"
                 style={{ flex: 1, padding: '0.5rem', borderRadius: '0.25rem', border: 'none', outline: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff' }}
               />
             </div>

             <button className="btn" onClick={manualSubscribeAndPush}>
               <Send size={18} /> Run Manual Push Test
             </button>
          </div>

          <div className="glass-panel">
            <h2 className="section-title"><Play className="text-accent" /> Control Panel</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Trigger the backend state machine to parallel process all images currently parked in the S3 catalog/ folder.
            </p>
            <button className="btn" onClick={triggerCatalogProcessing}>
              <Play size={18} /> Trigger Catalog Processing
            </button>
          </div>

          <div className="glass-panel">
            <h2 className="section-title"><Send className="text-secondary" /> Furniture AI Assistant</h2>
            <div className="chat-container">
              <div className="chat-input-wrapper">
                <input 
                  type="text" 
                  placeholder="Ask our AI agent about products..." 
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && invokeAgent()}
                  style={{ flex: 1, padding: '0.75rem', borderRadius: '0.5rem', border: 'none', outline: 'none', background: 'rgba(0,0,0,0.2)', color: '#fff' }}
                />
                <button 
                  className="btn"
                  onClick={invokeAgent} 
                  disabled={isAgentLoading || !agentPrompt}
                  style={{ minWidth: '100px', margin: 0 }}
                >
                  {isAgentLoading ? 'Thinking...' : 'Send'}
                </button>
              </div>
              {agentResponse && (
                <div className="chat-response" style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '0.5rem', borderLeft: '4px solid #10b981', textAlign: 'left' }}>
                  <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{agentResponse}</p>
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel" style={{ flexGrow: 1 }}>
            <h2 className="section-title" style={{ marginBottom: '1rem' }}>Application Logs</h2>
            <div className="log-box">
              {logs.map((log, i) => (
                <div key={i} className="log-entry">
                  <span className="log-time">{log.split(' ')[0]}</span>
                  {log.substring(log.indexOf(' ') + 1)}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
            <button 
              className="btn" 
              onClick={() => setLogs([])} 
              style={{ marginTop: '1rem', background: 'rgba(255,255,255,0.1)', width: 'fit-content', padding: '0.5rem 1rem', fontSize: '0.85rem' }}
            >
              Clear Logs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
