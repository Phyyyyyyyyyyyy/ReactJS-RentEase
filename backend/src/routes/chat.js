/**
 * Chat between a tenant and the people who run a property (its owner and manager),
 * so payments, repairs, and move-in details can be sorted out inside RentEase.
 *
 * - One conversation per tenant + property.
 * - A conversation can only be started when there's a real link: the tenant has
 *   applied for (or rents) a unit in that property.
 * - Tenants see only their own conversations; owners and managers see only those
 *   on properties they run. Everyone else gets a 404.
 * - The app checks for new messages every few seconds (no live connection needed).
 */
import { Router } from 'express';
import { Form } from '../lib/forms.js';
import { endpoint, fail, HttpError, notFound, reply } from '../lib/http.js';
import { iso, nowIso } from '../lib/format.js';
import { minutes, RateLimiter } from '../lib/rateLimit.js';
import { displayName, initials, userBrief } from '../users.js';
import { RUNS } from './properties.js';

const CHAT_ROLES = ['tenant', 'owner', 'manager'];
const MAX_MESSAGE = 2000;
const PAGE = 200;

/** SQL condition: conversation `c` (joined to property `p`) is visible to `user`, with its parameters. */
function visible(user) {
  return user.role === 'tenant'
    ? { sql: 'c.tenant_id = ?', params: [user.id] }
    : { sql: RUNS('p'), params: [user.id, user.id] };
}

const UNREAD_SQL = `(SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id
    AND m.id > COALESCE((SELECT r.last_read_id FROM conversation_reads r WHERE r.conversation_id = c.id AND r.user_id = ?), 0)
    AND (m.sender_id IS NULL OR m.sender_id <> ?))`;

const CONVERSATION_SELECT = `
  SELECT c.*, p.name AS property_name, p.owner_id, p.manager_id,
    t.username AS t_username, t.first_name AS t_first_name, t.last_name AS t_last_name, t.profile_photo AS t_profile_photo,
    o.username AS o_username, o.first_name AS o_first_name, o.last_name AS o_last_name, o.profile_photo AS o_profile_photo,
    (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
    (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender_id,
    ${UNREAD_SQL} AS unread
  FROM conversations c
  JOIN properties p ON p.id = c.property_id
  JOIN users t ON t.id = c.tenant_id
  JOIN users o ON o.id = p.owner_id`;

function person(row, prefix, id) {
  return { id, username: row[`${prefix}_username`], first_name: row[`${prefix}_first_name`], last_name: row[`${prefix}_last_name`],
    profile_photo: row[`${prefix}_profile_photo`] };
}

function conversationJson(c, user) {
  const tenant = userBrief(person(c, 't', c.tenant_id));
  const owner = userBrief(person(c, 'o', c.owner_id));
  // The tenant talks to "the property"; owners and managers talk to a tenant.
  const other = user.role === 'tenant' ? owner : tenant;
  const body = c.last_body || '';
  return {
    id: c.id,
    property: { id: c.property_id, name: c.property_name },
    tenant,
    owner,
    title: user.role === 'tenant' ? `${c.property_name} · ${owner.full_name}` : `${tenant.full_name} · ${c.property_name}`,
    avatar: other,
    last_message: c.last_body === null || c.last_body === undefined ? null
      : { body: body.length > 120 ? `${body.slice(0, 117)}…` : body, mine: c.last_sender_id === user.id },
    last_message_at: iso(c.last_message_at),
    unread: Number(c.unread || 0),
  };
}

function messageJson(m, user) {
  return {
    id: m.id,
    body: m.body,
    created_at: iso(m.created_at),
    mine: m.sender_id === user.id,
    sender: m.sender_id ? {
      id: m.sender_id, full_name: displayName(m), initials: initials(m), role: m.role,
      photo: m.profile_photo ? `/media/${m.profile_photo}` : null,
    } : { id: null, full_name: 'Deleted account', initials: '?', role: null, photo: null },
  };
}

/** Total unread messages for the sidebar badge. */
export async function unreadMessages(db, user) {
  if (!CHAT_ROLES.includes(user.role)) return 0;
  const v = visible(user);
  const row = await db.get(
    `SELECT COALESCE(SUM(${UNREAD_SQL}), 0) AS n FROM conversations c JOIN properties p ON p.id = c.property_id WHERE ${v.sql}`,
    [user.id, user.id, ...v.params]);
  return Number(row.n);
}

/** True if the tenant has applied for (or rents) a unit in the property. */
async function hasLink(db, tenantId, propertyId) {
  return Boolean(await db.get(
    'SELECT 1 AS x FROM applications a JOIN units u ON u.id = a.unit_id WHERE a.tenant_id = ? AND u.property_id = ?',
    [tenantId, propertyId]));
}

