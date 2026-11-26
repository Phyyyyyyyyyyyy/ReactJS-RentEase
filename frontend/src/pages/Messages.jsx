import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { usePageTitle } from '../components/AppLayout';
import Icon from '../components/Icon';
import { Avatar, EmptyState, LoadError } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useFlash } from '../context/FlashContext';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';

const LIST_EVERY_MS = 10_000;
const THREAD_EVERY_MS = 4_000;

/** Runs `fn` now and then every `ms` while the page is visible. */
function usePolling(fn, ms, deps) {
  useEffect(() => {
    let stopped = false;
    const tick = () => { if (!stopped && document.visibilityState === 'visible') fn(); };
    tick();
    const timer = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** /messages and /messages/:id: conversations between tenants and the people who run their property. */
export default function Messages() {
  usePageTitle('Messages');
  const { id } = useParams();
  const [conversations, setConversations] = useState(null);
  const [error, setError] = useState(null);

  const loadList = useCallback(() => {
    api('/conversations/').then((d) => setConversations(d.conversations)).catch(setError);
  }, []);
  usePolling(loadList, LIST_EVERY_MS, [loadList]);

  if (error) return <LoadError error={error} />;
  return (
    <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <aside className={`${id ? 'hidden lg:grid' : 'grid'} content-start gap-2 rounded-2xl border border-line bg-white p-3 shadow-sm`}>
        <h1 className="m-0 px-2 pt-1 text-base font-bold text-slate-900">Messages</h1>
        {conversations === null && <p className="m-0 p-2 text-sm text-slate-400">Loading…</p>}
        {conversations?.length === 0 && (
          <p className="m-0 p-2 text-xs text-slate-500">
            No conversations yet. Start one with the <strong>Message</strong> button on an application or rent page.
          </p>
        )}
        {conversations?.map((c) => (
          <Link key={c.id} to={`/messages/${c.id}`}
            className={`flex items-center gap-3 rounded-xl p-2.5 no-underline ${String(c.id) === id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
            <Avatar user={c.avatar} className="avatar avatar-small" />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm ${c.unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>{c.title}</span>
              <span className="block truncate text-xs text-slate-500">
                {c.last_message ? `${c.last_message.mine ? 'You: ' : ''}${c.last_message.body}` : 'No messages yet'}
              </span>
            </span>
            {c.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">{c.unread}</span>}
          </Link>
        ))}
      </aside>
      {id ? <Thread key={id} id={id} onActivity={loadList} /> : (
        <div className="hidden lg:grid">
          <EmptyState icon="chat" title="Choose a conversation" text="Messages about payments, repairs, and move-in stay here, with the property's owner and manager." />
        </div>
      )}
    </div>
  );
}

function Thread({ id, onActivity }) {
  const { user, refreshBadges } = useAuth();
  const { notify } = useFlash();
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const lastId = useRef(0);
  const bottom = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await api(`/conversations/${id}/messages/${lastId.current ? `?after=${lastId.current}` : ''}`);
      setConversation(data.conversation);
      if (data.messages.length) {
        lastId.current = data.messages.at(-1).id;
        setMessages((old) => [...old, ...data.messages.filter((m) => !old.some((o) => o.id === m.id))]);
        refreshBadges();
        onActivity();
      }
    } catch (e) {
      setError(e);
    }
  }, [id, refreshBadges, onActivity]);
  usePolling(load, THREAD_EVERY_MS, [load]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  const send = async (e) => {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const data = await api(`/conversations/${id}/messages/`, { method: 'POST', body: { body } });
      setDraft('');
      lastId.current = Math.max(lastId.current, data.message.id);
      setMessages((old) => [...old, data.message]);
      onActivity();
    } catch (err) {
      notify('error', err.data?.errors?.body?.[0] || err.message);
    } finally {
      setSending(false);
    }
  };

  if (error) return <LoadError error={error} />;
  return (
    <section className="flex min-h-[70vh] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
      <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <Link to="/messages" className="text-sm font-semibold text-brand no-underline lg:hidden">←</Link>
        {conversation && <Avatar user={conversation.avatar} className="avatar avatar-small" />}
        <div className="min-w-0">
          <strong className="block truncate text-sm text-slate-900">{conversation?.title || 'Conversation'}</strong>
          {conversation && (
            <span className="text-xs text-slate-500">
              {user.role === 'tenant' ? 'The owner and property manager can read this conversation.' : `Tenant of ${conversation.property.name}`}
            </span>
          )}
        </div>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4" style={{ maxHeight: '60vh' }}>
        {messages.length === 0 && <p className="m-0 py-10 text-center text-sm text-slate-400">No messages yet. Say hello!</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${m.mine ? 'bg-brand text-white' : 'border border-line bg-white text-slate-800'}`}>
              {!m.mine && <span className="mb-0.5 block text-[11px] font-bold opacity-70">{m.sender.full_name}</span>}
              <span className="whitespace-pre-wrap break-words">{m.body}</span>
              <span className={`mt-1 block text-right text-[10px] ${m.mine ? 'text-white/70' : 'text-slate-400'}`}>{formatDate(m.created_at, 'M j, g:i A')}</span>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-100 p-3">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={2000} aria-label="Message"
          placeholder="Write a message… (Enter to send, Shift+Enter for a new line)" className="min-h-12 flex-1 resize-y"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button type="submit" className="primary-button inline-flex cursor-pointer items-center gap-1.5" disabled={sending || !draft.trim()}>
          <Icon name="arrow" size={16} />Send
        </button>
      </form>
    </section>
  );
}
