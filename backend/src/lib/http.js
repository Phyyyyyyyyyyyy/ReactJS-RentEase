/**
 * Routing helpers for the JSON API.
 *
 *   endpoint(router, '/browse/:id/', { roles: ['tenant'], GET: handler, POST: handler })
 *
 * A handler gets `req` and returns the JSON body (status 200), or `reply(status, body)`.
 * Throwing an HttpError sends its status and body. Each endpoint checks, in order:
 * signed in (401), role (403), then HTTP method (405).
 */
import multer from 'multer';

export class HttpError extends Error {
  constructor(status, body) {
    super(body?.message || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

class Reply {
  constructor(status, body) {
    this.status = status;
    this.body = body;
  }
}

export const reply = (status, body) => new Reply(status, body);

/** 400 with a single message, e.g. "Only pending applications can be edited." */
export const fail = (message, status = 400) => new HttpError(status, { message });

export const notFound = () => new HttpError(404, { message: 'That page could not be found.' });

/** 400 listing field errors as {field: [messages]}; form-level errors go under non_field_errors. */
export const formErrors = (errors, message = 'Please fix the errors below.') =>
  new HttpError(400, { message, errors });

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const uploads = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 5, fields: 50 },
}).any();

/** Parse multipart/form-data (file uploads) into req.body and req.filesByField. */
function parseUploads(req, res) {
  return new Promise((resolve, reject) => {
    uploads(req, res, (error) => {
      if (!error) {
        req.filesByField = Object.fromEntries((req.files || []).map((f) => [f.fieldname, f]));
        resolve();
      } else if (error.code === 'LIMIT_FILE_SIZE') {
        reject(formErrors({ [error.field]: ['The file must be 10 MB or smaller.'] }));
      } else {
        reject(fail('The upload could not be read. Please try again.'));
      }
    });
  });
}

export function endpoint(router, path, { roles, public: isPublic = false, uploads: acceptsUploads = false, ...methods }) {
  router.all(path, async (req, res) => {
    if (!isPublic && !req.user) {
      throw new HttpError(401, { message: 'Please sign in to continue.' });
    }
    if (roles && !roles.includes(req.user.role)) {
      throw new HttpError(403, { message: 'You do not have permission to open that page.' });
    }
    const handler = methods[req.method];
    if (!handler) {
      res.set('Allow', Object.keys(methods).join(', '));
      throw new HttpError(405, { message: `Method "${req.method}" not allowed.` });
    }
    req.filesByField = {};
    if (acceptsUploads && req.is('multipart/form-data')) await parseUploads(req, res);
    req.body ??= {};
    const result = await handler(req, res);
    if (res.headersSent) return; // the handler sent its own response (e.g. a CSV download)
    if (result instanceof Reply) res.status(result.status).json(result.body);
    else res.json(result);
  });
}

/** Express error handler for the API: HttpErrors become JSON; anything else is a 500. */
export function apiErrorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  if (error instanceof HttpError) {
    res.status(error.status).json(error.body);
    return;
  }
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ message: 'The request body is not valid JSON.' });
    return;
  }
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ message: 'The request is too large.' });
    return;
  }
  console.error(error);
  res.status(500).json({ message: 'Something went wrong on the server. Please try again.' });
}
