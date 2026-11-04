// VERSION: 1.1.0
/**
 * Optional same-origin passthrough to a self-hosted Hermes Gateway.
 *
 * WHY THIS EXISTS
 * The Hermes Gateway (hermes serve) deliberately only trusts its own origin for
 * browser clients: it answers CORS with a strict loopback/public-URL allowlist
 * and rejects WebSocket upgrades whose Origin does not name the gateway itself
 * (anti-DNS-rebinding guards). A chess page served from this server is a
 * different origin, so a browser cannot talk to the gateway directly.
 *
 * HOW IT IS USED
 * Forwards every request under /hermes-gateway/* — plain HTTP (login, status)
 * and WebSocket upgrades (/api/ws) — to the gateway, rewriting only Host and
 * Origin so the gateway sees its own authority. Everything else, including the
 * session cookie and all WebSocket frames, passes through untouched.
 *
 * WHERE THE GATEWAY URL COMES FROM
 * 1. Server-side pre-configuration: HERMES_GATEWAY_URL env var or the local
 *    hermes.config.json ({"gatewayUrl": "http://host:9119"}).
 * 2. The game UI: the client posts the entered gateway URL to
 *    POST /hermes-gateway/target. The URL is validated and — unless the server
 *    was started with the env var — persisted back to hermes.config.json, so a
 *    restart keeps it. Users never edit config files by hand.
 *
 * SAFETY
 * This module accepts a target URL from page visitors, so it is deliberately
 * NOT a general-purpose proxy:
 *   - only http(s) targets,
 *   - only hosts that resolve to private/loopback addresses (RFC 1918,
 *     loopback, ULA, link-local) — no proxying to internet hosts (anti-SSRF),
 *   - no credentials, no AI logic, no game state; gateway auth stays between
 *     browser and gateway.
 * Keep the chess server (and the gateway) on a trusted network.
 */
'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const express = require('express');

const HOP_BY_HOP = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade'
]);

/** True for IPv4/IPv6 addresses that are loopback or private (RFC 1918/4193). */
function isPrivateOrLoopback(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 169 && b === 254);
    }
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;          // ULA fc00::/7
    if (/^fe[89ab]/.test(lower)) return true;                                   // link-local fe80::/10
    const v4mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);              // ::ffff:a.b.c.d
    if (v4mapped) return isPrivateOrLoopback(v4mapped[1]);
    return false;
}

/**
 * Attaches the proxy routes to an express app + its underlying http server.
 *
 * @param {http.Server} server       the Node HTTP server passed to socket.io
 * @param {express.Express} app      the express app
 * @param {object} options
 * @param {string}   [options.gatewayUrl]  pre-configured gateway base URL (env/file)
 * @param {string}   [options.configFile]  path of hermes.config.json for UI persistence
 * @param {boolean}  [options.lockedByEnv] true when gatewayUrl came from HERMES_GATEWAY_URL;
 *                                         UI changes still apply at runtime but are not persisted
 * @param {string}   [options.prefix]      mount path, default '/hermes-gateway'
 * @returns {{prefix: string, getTarget: () => URL|null}} getTarget for status logging
 */
