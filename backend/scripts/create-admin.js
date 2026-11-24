/**
 * Create an Admin account from the command line (the first admin can then
 * create other accounts in the app under Users & Access).
 *
 *   npm run create-admin
 */
import { createInterface } from 'node:readline/promises';
import { openDatabase } from '../src/db.js';
import { passwordProblems } from '../src/lib/passwords.js';
import { createUser, emailTaken, usernameTaken } from '../src/users.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (question) => (await rl.question(question)).trim();

const db = await openDatabase();
try {
  let username;
  while (!username) {
    username = await ask('Username: ');
    if (username && await usernameTaken(db, username)) {
      console.log('That username is already taken.');
      username = '';
    }
  }
  let email;
  while (!email) {
    email = (await ask('Email: ')).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(email)) {
      console.log('Enter a valid email address.');
      email = '';
    } else if (await emailTaken(db, email)) {
      console.log('An account with this email already exists.');
      email = '';
    }
  }
  const firstName = await ask('First name (optional): ');
  const lastName = await ask('Last name (optional): ');
  let password;
  while (!password) {
    // Note: the password is shown as you type.
    password = await rl.question('Password: ');
    const problems = passwordProblems(password, { username, email, first_name: firstName, last_name: lastName });
    if (problems.length) {
      problems.forEach((p) => console.log(p));
      password = '';
    }
  }
  await createUser(db, { username, email, password, first_name: firstName, last_name: lastName, role: 'admin' });
  console.log(`Admin account "${username}" created. Sign in at http://localhost:5173/login`);
} finally {
  rl.close();
  await db.close();
}
