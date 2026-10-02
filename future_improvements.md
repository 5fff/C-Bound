# 🚀 Future Improvements

This document lists potential code improvements, security hardening, and deployment optimizations identified during pre-release review. Since the priority is on keeping the core codebase simple for initial launch, these are deferred to future releases.

---

## 🛡️ Security Hardening

### 1. Robust Cryptographic Secret Comparison
* **Target File:** `server.js` (inside `handleApiConfig`, `handleProtectedPage`, and WebSocket connection event handlers)
* **Current Issue:** The current constant-time string comparison uses fixed-size buffers:
  ```javascript
  const providedBuf = Buffer.alloc(32);
  providedBuf.write(secret || '');
  const correctBuf = Buffer.alloc(32);
  correctBuf.write(CONFIG_SECRET);
  ```
  If `CONFIG_SECRET` is configured with a string longer than 32 characters, both buffers truncate the strings. This means an attacker only needs the first 32 characters to authenticate. Shorter inputs also leave the remainder of the buffer padded with zero bytes (`0x00`), which can lead to unexpected padding-matching behavior.
* **Proposed Solution:** Hash both strings to fixed-length SHA-256 digests *before* comparing them with constant-time equality checks. Add a helper function:
  ```javascript
  const secureCompare = (a, b) => {
      if (typeof a !== 'string' || typeof b !== 'string') return false;
      const aHash = crypto.createHash('sha256').update(a).digest();
      const bHash = crypto.createHash('sha256').update(b).digest();
      return crypto.timingSafeEqual(aHash, bHash);
  };
  ```
  Replace all `Buffer.alloc(32)` comparisons with `secureCompare(provided, correct)`.

---

## 🌐 Networking & Reliability

### 2. Dual-Stack IPv4-mapped IPv6 Address Normalization
* **Target File:** `server.js` (inside `isLocalIp` helper function)
* **Current Issue:** In dual-stack IPv4/IPv6 networks, client connections from the local intranet or loopback interfaces are often exposed by Node.js using IPv4-mapped IPv6 address formats (e.g., prefixed with `::ffff:`, such as `::ffff:192.168.1.100`). The current `isLocalIp` function does not recognize `::ffff:192.168.` or `::ffff:10.` as local.
* **Proposed Solution:** Normalize the IP address string to strip out the `::ffff:` prefix at the top of the `isLocalIp` helper:
  ```javascript
  const isLocalIp = (ip) => {
      if (!ip) return false;
      let normalizedIp = ip;
      if (normalizedIp.startsWith('::ffff:')) {
          normalizedIp = normalizedIp.substring(7);
      }
      // Continue with standard IPv4 / IPv6 local checks...
  ```

---

## 📦 Deployment Optimization

### 3. Production Obfuscator Dependency
* **Target File:** `package.json`
* **Current Issue:** The `javascript-obfuscator` is currently listed in `devDependencies`. When setting up automated continuous integration (CI) or production servers running with `NODE_ENV=production` or `npm install --production`, `npm` skips `devDependencies`. This will cause the build/start script (`npm run build` / `npm start`) to crash because the obfuscator binary is missing.
* **Proposed Solution:** Move `javascript-obfuscator` to regular `dependencies` since code obfuscation is a critical task in the production deployment pipeline (triggered by both `deploy.sh` and `npm start`).

---

## 🎨 User Interface (UI/UX)

### 4. Missing Landing Page Card Container Markup
* **Target File:** `index.html`
* **Current Issue:** In `index.html`, the opening `<div class="card">` tag is missing, although the CSS contains styles targeting `.card` (with dark background, padding, shadow, and rounded borders) and the code ends with an extra closing `</div>`. This breaks the UI layout, causing the landing page's main verification block to render unstyled.
* **Proposed Solution:** Insert the opening `<div class="card">` container tag wrap:
  ```html
  <body>
      <div class="card">
          <div class="spinner"></div>
          <div id="status">Verifying connection...</div>
      </div>
  ```
