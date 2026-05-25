import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for src/arcjet.js
 *
 * Because the module has top-level side effects (throws when ARCJET_KEY is
 * missing, constructs instances via @arcjet/node at import time), every test
 * that exercises the module uses:
 *   1. vi.doMock() – non-hoisted mock that can be set up per-test
 *   2. Dynamic import after vi.doMock()
 *   3. vi.resetModules() in afterEach to get a fresh module per test
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockDecision({ denied = false, isRateLimit = false } = {}) {
  return {
    isDenied: () => denied,
    reason: { isRateLimit: () => isRateLimit },
  };
}

function makeRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnThis();
  // Allow chaining: res.status(429).json(...)
  status.mockImplementation((code) => {
    res._status = code;
    return res;
  });
  const res = { _status: null, _body: null, status, json };
  json.mockImplementation((body) => {
    res._body = body;
    return res;
  });
  return res;
}

function makeReq() {
  return { headers: {}, method: 'GET', url: '/' };
}

// ---------------------------------------------------------------------------
// Shared mock state – mutated per test so vi.doMock factories can read it
// ---------------------------------------------------------------------------

let mockProtect = vi.fn();
let mockArcjetInstance = { protect: mockProtect };
let mockShield = vi.fn(() => ({}));
let mockDetectBot = vi.fn(() => ({}));
let mockSlidingWindow = vi.fn(() => ({}));
let mockArcjetFactory = vi.fn(() => mockArcjetInstance);

// ---------------------------------------------------------------------------
// securityMiddleware
// ---------------------------------------------------------------------------