function attachHermesGatewayProxy(server, app, {
    gatewayUrl, configFile = path.join(process.cwd(), 'hermes.config.json'),
    lockedByEnv = false, prefix = '/hermes-gateway'
} = {}) {
    const state = { target: null };
    if (gatewayUrl) state.target = new URL(gatewayUrl);

    /**
     * Validate + activate a gateway URL. Throws Error with a user-facing
     * message when the URL is rejected.
     */
    async function setTarget(rawUrl, { persist = true } = {}) {
        let parsed;
        try {
            parsed = new URL(rawUrl);
        } catch (e) {
            throw new Error('not a valid URL');
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('only http(s) URLs are supported');
        }
        let addrs;
        try {
            addrs = await dns.promises.lookup(parsed.hostname, { all: true });
        } catch (e) {
            throw new Error(`cannot resolve host "${parsed.hostname}"`);
        }
        if (!addrs.some(a => isPrivateOrLoopback(a.address))) {
            throw new Error('for security, the gateway must be a private/loopback address (LAN)');
        }
        state.target = parsed;
        let persisted = false;
        if (persist && !lockedByEnv && configFile) {
            try {
                fs.writeFileSync(configFile, JSON.stringify({ gatewayUrl: parsed.origin }, null, 4) + '\n');
                persisted = true;
            } catch (e) {
                console.error(`[hermes-proxy] could not persist ${configFile}: ${e.message}`);
            }
        }
        return persisted;
    }

    // --- UI configuration endpoint: the browser registers its gateway URL here ---
    app.post(`${prefix}/target`, express.json({ limit: '4kb' }), (req, res) => {
        const url = req.body && typeof req.body.url === 'string' ? req.body.url.trim() : '';
        if (!url) return res.status(400).json({ error: 'missing "url" field' });
        setTarget(url).then(persisted => {
            console.log(`[hermes-proxy] gateway target set via UI: ${state.target.origin}` +
                (persisted ? ` (persisted to ${path.basename(configFile)})` : ''));
            res.json({ ok: true, target: state.target.origin, persisted });
        }).catch(e => {
            res.status(400).json({ error: e.message });
        });
    });

    const noTargetMessage = () => ({
        error: 'no gateway configured yet — enter your Hermes Gateway URL in the game UI (Hermes Agent panel)'
    });

    // --- HTTP passthrough (login, status, anything else under the prefix) ---
    const forwardHttp = (req, res) => {
        if (!state.target) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(noTargetMessage()));
            return;
        }
        const target = state.target;
        const subPath = req.url.slice(prefix.length) || '/';

        const headers = { ...req.headers };
        HOP_BY_HOP.forEach(h => delete headers[h]);
        // Present the gateway's own authority: its CORS/origin guards treat this
        // as a same-origin request from its own webapp, exactly like the Vite dev
        // proxy setup the gateway documents for dashboard development.
        headers.host = target.host;
        headers.origin = target.origin;
        delete headers.referer;

        const reqOptions = {
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: subPath,
            method: req.method,
            headers
        };

        const upstream = (target.protocol === 'https:' ? https : http).request(reqOptions, (upRes) => {
            const resHeaders = { ...upRes.headers };
            HOP_BY_HOP.forEach(h => delete resHeaders[h]);
            res.writeHead(upRes.statusCode || 502, resHeaders);
            upRes.pipe(res);
        });

        upstream.on('error', (err) => {
            console.error(`[hermes-proxy] upstream error on ${req.method} ${subPath}: ${err.message}`);
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
            }
            res.end(JSON.stringify({ error: 'Hermes gateway unreachable' }));
        });

        req.pipe(upstream);
    };

    app.all(prefix, forwardHttp);
    app.all(`${prefix}/*`, forwardHttp);

    // --- WebSocket tunnel (/api/ws) ---
    server.on('upgrade', (req, socket, head) => {
        if (!req.url || !req.url.startsWith(prefix + '/')) return; // socket.io handles its own paths

        console.log(`[hermes-proxy] ws upgrade ${req.url}`);
        if (!state.target) {
            socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n' +
                'Content-Type: application/json\r\n\r\n' + JSON.stringify(noTargetMessage()));
            socket.destroy();
            return;
        }
        const target = state.target;
        const subPath = req.url.slice(prefix.length);

        const headerLines = Object.entries(req.headers)
            .filter(([k]) => !HOP_BY_HOP.has(k) && k !== 'host' && k !== 'origin' && k !== 'referer')
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`);

        const requestText = [
            `GET ${subPath} HTTP/1.1`,
            ...headerLines,
            `Host: ${target.host}`,
            `Origin: ${target.origin}`,
            '\r\n'
        ].join('\r\n');

        const connectOptions = { host: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80) };
        const upstreamSocket = (target.protocol === 'https:' ? tls : net).connect(connectOptions, () => {
            console.log(`[hermes-proxy] ws tunnel connected to ${target.host}, sending handshake`);
            upstreamSocket.write(requestText);
            if (head && head.length) upstreamSocket.write(head);
            // Log the gateway's first handshake bytes once (101 / 401 / 503) so
            // operators can see whether the upgrade reached and passed auth.
            upstreamSocket.once('data', (chunk) => {
                console.log(`[hermes-proxy] ws tunnel gateway replied: ${chunk.toString('utf8', 0, Math.min(60, chunk.length)).split('\r\n')[0]}`);
            });
        });

        const cleanup = (err) => {
            if (err) console.error(`[hermes-proxy] ws tunnel error: ${err.message || err}`);
            socket.destroy();
            upstreamSocket.destroy();
        };

        socket.on('error', cleanup);
        upstreamSocket.on('error', cleanup);
        upstreamSocket.on('close', () => socket.destroy());
        socket.on('close', () => upstreamSocket.destroy());

        // Raw bidirectional pipe: the 101 handshake response and every frame
        // after it flow through unchanged (including cookie auth and pings).
        upstreamSocket.pipe(socket);
        socket.pipe(upstreamSocket);
    });

    return { prefix, getTarget: () => state.target };
}

module.exports = { attachHermesGatewayProxy };
