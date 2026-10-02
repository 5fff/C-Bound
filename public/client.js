const statusEl = document.getElementById('status');

const params = new URLSearchParams(window.location.search);
const target = params.get('target') || '';

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}/?target=${target}`;
let ws;
try {
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        try {
            const deviceInfo = {
                type: 'DEVICE_INFO',
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                resolution: `${window.screen.width}x${window.screen.height}`,
                userAgent: navigator.userAgent
            };
            ws.send(JSON.stringify(deviceInfo));
        } catch(e) {
            // Ignore if device info extraction fails for any reason
        }
        statusEl.textContent = 'Authenticating...';
    };
} catch (e) {
    statusEl.textContent = 'Access Denied.';
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
        } else if (data.type === 'AUTHORIZED') {
            // 1. Decode payload
            let targetUrl = atob(data.payload);
            const showQrCode = !!data.showQrCode;
            
            // 2. Nuke the WebSocket connection entirely
            if (ws) {
                ws.onclose = null; // Prevent close handler
                ws.onerror = null;
                ws.onmessage = null;
                ws.close();
                ws = null;
            }
            
            // 3. Clear data out of memory
            data.payload = null;
            event.data = null;
            
            if (showQrCode) {
                // WeChat / Wrapper Bypass: Render QR Code on screen
                const spinner = document.querySelector('.spinner');
                if (spinner) spinner.style.display = 'none';
                
                statusEl.innerHTML = 'Verification Complete.<br><span style="font-size: 0.9rem; color: #aaa;">Scan this QR securely to continue.</span>';
                
                const qrContainer = document.createElement('div');
                qrContainer.id = 'qrcode';
                qrContainer.style.background = '#fff';
                qrContainer.style.padding = '15px';
                qrContainer.style.borderRadius = '8px';
                qrContainer.style.marginTop = '20px';
                
                const card = document.querySelector('.card');
                if (card) {
                    card.appendChild(qrContainer);
                } else {
                    document.body.appendChild(qrContainer);
                }
                
                new QRCode(qrContainer, {
                    text: targetUrl,
                    width: 200,
                    height: 200,
                    colorDark : "#000000",
                    colorLight : "#ffffff",
                    correctLevel : QRCode.CorrectLevel.H
                });

                // Convert Canvas to a Native Image for Mobile Long-Press Support
                setTimeout(() => {
                    const canvas = qrContainer.querySelector('canvas');
                    if (canvas) {
                        const img = document.createElement('img');
                        img.src = canvas.toDataURL('image/png');
                        img.style.width = '200px';
                        img.style.height = '200px';
                        img.style.display = 'block';
                        img.style.margin = '0 auto';
                        // Replace everything in the container with just the native image
                        qrContainer.innerHTML = '';
                        qrContainer.appendChild(img);
                    }
                }, 50);
                
            } else {
                // 4. Erase the current document DOM so the "referrer" is effectively blanked
                document.open();
                document.write('');
                document.close();

                // 5. Silent History Replacement
                window.location.replace(targetUrl);
            }
            
            // 6. Final overwrite of target string memory reference
            targetUrl = null;

        } else if (data.type === 'DENIED') {
            statusEl.textContent = 'Access Denied.';
            // Optional: remove spinner if unauthorized
            const spinner = document.querySelector('.spinner');
            if (spinner) spinner.style.display = 'none';
        } else if (data.type === 'INVALID_TARGET') {
            statusEl.textContent = 'This link does not exist or is no longer valid.';
            const spinner = document.querySelector('.spinner');
            if (spinner) spinner.style.display = 'none';
        }
    } catch (e) {
        // Silently drop invalid packets
    }
};

if (ws) {
    ws.onclose = () => {
        if (statusEl && statusEl.textContent !== 'Access Denied.' && statusEl.textContent !== 'This link does not exist or is no longer valid.') {
            statusEl.textContent = 'Access Denied.';
            const spinner = document.querySelector('.spinner');
            if (spinner) spinner.style.display = 'none';
        }
    };

    ws.onerror = (error) => {
        if (statusEl) {
            statusEl.textContent = 'Access Denied.';
            const spinner = document.querySelector('.spinner');
            if (spinner) spinner.style.display = 'none';
        }
    };
}
