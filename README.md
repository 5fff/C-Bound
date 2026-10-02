# C-Bound 🛰️

> **Perimeter security enforced by the laws of physics.**

**C-Bound** is a usable proof of concept for a proximity-based spam protection, URL shortener, and QR code redirection service. By measuring network latency (which is physically bounded by the speed of light, $c$), it validates a client's physical distance from the server. Through a cryptographically secure challenge-response pulse, C-Bound forms a "Physical-Layer Geofence" that prevents location spoofing via VPNs, residential proxies, or GPS manipulation—ensuring only physically nearby users can access target links.

---

## ⚡ The Core Logic: The $c$ Limit
Data cannot travel faster than the speed of light. In a vacuum, $c \approx 299,792 \text{ km/s}$. Over fiber optic cables, this is reduced by the refractive index of glass to roughly **200,000 km/s**. 

Because a signal must travel from the server to the client and back, the **minimum possible RTT** is a hard physical floor based on distance.

| Proximity | Distance (Approx) | Theoretical RTT Floor | Real-World Baseline |
| :--- | :--- | :--- | :--- |
| **Intra-City** | < 100 km | < 1 ms | 2–15 ms |
| **Regional/State** | 500 - 1,000 km | 5 - 10 ms | 20–40 ms |
| **Continental** | 4,000 - 5,000 km | 40 - 50 ms | 60–90 ms |
| **Intercontinental** | > 8,000 km | > 80 ms | **150ms+** |

---

## ⚠️ The "Slow Internet" Myth
A common misconception is that C-Bound punishes users with "bad" or "slow" connection speeds. This confuses **Bandwidth** with **Latency**.

* **Bandwidth (Throughput):** How much data you can move at once (e.g., 1 Gbps vs 10 Mbps). You can buy more bandwidth.
* **Latency (Ping):** How long a single bit takes to travel. **You cannot buy a faster speed of light.**

A user on a 5 Mbps DSL line in the same region will pass the C-Bound check, while a user with a 10 Gbps Fiber line on the other side of the planet will physically fail. C-Bound measures **proximity**, not "quality" of service.

### False Negatives
While false negatives are rare, the probability of a physically nearby user failing the check is not zero. Certain network routing setups force client traffic to travel a vast physical distance before entering the public internet:
* **Cellular Roaming:** Mobile networks often backhaul roaming data traffic to a centralized home gateway (breakout node) in another state or country before releasing it, introducing substantial routing latency even if the client is sitting right next to the server.
* **Corporate WANs & VPNs:** Enterprise network designs frequently route all office or remote employee traffic to a centralized security stack or proxy gateway.

In these scenarios, the physical path the packets must travel is significantly lengthened, producing an elevated RTT that fails the proximity threshold.

---

## 🛡️ Spoof-Proof Design
Traditional geofencing is easily defeated by VPNs because the VPN server acts as a middleman with a "clean" IP. C-Bound defeats this because:
1. **The Nonce Challenge:** The server sends a random, unpredictable 16-byte nonce.
2. **The Reflex:** The client must "echo" the nonce immediately.
3. **The Physics Trap:** Even if a user uses a local VPN, the signal must still travel to the user's actual physical location and back. This adds the physical distance to the RTT, which the server detects instantly.


## 🧱 Limitations & Threat Model

C-Bound is designed to prevent **location spoofing**, not **location delegating**. It is important to understand what the protocol cannot prevent:

