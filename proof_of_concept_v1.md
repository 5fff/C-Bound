# C-Bound Proof of Concept v1

This document provides a fully reproducible specification for the prototype of "C-Bound," a system that verifies a client's physical proximity to a server using latency-based challenge-response nonces.

## Prerequisites
- Node.js (v14+ recommended)
- npm

## Setup Instructions

1. Create a project directory:
   ```bash
   mkdir C-Bound
   cd C-Bound
   ```

2. Create the three files listed below (`package.json`, `server.js`, `index.html`) using their respective source code.

3. Install the dependencies:
   ```bash
   npm install
   ```

4. Run the server:
   ```bash
   npm start
   ```
   *Optional: To bind to your local network IP (instead of just localhost), run `HOST=0.0.0.0 npm start`.*

5. Open a web browser and navigate to the server's address (e.g., `http://localhost:3000` or `http://<your-local-ip>:3000`).

---

## Source Code

### `package.json`
```json
{
  "name": "c-bound",
  "version": "1.0.0",
  "description": "C-Bound: Proximity verification using latency-based challenge-response",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "ws": "^8.16.0"
  }
}
```

### `server.js`
```javascript
const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const LATENCY_THRESHOLD_MS = 50;
const ROUNDS = 5;

// Serve the index.html file
const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('Client connected. Starting C-Bound verification...');

    let currentRound = 0;
    const rtts = [];
    let currentNonce = null;
    let startTime = null;

    const startNextRound = () => {
        if (currentRound >= ROUNDS) {
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
        console.log(`Verification complete. Min RTT: ${minRtt.toFixed(2)}ms`);

        if (minRtt <= LATENCY_THRESHOLD_MS) {
            console.log('Result: ACCESS_GRANTED');
            ws.send(JSON.stringify({
                type: 'RESULT',
                decision: 'ACCESS_GRANTED',
                minRtt: minRtt
            }));
        } else {
            console.log('Result: ACCESS_DENIED');
            ws.send(JSON.stringify({
                type: 'RESULT',
                decision: 'ACCESS_DENIED',
                minRtt: minRtt
            }));
            // Terminate connection on denial
            ws.close();
        }
    };

    ws.on('message', (message) => {
        const endTime = process.hrtime.bigint();
        
        try {
            const data = JSON.parse(message);
            if (data.type === 'RESPONSE' && data.nonce === currentNonce?.toString('hex')) {
                // Calculate RTT in milliseconds
                // process.hrtime.bigint() returns nanoseconds (1 ms = 1,000,000 ns)
                const rttNs = endTime - startTime;
                const rttMs = Number(rttNs) / 1000000;
                
                console.log(`Round ${currentRound}/${ROUNDS} - RTT: ${rttMs.toFixed(2)}ms`);
                rtts.push(rttMs);
                
                // Slight delay before next round to avoid overlapping messages / unrepresentative network buffering
                setTimeout(startNextRound, 50);
            } else {
                console.error('Invalid response or nonce mismatch.');
                ws.close();
            }
        } catch (e) {
            console.error('Failed to parse message:', e);
            ws.close();
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected.');
    });

    // Start the first round
    startNextRound();
});

server.listen(PORT, HOST, () => {
    console.log(`C-Bound Server listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (bound to ${HOST})`);
});
```

### `index.html`
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>C-Bound Proximity Verification</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #121212;
            color: #ffffff;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
        }
        .card {
            background-color: #1e1e1e;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            text-align: center;
            max-width: 400px;
            width: 100%;
        }
        h1 {
            color: #bb86fc;
            margin-top: 0;
        }
        .status {
            font-size: 1.2rem;
            margin: 20px 0;
            padding: 10px;
            border-radius: 6px;
            background-color: #2c2c2c;
        }
        .granted {
            color: #03dac6;
            font-weight: bold;
        }
        .denied {
            color: #cf6679;
            font-weight: bold;
        }
        .latency {
            font-size: 1.5rem;
            margin-top: 10px;
        }
        .log {
            margin-top: 20px;
            font-size: 0.9rem;
            color: #aaaaaa;
            text-align: left;
            max-height: 150px;
            overflow-y: auto;
            background-color: #000000;
            padding: 10px;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>C-Bound</h1>
        <p>Proximity Verification</p>
        
        <div id="status" class="status">Connecting to server...</div>
        <div id="latency" class="latency">...</div>
        
        <div id="log" class="log"></div>
    </div>

    <script>
        const statusEl = document.getElementById('status');
        const latencyEl = document.getElementById('latency');
        const logEl = document.getElementById('log');

        function log(msg) {
            const div = document.createElement('div');
            div.textContent = `> ${msg}`;
            logEl.appendChild(div);
            logEl.scrollTop = logEl.scrollHeight;
        }

        // Connect to the WebSocket server on the same host/port
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        log(`Connecting to ${wsUrl}`);
        
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            statusEl.textContent = 'Connected. Waiting for challenge...';
            log('WebSocket connection established.');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'CHALLENGE') {
                    // Reflex logic: Immediately send back the nonce
                    ws.send(JSON.stringify({
                        type: 'RESPONSE',
                        nonce: data.nonce
                    }));
                    log(`Received challenge, replied with nonce: ${data.nonce.substring(0, 8)}...`);
                } else if (data.type === 'RESULT') {
                    const rtt = data.minRtt.toFixed(2);
                    latencyEl.textContent = `Minimum RTT: ${rtt} ms`;
                    
                    if (data.decision === 'ACCESS_GRANTED') {
                        statusEl.textContent = 'ACCESS GRANTED';
                        statusEl.className = 'status granted';
                        log('Server granted access.');
                    } else {
                        statusEl.textContent = 'ACCESS DENIED';
                        statusEl.className = 'status denied';
                        log('Server denied access (latency too high).');
                    }
                }
            } catch (e) {
                log(`Error parsing message: ${e.message}`);
                console.error(e);
            }
        };

        ws.onclose = () => {
            if (statusEl.textContent !== 'ACCESS GRANTED' && statusEl.textContent !== 'ACCESS DENIED') {
                statusEl.textContent = 'Connection closed.';
            }
            log('WebSocket connection closed.');
        };

        ws.onerror = (error) => {
            statusEl.textContent = 'Connection error.';
            log('WebSocket error occurred.');
            console.error(error);
        };
    </script>
</body>
</html>
```
