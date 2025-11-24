// index.js

const http = require('http');

// Render נותן PORT במשתנה סביבה, ואם אין – נשתמש ב-10000
const PORT = process.env.PORT || 10000;

// שרת פשוט שיחזיר טקסט כדי ש-Render ידע שהשירות חי
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Bot is running!\n');
});

// הפעלת השרת
server.listen(PORT, () => {
  console.log(`Bot is running on port ${PORT}`);
});

// לוג קטן כל דקה כדי לראות שהאפליקציה עדיין חיה
setInterval(() => {
  console.log('Still alive at', new Date().toISOString());
}, 60 * 1000);