* **Remote Desktop/Zombie Hosts:** If an attacker has a physical or virtual machine *inside* or close to your target region (e.g., an AWS instance in `us-west-2`), they can run the client from that machine. The latency check will pass because the "client" is physically close, even if the "user" controlling it is global.
* **Hardware Relays:** While C-Bound defeats software-based VPNs, a high-resource attacker could use dedicated physical relays. However, as long as the "Reflex" must happen at the edge of the network, the speed-of-light delay remains a constant.
* **Proximity vs. Remoteness (The One-Way Latency Filter):** C-Bound can only verify **proximity** (closeness), never **remoteness** (distance). An attacker can easily inject artificial delays (non-negative latency) on the infrastructure they control to pretend they are further away than they actually are. However, because they can never violate physics to *remove* latency or travel faster than light, the protocol remains an incredibly reliable filter for low latency only. You can prove a client is close, but you can never prove they are far. *(Note: While mathematically challenging, proving exact latency remoteness might be theoretically possible in future revisions by introducing server-side randomized processing delay over a high volume of RTT checks. If an attacker cannot predict the server's randomized timing, they cannot reliably manipulate the RTT to land in a narrow expected window. Any naive delay injection would introduce higher statistical variance, immediately exposing the spoofing attempt).*

**In short:** C-Bound raises the "Cost of Attack" from a $5 VPN subscription to a $50/hr dedicated remote host or human actor.


---

## 🚀  Features
* **Dynamic Latency Bounds:** The protocol evaluates RTT elasticity by dynamically polling between a configurable `MIN_ROUNDS` and `MAX_ROUNDS`. If a local network glitch spikes the first packet but a subsequent ping beats the `LATENCY_THRESHOLD_MS`, C-Bound grants early-exit authorization instantly to eliminate false negatives.
* **Persistent Configuration State:** A built-in JSON deserializer `data/cbound_config.json` actively caches the administrator's URL Database map, ensuring your custom routing and latency thresholds seamlessly persist across PM2 restarts and system reboots. Storing configuration directly in a flat JSON file entirely eliminates database overhead and traditional SQL-injection/database attack vectors.
* **QR Rendering Fallback (WeChat Bypass):** Certain aggressive in-app mobile browsers automatically drop and blacklist programmatic JavaScript `window.location.replace` behaviors. Administrators can toggle an interactive QR matrix rendering mode per-target, empowering users to seamlessly break out of WebView wrappers by long-pressing and natively scanning the payload.
* **Nanosecond Precision:** Powered by Node.js `process.hrtime.bigint()` for sub-millisecond hardware clock reading.
* **Zero-Dependency Client:** A vanilla JavaScript "Reflex" library ensures no execution overhead on the client side.

---

## 🛠️ Quick Start (Development)

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Run the Server:**
   ```bash
   npm start
   ```

---

## 🔒 Production Deployment & Hardening

C-Bound requires specific deployment configurations to maintain a reasonable security posture in production environments.

### 1. Initial Setup
Clone the repository and install the dependencies to your production server:
```bash
git clone https://github.com/5fff/C-Bound.git
cd C-Bound
npm install
```

### 2. Environment Variables
Never hardcode secrets in production. C-Bound uses `dotenv` to manage secrets safely. 
1. Copy the provided template: `cp .env.example .env`
2. Edit `.env` and configure the following:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | The port the Node server listens on | `3000` |
| `HOST` | Bind address (use `127.0.0.1` if behind NGINX, `0.0.0.0` for public) | `0.0.0.0` |
| `MIN_ROUNDS` | The minimum required ping checks before early-exit evaluation | `3` |
| `MAX_ROUNDS` | Maximum attempts permitted before forced verification failure | `10` |
| `DATA_FILE_PATH` | JSON path where URL configs save to survive restarts | `./data/cbound_config.json` |
| `CONFIG_SECRET` | Cryptographic passphrase protecting `/admin` | `secretstring123` |
| `TARGET_URL` | Global fallback Target URL | `https://google.com/` |
| `HONEYPOT_URL` | Global fallback Honeypot URL for physical proximity failures | `https://youtube.com/` |
| `HONEYPOT_ENABLED`| If `"false"`, disables honeypot redirection entirely and closes connection | `true` |
| `LATENCY_THRESHOLD_MS`| Sub-2ms local threshold for latency decisions | `2` |
| `GLOBAL_QR_MODE` | If true, new Targets will default to generating interactive QRs | `false` |
| `TRUST_PROXY` | Set `"true"` **ONLY** if using Cloudflare Tunnels or NGINX | `false` |

**Security Note:** `TRUST_PROXY` ensures C-Bound safely parses `X-Forwarded-For` and `CF-Connecting-IP` headers without being vulnerable to naive IP header spoofing from bad actors.

### 3. Build Process (Client Obfuscation)
The client-side Verification Reflex relies on an automated obfuscation pipeline to prevent reverse-engineering of the challenge logic.
Before starting the server in production, ensure the build script runs:
```bash
npm run build
```
*(Note: `npm start` automatically triggers the build script).*

### 4. Process Management & Logging (Automated)
Do not run `node server.js` directly in production. Use a process manager like **PM2** to ensure the service automatically restarts on failure and manages log rotation in the background.

To fully automate the installation of dependencies, Client JS obfuscation, PM2 installation, Logrotate setup, and daemonization, simply run the deployment script:

```bash
chmod +x deploy.sh
./deploy.sh
```

**Where are the logs?**
By using PM2, all C-Bound connection data, validation latencies, and output errors are automatically captured and safely stored in log files located in your user's home directory:
* Standard Output Logs (Connections, IPs, RTTs): `~/.pm2/logs/c-bound-out.log`
* Error Logs (Crashes, stack traces): `~/.pm2/logs/c-bound-error.log`

You can monitor these logs in real-time right from your terminal by running:
```bash
pm2 logs c-bound
```

### 5. Maintenance & Useful Commands
Because C-Bound runs as a background daemon under PM2, you can use standard PM2 commands to control it.

**Stop the service (for maintenance):**
```bash
pm2 stop c-bound
```

**Restart the service (after pulling new code or editing `.env`):**
```bash
pm2 restart c-bound
```

**Check the status of the process (Uptime, Memory Usage):**
```bash
pm2 status
# or
pm2 monit
```

**Completely shut down all background PM2 daemons (Useful if running on a local development laptop):**
If you want to completely stop not just the server, but the actual PM2 background daemon and its log-rotator module from running on your machine:
```bash
# This kills all applications and the PM2 god daemon itself
pm2 kill

# (Optional) If you want to uninstall the log-rotator module entirely:
pm2 uninstall pm2-logrotate
```

### 6. Reverse Proxy & Zero Trust Strategy
If deploying C-Bound to the public internet:
1. **Cloudflare Tunnels:** Highly recommended. Bind C-Bound to `127.0.0.1` and expose it securely via `cloudflared`. Set `TRUST_PROXY=true`.
2. **Protect the Admin Panel:** Place a Zero Trust Access Policy (e.g., Cloudflare Access) specifying that **only** authenticated administrators (via Email OTP, GitHub, etc.) can reach the `/admin/*` and `/fieldtest/*` paths.
3. **Rate Limiting:** Implement WAF rate-limiting on the root `/` path to prevent attackers from brute-forcing connection latency checks.
4. **Least Privilege:** Run the Node service under a dedicated, unprivileged Linux user account.

### 7. TLS/SSL Termination & Offloading (Decoupled Encryption)
C-Bound deliberately **decouples TLS/SSL encryption** from the core application layer. The server listens exclusively on unencrypted HTTP and WS protocols, and does not handle `.crt` or `.key` certificate files directly. 

Offloading TLS/SSL to dedicated, specialized edge infrastructure is standard industry practice for production web services. It is recommended to terminate TLS using:
* **CDNs & Tunnels:** Cloudflare Tunnels (using `cloudflared` to route traffic over secure tunnels to Cloudflare's edge) or AWS ALB/CloudFront.
* **Reverse Proxies:** An on-premise NGINX, HAProxy, or Envoy instance configured to terminate SSL and proxy traffic to C-Bound over localhost.

**Why is this decoupled?**
1. **Performance:** Specialized reverse proxies (like NGINX) and edge networks (like Cloudflare) are written in highly optimized native code (C/Go/C++) and handle cryptographic handshakes, TLS session resumption, and TCP multiplexing significantly faster and more efficiently than the Node.js V8 runtime.
2. **Simplified Certificate Management:** It allows you to manage and automatically renew SSL certificates (e.g., via Let's Encrypt / Certbot) independently at the edge or reverse proxy layer, completely eliminating the need to restart or reconfigure the Node.js application process during certificate renewals.
3. **Enhanced Security:** Offloading TLS allows the C-Bound Node.js process to run as an unprivileged, restricted Linux user bound to a local high-port (e.g., localhost `3000`), completely avoiding the security risk of granting Node.js root privileges just to bind to public privileged ports like `80` or `443`.

---

## ⚠️ Disclaimer

**This project is provided "as is" and has not been stress-tested, audited, or evaluated for large-scale, high-availability, or mission-critical production deployments.** 

By using this software, you acknowledge and agree that:
1. **Experimental Nature:** This is an experimental proximity-verification protocol. Network latency is subject to physical fluctuation, routing changes, ISP congestion, and varying client hardware/browser performance, which can affect measurement consistency and result in false positives or negatives.
2. **No Warranty:** To the maximum extent permitted by applicable law, this software is provided without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement.
3. **Use At Your Own Risk:** In no event shall the authors, contributors, or copyright holders be liable for any claim, damages, or other liability—whether in an action of contract, tort, or otherwise—arising from, out of, or in connection with this software or the use or other dealings in this software. Use of this tool is entirely at your own risk and discretion.
