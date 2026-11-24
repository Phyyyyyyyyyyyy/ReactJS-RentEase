/**
 * On Render, installing the root folder (Render's default build command,
 * `npm install` or `yarn`) also installs backend/ and frontend/ and builds the
 * React app, so the deploy works even if the Build Command isn't `npm run build`.
 * On your own computer this does nothing.
 */
import { execSync } from 'node:child_process';

if (process.env.RENDER && !process.env.RENTEASE_BUILDING) {
  execSync('npm run build', { stdio: 'inherit', env: { ...process.env, RENTEASE_BUILDING: '1' } });
}
