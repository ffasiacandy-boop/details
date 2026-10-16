const path = require('path');
let esbuild; try { esbuild = require('esbuild'); } catch { esbuild = require('/home/claude/.npm-global/lib/node_modules/tsx/node_modules/esbuild'); }
esbuild.build({ entryPoints: [path.join(__dirname, '../browser-entry.js')], bundle: true, format: 'iife', target: ['es2020'], outfile: path.join(__dirname, 'vto-test.js'), external: ['https://*'] })
  .then(() => console.log('harness bundle ok')).catch((e) => { console.error(e.message); process.exit(1); });
