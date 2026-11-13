'use client';

import React, { useEffect, useRef, useState, useId } from 'react';
import mermaid from 'mermaid';
import { motion, AnimatePresence } from 'framer-motion';

import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { ZoomIn, ZoomOut, RotateCcw, X, Maximize2 } from 'lucide-react';

interface MermaidProps {
  chart: string;
}

const Mermaid: React.FC<MermaidProps> = React.memo(({ chart }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>('dark');
  const containerRef = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, '');

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          const theme = document.documentElement.getAttribute('data-theme') as 'light' | 'dark';
          setCurrentTheme(theme || 'dark');
        }
      });
    });

    observer.observe(document.documentElement, { attributes: true });
    
    const initialTheme = document.documentElement.getAttribute('data-theme') as 'light' | 'dark';
    setCurrentTheme(initialTheme || 'dark');

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const isLight = currentTheme === 'light';
    
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      fontFamily: 'Inter, system-ui, sans-serif',
      themeVariables: {
        primaryColor: '#3b82f6',
        primaryTextColor: isLight ? '#0f172a' : '#fff',
        primaryBorderColor: '#3b82f6',
        lineColor: isLight ? '#64748b' : '#94a3b8',
        secondaryColor: isLight ? '#f1f5f9' : '#0f172a',
        tertiaryColor: isLight ? '#f8fafc' : '#020617',
        mainBkg: isLight ? '#ffffff' : '#0f172a',
        nodeBorder: isLight ? '#e2e8f0' : '#334155',
        clusterBkg: isLight ? 'rgba(59, 130, 246, 0.05)' : 'rgba(59, 130, 246, 0.03)',
        clusterBorder: '#3b82f6',
        fontSize: '14px',
        titleColor: isLight ? '#0f172a' : '#fff',
        edgeLabelBackground: isLight ? 'rgba(255, 255, 255, 0.9)' : 'rgba(15, 23, 42, 0.9)',
        textColor: isLight ? '#475569' : '#94a3b8'
      },
      flowchart: {
        htmlLabels: true,
        useMaxWidth: true,
        curve: 'basis'
      },
      themeCSS: `
        .node rect, .node circle, .node polygon, .node path, .node .label-container { 
          fill: ${isLight ? '#ffffff' : '#1e293b'} !important; 
          stroke: #3b82f6 !important; 
          stroke-width: 2px !important;
        }
        .node .label, .node div { 
          color: ${isLight ? '#0f172a' : '#f1f5f9'} !important; 
          font-weight: 600 !important;
          font-family: 'Inter', sans-serif !important;
        }
        .edgePath .path { 
          stroke: ${isLight ? '#64748b' : '#94a3b8'} !important; 
          stroke-width: 2px !important; 
          opacity: 0.6 !important;
        }
        .marker { 
          fill: ${isLight ? '#64748b' : '#94a3b8'} !important; 
          stroke: ${isLight ? '#64748b' : '#94a3b8'} !important; 
          opacity: 0.6 !important;
        }
        .edgeLabel { 
          background-color: ${isLight ? '#f8fafc' : '#020617'} !important; 
          color: ${isLight ? '#475569' : '#94a3b8'} !important; 
          border-radius: 4px !important;
          padding: 2px 6px !important;
          font-weight: 800 !important;
          border: 1px solid rgba(59, 130, 246, 0.4) !important;
          font-size: 11px !important;
          box-shadow: 0 4px 10px ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.5)'} !important;
        }
        .edgeLabel rect {
          fill: ${isLight ? '#ffffff' : '#0f172a'} !important;
          stroke: rgba(59, 130, 246, 0.4) !important;
        }
        .cluster rect {
          fill: ${isLight ? 'rgba(59, 130, 246, 0.02)' : 'rgba(59, 130, 246, 0.04)'} !important;
          stroke: #3b82f6 !important;
          stroke-dasharray: 8, 4 !important;
          stroke-width: 2px !important;
        }
        .cluster .label {
          color: #3b82f6 !important;
          font-weight: 800 !important;
          text-transform: uppercase !important;
          letter-spacing: 1px !important;
        }
      `
    });

    const preprocessChart = (code: string) => {
      const subgraphRegex = /subgraph\s+([^\n\[\(\{]+)/g;
      let match;
      const subgraphs = new Set();
      while ((match = subgraphRegex.exec(code)) !== null) {
        subgraphs.add(match[1].trim());
      }
      let processed = code;
      subgraphs.forEach((name: any) => {
        const nodeRegex = new RegExp(`(\\b)${name}(\\[|\\(|\\{)`, 'g');
        processed = processed.replace(nodeRegex, `$1${name}_node$2`);
      });
      return processed;
    };

    const renderChart = async () => {
      try {
        const processedChart = preprocessChart(chart);
        const { svg } = await mermaid.render(`mermaid-${id}`, processedChart);
        setSvg(svg);
        setError(null);
      } catch (err: any) {
        console.error('Mermaid render failed:', err);
        setError(`Diagram Error: ${err.message || 'Failed to render.'}`);
      }
    };

    if (chart) {
      renderChart();
    }
  }, [chart, id, currentTheme]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsZoomed(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  if (error) {
    return <div className="p-4 text-red-500 bg-red-100/10 rounded-lg text-xs">{error}</div>;
  }

  return (
    <>
      <div 
        className="mermaid-container"
        onClick={() => setIsZoomed(true)}
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '24px',
          backgroundColor: currentTheme === 'light' ? 'rgba(255, 255, 255, 0.8)' : 'rgba(30, 41, 59, 0.4)',
          backdropFilter: 'blur(10px)',
          borderRadius: '24px',
          border: '1px solid var(--border-color)',
          marginTop: '20px',
          marginBottom: '20px',
          overflowX: 'auto',
          boxShadow: currentTheme === 'light' ? '0 10px 30px rgba(0, 0, 0, 0.05)' : '0 20px 40px -10px rgba(0, 0, 0, 0.3)',
          cursor: 'zoom-in',
          transition: 'all 0.2s ease',
          position: 'relative'
        }}
      >
        <div dangerouslySetInnerHTML={{ __html: svg }} />
        <div style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          padding: '6px',
          borderRadius: '8px',
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '10px',
          fontWeight: 700,
          color: '#3b82f6',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          <Maximize2 size={10} /> Full View
        </div>
      </div>

      <AnimatePresence>
        {isZoomed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: currentTheme === 'light' ? 'rgba(248, 250, 252, 0.98)' : 'rgba(2, 6, 23, 0.98)',
              backdropFilter: 'blur(30px)',
              zIndex: 9999,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <TransformWrapper
              initialScale={1}
              minScale={0.1}
              maxScale={20}
              centerOnInit={true}
            >
              {({ zoomIn, zoomOut, resetTransform }) => (
                <>
                  {/* Floating Controls */}
                  <div style={{
                    position: 'absolute',
                    top: '30px',
                    left: '30px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    zIndex: 10000
                  }}>
                    <button onClick={() => zoomIn()} className="diag-ctrl-btn"><ZoomIn size={18} /></button>
                    <button onClick={() => zoomOut()} className="diag-ctrl-btn"><ZoomOut size={18} /></button>
                    <button onClick={() => resetTransform()} className="diag-ctrl-btn"><RotateCcw size={18} /></button>
                  </div>

                  <button 
                    onClick={() => setIsZoomed(false)}
                    style={{
                      position: 'absolute',
                      top: '30px',
                      right: '30px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      color: '#ef4444',
                      padding: '10px 18px',
                      borderRadius: '14px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '12px',
                      zIndex: 10000
                    }}
                  >
                    <X size={16} /> CLOSE ESC
                  </button>

                  <TransformComponent
                    wrapperStyle={{
                      width: "100%",
                      height: "100%",
                      cursor: "grab",
                    }}
                  >
                    <div 
                      style={{ 
                        padding: '100px',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center'
                      }}
                      dangerouslySetInnerHTML={{ __html: svg }}
                    />
                  </TransformComponent>
                </>
              )}
            </TransformWrapper>

            <style jsx>{`
              .diag-ctrl-btn {
                width: 44px;
                height: 44px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: currentTheme === 'light' ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)',
                border: currentTheme === 'light' ? '1px solid rgba(0, 0, 0, 0.1)' : '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                color: currentTheme === 'light' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.7)',
                cursor: 'pointer',
                transition: 'all 0.2s ease';
              }
              .diag-ctrl-btn:hover {
                background: rgba(59, 130, 246, 0.2);
                border-color: rgba(59, 130, 246, 0.4);
                color: #3b82f6;
                transform: scale(1.05);
              }
            `}</style>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});

export default Mermaid;
