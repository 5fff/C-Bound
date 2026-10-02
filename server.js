const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Global Timestamped Logging Interceptor
const originalConsoleLog = console.log;
console.log = function() {
    const now = new Date();
    const tsString = `[${now.toISOString()} | UNIX: ${now.getTime()}]`;
    const args = Array.from(arguments);
    if (typeof args[0] === 'string') {
        args[0] = `${tsString} ${args[0]}`;
    } else {
        args.unshift(tsString);
    }
    originalConsoleLog.apply(console, args);
};
// ============================================================================
// CONFIGURATION & STATE
// ============================================================================

// Static Environment Configurations
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MIN_ROUNDS = process.env.MIN_ROUNDS ? parseInt(process.env.MIN_ROUNDS) : 3;
const MAX_ROUNDS = process.env.MAX_ROUNDS ? parseInt(process.env.MAX_ROUNDS) : 10;
const CONFIG_SECRET = process.env.CONFIG_SECRET || 'secretstring123';
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

// Mutable Dynamic Settings
let LATENCY_THRESHOLD_MS = process.env.LATENCY_THRESHOLD_MS ? parseInt(process.env.LATENCY_THRESHOLD_MS) : 2;
let HONEYPOT_URL = process.env.HONEYPOT_URL || 'https://youtube.com/';
const HONEYPOT_ENABLED = process.env.HONEYPOT_ENABLED !== 'false';
let GLOBAL_QR_MODE = process.env.GLOBAL_QR_MODE === 'true';

// URL Database Configuration
const urlDatabase = new Map();

// Data Persistence
const DATA_FILE_PATH = process.env.DATA_FILE_PATH || path.join(__dirname, 'data', 'cbound_config.json');

const loadState = () => {
    try {
        if (fs.existsSync(DATA_FILE_PATH)) {
            const rawData = fs.readFileSync(DATA_FILE_PATH, 'utf8');
            const parsed = JSON.parse(rawData);
            
            if (parsed.LATENCY_THRESHOLD_MS !== undefined) LATENCY_THRESHOLD_MS = parseInt(parsed.LATENCY_THRESHOLD_MS);
            if (parsed.HONEYPOT_URL !== undefined) HONEYPOT_URL = parsed.HONEYPOT_URL;
            if (parsed.GLOBAL_QR_MODE !== undefined) GLOBAL_QR_MODE = !!parsed.GLOBAL_QR_MODE;
            
            if (parsed.urls) {
                for (const [key, val] of Object.entries(parsed.urls)) {
                    urlDatabase.set(key, val);
                }
            }
            console.log(`Loaded configuration state from ${DATA_FILE_PATH}`);
        }
    } catch (e) {
        console.error(`Failed to load configuration from ${DATA_FILE_PATH}:`, e);
    }

    if (urlDatabase.size === 0) {
        urlDatabase.set('default', { name: 'Default Target', targetUrl: process.env.TARGET_URL || 'https://google.com/', showQrCode: GLOBAL_QR_MODE });
    }
};

