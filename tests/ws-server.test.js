import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Tests for ws/server.js – specifically the new Arcjet protection in the
 * 'upgrade' event handler added in this PR.
 *
 * The module depends on:
 *   - 'ws' (WebSocketServer)
 *   - '../src/arcjet.js' (wsArcjet)
 *
 * Both are mocked via vi.doMock() so no real network connections are opened.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSocket() {
  return {
    write: vi.fn(),
    destroy: vi.fn(),
  };
}

function makeReq(url = '/ws') {
  return { url, headers: { host: 'localhost' }, method: 'GET' };
}

function makeMockDecision({ denied = false, isRateLimit = false } = {}) {
  return {
    isDenied: () => denied,
    reason: { isRateLimit: () => isRateLimit },
  };
}

// Emit the 'upgrade' event on the server and await all async handlers
async function emitUpgrade(server, req, socket) {
  const listeners = server.listeners('upgrade');
  for (const listener of listeners) {
    await listener(req, socket, Buffer.alloc(0));
  }
}

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

let mockProtect;
let mockWsArcjet;
let mockWss;
let mockWssConstructor;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('attachWebSocketServer – upgrade handler (Arcjet protection)', () => {
  let server;

  beforeEach(() => {
    mockProtect = vi.fn();
    mockWsArcjet = { protect: mockProtect };

    mockWss = new EventEmitter();
    mockWss.clients = new Set();
    mockWss.handleUpgrade = vi.fn((req, socket, head, cb) => {
      const mockWs = new EventEmitter();
      mockWs.readyState = 1; // OPEN
      mockWs.isAlive = false;
      mockWs.send = vi.fn();
      mockWs.ping = vi.fn();
      mockWs.terminate = vi.fn();
      cb(mockWs);
    });

    // Must use a regular function (not arrow) so it can be called with `new`
    mockWssConstructor = vi.fn(function () { return mockWss; });

    vi.doMock('ws', () => ({
      default: Object.assign(mockWssConstructor, { OPEN: 1 }),
      WebSocketServer: mockWssConstructor,
    }));

    vi.doMock('../src/arcjet.js', () => ({
      wsArcjet: mockWsArcjet,
      httpArcjet: null,
      securityMiddleware: vi.fn(() => (_req, _res, next) => next()),
    }));

    server = new EventEmitter();
  });

  afterEach(() => {
    vi.resetModules();
  });

  // ---- URL routing --------------------------------------------------------

  it('destroys socket immediately when upgrade URL is not /ws', async () => {
    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    const socket = makeSocket();
    await emitUpgrade(server, makeReq('/api/other'), socket);

    expect(socket.destroy).toHaveBeenCalled();
    expect(mockWss.handleUpgrade).not.toHaveBeenCalled();
  });

  it('does not destroy socket for a valid /ws upgrade', async () => {
    mockProtect.mockResolvedValue(makeMockDecision({ denied: false }));

    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    const socket = makeSocket();
    await emitUpgrade(server, makeReq('/ws'), socket);

    expect(socket.destroy).not.toHaveBeenCalled();
    expect(mockWss.handleUpgrade).toHaveBeenCalled();
  });

  it('does not call handleUpgrade when URL is not /ws', async () => {
    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    await emitUpgrade(server, makeReq('/health'), makeSocket());

    expect(mockWss.handleUpgrade).not.toHaveBeenCalled();
  });

  // ---- wsArcjet allowed ---------------------------------------------------

  it('calls handleUpgrade when wsArcjet allows the connection', async () => {
    mockProtect.mockResolvedValue(makeMockDecision({ denied: false }));

    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    const socket = makeSocket();
    await emitUpgrade(server, makeReq('/ws'), socket);

    expect(mockProtect).toHaveBeenCalledWith(expect.objectContaining({ url: '/ws' }));
    expect(mockWss.handleUpgrade).toHaveBeenCalled();
    expect(socket.write).not.toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  // ---- wsArcjet denied (rate limit) ---------------------------------------

  it('writes HTTP 429 when wsArcjet denies with rate limit', async () => {
    mockProtect.mockResolvedValue(makeMockDecision({ denied: true, isRateLimit: true }));

    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    const socket = makeSocket();
    await emitUpgrade(server, makeReq('/ws'), socket);

    expect(socket.write).toHaveBeenCalledWith(
      expect.stringContaining('429 Too Many Requests')
    );
    expect(socket.destroy).toHaveBeenCalled();
    expect(mockWss.handleUpgrade).not.toHaveBeenCalled();
  });

  it('includes Content-Length: 0 in 429 response', async () => {
    mockProtect.mockResolvedValue(makeMockDecision({ denied: true, isRateLimit: true }));

    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    const socket = makeSocket();
    await emitUpgrade(server, makeReq('/ws'), socket);

    const written = socket.write.mock.calls[0][0];
    expect(written).toContain('Content-Length: 0');
  });

  // ---- wsArcjet denied (not rate limit) -----------------------------------

  it('writes HTTP 403 when wsArcjet denies without rate limit', async () => {
    mockProtect.mockResolvedValue(makeMockDecision({ denied: true, isRateLimit: false }));

    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    const socket = makeSocket();
    await emitUpgrade(server, makeReq('/ws'), socket);

    expect(socket.write).toHaveBeenCalledWith(
      expect.stringContaining('403 Forbidden')
    );
    expect(socket.destroy).toHaveBeenCalled();
    expect(mockWss.handleUpgrade).not.toHaveBeenCalled();
  });

  it('includes Content-Length: 0 in 403 response', async () => {
    mockProtect.mockResolvedValue(makeMockDecision({ denied: true, isRateLimit: false }));

    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    const socket = makeSocket();
    await emitUpgrade(server, makeReq('/ws'), socket);

    const written = socket.write.mock.calls[0][0];
    expect(written).toContain('Content-Length: 0');
  });

  // ---- wsArcjet throws ----------------------------------------------------

  it('writes HTTP 503 when wsArcjet.protect() throws', async () => {
    mockProtect.mockRejectedValue(new Error('arcjet service down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    const socket = makeSocket();
    await emitUpgrade(server, makeReq('/ws'), socket);

    expect(socket.write).toHaveBeenCalledWith(
      expect.stringContaining('503 Service Unavailable')
    );
    expect(socket.destroy).toHaveBeenCalled();
    expect(mockWss.handleUpgrade).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('logs the error when wsArcjet.protect() throws', async () => {
    const arcjetError = new Error('timeout');
    mockProtect.mockRejectedValue(arcjetError);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    await emitUpgrade(server, makeReq('/ws'), makeSocket());

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Arcjet WS protection error'),
      arcjetError
    );

    consoleSpy.mockRestore();
  });

  it('includes Content-Length: 0 in 503 response', async () => {
    mockProtect.mockRejectedValue(new Error('fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    const socket = makeSocket();
    await emitUpgrade(server, makeReq('/ws'), socket);

    expect(socket.write.mock.calls[0][0]).toContain('Content-Length: 0');

    consoleSpy.mockRestore();
  });

  // ---- wsArcjet is null (no key) ------------------------------------------

  it('skips Arcjet check and calls handleUpgrade when wsArcjet is null', async () => {
    vi.resetModules();
    const localWssCtor = vi.fn(function () { return mockWss; });
    vi.doMock('ws', () => ({
      default: Object.assign(localWssCtor, { OPEN: 1 }),
      WebSocketServer: localWssCtor,
    }));
    vi.doMock('../src/arcjet.js', () => ({
      wsArcjet: null,
      httpArcjet: null,
      securityMiddleware: vi.fn(() => (_req, _res, next) => next()),
    }));

    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    const socket = makeSocket();
    await emitUpgrade(server, makeReq('/ws'), socket);

    expect(mockProtect).not.toHaveBeenCalled();
    expect(mockWss.handleUpgrade).toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  // ---- noServer configuration ---------------------------------------------

  it('creates WebSocketServer with noServer:true', async () => {
    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    expect(mockWssConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ noServer: true })
    );
  });

  it('does NOT pass a server option to the WebSocketServer constructor', async () => {
    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    const callArg = mockWssConstructor.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('server');
  });

  // ---- return value -------------------------------------------------------

  it('returns an object with a broadcastMatchCreated function', async () => {
    const { attachWebSocketServer } = await import('../ws/server.js');
    const result = attachWebSocketServer(server);

    expect(result).toHaveProperty('broadcastMatchCreated');
    expect(typeof result.broadcastMatchCreated).toBe('function');
  });

  // ---- upgrade listener registered on HTTP server ------------------------

  it('registers exactly one "upgrade" listener on the HTTP server', async () => {
    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    expect(server.listenerCount('upgrade')).toBe(1);
  });

  // ---- regression: write() called before destroy() ----------------------

  it('calls socket.write() before socket.destroy() when rejecting a connection', async () => {
    mockProtect.mockResolvedValue(makeMockDecision({ denied: true, isRateLimit: true }));

    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    const socket = makeSocket();
    await emitUpgrade(server, makeReq('/ws'), socket);

    const writeOrder = socket.write.mock.invocationCallOrder[0];
    const destroyOrder = socket.destroy.mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(destroyOrder);
  });

  // ---- boundary: only /ws path is accepted --------------------------------

  it('rejects upgrade to /ws/ (trailing slash) as not matching path exactly', async () => {
    const { attachWebSocketServer } = await import('../ws/server.js');
    attachWebSocketServer(server);

    const socket = makeSocket();
    await emitUpgrade(server, makeReq('/ws/'), socket);

    expect(socket.destroy).toHaveBeenCalled();
    expect(mockWss.handleUpgrade).not.toHaveBeenCalled();
  });
});
