'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Upload, 
  FileText, 
  Sparkles, 
  Brain, 
  Menu,
  X,
  Mic,
  Globe,
  Dna,
  Activity,
  Info,
  Camera,
  LogOut,
  Lock,
  Mail,
  Trash2,
  Plus,
  Download,
  Volume2,
  Edit2,
  MoreVertical,
  User,
  Copy,
  Check,
  Sun,
  Moon
} from 'lucide-react';

import Mermaid from './components/Mermaid';
import { downloadMarkdown } from './utils/ExportManager';
import { VoiceAssistant } from './utils/VoiceAssistant';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'framer-motion';

interface AppDocument {
  id: number;
  filename: string;
}

interface Message {
  id?: string | number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  type?: 'system' | 'error';
  citations?: Citation[];
  confidence?: number;
  timestamp?: string;
}

interface Citation {
  source: string;
  page: number;
  text: string;
  x?: number;
  y?: number;
}

interface KGNode {
  id: string;
  x: number;
  y: number;
}

interface KGEdge {
  source: string;
  target: string;
}

interface KGData {
  nodes: KGNode[];
  edges: KGEdge[];
}

const RAG_THINKING = [
  'Analyzing research library... 📚',
  'Scanning document vectors... 🔍',
  'Synthesizing insights... ✨',
  'Mapping knowledge nodes... 🌐',
  'Connecting research points... 🖇️'
];

const WEB_THINKING = [
  'Searching the live web... 🌐',
  'Filtering search results... 🔍',
  'Analyzing real-time data... ✨',
  'Verifying latest information... ✅',
  'Synthesizing web insights... 🧠'
];

const GENERAL_THINKING = [
  'Analyzing your query... 🧠',
  'Processing request... ⚙️',
  'Synthesizing answer... ✨',
  'Consulting internal models... 🤖',
  'Almost ready! 🚀'
];

// Memoized components for ReactMarkdown to prevent re-renders during typing
const MarkdownComponents = {
  code: React.memo((props: any) => {
    const {children, className, node, ...rest} = props
    const match = /language-(\w+)/.exec(className || '')
    return match && match[1] === 'mermaid' ? (
      <Mermaid chart={String(children).replace(/\n$/, '')} />
    ) : (
      <code {...rest} className={className}>
        {children}
      </code>
    )
  })
};