const saveState = () => {
    try {
        const state = {
            LATENCY_THRESHOLD_MS,
            HONEYPOT_URL,
            GLOBAL_QR_MODE,
            urls: Object.fromEntries(urlDatabase)
        };
        const dir = path.dirname(DATA_FILE_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save configuration state:', e);
    }
};

// Initialize configuration into memory
loadState();

// ============================================================================
// UTILITIES
// ============================================================================

// Check if an IP is a private network / localhost IP
const isLocalIp = (ip) => {
    if (!ip) return false;
    // IPv4 localhost
    if (ip === '127.0.0.1') return true;
    // IPv6 localhost
    if (ip === '::1' || ip === '::ffff:127.0.0.1') return true;
    // Private IPv4 ranges (10.x.x.x, 172.16.x.x-172.31.x.x, 192.168.x.x)
    if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
    if (ip.startsWith('172.')) {
        const secondOctet = parseInt(ip.split('.')[1], 10);
        if (secondOctet >= 16 && secondOctet <= 31) return true;
    }
    // IPv6 Unique Local Address (fc00::/7)
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
    
    return false;
};

const serveFile = (res, filename) => {
    fs.readFile(path.join(__dirname, filename), (err, data) => {
        if (err) {
            res.writeHead(500);
            res.end(`Error loading ${filename}`);
        } else {
            res.writeHead(200, { 
                'Content-Type': 'text/html',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY'
            });
            res.end(data);
        }
    });
};

// ============================================================================
// HTTP API ROUTERS
// ============================================================================

const handleApiConfig = (req, res, searchParams) => {
    const secret = searchParams.get('secret');
    
    // Constant-time string comparison to prevent timing attacks
    const providedBuf = Buffer.alloc(32);
    providedBuf.write(secret || '');
    const correctBuf = Buffer.alloc(32);
    correctBuf.write(CONFIG_SECRET);

    if (providedBuf.length !== correctBuf.length || !crypto.timingSafeEqual(providedBuf, correctBuf)) {
        res.writeHead(403); return res.end('Unauthorized');
    }

    if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ 
            urls: Object.fromEntries(urlDatabase), 
            globalHoneypotUrl: HONEYPOT_URL, 
            globalLatencyThreshold: LATENCY_THRESHOLD_MS,
            globalQrMode: GLOBAL_QR_MODE
        }));
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                
                const requestHost = req.headers.host || '';
                const isLoop = (u) => { try { return new URL(u).host === requestHost; } catch(e) { return false; } };
                
                // Handle Global Config Updates
                if (data.isGlobalConfig) {
                    if (data.globalHoneypotUrl !== undefined) {
                        let hp = data.globalHoneypotUrl;
                        if (hp && hp.trim() !== '') {
                            hp = hp.trim();
                            if (!/^https?:\/\//i.test(hp)) hp = 'https://' + hp;
                            new URL(hp);
                            if (isLoop(hp)) {
                                res.writeHead(400); return res.end('Infinite Loop: URL points back to server');
                            }
                            HONEYPOT_URL = hp;
                        } else {
                            HONEYPOT_URL = '';
                        }
                    }
                    if (data.globalLatencyThreshold !== undefined) {
                        const newThreshold = parseInt(data.globalLatencyThreshold);
                        if (!isNaN(newThreshold) && newThreshold >= 1 && newThreshold <= 3000) {
                            LATENCY_THRESHOLD_MS = newThreshold;
                        } else {
                            res.writeHead(400); return res.end('Invalid Latency Threshold (must be between 1 and 3000)');
                        }
                    }
                    if (data.globalQrMode !== undefined) {
                        GLOBAL_QR_MODE = !!data.globalQrMode;
                    }
                    saveState(); // Persist global changes
                    res.writeHead(200); return res.end(JSON.stringify({ 
                        success: true, 
                        globalHoneypotUrl: HONEYPOT_URL, 
                        globalLatencyThreshold: LATENCY_THRESHOLD_MS,
                        globalQrMode: GLOBAL_QR_MODE
                    }));
                }

                // Handle Target Operations
                const { id, name, targetUrl, honeypotUrl, showQrCode } = data;
                if (!name || !targetUrl) {
                    res.writeHead(400); return res.end('Missing name or targetUrl');
                }

                let urlToSave = targetUrl.trim();
                if (!/^https?:\/\//i.test(urlToSave)) urlToSave = 'https://' + urlToSave;
                new URL(urlToSave);
                if (isLoop(urlToSave)) {
                    res.writeHead(400); return res.end('Infinite Loop: Target URL points back to server');
                }
                
                let honeypotToSave = null;
                if (honeypotUrl && honeypotUrl.trim() !== '') {
                    honeypotToSave = honeypotUrl.trim();
                    if (!/^https?:\/\//i.test(honeypotToSave)) honeypotToSave = 'https://' + honeypotToSave;
                    new URL(honeypotToSave);
                    if (isLoop(honeypotToSave)) {
                        res.writeHead(400); return res.end('Infinite Loop: Honeypot URL points back to server');
                    }
                }
                
                let finalId = id;
                if (!finalId) {
                    finalId = crypto.randomBytes(4).toString('hex');
                }
                
                urlDatabase.set(finalId, { 
                    name: name.trim(), 
                    targetUrl: urlToSave, 
                    honeypotUrl: honeypotToSave,
                    showQrCode: !!showQrCode
                });
                saveState(); // Persist target addition/modification
                res.writeHead(200); return res.end(JSON.stringify({ id: finalId }));
            } catch(e) {
                res.writeHead(400); return res.end('Invalid Request');
            }
        });
        return;
    }

    if (req.method === 'DELETE') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.id && urlDatabase.has(data.id)) {
                    urlDatabase.delete(data.id);
                    saveState(); // Persist target deletion
                    res.writeHead(200); return res.end('OK');
                }
                res.writeHead(404); return res.end('ID not found');
            } catch(e) {
                res.writeHead(400); return res.end('Bad Request');
            }
        });
        return;
    }

    res.writeHead(405); return res.end('Method Not Allowed');
};

