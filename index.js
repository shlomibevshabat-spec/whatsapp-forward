// index.js

const http = require('http');

// Render provides a PORT environment variable. Fallback to 10000 if not set.
const PORT = process.env.PORT || 10000;

// Simple HTTP server to keep the service alive
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Bot is running!\n');
});

// Start the server
server.listen(PORT, () => {
  console.log(`Bot is running on port ${PORT}`);
});

// Keep-alive heartbeat every minute
setInterval(() => {
  console.log('Still alive at', new Date().toISOString());
}, 60 * 1000);