export default function chatRoutes(db, { limits = {} } = {}) {
  const router = Router();
  // Stop message flooding: 30 messages a minute per person is plenty for a conversation.
  const sendLimiter = new RateLimiter(limits.messagesPerUser || { limit: 30, windowMs: 60_000 });

  async function visibleConversation(req) {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw notFound();
    const v = visible(req.user);
    const c = await db.get(`${CONVERSATION_SELECT} WHERE c.id = ? AND ${v.sql}`, [req.user.id, req.user.id, id, ...v.params]);
    if (!c) throw notFound();
    return c;
  }

  async function markRead(conversationId, userId, lastId) {
    if (!lastId) return;
    await db.run(
      `INSERT INTO conversation_reads (conversation_id, user_id, last_read_id) VALUES (?, ?, ?)
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_id = excluded.last_read_id
       WHERE excluded.last_read_id > conversation_reads.last_read_id`,
      [conversationId, userId, lastId]);
  }

  endpoint(router, '/conversations/', {
    roles: CHAT_ROLES,
    GET: async (req) => {
      const v = visible(req.user);
      const rows = await db.all(
        `${CONVERSATION_SELECT} WHERE ${v.sql} ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC`,
        [req.user.id, req.user.id, ...v.params]);
      return { conversations: rows.map((c) => conversationJson(c, req.user)) };
    },
    // Open (or find) the conversation with a property (tenant) or with a tenant (owner/manager).
    POST: async (req) => {
      const form = new Form(req.body);
      const propertyId = form.integer('property', { min: 1 });
      const tenantId = req.user.role === 'tenant' ? req.user.id : form.integer('tenant', { min: 1 });
      form.check();
      const property = await db.get('SELECT * FROM properties WHERE id = ?', [propertyId]);
      if (!property) throw notFound();
      if (req.user.role !== 'tenant' && property.owner_id !== req.user.id && property.manager_id !== req.user.id) throw notFound();
      if (!await hasLink(db, tenantId, propertyId)) {
        throw new HttpError(403, {
          message: req.user.role === 'tenant'
            ? 'You can message a property after you apply for one of its units.'
            : 'You can message a tenant after they apply for one of this property’s units.',
        });
      }
      await db.run('INSERT INTO conversations (property_id, tenant_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        [propertyId, tenantId, nowIso()]);
      const { id } = await db.get('SELECT id FROM conversations WHERE property_id = ? AND tenant_id = ?', [propertyId, tenantId]);
      return reply(201, { id });
    },
  });

  endpoint(router, '/conversations/:id/messages/', {
    roles: CHAT_ROLES,
    // The latest messages, or with ?after=<id> only newer ones (used to check for new messages).
    GET: async (req) => {
      const c = await visibleConversation(req);
      const after = Number(req.query.after) || 0;
      const rows = after
        ? await db.all(`SELECT m.*, u.username, u.first_name, u.last_name, u.profile_photo, u.role FROM messages m
            LEFT JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ? AND m.id > ? ORDER BY m.id LIMIT ${PAGE}`, [c.id, after])
        : (await db.all(`SELECT m.*, u.username, u.first_name, u.last_name, u.profile_photo, u.role FROM messages m
            LEFT JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT ${PAGE}`, [c.id])).reverse();
      await markRead(c.id, req.user.id, rows.at(-1)?.id);
      return { conversation: conversationJson({ ...c, unread: 0 }, req.user), messages: rows.map((m) => messageJson(m, req.user)) };
    },
    POST: async (req, res) => {
      const c = await visibleConversation(req);
      const wait = sendLimiter.retryAfter(`user:${req.user.id}`);
      if (wait) {
        res.set('Retry-After', String(wait));
        throw fail(`You're sending messages too quickly. Please wait ${minutes(wait)}.`, 429);
      }
      const form = new Form(req.body);
      const body = form.text('body', { max: MAX_MESSAGE });
      form.check();
      sendLimiter.hit(`user:${req.user.id}`);
      const now = nowIso();
      const id = await db.insert('INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)',
        [c.id, req.user.id, body, now]);
      await db.run('UPDATE conversations SET last_message_at = ? WHERE id = ?', [now, c.id]);
      await markRead(c.id, req.user.id, id);
      const row = await db.get(`SELECT m.*, u.username, u.first_name, u.last_name, u.profile_photo, u.role FROM messages m
        LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?`, [id]);
      return reply(201, { message: messageJson(row, req.user) });
    },
  });

  return router;
}
