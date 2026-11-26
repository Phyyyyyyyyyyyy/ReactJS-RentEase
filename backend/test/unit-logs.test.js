import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parseAmount, parseDate, readLogCsv } from '../src/csvImport.js';
import { makeProperty, makeUnit, makeUser, setup } from './helpers.js';

// Like the user's Excel sheet after File > Save As > CSV: title rows, blank columns,
// quoted dates and amounts with commas, and a total at the bottom.
const SHEET_CSV = [
  ',,Statement of Account,,,,,',
  ',,,,,,,',
  'Date:,"As of November 26, 2026",,,,,,',
  'To: Mr. Artchille L. Alcuino & Cheryl L. Alcuino,,,,,,,',
  'Re: Block 2 Lot 42 House & Lot Lessandra Roma,,,,,,,',
  'Term:,12 yrs / Rent to Own,,,,,,',
  'Contract Price:,"PH 3,000,000.00",,,,,,',
  'Payments:,,,Date,,Amount,,Mode of Payments',
  'Reservation payments,,,"Oct 31, 2019",,"60,000",,Cash payments',
  'Issued check,,,"Nov 05, 2019",,"20,000",,Checked deposit',
  'Issued check,,,"May 05,2021",,"20,000",,Checked deposit',
  'Online banking,,,"Nov 05, 2022",,"20,200",,Online bank deposit',
  'Online banking,,,"April 05, 2024",,"20,000",,Checked deposit',
  ',,,,,"1,760,200",,',
].join('\r\n');

describe('reading the spreadsheet CSV', () => {
  it('reads dates in the formats spreadsheets use', () => {
    assert.equal(parseDate('Oct 31, 2019'), '2019-10-31');
    assert.equal(parseDate('May 05,2021'), '2021-05-05');
    assert.equal(parseDate('April 05, 2024'), '2024-04-05');
    assert.equal(parseDate('2019-10-31'), '2019-10-31');
    assert.equal(parseDate('10/31/2019'), '2019-10-31');
    assert.equal(parseDate('31-Oct-19'), '2019-10-31');
    assert.equal(parseDate('Feb 30, 2024'), null);
    assert.equal(parseDate('As of November 26, 2026'), null);
  });

  it('reads amounts', () => {
    assert.equal(parseAmount('20,000'), 2000000);
    assert.equal(parseAmount('₱ 20,200.50'), 2020050);
    assert.equal(parseAmount('PH 3,000,000.00'), 300000000);
    assert.equal(parseAmount('0'), null);
    assert.equal(parseAmount('abc'), null);
  });

  it('finds the payments and skips titles, headers, and totals', () => {
    const { entries, skipped } = readLogCsv(SHEET_CSV);
    assert.deepEqual(entries.map((e) => [e.description, e.entry_date, e.amount, e.mode]), [
      ['Reservation payments', '2019-10-31', 6000000, 'Cash payments'],
      ['Issued check', '2019-11-05', 2000000, 'Checked deposit'],
      ['Issued check', '2021-05-05', 2000000, 'Checked deposit'],
      ['Online banking', '2022-11-05', 2020000, 'Online bank deposit'],
      ['Online banking', '2024-04-05', 2000000, 'Checked deposit'],
    ]);
    assert.ok(skipped.some((s) => /1,760,200/.test(s.text)));
  });
});

