/** Notifications API: the signed-in user's own notifications only. */
import { Router } from 'express';
import { endpoint, notFound } from '../lib/http.js';
import { notificationJson, remindTenant } from '../notifications.js';

export default function notificationsRoutes(db) {
  const router = Router();

  endpoint(router, '/notifications/', {
    GET: async (req) => {
      if (req.user.role === 'tenant') await remindTenant(db, req.user.id);
      const rows = await db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50',
        [req.user.id]);
      const unread = await db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]);
      return { notifications: rows.map(notificationJson), unread: Number(unread.n) };
    },
  });

  endpoint(router, '/notifications/read-all/', {
    POST: async (req) => {
      await db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
      return { message: 'All notifications marked as read.' };
    },
  });

  endpoint(router, '/notifications/:id/read/', {
    POST: async (req) => {
      const id = Number(req.params.id);
      const { changes } = Number.isSafeInteger(id)
        ? await db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, req.user.id])
        : { changes: 0 };
      if (!changes) throw notFound();
      return { message: 'Marked as read.' };
    },
  });

  return router;
}
