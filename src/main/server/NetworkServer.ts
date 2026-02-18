import { EventEmitter } from 'events';
import express from 'express';
import { createServer, Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { networkInterfaces } from 'os';
import QRCode from 'qrcode';
import { TranscriptSegment } from '../../shared/types/transcript';
import { DisplaySettings, DEFAULT_SETTINGS } from '../../shared/types/settings';
import { PacedSegment, NetworkStatus } from '../../shared/types/ipc';

interface WSMessage {
  type: 'segment' | 'settings' | 'clear' | 'welcome';
  payload: unknown;
}

export class NetworkServer extends EventEmitter {
  private app: express.Express | null = null;
  private httpServer: HTTPServer | null = null;
  private wss: WebSocketServer | null = null;
  private port: number;
  private _isRunning = false;
  private displaySettings: DisplaySettings = { ...DEFAULT_SETTINGS.display };
  private recentSegments: TranscriptSegment[] = [];
  private readonly maxRecentSegments = 50;

  constructor(port = 8080) {
    super();
    this.port = port;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  getStatus(): NetworkStatus {
    return {
      running: this._isRunning,
      port: this.port,
      url: this._isRunning ? `http://${this.getLocalIP()}:${this.port}` : '',
      connectedClients: this.wss ? this.wss.clients.size : 0,
    };
  }

  async start(): Promise<NetworkStatus> {
    if (this._isRunning) return this.getStatus();

    this.app = express();
    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer });

    // Serve the viewer HTML
    this.app.get('/', (_req, res) => {
      res.type('html').send(this.getViewerHTML());
    });

    // Health check / status endpoint
    this.app.get('/api/status', (_req, res) => {
      res.json({
        app: 'AutoScribe',
        clients: this.wss?.clients.size ?? 0,
      });
    });

    // WebSocket connection handling
    this.wss.on('connection', (ws: WebSocket) => {
      console.log(`[Network] Viewer connected (${this.wss!.clients.size} total)`);

      // Send current display settings and recent segments
      const welcome: WSMessage = {
        type: 'welcome',
        payload: {
          settings: this.displaySettings,
          recentSegments: this.recentSegments,
        },
      };
      ws.send(JSON.stringify(welcome));

      ws.on('close', () => {
        console.log(`[Network] Viewer disconnected (${this.wss!.clients.size} total)`);
      });
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.port, () => {
        this._isRunning = true;
        const status = this.getStatus();
        console.log(`[Network] Server running at ${status.url}`);
        resolve(status);
      });

      this.httpServer!.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[Network] Port ${this.port} already in use`);
        }
        this._isRunning = false;
        reject(err);
      });
    });
  }

  stop(): void {
    if (!this._isRunning) return;

    // Close all WebSocket connections
    if (this.wss) {
      this.wss.clients.forEach((client) => client.close());
      this.wss.close();
      this.wss = null;
    }

    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }

    this.app = null;
    this._isRunning = false;
    console.log('[Network] Server stopped');
  }

  broadcastSegment(paced: PacedSegment): void {
    // Store for new viewers joining
    this.recentSegments.push(paced.segment);
    if (this.recentSegments.length > this.maxRecentSegments) {
      this.recentSegments = this.recentSegments.slice(-this.maxRecentSegments);
    }

    this.broadcast({ type: 'segment', payload: paced });
  }

  broadcastSettings(settings: DisplaySettings): void {
    this.displaySettings = { ...this.displaySettings, ...settings };
    this.broadcast({ type: 'settings', payload: this.displaySettings });
  }

  broadcastClear(): void {
    this.recentSegments = [];
    this.broadcast({ type: 'clear', payload: null });
  }

  async getQRCode(): Promise<string> {
    const url = `http://${this.getLocalIP()}:${this.port}`;
    return QRCode.toDataURL(url, { width: 256, margin: 2 });
  }

  private broadcast(message: WSMessage): void {
    if (!this.wss) return;
    const data = JSON.stringify(message);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  private getLocalIP(): string {
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  private getViewerHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>AutoScribe Viewer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: Arial, sans-serif;
      overflow: hidden;
      height: 100vh;
      transition: background-color 0.3s, color 0.3s;
    }

    #container {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 2rem;
      overflow-y: auto;
    }

    .line {
      margin-bottom: 0.75rem;
      transition: opacity 0.5s;
    }

    #status {
      position: fixed;
      top: 0.5rem;
      right: 0.5rem;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.7rem;
      opacity: 0.5;
      z-index: 10;
    }

    .status-connected { background: #22c55e; color: white; }
    .status-disconnected { background: #ef4444; color: white; }
    .status-connecting { background: #eab308; color: white; }

    #waiting {
      text-align: center;
      opacity: 0.2;
      font-size: 1.5rem;
    }

    @media (max-width: 640px) {
      #container { padding: 1rem; }
    }
  </style>
</head>
<body>
  <div id="status" class="status-connecting">Connecting...</div>
  <div id="container">
    <p id="waiting">Waiting for transcription...</p>
  </div>

  <script>
    const container = document.getElementById('container');
    const statusEl = document.getElementById('status');
    const waitingEl = document.getElementById('waiting');
    const MAX_LINES = 30;
    let lines = [];
    let settings = {};
    let ws;
    let reconnectTimer;

    function applySettings(s) {
      settings = s;
      document.body.style.fontFamily = s.fontFamily || 'Arial, sans-serif';
      document.body.style.fontSize = (s.fontSize || 32) + 'px';
      document.body.style.color = s.textColor || '#000000';
      document.body.style.backgroundColor = s.backgroundColor || '#FFFFFF';
      document.body.style.lineHeight = s.lineHeight || 1.6;
      container.style.textAlign = s.textAlign || 'left';
    }

    const BIBLE_BOOKS = [
      'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
      '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles',
      'Ezra','Nehemiah','Esther','Job','Psalms?','Proverbs','Ecclesiastes','Song of Solomon',
      'Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah',
      'Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi',
      'Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians',
      'Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians',
      '1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter',
      '1 John','2 John','3 John','Jude','Revelation'
    ];
    var bp = BIBLE_BOOKS.join('|');
    var bibleRefRegex = new RegExp(
      '((?:'+bp+')\\\\s+\\\\d+:\\\\d+(?:\\\\s*-\\\\s*\\\\d+(?::\\\\d+)?)?)'
      +'|((?:'+bp+')\\\\s+chapter\\\\s+\\\\d+\\\\s+verses?\\\\s+\\\\d+(?:\\\\s+(?:through|to|-)\\\\s+\\\\d+)?)'
      +'|((?:'+bp+')\\\\s+\\\\d{1,3}\\\\s+\\\\d{1,3}(?:\\\\s*-\\\\s*\\\\d+)?)'
      +'|((?:'+bp+')\\\\s+\\\\d{2,})',
      'gi'
    );

    function normalizeRef(raw) {
      if (raw.includes(':')) return raw;
      var cv = raw.match(/^(.+?)\\s+chapter\\s+(\\d+)\\s+verses?\\s+(\\d+)(?:\\s+(?:through|to|-)\\s+(\\d+))?$/i);
      if (cv) return cv[4] ? cv[1]+' '+cv[2]+':'+cv[3]+'-'+cv[4] : cv[1]+' '+cv[2]+':'+cv[3];
      var tn = raw.match(/^(.+?)\\s+(\\d{1,3})\\s+(\\d{1,3})(?:\\s*-\\s*(\\d+))?$/);
      if (tn) return tn[4] ? tn[1]+' '+tn[2]+':'+tn[3]+'-'+tn[4] : tn[1]+' '+tn[2]+':'+tn[3];
      var rt = raw.match(/^(.+?)\\s+(\\d{2,})$/);
      if (rt) {
        var d = rt[2];
        if (d.length===3) return rt[1]+' '+d[0]+':'+d.slice(1);
        if (d.length===4) return rt[1]+' '+d.slice(0,2)+':'+d.slice(2);
      }
      return raw;
    }

    function formatWithBibleRefs(text) {
      var parts = [];
      var lastIndex = 0;
      bibleRefRegex.lastIndex = 0;
      var m;
      while ((m = bibleRefRegex.exec(text)) !== null) {
        var matched = m[1]||m[2]||m[3]||m[4]||'';
        if (!matched) continue;
        if (m.index > lastIndex) {
          var before = text.slice(lastIndex, m.index).trim();
          if (before) parts.push({ text: before, isRef: false });
        }
        parts.push({ text: normalizeRef(matched.trim()), isRef: true });
        lastIndex = m.index + m[0].length;
      }
      if (lastIndex < text.length) {
        var after = text.slice(lastIndex).trim();
        if (after) parts.push({ text: after, isRef: false });
      }
      if (parts.length === 0) parts.push({ text: text, isRef: false });
      return parts;
    }

    function renderLines() {
      // Remove old line elements
      container.querySelectorAll('.line').forEach(el => el.remove());

      if (lines.length === 0) {
        waitingEl.style.display = 'block';
        return;
      }
      waitingEl.style.display = 'none';

      lines.forEach((line, i) => {
        const div = document.createElement('div');
        div.className = 'line';
        const recency = (i + 1) / lines.length;
        div.style.opacity = Math.max(0.3, recency);

        const parts = formatWithBibleRefs(line.text);
        parts.forEach(part => {
          if (part.isRef) {
            const p = document.createElement('p');
            p.style.fontWeight = 'bold';
            p.style.margin = '0.5rem 0';
            p.textContent = part.text;
            div.appendChild(p);
          } else {
            const span = document.createElement('span');
            span.textContent = part.text;
            div.appendChild(span);
          }
        });

        container.appendChild(div);
      });

      container.scrollTop = container.scrollHeight;
    }

    function addSegment(segment) {
      lines.push({ id: segment.id, text: segment.text });
      if (lines.length > MAX_LINES) {
        lines = lines.slice(-MAX_LINES);
      }
      renderLines();
    }

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + location.host);

      ws.onopen = () => {
        statusEl.textContent = 'Connected';
        statusEl.className = 'status-connected';
        clearTimeout(reconnectTimer);
      };

      ws.onclose = () => {
        statusEl.textContent = 'Disconnected';
        statusEl.className = 'status-disconnected';
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'welcome':
            if (msg.payload.settings) applySettings(msg.payload.settings);
            if (msg.payload.recentSegments) {
              lines = [];
              msg.payload.recentSegments.forEach(seg => {
                lines.push({ id: seg.id, text: seg.text });
              });
              if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
              renderLines();
            }
            break;
          case 'segment':
            addSegment(msg.payload.segment);
            break;
          case 'settings':
            applySettings(msg.payload);
            break;
          case 'clear':
            lines = [];
            renderLines();
            break;
        }
      };
    }

    connect();
  </script>
</body>
</html>`;
  }
}
