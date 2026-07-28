'use client';

import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';

interface Message { role: 'user' | 'assistant'; content: string }

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4000';

function getCookieClient(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';').map(s => s.trim())) {
    if (part.startsWith(`${name}=`)) return decodeURIComponent(part.slice(name.length + 1));
  }
  return null;
}

export function ChatWidget({ businessName }: { businessName: string }): JSX.Element {
  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input,    setInput]    = useState('');
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setBusy(true);
    setError(null);

    try {
      const slug = getCookieClient('tenant_slug') ?? '';
      const res  = await fetch(`${API_ORIGIN}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Slug': slug,
        },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-6),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Error ${res.status}`);
      }

      const { reply } = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      setError("Sorry, I'm having trouble responding right now. Please try again or call us directly.");
    } finally {
      setBusy(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* Chat window */}
      {open && (
        <div
          className="mb-3 flex flex-col rounded-2xl shadow-2xl overflow-hidden"
          style={{
            width: 360,
            height: 480,
            background: 'var(--surface-0)',
            border: '1px solid var(--surface-200)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ background: 'var(--brand-600)' }}>
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <div>
                <div className="text-sm font-semibold text-white">{businessName}</div>
                <div className="text-xs text-white opacity-70">Usually replies instantly</div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-white opacity-70 hover:opacity-100 transition-opacity p-1"
              aria-label="Close chat"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3l10 10M13 3L3 13"/>
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {/* Welcome message */}
            {messages.length === 0 && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--brand-500)' }}>
                  {businessName.charAt(0)}
                </div>
                <div className="rounded-2xl rounded-tl-sm px-3 py-2 text-sm max-w-[80%]" style={{ background: 'var(--surface-100)', color: 'var(--ink-800)' }}>
                  Hi there! 👋 I'm here to help with questions about our services, pricing, and scheduling. What can I help you with?
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                {m.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--brand-500)' }}>
                    {businessName.charAt(0)}
                  </div>
                )}
                <div
                  className="rounded-2xl px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap"
                  style={m.role === 'user'
                    ? { background: 'var(--brand-600)', color: 'white', borderBottomRightRadius: 4 }
                    : { background: 'var(--surface-100)', color: 'var(--ink-800)', borderTopLeftRadius: 4 }
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {busy && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--brand-500)' }}>
                  {businessName.charAt(0)}
                </div>
                <div className="rounded-2xl rounded-tl-sm px-3 py-2.5 flex gap-1" style={{ background: 'var(--surface-100)' }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--ink-400)', animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--ink-400)', animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--ink-400)', animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs px-3 py-2 rounded-xl" style={{ background: '#fef2f2', color: '#991b1b' }}>
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 flex-shrink-0 border-t" style={{ borderColor: 'var(--surface-200)' }}>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--surface-50)', border: '1px solid var(--surface-200)' }}>
              <input
                ref={inputRef}
                className="flex-1 text-sm bg-transparent outline-none"
                style={{ color: 'var(--ink-900)' }}
                placeholder="Ask a question…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                disabled={busy}
                maxLength={500}
              />
              <button
                onClick={send}
                disabled={!input.trim() || busy}
                className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                style={{
                  background: input.trim() && !busy ? 'var(--brand-600)' : 'var(--surface-200)',
                  color: input.trim() && !busy ? 'white' : 'var(--ink-400)',
                }}
                aria-label="Send"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1.5 1.5l13 6.5-13 6.5v-5l9-1.5-9-1.5z"/>
                </svg>
              </button>
            </div>
            <div className="text-center mt-1.5 text-xs" style={{ color: 'var(--ink-300)' }}>Powered by AI</div>
          </div>
        </div>
      )}

      {/* Bubble button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
        style={{ background: 'var(--brand-600)' }}
        aria-label={open ? 'Close chat' : 'Chat with us'}
      >
        {open ? (
          <svg className="w-5 h-5 text-white" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
          </svg>
        ) : (
          <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        )}
      </button>
    </div>
  );
}
