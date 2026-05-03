import { useState, useRef, useEffect } from 'react';
import { api } from '../services/api';

// Very lightweight markdown: bold, italic, bullet lists, newlines
function renderMarkdown(text) {
  const lines = text.split('\n');
  const elements = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Bullet list
    if (/^[\*\-] /.test(line)) {
      const content = line.replace(/^[\*\-] /, '');
      elements.push(<li key={key++} style={{ marginLeft: 16 }}>{inlineFormat(content)}</li>);
      continue;
    }

    // Blank line → spacer
    if (line.trim() === '') {
      if (elements.length && elements[elements.length - 1]?.type !== 'br') {
        elements.push(<br key={key++} />);
      }
      continue;
    }

    elements.push(<span key={key++}>{inlineFormat(line)}<br /></span>);
  }

  return elements;
}

function inlineFormat(text) {
  // Bold **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    return p;
  });
}

const SUGGESTIONS = [
  'What are the high priority pending items?',
  'Summarize last month\'s water usage',
  'How is billing calculated?',
  'What is the current cost per litre?',
];

export default function ChatBot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'model', text: 'Hi! I\'m your WaterApp assistant. Ask me about billing, usage, pending maintenance items, or anything about your society\'s water management.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open, loading]);

  // Focus input when opened
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const sendMessage = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    setInput('');
    setError('');
    const userMsg = { role: 'user', text: msg };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    // Build history (exclude welcome message, last 8 turns for context window)
    const historyForApi = messages
      .slice(1)
      .slice(-8)
      .map(m => ({ role: m.role, text: m.text }));

    try {
      const { reply } = await api.chat(msg, historyForApi);
      setMessages(prev => [...prev, { role: 'model', text: reply }]);
    } catch (err) {
      setError(err.message || 'Failed to get a response. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([
      { role: 'model', text: 'Hi! I\'m your WaterApp assistant. Ask me about billing, usage, pending maintenance items, or anything about your society\'s water management.' },
    ]);
    setError('');
  };

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #1976d2, #42a5f5)',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(25,118,210,0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          zIndex: 1000,
          transition: 'transform 0.15s ease',
        }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        title="AI Assistant"
        aria-label="Open AI assistant"
      >
        {open ? '✕' : '🤖'}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: 86,
          right: 24,
          width: 360,
          maxHeight: '75vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'white',
          borderRadius: 16,
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          zIndex: 999,
          overflow: 'hidden',
          border: '1px solid #e3eaf5',
          fontFamily: 'inherit',
        }}>
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, #1976d2, #42a5f5)',
            color: 'white',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>🤖</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>WaterApp Assistant</div>
                <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>Powered by Gemini 1.5 Flash</div>
              </div>
            </div>
            <button onClick={clearChat} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: '0.75rem' }} title="Clear chat">
              Clear
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((msg, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '85%',
                  padding: '8px 12px',
                  borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: msg.role === 'user' ? '#1976d2' : '#f0f4ff',
                  color: msg.role === 'user' ? 'white' : '#1a1a2e',
                  fontSize: '0.85rem',
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                }}>
                  {msg.role === 'model' ? renderMarkdown(msg.text) : msg.text}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ background: '#f0f4ff', borderRadius: '14px 14px 14px 4px', padding: '10px 14px', fontSize: '0.85rem', color: '#555' }}>
                  <span style={{ display: 'inline-block', animation: 'pulse 1s infinite' }}>Thinking…</span>
                </div>
              </div>
            )}

            {error && (
              <div style={{ background: '#fff0f0', color: '#c62828', borderRadius: 8, padding: '8px 12px', fontSize: '0.82rem' }}>
                ⚠️ {error}
              </div>
            )}

            {/* Suggestion pills — only on first message */}
            {messages.length === 1 && !loading && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => sendMessage(s)} style={{
                    background: '#e8f4fd',
                    border: '1px solid #90caf9',
                    borderRadius: 20,
                    padding: '4px 10px',
                    fontSize: '0.75rem',
                    color: '#1565c0',
                    cursor: 'pointer',
                    lineHeight: 1.4,
                  }}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '10px 12px', borderTop: '1px solid #eaf0fb', flexShrink: 0, display: 'flex', gap: 8, background: '#fafcff' }}>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about water usage, billing…"
              style={{
                flex: 1,
                resize: 'none',
                border: '1px solid #c5d8f0',
                borderRadius: 10,
                padding: '8px 11px',
                fontSize: '0.85rem',
                fontFamily: 'inherit',
                outline: 'none',
                lineHeight: 1.4,
                maxHeight: 80,
                overflowY: 'auto',
              }}
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              style={{
                background: loading || !input.trim() ? '#c5d8f0' : '#1976d2',
                border: 'none',
                borderRadius: 10,
                color: 'white',
                cursor: loading || !input.trim() ? 'default' : 'pointer',
                padding: '0 14px',
                fontSize: 18,
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
              title="Send"
            >
              ➤
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  );
}