const handleServeStatic = (req, res, pathname) => {
    const filePath = path.join(__dirname, pathname);
    // Enforce strict directory boundaries
    const publicDir = path.join(__dirname, 'public') + path.sep;
    if (!filePath.startsWith(publicDir) && filePath !== path.join(__dirname, 'public')) {
        res.writeHead(403); return res.end('Unauthorized');
    }
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404); return res.end('Not found');
        }
        const ext = path.extname(filePath);
        const contentType = ext === '.js' ? 'application/javascript' : 'text/plain';
        res.writeHead(200, { 
            'Content-Type': contentType,
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
        });
        res.end(data);
    });
};

const handleProtectedPage = (req, res, pageName, secret) => {
    // Constant-time string comparison
    const providedBuf = Buffer.alloc(32);
    providedBuf.write(secret || '');
    const correctBuf = Buffer.alloc(32);
    correctBuf.write(CONFIG_SECRET);
    
    if (providedBuf.length === correctBuf.length && crypto.timingSafeEqual(providedBuf, correctBuf)) {
        serveFile(res, pageName);
    } else {
        res.writeHead(403); res.end('Unauthorized');
    }
};

// ============================================================================
// MAIN HTTP SERVER
// ============================================================================
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const pathParts = pathname.split('/');
    const route = pathParts[1];

    if (pathname === '/api/config') return handleApiConfig(req, res, url.searchParams);
    if (pathname === '/' || pathname === '/index.html') return serveFile(res, 'index.html');
    if (route === 'fieldtest') return handleProtectedPage(req, res, 'fieldtest.html', pathParts[2]);
    if (route === 'admin') return handleProtectedPage(req, res, 'admin.html', pathParts[2]);
    if (route === 'public') return handleServeStatic(req, res, pathname);

    res.writeHead(404);
    res.end('Not found');
});

