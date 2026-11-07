'use strict';
// Minimal static server for local play/testing.
// Usage: node tools/serve.js [port]

const { createServer } = require('./harness');

const port = Number(process.argv[2] || process.env.PORT || 8080);

createServer(port).then(() => {
  console.log('Thunder Strike running at http://127.0.0.1:' + port + '/');
  console.log('Press Ctrl+C to stop.');
}).catch(err => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
