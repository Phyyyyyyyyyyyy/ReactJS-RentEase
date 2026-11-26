import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { makeApplication, makeProperty, makeUnit, makeUser, setup } from './helpers.js';

let env;
let db;
let owner;
let manager;
let tenant;
let stranger;
let prop;
let otherProp;
let ownerClient;
let tenantClient;

beforeEach(async () => {
  env = await setup({ limits: { messagesPerUser: { limit: 5, windowMs: 60_000 } } });
  ({ db } = env);
  owner = await makeUser(db, 'owner', 'owner');
  manager = await makeUser(db, 'mgr', 'manager');
  tenant = await makeUser(db, 'tenant', 'tenant');
  stranger = await makeUser(db, 'stranger', 'tenant');
  prop = await makeProperty(db, owner, { name: 'Lahug Apartments', address: 'A' });
  otherProp = await makeProperty(db, owner, { name: 'Elsewhere', address: 'B' });
  const unit = await makeUnit(db, prop, { name: '101', rent: 8000 });
  await makeApplication(db, tenant, unit);
  await db.run('UPDATE properties SET manager_id = ? WHERE id = ?', [manager.id, prop.id]);
  ownerClient = env.client;
  await ownerClient.login(owner);
  tenantClient = env.newClient();
  await tenantClient.login(tenant);
});
afterEach(() => env.close());

const start = (client, body) => client.post('/conversations/', body);
const send = (client, id, body) => client.post(`/conversations/${id}/messages/`, { body });

describe('chat', () => {
  it('a tenant and the owner message each other, with unread counts', async () => {
    const { json, status } = await start(tenantClient, { property: prop.id });
    assert.equal(status, 201);
    const id = json.id;
    assert.equal((await start(tenantClient, { property: prop.id })).json.id, id); // same conversation again

    assert.equal((await send(tenantClient, id, 'Hi! I sent ₱8,000 by GCash, ref 1234567890123.')).status, 201);
    assert.equal((await ownerClient.get('/badges/')).json.unread_messages, 1);
    const list = (await ownerClient.get('/conversations/')).json.conversations;
    assert.deepEqual([list[0].title, list[0].unread, list[0].last_message.body], ['Tenant Test · Lahug Apartments', 1, 'Hi! I sent ₱8,000 by GCash, ref 1234567890123.']);

    const thread = (await ownerClient.get(`/conversations/${id}/messages/`)).json;
    assert.equal(thread.messages.length, 1);
    assert.equal(thread.messages[0].mine, false);
    assert.equal((await ownerClient.get('/badges/')).json.unread_messages, 0); // reading clears it

    const reply = (await send(ownerClient, id, 'Got it, confirmed. Thanks!')).json.message;
    assert.equal(reply.mine, true);
    // Checking for new messages returns only newer ones.
    const newer = (await tenantClient.get(`/conversations/${id}/messages/`, { after: thread.messages[0].id })).json.messages;
    assert.deepEqual(newer.map((m) => [m.body, m.sender.full_name]), [['Got it, confirmed. Thanks!', 'Owner Test']]);
  });

  it('the property manager is in the conversation too', async () => {
    const id = (await start(tenantClient, { property: prop.id })).json.id;
    await send(tenantClient, id, 'Hello');
    const mgr = env.newClient();
    await mgr.login(manager);
    assert.equal((await mgr.get('/badges/')).json.unread_messages, 1);
    assert.equal((await send(mgr, id, 'Manager here, I can help.')).status, 201);
  });

  it('owners and managers can start a conversation with a tenant who applied', async () => {
    const { json } = await start(ownerClient, { property: prop.id, tenant: tenant.id });
    assert.equal((await tenantClient.get(`/conversations/${json.id}/messages/`)).status, 200);
  });

  it('only people linked to the property can start or read a conversation', async () => {
    const strangerClient = env.newClient();
    await strangerClient.login(stranger);
    // A tenant who never applied can't message the property, and an owner can't message them.
    assert.equal((await start(strangerClient, { property: prop.id })).status, 403);
    assert.equal((await start(ownerClient, { property: prop.id, tenant: stranger.id })).status, 403);
    assert.equal((await start(tenantClient, { property: otherProp.id })).status, 403);

    const id = (await start(tenantClient, { property: prop.id })).json.id;
    await send(tenantClient, id, 'PRIVATE: my bank details');
    for (const user of [stranger, await makeUser(db, 'owner2', 'owner'), await makeUser(db, 'mgr2', 'manager')]) {
      const c = env.newClient();
      await c.login(user);
      assert.equal((await c.get(`/conversations/${id}/messages/`)).status, 404, user.username);
      assert.equal((await send(c, id, 'hi')).status, 404, user.username);
      assert.ok(!JSON.stringify((await c.get('/conversations/')).json).includes('PRIVATE'), user.username);
      if (user.role !== 'tenant') assert.equal((await start(c, { property: prop.id, tenant: tenant.id })).status, 404);
    }
    const admin = env.newClient();
    await admin.login(await makeUser(db, 'root', 'admin'));
    assert.equal((await admin.get('/conversations/')).status, 403);
  });

  it('messages are plain text with a length limit, and flooding is stopped', async () => {
    const id = (await start(tenantClient, { property: prop.id })).json.id;
    assert.ok((await send(tenantClient, id, '   ')).json.errors.body);
    assert.ok((await send(tenantClient, id, 'x'.repeat(2001))).json.errors.body);
    const html = (await send(tenantClient, id, '<img src=x onerror=alert(1)>')).json.message;
    assert.equal(html.body, '<img src=x onerror=alert(1)>'); // stored as text; React shows it as text
    for (let i = 0; i < 4; i += 1) await send(tenantClient, id, `msg ${i}`);
    assert.equal((await send(tenantClient, id, 'one too many')).status, 429);
  });
});