// ============================================================================
// WEBSOCKET VERIFIER
// ============================================================================

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const mode = url.searchParams.get('mode');
    const secret = url.searchParams.get('secret');
    const targetId = url.searchParams.get('target') || 'default';
    
    // Constant-time string comparison for WebSocket auth
    const providedBuf = Buffer.alloc(32);
    providedBuf.write(secret || '');
    const correctBuf = Buffer.alloc(32);
    correctBuf.write(CONFIG_SECRET);
    const isSpecialClient = (mode === 'admin' || mode === 'fieldtest') && 
                            (providedBuf.length === correctBuf.length && crypto.timingSafeEqual(providedBuf, correctBuf));
    
    // Extract real IP from proxy headers only if explicitly trusted
    // We only trust the proxy headers if TRUST_PROXY is true OR if the direct socket connection comes from a Private IP / Localhost
    // This prevents a random public IP from spoofing a Cloudflare proxy header
    const directIp = req.socket.remoteAddress;
    let clientIp = directIp;
    
    if (TRUST_PROXY || isLocalIp(directIp)) {
        clientIp = req.headers['cf-connecting-ip'] 
                || (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null)
                || req.headers['x-real-ip']
                || directIp;
    } else {
        // If they sent proxy headers but they aren't authorized (e.g. naive spoofing attempt)
        if (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip']) {
            console.log(`[SECURITY WARNING] IP Spoofing attempt blocked from public IP: ${directIp}`);
        }
    }

    const logMsg = (msg) => {
        console.log(msg);
        if (isSpecialClient) {
            ws.send(JSON.stringify({ type: 'LOG', message: msg }));
        }
    };

    logMsg('Client connected. Starting C-Bound verification...');

    let currentRound = 0;
    const rtts = [];
    let currentNonce = null;
    let startTime = null;

    const startNextRound = () => {
        // Evaluate early-exit condition: If we've completed the minimum rounds, check if they already passed
        if (currentRound >= MIN_ROUNDS && rtts.length > 0) {
            const currentMinRtt = Math.min(...rtts);
            if (currentMinRtt <= LATENCY_THRESHOLD_MS) {
                logMsg(`Early exit condition met: Min RTT ${currentMinRtt.toFixed(2)}ms <= ${LATENCY_THRESHOLD_MS}ms target`);
                finishVerification();
                return;
            }
        }

        // If we hit the absolute maximum allowed rounds and haven't early-exited, force finish
        if (currentRound >= MAX_ROUNDS) {
            logMsg(`Maximum rounds (${MAX_ROUNDS}) reached without meeting threshold.`);
            finishVerification();
            return;
        }

        currentRound++;
        currentNonce = crypto.randomBytes(16);
        startTime = process.hrtime.bigint();

        ws.send(JSON.stringify({
            type: 'CHALLENGE',
            nonce: currentNonce.toString('hex')
        }));
    };

    const finishVerification = () => {
        const minRtt = Math.min(...rtts);
        logMsg(`Verification complete. Min RTT: ${minRtt.toFixed(2)}ms for target: ${targetId}`);

        // Ensure diagnostic modes evaluate and return latency results BEFORE failing out on missing targets
        if (isSpecialClient) {
            ws.send(JSON.stringify({
                type: 'RESULT',
                decision: minRtt <= LATENCY_THRESHOLD_MS ? 'ACCESS_GRANTED' : 'ACCESS_DENIED',
                minRtt: minRtt
            }));
        }

        // Look up the requested target identifier, fallback to 'default' if missing
        const entry = urlDatabase.get(targetId) || urlDatabase.get('default');
        
        if (!entry) {
            logMsg(`Result: INVALID_TARGET (Target '${targetId}' not found, no default exists)`);
            ws.send(JSON.stringify({ type: 'INVALID_TARGET' }));
            setTimeout(() => ws.close(), 1000);
            return;
        }

        const finalUrl = entry.targetUrl;
        const finalHoneypot = entry.honeypotUrl || HONEYPOT_URL;

        if (minRtt <= LATENCY_THRESHOLD_MS) {
            logMsg('Result: ACCESS_GRANTED (Sending Target URL)');
            ws.send(JSON.stringify({
                type: 'AUTHORIZED',
                payload: Buffer.from(finalUrl).toString('base64'),
                showQrCode: !!entry.showQrCode
            }));
        } else if (HONEYPOT_ENABLED && finalHoneypot) {
            logMsg('Result: ACCESS_DENIED (Sending Honeypot URL)');
            ws.send(JSON.stringify({
                type: 'AUTHORIZED',
                payload: Buffer.from(finalHoneypot).toString('base64'),
                showQrCode: !!entry.showQrCode
            }));
        } else {
            logMsg('Result: ACCESS_DENIED (Closing connection)');
            ws.send(JSON.stringify({ type: 'DENIED' }));
            ws.close();
        }
    };

    ws.on('message', (message) => {
        const endTime = process.hrtime.bigint();
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'DEVICE_INFO') {
                const clientType = isSpecialClient ? mode.toUpperCase() : 'CLIENT';
                logMsg(`[${clientType}] IP: ${clientIp} | Target: ${targetId} | TZ: ${data.timezone} | Res: ${data.resolution} | UA: ${data.userAgent}`);
                return;
            }

            if (data.type === 'RESPONSE' && data.nonce === currentNonce?.toString('hex')) {
                // Calculate RTT in milliseconds
                // process.hrtime.bigint() returns nanoseconds (1 ms = 1,000,000 ns)
                const rttNs = endTime - startTime;
                const rttMs = Number(rttNs) / 1000000;
                
                logMsg(`Round ${currentRound}/${MAX_ROUNDS} (Min: ${MIN_ROUNDS}) - RTT: ${rttMs.toFixed(2)}ms`);
                rtts.push(rttMs);
                
                // Slight delay before next round to avoid overlapping messages / unrepresentative network buffering
                setTimeout(startNextRound, 50);
            } else {
                logMsg('Error: Invalid response or nonce mismatch.');
                ws.close();
            }
        } catch (e) {
            logMsg('Error: Failed to parse message:' + e.message);
            ws.close();
        }
    });

    ws.on('close', () => {
        logMsg('Client disconnected.');
    });

    // Start the first round
    startNextRound();
});

server.listen(PORT, HOST, () => {
    console.log(`C-Bound Server listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (bound to ${HOST})`);
});