describe('payment logs', () => {
  let env;
  let db;
  let client;
  let owner;
  let unit;

  beforeEach(async () => {
    env = await setup();
    ({ db, client } = env);
    owner = await makeUser(db, 'owner', 'owner');
    const prop = await makeProperty(db, owner, { name: 'Lessandra Roma', address: 'Lawaan', city: 'Talisay' });
    unit = await makeUnit(db, prop, { name: 'Block 2 Lot 42', rent: 20000 });
    await db.run("UPDATE units SET listing_type = 'rent_to_own', contract_price = 300000000, term_years = 12, interest_rate_bp = 500 WHERE id = ?", [unit.id]);
    await client.login(owner);
  });
  afterEach(() => env.close());

  const newLog = (body = {}) => client.post(`/owner/units/${unit.id}/logs/`, {
    holder_name: 'Mr. Artchille L. Alcuino & Cheryl L. Alcuino', start_date: '2019-10-31', ...body,
  });

  it('creates a log with the unit’s contract terms by default', async () => {
    const { json } = await newLog();
    const { log } = (await client.get(`/owner/logs/${json.id}/`)).json;
    assert.deepEqual([log.holder_name, log.contract_price, log.term_years, log.interest_rate, log.monthly_amount],
      ['Mr. Artchille L. Alcuino & Cheryl L. Alcuino', '3000000.00', 12, '5.00', '20000.00']);
    assert.ok((await newLog({ holder_name: '' })).json.errors.holder_name);
  });

  it('adds, edits, and deletes entries, and totals them like the sheet', async () => {
    const id = (await newLog()).json.id;
    const add = (body) => client.post(`/owner/logs/${id}/entries/`, body);
    assert.equal((await add({ entry_date: '2019-10-31', description: 'Reservation payments', amount: '60000', mode: 'Cash payments' })).status, 201);
    await add({ entry_date: '2019-11-05', description: 'Issued check', amount: '20000', mode: 'Checked deposit', reference: 'BDO 001234' });
    assert.ok((await add({ entry_date: 'soon', amount: '-5' })).json.errors.amount);
    let data = (await client.get(`/owner/logs/${id}/`)).json;
    assert.deepEqual([data.log.total_paid, data.log.remaining_balance, data.log.percent_paid], ['80000.00', '2920000.00', 2.7]);
    const check = data.entries[1];
    await client.put(`/owner/log-entries/${check.id}/`, { ...check, amount: '20200' });
    await client.delete(`/owner/log-entries/${data.entries[0].id}/`);
    data = (await client.get(`/owner/logs/${id}/`)).json;
    assert.deepEqual(data.entries.map((e) => [e.amount, e.reference]), [['20200.00', 'BDO 001234']]);
  });

  it('previews, then imports the spreadsheet; importing again adds nothing', async () => {
    const id = (await newLog()).json.id;
    const preview = (await client.post(`/owner/logs/${id}/import/`, { csv: SHEET_CSV, preview: true })).json;
    assert.equal(preview.rows.length, 5);
    assert.equal(preview.total, '140200.00');
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM unit_log_entries')).n, 0); // preview saves nothing
    const done = (await client.post(`/owner/logs/${id}/import/`, { csv: SHEET_CSV })).json;
    assert.equal(done.added, 5);
    const again = (await client.post(`/owner/logs/${id}/import/`, { csv: SHEET_CSV })).json;
    assert.equal(again.added, 0);
    assert.ok(again.rows.every((r) => r.duplicate));
    const { log } = (await client.get(`/owner/logs/${id}/`)).json;
    assert.deepEqual([log.entries_count, log.total_paid, log.remaining_balance], [5, '140200.00', '2859800.00']);
    assert.equal((await client.post(`/owner/logs/${id}/import/`, { csv: '  ' })).status, 400);
  });

  it('exports CSV like the sheet, with formula text made harmless', async () => {
    const id = (await newLog()).json.id;
    await client.post(`/owner/logs/${id}/entries/`, { entry_date: '2019-10-31', description: '=HYPERLINK("x")', amount: '60000', mode: 'Cash payments' });
    const response = await fetch(`${client.base}/api/owner/logs/${id}/export/`, { headers: { Cookie: `sessionid=${client.cookies.sessionid}` } });
    const csv = await response.text();
    assert.match(response.headers.get('content-disposition'), /payment-log-/);
    for (const expected of ['To,Mr. Artchille L. Alcuino & Cheryl L. Alcuino', 'Contract price (PHP),3000000.00', '2019-10-31,60000.00,Cash payments',
      'Remaining balance (PHP),,2940000.00', `"'=HYPERLINK(""x"")"`]) {
      assert.ok(csv.includes(expected), expected);
    }
  });

  it('only the owner and the property’s manager can see or change a log', async () => {
    const id = (await newLog()).json.id;
    const entry = await client.post(`/owner/logs/${id}/entries/`, { entry_date: '2019-10-31', amount: '1' });
    assert.equal(entry.status, 201);
    const entryId = (await db.get('SELECT id FROM unit_log_entries')).id;
    const manager = await makeUser(db, 'mgr', 'manager');
    await client.login(manager);
    assert.equal((await client.get(`/owner/logs/${id}/`)).status, 404);
    await db.run('UPDATE properties SET manager_id = ? WHERE id = (SELECT property_id FROM units WHERE id = ?)', [manager.id, unit.id]);
    assert.equal((await client.get(`/owner/logs/${id}/`)).status, 200);
    await client.login(await makeUser(db, 'owner2', 'owner'));
    for (const [method, url] of [['GET', `/owner/logs/${id}/`], ['GET', `/owner/units/${unit.id}/logs/`], ['DELETE', `/owner/log-entries/${entryId}/`],
      ['POST', `/owner/logs/${id}/import/`], ['GET', `/owner/logs/${id}/export/`]]) {
      assert.equal((await client.request(method, url, { json: method === 'GET' ? undefined : { csv: SHEET_CSV } })).status, 404, url);
    }
    await client.login(await makeUser(db, 'tenant', 'tenant'));
    assert.equal((await client.get(`/owner/logs/${id}/`)).status, 403);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM unit_log_entries')).n, 1);
  });

  it('deleting a log removes its entries', async () => {
    const id = (await newLog()).json.id;
    await client.post(`/owner/logs/${id}/import/`, { csv: SHEET_CSV });
    await client.delete(`/owner/logs/${id}/`);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM unit_log_entries')).n, 0);
  });
});
