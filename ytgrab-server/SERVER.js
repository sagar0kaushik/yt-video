// ╔══════════════════════════════════════════════════════════════╗
// ║         YTGrab — Production Server (Render Ready)           ║
// ║                                                             ║
// ║  HOW IT WORKS:                                              ║
// ║  Instead of saving files on the server (which doesn't work  ║
// ║  on cloud), we STREAM the video bytes directly to the       ║
// ║  browser → browser saves it to user's Downloads folder.     ║
// ╚══════════════════════════════════════════════════════════════╝

const express = require('express');
const cors    = require('cors');
const { spawn } = require('child_process');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3737;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Serve index.html (for local use)
app.use(express.static(path.join(__dirname)));

// ─────────────────────────────────────────────
// /ping  →  connection check
// ─────────────────────────────────────────────
app.get('/ping', (req, res) => {
  res.json({ status: 'ok' });
});

// ─────────────────────────────────────────────
// /info?url=...  →  video metadata
// ─────────────────────────────────────────────
app.get('/info', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'No URL' });

  console.log('📡 Info:', url);

  const ytdlp = spawn('yt-dlp', [
    '--dump-json',
    '--no-playlist',
    '--no-warnings',
    url
  ]);

  let out = '', err = '';
  ytdlp.stdout.on('data', d => out += d);
  ytdlp.stderr.on('data', d => err += d);

  ytdlp.on('close', code => {
    if (code !== 0 || !out.trim()) {
      console.error('yt-dlp info failed:', err);
      return res.status(500).json({ error: 'Could not fetch video info. Is the URL correct?' });
    }
    try {
      res.json(JSON.parse(out));
    } catch {
      res.status(500).json({ error: 'Failed to parse response' });
    }
  });

  ytdlp.on('error', () => {
    res.status(500).json({ error: 'yt-dlp not installed on server' });
  });
});

// ─────────────────────────────────────────────
// /stream?url=...&quality=720p&format=mp4
//
// THIS IS THE KEY ROUTE:
// Instead of saving to disk, we pipe yt-dlp's
// output directly to the browser response.
// Browser receives it as a file download.
// ─────────────────────────────────────────────
app.get('/stream', (req, res) => {
  const { url, quality, format } = req.query;
  if (!url) return res.status(400).json({ error: 'No URL' });

  const qualityMap = {
    '360p':  'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]',
    '480p':  'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]',
    '720p':  'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]',
    '1080p': 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]',
  };

  const isAudio  = format === 'mp3';
  const ytFormat = isAudio ? 'bestaudio/best' : (qualityMap[quality] || qualityMap['720p']);
  const ext      = isAudio ? 'mp3' : 'mp4';
  const mimeType = isAudio ? 'audio/mpeg' : 'video/mp4';
  const filename = `YTGrab_${quality || 'best'}_${Date.now()}.${ext}`;

  console.log(`\n📥 Stream request: ${quality} ${format}`);
  console.log('🔗 URL:', url);

  // Build yt-dlp args — output to stdout (-) so we can pipe it
  const args = isAudio
    ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', '-', '--no-warnings', url]
    : ['-f', ytFormat, '--merge-output-format', 'mp4', '-o', '-', '--no-warnings', url];

  const ytdlp = spawn('yt-dlp', args);

  // Tell browser: "this is a file, save it with this name"
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Transfer-Encoding', 'chunked');

  // Pipe yt-dlp stdout → browser (this is the streaming magic)
  ytdlp.stdout.pipe(res);

  ytdlp.stderr.on('data', d => console.log(d.toString()));

  ytdlp.on('close', code => {
    if (code === 0) console.log('✅ Stream complete:', filename);
    else console.error('❌ Stream failed (code:', code, ')');
  });

  ytdlp.on('error', err => {
    console.error('❌ yt-dlp error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'yt-dlp not found' });
    }
  });

  // If user cancels download, kill yt-dlp
  req.on('close', () => {
    ytdlp.kill('SIGTERM');
    console.log('🛑 Download cancelled by user');
  });
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ YTGrab running at http://localhost:${PORT}\n`);
});