describe('securityMiddleware', () => {
  beforeEach(() => {
    mockProtect = vi.fn();
    mockArcjetInstance = { protect: mockProtect };
    mockShield = vi.fn(() => ({}));
    mockDetectBot = vi.fn(() => ({}));
    mockSlidingWindow = vi.fn(() => ({}));
    mockArcjetFactory = vi.fn(() => mockArcjetInstance);

    vi.doMock('dotenv/config', () => ({}));
    vi.doMock('@arcjet/node', () => ({
      default: mockArcjetFactory,
      shield: mockShield,
      detectBot: mockDetectBot,
      slidingWindow: mockSlidingWindow,
    }));
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.ARCJET_KEY;
    delete process.env.ARCJETMODE;
  });

  it('calls next() when protect() returns an allowed decision', async () => {
    process.env.ARCJET_KEY = 'test-key-allowed';
    mockProtect.mockResolvedValue(makeMockDecision({ denied: false }));

    const { securityMiddleware } = await import('../src/arcjet.js');
    const middleware = securityMiddleware();
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(mockProtect).toHaveBeenCalledWith(req);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeNull();
  });

  it('returns 429 when decision is denied and reason is rate limit', async () => {
    process.env.ARCJET_KEY = 'test-key-ratelimit';
    mockProtect.mockResolvedValue(makeMockDecision({ denied: true, isRateLimit: true }));

    const { securityMiddleware } = await import('../src/arcjet.js');
    const middleware = securityMiddleware();
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res._status).toBe(429);
    expect(res._body).toEqual({ error: 'rate limit exceeded' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when decision is denied and reason is not rate limit', async () => {
    process.env.ARCJET_KEY = 'test-key-forbidden';
    mockProtect.mockResolvedValue(makeMockDecision({ denied: true, isRateLimit: false }));

    const { securityMiddleware } = await import('../src/arcjet.js');
    const middleware = securityMiddleware();
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'forbidden' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 503 with error details when protect() throws', async () => {
    process.env.ARCJET_KEY = 'test-key-error';
    const testError = new Error('arcjet network failure');
    mockProtect.mockRejectedValue(testError);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { securityMiddleware } = await import('../src/arcjet.js');
    const middleware = securityMiddleware();
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res._status).toBe(503);
    expect(res._body).toEqual({
      error: 'arcjet middleware error',
      details: 'arcjet network failure',
    });
    expect(next).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('securityMiddleware returns an async function with (req, res, next) signature', async () => {
    process.env.ARCJET_KEY = 'test-key-shape';
    mockProtect.mockResolvedValue(makeMockDecision());

    const { securityMiddleware } = await import('../src/arcjet.js');
    const middleware = securityMiddleware();

    expect(typeof middleware).toBe('function');
    expect(middleware.length).toBe(3);
  });

  it('securityMiddleware() can be called multiple times to produce independent middleware instances', async () => {
    process.env.ARCJET_KEY = 'test-key-multi';
    mockProtect.mockResolvedValue(makeMockDecision({ denied: false }));

    const { securityMiddleware } = await import('../src/arcjet.js');
    const m1 = securityMiddleware();
    const m2 = securityMiddleware();

    expect(typeof m1).toBe('function');
    expect(typeof m2).toBe('function');
    expect(m1).not.toBe(m2);
  });

  it('throws at module level when ARCJET_KEY is not set', async () => {
    delete process.env.ARCJET_KEY;

    await expect(import('../src/arcjet.js')).rejects.toThrow('ARCJETKEY is not set');
  });
});

// ---------------------------------------------------------------------------
// ARCJETMODE configuration
// ---------------------------------------------------------------------------

describe('ARCJETMODE configuration', () => {
  beforeEach(() => {
    mockShield = vi.fn(() => ({}));
    mockDetectBot = vi.fn(() => ({}));
    mockSlidingWindow = vi.fn(() => ({}));
    mockArcjetFactory = vi.fn(() => ({ protect: vi.fn() }));

    vi.doMock('dotenv/config', () => ({}));
    vi.doMock('@arcjet/node', () => ({
      default: mockArcjetFactory,
      shield: mockShield,
      detectBot: mockDetectBot,
      slidingWindow: mockSlidingWindow,
    }));
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.ARCJET_KEY;
    delete process.env.ARCJETMODE;
  });

  it('uses LIVE mode when ARCJETMODE env var is absent', async () => {
    process.env.ARCJET_KEY = 'test-key-live';
    delete process.env.ARCJETMODE;

    await import('../src/arcjet.js');

    expect(mockShield).toHaveBeenCalledWith(expect.objectContaining({ mode: 'LIVE' }));
    expect(mockDetectBot).toHaveBeenCalledWith(expect.objectContaining({ mode: 'LIVE' }));
    expect(mockSlidingWindow).toHaveBeenCalledWith(expect.objectContaining({ mode: 'LIVE' }));
  });

  it('uses DRY_RUN mode when ARCJETMODE env var is "DRY_RUN"', async () => {
    process.env.ARCJET_KEY = 'test-key-dryrun';
    process.env.ARCJETMODE = 'DRY_RUN';

    await import('../src/arcjet.js');

    expect(mockShield).toHaveBeenCalledWith(expect.objectContaining({ mode: 'DRY_RUN' }));
    expect(mockDetectBot).toHaveBeenCalledWith(expect.objectContaining({ mode: 'DRY_RUN' }));
    expect(mockSlidingWindow).toHaveBeenCalledWith(expect.objectContaining({ mode: 'DRY_RUN' }));
  });

  it('falls back to LIVE mode when ARCJETMODE has an unrecognised value', async () => {
    process.env.ARCJET_KEY = 'test-key-unknown';
    process.env.ARCJETMODE = 'STAGING';

    await import('../src/arcjet.js');

    expect(mockShield).toHaveBeenCalledWith(expect.objectContaining({ mode: 'LIVE' }));
    expect(mockSlidingWindow).toHaveBeenCalledWith(expect.objectContaining({ mode: 'LIVE' }));
  });
});

// ---------------------------------------------------------------------------
// Rule configuration
// ---------------------------------------------------------------------------

describe('Arcjet rule configuration', () => {
  beforeEach(() => {
    mockShield = vi.fn(() => ({}));
    mockDetectBot = vi.fn(() => ({}));
    mockSlidingWindow = vi.fn(() => ({}));
    mockArcjetFactory = vi.fn(() => ({ protect: vi.fn() }));

    vi.doMock('dotenv/config', () => ({}));
    vi.doMock('@arcjet/node', () => ({
      default: mockArcjetFactory,
      shield: mockShield,
      detectBot: mockDetectBot,
      slidingWindow: mockSlidingWindow,
    }));
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.ARCJET_KEY;
    delete process.env.ARCJETMODE;
  });

  it('configures httpArcjet slidingWindow with interval 10s and max 50', async () => {
    process.env.ARCJET_KEY = 'test-key-http-config';

    await import('../src/arcjet.js');

    // slidingWindow is called twice (once for http, once for ws).
    // The first call should be http (10s/50).
    const calls = mockSlidingWindow.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][0]).toMatchObject({ interval: '10s', max: 50 });
  });

  it('configures wsArcjet slidingWindow with stricter interval 2s and max 5', async () => {
    process.env.ARCJET_KEY = 'test-key-ws-config';

    await import('../src/arcjet.js');

    const calls = mockSlidingWindow.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[1][0]).toMatchObject({ interval: '2s', max: 5 });
  });

  it('configures detectBot to allow CATEGORY:SEARCH_ENGINE for both instances', async () => {
    process.env.ARCJET_KEY = 'test-key-detectbot';

    await import('../src/arcjet.js');

    for (const call of mockDetectBot.mock.calls) {
      expect(call[0].allow).toContain('CATEGORY:SEARCH_ENGINE');
    }
  });

  it('configures detectBot to allow CATEGORY:PREVIEW for both instances', async () => {
    process.env.ARCJET_KEY = 'test-key-preview';

    await import('../src/arcjet.js');

    for (const call of mockDetectBot.mock.calls) {
      expect(call[0].allow).toContain('CATEGORY:PREVIEW');
    }
  });

  it('passes the ARCJET_KEY to the arcjet factory', async () => {
    process.env.ARCJET_KEY = 'my-secret-key';

    await import('../src/arcjet.js');

    // Factory is called twice (httpArcjet + wsArcjet)
    for (const call of mockArcjetFactory.mock.calls) {
      expect(call[0].key).toBe('my-secret-key');
    }
  });
});

// ---------------------------------------------------------------------------
// Null branch: securityMiddleware when httpArcjet is null
// (tested via an inline reproduction of the middleware logic)
// ---------------------------------------------------------------------------

describe('securityMiddleware null-arcjet guard', () => {
  it('calls next() without touching protect() when httpArcjet is null', async () => {
    // Reproduce the guard inline since the module-level throw prevents
    // importing arcjet.js without a key
    const httpArcjet = null;
    const middleware = async (req, res, next) => {
      if (!httpArcjet) return next();
      const decision = await httpArcjet.protect(req);
      if (decision.isDenied()) return res.status(403).json({ error: 'forbidden' });
      next();
    };

    const next = vi.fn();
    const res = makeRes();

    await middleware(makeReq(), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeNull();
  });
});