export default function Home() {

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [documents, setDocuments] = useState<AppDocument[]>([]);
  const [mode, setMode] = useState('General');
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [isReasoning, setIsReasoning] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [useWeb, setUseWeb] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [hoveredCitation, setHoveredCitation] = useState<Citation | null>(null);
  const [user, setUser] = useState<{id: number, email: string} | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ email: '', password: '', username: '' });
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<{msg: string, type: 'error' | 'success'} | null>(null);
  const [historyMessages, setHistoryMessages] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
  const [isSpeaking, setIsSpeaking] = useState<string | number | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [activeDropdownId, setActiveDropdownId] = useState<string | number | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    danger?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const showConfirm = (title: string, message: string, onConfirm: () => void, danger: boolean = true) => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, danger });
  };

  const [notification, setNotification] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'info' | 'error' | 'success';
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'info',
  });

  const showNotification = (title: string, message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setNotification({ isOpen: true, title, message, type });
  };

  const refreshHistory = async () => {
    if (!authToken) return;
    try {
      const res = await fetch(`/api/backend/history?t=${Date.now()}`, { 
        headers: { 'Authorization': `Bearer ${authToken}` },
        cache: 'no-store'
      });
      if (res.status === 401) {
        setAuthToken(null);
        localStorage.removeItem('research_ai_token');
        localStorage.removeItem('research_ai_user');
        setIsAuthModalOpen(true);
        return;
      }
      const data = await res.json();
      if (data.history && Array.isArray(data.history)) {
        console.log('[History] List refreshed:', data.history.length, 'sessions');
        setHistoryMessages(data.history);
      }
    } catch (e) { console.error('History refresh failed', e); }
  };


  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load token on mount
  useEffect(() => {
    const token = localStorage.getItem('research_ai_token');
    const savedUser = localStorage.getItem('research_ai_user');
    if (token && savedUser) {
      setAuthToken(token);
      setUser(jsonSafeParse(savedUser));
    } else {
      setIsAuthModalOpen(true);
    }
  }, []);

  function jsonSafeParse(str: string) {
    try { return JSON.parse(str); } catch { return null; }
  }

  // Check backend health
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/backend/health');
        if (res.ok) setBackendStatus('online');
        else setBackendStatus('offline');
      } catch (e) {
        setBackendStatus('offline');
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);


  // Fetch user data on login
  useEffect(() => {
    if (!authToken) return;
    
    const fetchData = async () => {
      const headers = { 'Authorization': `Bearer ${authToken}` };
      
      // Fetch History
      await refreshHistory();

      // Fetch Docs
      try {
        const docRes = await fetch('/api/backend/documents', { headers });
        const docData = await docRes.json();
        if (docData.documents) setDocuments(docData.documents);
      } catch (e) { console.error('Docs fetch failed', e); }
    };

    fetchData();
  }, [authToken]);

  useEffect(() => {
    if (authStatus && authStatus.type === 'error') {
      const timer = setTimeout(() => {
        setAuthStatus(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [authStatus]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    setIsUploading(true);
    
    const formData = new FormData();
    formData.append('file', file);

    // Add a system message to indicate progress
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `📤 Uploading and analyzing **${file.name}**... This may take a moment for large files. ✨`,
      type: 'system',
      id: `sys-${Date.now()}`
    }]);

    try {
      const res = await fetch('/api/backend/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData,
      });

      if (!res.ok) {
        let errorDetail = `Server Error (${res.status})`;
        try {
          const errorData = await res.json();
          errorDetail = errorData.detail || errorDetail;
        } catch (e) {
          // If not JSON, it might be the "Internal Server Error" text
          const text = await res.text();
          if (text.includes("Internal Server Error")) errorDetail = "The server encountered an error while processing the file. It might be too large or complex.";
        }
        throw new Error(errorDetail);
      }

      const data = await res.json();
      setDocuments(prev => {
        const exists = prev.some(d => d.id === data.id);
        if (exists) return prev;
        return [...prev, { id: data.id, filename: data.filename }];
      });
      
      let successMsg = `Successfully processed **${data.filename}**. What would you like to explore? ✨`;
      if (data.suggestions && data.suggestions.length > 0) {
        successMsg += "\n\n**I can also help with:**\n" + data.suggestions.map((s: string) => `- ${s}`).join('\n');
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: successMsg,
        type: 'system',
        id: `sys-done-${Date.now()}`
      }]);

    } catch (error: any) {
      console.error('Upload failed', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Upload failed: ${error.message || 'Please ensure the file is a supported format and try again.'}`,
        type: 'error'
      }]);
    } finally {
      setIsUploading(false);
    }
  };



  const handleSendMessage = async () => {
    if (!input.trim() || !authToken) return;
    const queryText = input;
    const userMsg: Message = { role: 'user', content: queryText, id: `user-${Date.now()}` };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    await performQuery(queryText, messages);
  };

  const performQuery = async (queryText: string, currentHistory: Message[]) => {
    setIsReasoning(true);
    try {
      const formData = new FormData();
      formData.append('question', queryText);
      formData.append('mode', 'general'); // Or get from state if you have a mode selector
      formData.append('web_search', useWeb.toString());
      formData.append('model', 'gemini-2.0-flash');
      formData.append('history', JSON.stringify(currentHistory.slice(-20)));
      if (currentSessionId) {
        formData.append('session_id', currentSessionId);
      }

      const res = await fetch('/api/backend/query', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData,
      });
      
      if (res.status === 401) {
        setAuthToken(null);
        localStorage.removeItem('research_ai_token');
        localStorage.removeItem('research_ai_user');
        setIsAuthModalOpen(true);
        throw new Error("Session expired. Please login again.");
      }
      
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const data = await res.json();
      
      if (data.session_id) {
        if (!currentSessionId) {
          setCurrentSessionId(data.session_id);
        }
        // Always refresh history to catch title updates
        setTimeout(() => refreshHistory(), 2000);
      }

      setMessages(prev => {
        const last = [...prev];
        if (last.length > 0 && last[last.length - 1].role === 'user') {
          last[last.length - 1].id = data.user_message_id;
        }
        return last;
      });

      const aiMsg: Message = {
        id: data.assistant_message_id,
        role: 'assistant',
        content: data.answer,
        citations: data.citations,
        confidence: data.confidence,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, aiMsg]);

    } catch (error) {
      console.error('Query error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: Could not connect to the Research Engine.`,
        type: 'error'
      }]);
    } finally {
      setIsReasoning(false);
    }
  };

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    showNotification('Copied', 'Message content copied to clipboard! ✨', 'success');
    setActiveDropdownId(null);
  };

  const handleAuth = async () => {
    const endpoint = authMode === 'login' ? '/api/backend/token' : '/api/backend/register';
    const formData = new FormData();
    formData.append('email', authForm.email);
    formData.append('password', authForm.password);
    if (authForm.username) formData.append('username', authForm.username);

    try {
      const res = await fetch(endpoint, { method: 'POST', body: formData });
      const data = await res.json();
      
      if (res.ok) {
        if (authMode === 'login') {
          localStorage.setItem('research_ai_token', data.access_token);
          localStorage.setItem('research_ai_user', JSON.stringify(data.user));
          setAuthToken(data.access_token);
          setUser(data.user);
          setIsAuthModalOpen(false);
        } else {
          setAuthStatus({ msg: 'Account created! Redirecting to login...', type: 'success' });
          setTimeout(() => {
            setAuthMode('login');
            setAuthStatus(null);
            setAuthForm({ email: '', password: '', username: '' });
          }, 2000);
        }
      } else {
        setAuthStatus({ msg: data.detail || 'Authentication failed', type: 'error' });
      }
    } catch (e) {
      setAuthStatus({ msg: 'Network error. Please try again.', type: 'error' });
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('research_ai_token');
    localStorage.removeItem('research_ai_user');
    setAuthToken(null);
    setUser(null);
    setMessages([]);
    setDocuments([]);
    setIsAuthModalOpen(true);
  };

  

  const loadSession = async (sessionId: string) => {
    if (!authToken) return;
    try {
      const res = await fetch(`/api/backend/history/${sessionId}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages);
        setCurrentSessionId(sessionId);
        // On mobile, you might want to close sidebar here
      }
    } catch (e) {
      console.error('Failed to load session', e);
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setCurrentSessionId(null);
  };

  const startListening = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Win = window as unknown as { 
      SpeechRecognition?: new () => any; 
      webkitSpeechRecognition?: new () => any 
    };

    const SpeechRecognition = Win.SpeechRecognition || Win.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showNotification('Feature Unsupported', 'Speech recognition is not supported in this browser. Please try Chrome or Edge.', 'error');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: { results: { [key: number]: { [key: number]: { transcript: string } } } }) => {
      setInput(event.results[0][0].transcript);
    };
    recognition.start();
  };

  // Knowledge graph feature removed

  const handleClearLibrary = async () => {
    showConfirm(
      "Clear All Data?",
      "This will permanently delete ALL documents and your entire research history. This action cannot be reversed! ⚠️",
      async () => {
        if (!authToken) return;
        try {
          const res = await fetch('/api/backend/clear', { 
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
          });
          if (res.ok) {
            setDocuments([]);
            setHistoryMessages([]);
            setMessages([{
              role: 'assistant',
              content: '🗑️ Library and chat history cleared. Ready for a fresh start!',
              type: 'system'
            }]);
          }
        } catch (error) {
          console.error('Clear failed', error);
        }
      }
    );
  };

  const handleDeleteDocument = async (docId: number) => {
    if (!docId) {
      showNotification('Missing ID', 'This document has no valid ID. Please refresh the page or re-upload the file.', 'error');
      return;
    }
    
    showConfirm(
      "Delete Document?",
      "Are you sure you want to permanently remove this document from your library? This action cannot be undone. 🗑️",
      async () => {
        if (!authToken) return;
        try {
          const res = await fetch(`/api/backend/documents/${docId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
          });
          if (res.ok) {
            const data = await res.json();
            const deletedDoc = documents.find(d => d.id === docId);
            const filename = data.filename || deletedDoc?.filename || "document";
            
            setDocuments(prev => prev.filter(d => d.id !== docId));
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `🗑️ Deleted **${filename}** from the library.`,
              type: 'system'
            }]);
          }
        } catch (error) {
          console.error('Delete failed', error);
        }
      }
    );
  };

  const handleDeleteMessage = async (messageId: string | number) => {
    showConfirm(
      "Delete Message?",
      "Are you sure you want to delete this specific message? 🗑️",
      async () => {
        if (!authToken) return;
        try {
          const res = await fetch(`/api/backend/messages/${messageId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
          });
          if (res.ok) {
            setMessages(prev => prev.filter(m => m.id !== messageId));
          }
        } catch (e) { console.error('Delete message failed', e); }
      }
    );
  };

  const handleEditMessage = async (messageId: string | number) => {
    if (!authToken || !editingContent.trim()) return;
    try {
      // 1. Update the message on the backend
      const res = await fetch(`/api/backend/messages/${messageId}`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: editingContent })
      });
      
      if (res.ok) {
        // 2. Clean up subsequent messages on backend
        await fetch(`/api/backend/messages/${messageId}/subsequent`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${authToken}` }
        });

        // 3. Update local state: keep messages up to the edited one
        const msgIdx = messages.findIndex(m => m.id === messageId);
        if (msgIdx !== -1) {
          const updatedHistory = messages.slice(0, msgIdx);
          setMessages([...updatedHistory, { ...messages[msgIdx], content: editingContent }]);
          
          setEditingMessageId(null);
          setEditingContent('');
          
          // 4. Trigger new AI response based on the new content and the history before it
          await performQuery(editingContent, updatedHistory);
        }
      }
    } catch (e) { console.error('Edit message failed', e); }
  };

  const handleDeleteSession = async (sessionId: string) => {
    showConfirm(
      "Delete Conversation?",
      "Are you sure you want to delete this entire research session? All messages will be lost. 🗑️",
      async () => {
        if (!authToken) return;
        try {
          const res = await fetch(`/api/backend/history/${sessionId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
          });
          if (res.ok) {
            setHistoryMessages(prev => prev.filter(s => s.session_id !== sessionId));
            if (currentSessionId === sessionId) {
              setMessages([]);
              setCurrentSessionId(null);
            }
          }
        } catch (e) { console.error('Delete session failed', e); }
      }
    );
  };

  const [thinkingIdx, setThinkingIdx] = useState(0);
  const getThinkingMessages = () => {
    if (useWeb) return WEB_THINKING;
    if (documents.length > 0) return RAG_THINKING;
    return GENERAL_THINKING;
  };
  
  useEffect(() => {
    if (isReasoning) {
      const messages = getThinkingMessages();
      const interval = setInterval(() => {
        setThinkingIdx(prev => (prev + 1) % messages.length);
      }, 2000);
      return () => clearInterval(interval);
    } else {
      setThinkingIdx(0);
    }
  }, [isReasoning, useWeb, documents.length]);





  return (
    <div className="app-container" onClick={() => setActiveDropdownId(null)}>


      {/* Sidebar - Changed to simple div with fixed width for stability */}
      {isSidebarOpen && (
        <aside className="sidebar" style={{ minWidth: '300px', flexShrink: 0 }}>
          <div className="logo-area">
            <div className="logo-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <h1 className="logo-text">ResearchAI</h1>
              <span className="logo-sub">Intelligence Suite</span>
            </div>
          </div>

          <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <p className="section-title">🚀 Upload Center</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <label className="upload-zone" style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '12px',
                background: 'var(--item-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--text-main)'
              }}>
                <Upload size={16} color="#6366f1" />
                <span>{isUploading ? 'PROCESSING...' : 'FILE'}</span>
                <input type="file" hidden accept=".pdf,.docx,.txt,.md,.csv" onChange={handleUpload} disabled={isUploading} />
              </label>

              <label className="upload-zone" style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '12px',
                background: 'var(--item-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--text-main)'
              }}>
                <Camera size={16} color="#10b981" />
                <span>{isUploading ? 'PROCESSING...' : 'SCAN'}</span>
                <input type="file" hidden accept="image/*" capture="environment" onChange={handleUpload} disabled={isUploading} />
              </label>
            </div>
          </div>

          {/* Research Mode unified into General Analysis */}

          {/* Visual Insights button removed */}

          <div style={{ flex: 1, marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p className="section-title">📂 Library ({documents.length})</p>
              {documents.length > 0 && (
                <button 
                  onClick={handleClearLibrary}
                  style={{ 
                    fontSize: '9px', 
                    color: '#ef4444', 
                    background: 'transparent', 
                    border: 'none', 
                    cursor: 'pointer',
                    fontWeight: 700,
                    marginBottom: '12px'
                  }}
                >
                  CLEAR ALL
                </button>
              )}
            </div>
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {documents.map((doc, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'var(--item-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: 'var(--text-dim)',
                  transition: 'all 0.2s'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                    <FileText size={14} color="#3b82f6" />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.filename}</span>
                  </div>
                  <button 
                    onClick={() => handleDeleteDocument(doc.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ef4444'
                    }}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
            <button 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--text-main)',
                transition: 'all 0.2s'
              }}
            >
              {theme === 'dark' ? (
                <>
                  <Sun size={18} color="#f59e0b" />
                  <span>Light Mode</span>
                </>
              ) : (
                <>
                  <Moon size={18} color="#6366f1" />
                  <span>Dark Mode</span>
                </>
              )}
            </button>
          </div>
        </aside>
      )}

      {/* Main Panel */}
      <section className="main-panel">
        <header className="main-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button onClick={() => setSidebarOpen(!isSidebarOpen)} style={{ background: 'transparent', color: 'var(--text-dim)', border: 'none', cursor: 'pointer' }}>
              {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600 }}>Research Engine</span>
              {(() => {
                const statusColor = backendStatus === 'online' ? '#10b981' : backendStatus === 'offline' ? '#ef4444' : '#f59e0b';
                return (
                  <div style={{ 
                    width: '8px', 
                    height: '8px', 
                    background: statusColor,
                    borderRadius: '50%', 
                    boxShadow: '0 0 10px ' + statusColor,
                    transition: 'all 0.3s ease'
                  }}></div>
                );
              })()}
              <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 500 }}>
                {backendStatus.toUpperCase()}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button 
              onClick={() => {
                const session = historyMessages.find(s => s.session_id === currentSessionId);
                downloadMarkdown(session?.title || 'Research_Report', messages);
              }}
              style={{
                background: 'transparent',
                color: 'var(--text-dim)',
                border: 'none',
                padding: '6px 10px',
                borderRadius: '8px',
                fontSize: '11px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer'
              }}
            >
              <Download size={14} /> EXPORT
            </button>
            <button 
              onClick={() => setRightSidebarOpen(!isRightSidebarOpen)}
              style={{
                background: isRightSidebarOpen ? 'rgba(59,130,246,0.1)' : 'transparent',
                color: isRightSidebarOpen ? '#3b82f6' : 'var(--text-dim)',
                border: 'none',
                padding: '6px 10px',
                borderRadius: '8px',
                fontSize: '11px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer'
              }}
            >
              <Activity size={14} /> HISTORY
            </button>
            {user && (
              <button 
                onClick={handleLogout}
                style={{ 
                  background: 'rgba(239,68,68,0.1)', 
                  color: '#ef4444', 
                  border: 'none', 
                  padding: '6px 10px', 
                  borderRadius: '8px', 
                  fontSize: '11px', 
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer'
                }}
              >
                <LogOut size={14} /> LOGOUT
              </button>
            )}
          </div>
        </header>

        <div className="chat-scroller">
          <div className="chat-container">
              <>
            {messages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', textAlign: 'center', gap: '20px' }}>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(59, 130, 246, 0.1)', filter: 'blur(40px)', borderRadius: '50%' }}></div>
                  <Brain size={64} color="#3b82f6" style={{ position: 'relative' }} />
                </div>
                <div>
                  <h2 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '8px' }}>Let&apos;s start your research! 🚀</h2>
                  <p style={{ color: 'var(--text-dim)', maxWidth: '400px' }}>Upload your documents (PDF, Word, Images, TXT, CSV) and let the magic happen. ✨ I&apos;ll extract, synthesize, and reason through the data for you!</p>
                </div>
              </div>
            )}

            {/* Knowledge Graph Modal removed */}

            <AnimatePresence initial={false}>
              {messages.map((msg, i) => (
                <motion.div 
                  key={msg.id || `msg-${i}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={"message-row " + msg.role}
                >
                  <div className="bubble">
                    {msg.role !== 'system' && (
                      <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 100 }}>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            const id = msg.id || i; // Fallback to index for local state management if no DB ID
                            setActiveDropdownId(activeDropdownId === id ? null : id);
                          }}
                          className="msg-action-btn"
                          title="More options"
                        >
                          <MoreVertical size={14} />
                        </button>
                        
                        {(activeDropdownId === msg.id || (activeDropdownId === i && !msg.id)) && (
                          <div className="msg-dropdown">
                            <button 
                              onClick={() => {
                                if (isSpeaking === (msg.id || i)) {
                                  VoiceAssistant.stop();
                                  setIsSpeaking(null);
                                } else {
                                  VoiceAssistant.speak(msg.content, () => setIsSpeaking(null));
                                  setIsSpeaking(msg.id || i);
                                }
                                setActiveDropdownId(null);
                              }}
                              className="dropdown-item"
                            >
                              <Volume2 size={12} /> {isSpeaking === (msg.id || i) ? 'Stop' : 'Read Aloud'}
                            </button>
                            
                            {msg.role === 'user' && (
                              <button 
                                onClick={() => {
                                  if (!msg.id) {
                                    showNotification('Please Wait', "This message hasn't been saved to the database yet. Please wait a moment before editing.", 'info');
                                    return;
                                  }
                                  setEditingMessageId(msg.id!);
                                  setEditingContent(msg.content);
                                  setActiveDropdownId(null);
                                }}
                                className="dropdown-item"
                                style={{ opacity: msg.id ? 1 : 0.5 }}
                              >
                                <Edit2 size={12} /> Edit
                              </button>
                            )}
                            
                            <button 
                              onClick={() => {
                                if (msg.id) {
                                  handleDeleteMessage(msg.id!);
                                } else {
                                  // Local delete for unsaved messages
                                  setMessages(prev => prev.filter((_, idx) => idx !== i));
                                }
                                setActiveDropdownId(null);
                              }}
                              className="dropdown-item delete"
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                            <button 
                              onClick={() => handleCopyMessage(msg.content)}
                              className="dropdown-item"
                            >
                              <Copy size={12} /> Copy Content
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {editingMessageId === msg.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '200px' }}>
                        <textarea 
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          className="edit-textarea"
                          autoFocus
                        />
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => handleEditMessage(msg.id!)} className="edit-save-btn">SAVE CHANGES</button>
                          <button onClick={() => setEditingMessageId(null)} className="edit-cancel-btn">CANCEL</button>
                        </div>
                      </div>
                    ) : (
                      <div className="markdown-content">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={MarkdownComponents as any}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
                    
                    {msg.role === 'assistant' && msg.citations && (
                      <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {msg.citations.map((cit, j) => (
                            <div 
                              key={j} 
                              onMouseEnter={() => setHoveredCitation({ ...cit, x: 0, y: 0 })}
                              onMouseLeave={() => setHoveredCitation(null)}
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '6px', 
                                padding: '6px 10px', 
                                borderRadius: '8px', 
                                background: 'rgba(59, 130, 246, 0.1)', 
                                fontSize: '11px', 
                                fontWeight: 600, 
                                color: '#3b82f6',
                                cursor: 'help',
                                border: '1px solid rgba(59, 130, 246, 0.2)',
                                position: 'relative'
                              }}
                            >
                              <Info size={12} />
                              {cit.source} (p.{cit.page})
                              
                              <AnimatePresence>
                                {hoveredCitation?.text === cit.text && (
                                  <motion.div 
                                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    style={{
                                      position: 'absolute',
                                      bottom: 'calc(100% + 14px)',
                                      left: '0',
                                      width: '320px',
                                      background: 'rgba(15, 23, 42, 0.95)',
                                      backdropFilter: 'blur(20px)',
                                      padding: '18px',
                                      borderRadius: '16px',
                                      border: '1px solid rgba(255, 255, 255, 0.08)',
                                      zIndex: 1000,
                                      fontSize: '13px',
                                      color: '#e2e8f0',
                                      lineHeight: '1.6',
                                      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
                                      pointerEvents: 'none'
                                    }}
                                  >
                                    <div style={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      justifyContent: 'space-between',
                                      marginBottom: '12px',
                                      paddingBottom: '8px',
                                      borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
                                    }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <FileText size={12} color="#3b82f6" />
                                        <span style={{ fontSize: '10px', fontWeight: 800, color: '#3b82f6', letterSpacing: '0.05em' }}>SOURCE SNIPPET</span>
                                      </div>
                                      <span style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>PG. {cit.page}</span>
                                    </div>
                                    <div style={{ 
                                      fontStyle: 'italic', 
                                      color: '#94a3b8', 
                                      position: 'relative', 
                                      paddingLeft: '12px', 
                                      borderLeft: '2px solid rgba(59, 130, 246, 0.3)',
                                      maxHeight: '350px',
                                      overflowY: 'auto',
                                      scrollbarWidth: 'thin'
                                    }}>
                                      {(() => {
                                        let text = cit.text || "";
                                        // Clean common noise and artifacts
                                        text = text.replace(/file:\/\/\/[^\s]+/g, ''); // Remove absolute file paths
                                        text = text.replace(/[a-zA-Z0-9_\-\.]+\.(html|pdf|docx|txt|md|csv|png|jpg|jpeg)/gi, ''); // Remove floating filenames
                                        text = text.replace(/\d+\/\d+/g, ''); // Remove page indicators like 1/3
                                        text = text.replace(/\\n/g, ' '); // Replace escaped newlines
                                        text = text.replace(/[\[\]{}'"_]/g, ''); // Remove JSON brackets, quotes, and underscores
                                        text = text.replace(/Table Data:|Table Content:/gi, ''); // Remove table headers
                                        text = text.replace(/\s+/g, ' ').trim(); // Normalize spaces
                                        return text;
                                      })()}
                                    </div>
                                    {/* Tooltip Arrow */}
                                    <div style={{
                                      position: 'absolute',
                                      top: '100%',
                                      left: '20px',
                                      width: '0',
                                      height: '0',
                                      borderLeft: '8px solid transparent',
                                      borderRight: '8px solid transparent',
                                      borderTop: '8px solid rgba(15, 23, 42, 0.95)'
                                    }}></div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            
            {isReasoning && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-dim)', fontSize: '13px', paddingLeft: '10px' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <div style={{ width: '4px', height: '4px', background: '#3b82f6', borderRadius: '50%', animation: 'bounce 1.4s infinite ease-in-out' }}></div>
                  <div style={{ width: '4px', height: '4px', background: '#3b82f6', borderRadius: '50%', animation: 'bounce 1.4s infinite ease-in-out 0.2s' }}></div>
                  <div style={{ width: '4px', height: '4px', background: '#3b82f6', borderRadius: '50%', animation: 'bounce 1.4s infinite ease-in-out 0.4s' }}></div>
                </div>
                <motion.span
                  key={thinkingIdx}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                >
                  {getThinkingMessages()[thinkingIdx]}
                </motion.span>
              </div>
            )}
            <div ref={chatEndRef} />
            </>
          </div>
        </div>

        <footer className="input-area">
          <div className="dock">
            <input 
              type="text" 
              placeholder="Ask a question about the research..." 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              suppressHydrationWarning
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button 
                onClick={() => setUseWeb(!useWeb)}
                style={{ 
                  background: useWeb ? 'rgba(59,130,246,0.1)' : 'transparent', 
                  color: useWeb ? '#3b82f6' : 'var(--text-muted)', 
                  padding: '8px', 
                  border: useWeb ? '1px solid #3b82f6' : 'none',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '10px',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
                suppressHydrationWarning
              >
                <Globe size={18} />
                {useWeb ? 'WEB ON' : 'WEB OFF'}
              </button>
              <button 
                onClick={startListening}
                style={{ 
                  background: isListening ? 'rgba(239,68,68,0.1)' : 'transparent', 
                  color: isListening ? '#ef4444' : 'var(--text-muted)', 
                  padding: '8px', 
                  border: 'none',
                  animation: isListening ? 'pulse 1.5s infinite' : 'none',
                  borderRadius: '50%'
                }}
                suppressHydrationWarning
              >
                <Mic size={20} />
              </button>
              <button onClick={handleSendMessage} className="send-btn" style={{ border: 'none' }} suppressHydrationWarning>
                <Send size={20} />
              </button>
            </div>
          </div>
        </footer>
      </section>

      {/* Right Sidebar - History Center */}
      {isRightSidebarOpen && (
        <aside className="sidebar right-sidebar" style={{ minWidth: '280px', flexShrink: 0, borderLeft: '1px solid var(--border-color)', borderRight: 'none' }}>
          <div className="logo-area" style={{ justifyContent: 'flex-start', marginBottom: '16px' }}>
            <Activity size={18} color="#3b82f6" />
            <h2 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>RESEARCH LOG</h2>
          </div>
          
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', marginTop: '10px' }}>
            <button 
              onClick={startNewChat}
              suppressHydrationWarning
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                color: '#3b82f6',
                fontSize: '12px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer',
                marginBottom: '20px',
                transition: 'all 0.2s'
              }}
            >
              <Plus size={16} /> NEW RESEARCH SESSION
            </button>

            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
              {historyMessages.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Brain size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                  <p style={{ fontSize: '12px' }}>Your research log is empty. Start a conversation to see it here!</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {currentSessionId && messages.length > 0 && !historyMessages.some(m => m.session_id === currentSessionId) && (
                    <div style={{ marginBottom: '16px' }}>
                      <p className="section-title">✨ Active Research</p>
                      <div 
                        style={{
                          padding: '14px',
                          background: 'rgba(59, 130, 246, 0.15)',
                          borderRadius: '14px',
                          fontSize: '12px',
                          color: '#3b82f6',
                          border: '1px solid rgba(59, 130, 246, 0.4)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}
                      >
                        <div style={{ fontSize: '9px', fontWeight: 800, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Live Session
                        </div>
                        <span style={{ fontWeight: 700 }}>
                          {historyMessages.find(m => m.session_id === currentSessionId)?.title || 
                           messages.find(m => m.role === 'user')?.content.substring(0, 40) || 
                           'New Research'}
                        </span>
                      </div>
                    </div>
                  )}
                  <p className="section-title">🕒 Saved Conversations</p>
                  {historyMessages.map((m, i) => (
                    <div 
                      key={i}
                      onClick={() => loadSession(m.session_id)}
                      style={{
                        padding: '14px',
                        background: currentSessionId === m.session_id ? 'rgba(59, 130, 246, 0.1)' : 'var(--item-bg)',
                        borderRadius: '14px',
                        fontSize: '12px',
                        color: currentSessionId === m.session_id ? '#3b82f6' : 'var(--text-main)',
                        cursor: 'pointer',
                        border: '1px solid ' + (currentSessionId === m.session_id ? 'rgba(59, 130, 246, 0.3)' : 'var(--border-color)'),
                        transition: 'all 0.2s',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
                          <div style={{ fontSize: '9px', fontWeight: 800, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {new Date(m.timestamp).toLocaleDateString()}
                          </div>
                          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.title}
                          </span>
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSession(m.session_id);
                          }}
                          style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            color: '#ef4444',
                            border: 'none',
                            padding: '6px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>


        </aside>
      )}

      {/* Notification Modal */}
      {notification.isOpen && (
        <div className="auth-overlay" style={{ zIndex: 1200 }}>
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="auth-card"
            style={{ maxWidth: '400px', padding: '32px', textAlign: 'center' }}
          >
            <div className="auth-logo" style={{ marginBottom: '16px' }}>
              <div className="auth-logo-inner" style={{ 
                background: notification.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                borderColor: notification.type === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)'
              }}>
                {notification.type === 'error' ? <X size={24} color="#ef4444" /> : <Info size={24} color="#3b82f6" />}
              </div>
            </div>
            <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>{notification.title}</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-dim)', marginBottom: '24px' }}>{notification.message}</p>
            
            <button 
              onClick={() => setNotification(prev => ({ ...prev, isOpen: false }))}
              className="primary-auth-btn"
              style={{ width: '100%', margin: 0, padding: '12px' }}
            >
              UNDERSTOOD
            </button>
          </motion.div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="auth-overlay" style={{ zIndex: 1100 }}>
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="auth-card"
            style={{ maxWidth: '400px', padding: '32px', textAlign: 'center' }}
          >
            <div className="auth-logo" style={{ marginBottom: '16px' }}>
              <div className="auth-logo-inner" style={{ 
                background: confirmModal.danger ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                borderColor: confirmModal.danger ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)'
              }}>
                <Trash2 size={24} color={confirmModal.danger ? '#ef4444' : '#3b82f6'} />
              </div>
            </div>
            <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>{confirmModal.title}</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-dim)', marginBottom: '24px' }}>{confirmModal.message}</p>
            
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="edit-cancel-btn"
                style={{ flex: 1, margin: 0, padding: '12px' }}
              >
                CANCEL
              </button>
              <button 
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(prev => ({ ...prev, isOpen: false }));
                }}
                className="primary-auth-btn"
                style={{ 
                  flex: 1, 
                  margin: 0, 
                  padding: '12px',
                  background: confirmModal.danger ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  boxShadow: confirmModal.danger ? '0 10px 20px -5px rgba(239, 68, 68, 0.4)' : '0 10px 20px -5px rgba(59, 130, 246, 0.4)'
                }}
              >
                CONFIRM
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Auth Modal - Professional Redesign */}
      {isAuthModalOpen && (
        <div className="auth-overlay">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="auth-card"
          >
            <div className="auth-header" style={{ textAlign: 'left' }}>
              <div style={{ marginBottom: '16px' }}>
                <Sparkles size={36} color="var(--accent-primary)" />
              </div>
              <h2>{authMode === 'login' ? 'Welcome Back' : 'Get Started'}</h2>
              <p>Enter your credentials to access the Research Intelligence Suite</p>
            </div>
            
            <div className="auth-form">
              {authStatus && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className={"auth-status " + authStatus.type}
                >
                  {authStatus.msg}
                </motion.div>
              )}
              
              <div className="input-field">
                <label>USERNAME</label>
                <div className="input-wrapper">
                  <User size={18} />
                  <input 
                    type="text" 
                    placeholder="e.g. User123" 
                    value={authForm.username}
                    onChange={(e) => setAuthForm({...authForm, username: e.target.value})}
                  />
                </div>
              </div>
              
              <div className="input-field">
                <label>EMAIL ADDRESS</label>
                <div className="input-wrapper">
                  <Mail size={18} />
                  <input 
                    type="email" 
                    placeholder="name@company.com" 
                    value={authForm.email}
                    onChange={(e) => setAuthForm({...authForm, email: e.target.value})}
                  />
                </div>
              </div>
              
              <div className="input-field">
                <label>PASSWORD</label>
                <div className="input-wrapper">
                  <Lock size={18} />
                  <input 
                    type="password" 
                    placeholder="••••••••" 
                    value={authForm.password}
                    onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
                  />
                </div>
              </div>
              
              <button onClick={handleAuth} className="primary-auth-btn">
                {authMode === 'login' ? 'Sign In to Dashboard' : 'Create Your Account'}
              </button>
              
              <div className="auth-divider">
                <span>OR</span>
              </div>
              
              <p className="auth-switch">
                {authMode === 'login' ? "New to ResearchAI?" : "Already have an account?"}
                <span onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                  setAuthForm({ email: '', password: '', username: '' });
                  setAuthStatus(null);
                }}>
                  {authMode === 'login' ? ' Join now' : ' Sign in'}
                </span>
              </p>
            </div>
            
            <div className="auth-footer">
              Secure, encrypted research environment 🛡️
            </div>
          </motion.div>
        </div>
      )}

    </div>
  );
}
