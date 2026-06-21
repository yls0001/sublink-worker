import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock the httpSubscriptionFetcher module so tests do not hit the network
vi.mock('../src/parsers/subscription/httpSubscriptionFetcher.js', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...original,
        fetchSubscriptionWithFormat: vi.fn()
    };
});

import { fetchSubscriptionWithFormat } from '../src/parsers/subscription/httpSubscriptionFetcher.js';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

const createTestApp = () => {
    const runtime = { kv: new MemoryKVAdapter(), assetFetcher: null, logger: console, config: { configTtlSeconds: 60, shortLinkTtlSeconds: null } };
    return createApp(runtime);
};

// Plain base64-decodable node list (vless links) so the builders can parse real proxies.
const mockNodeList = [
    'vless://00000000-0000-4000-8000-000000000000@hk.example.com:443?security=tls&type=ws&host=example.com&sni=example.com&path=%2F#HK-Node',
    'vless://00000000-0000-4000-8000-000000000000@jp.example.com:443?security=tls&type=ws&host=example.com&sni=example.com&path=%2F#JP-Node'
].join('\n');

describe('GET /sub (subconverter-compatible endpoint)', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns 400 when url is missing', async () => {
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=clash');
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Missing url');
    });

    it('returns 400 for unsupported target (quanx)', async () => {
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=quanx&url=https://example.com/sub');
        expect(res.status).toBe(400);
        const text = await res.text();
        expect(text).toContain('Unsupported target');
        expect(text).toContain('quanx');
    });

    it('returns 400 for unsupported target (loon)', async () => {
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=loon&url=https://example.com/sub');
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('loon');
    });

    it('returns 400 when fetch fails', async () => {
        fetchSubscriptionWithFormat.mockResolvedValue(null);
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=clash&url=https://example.com/sub');
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Failed to fetch');
    });

    it('returns 400 when fetched content is empty', async () => {
        fetchSubscriptionWithFormat.mockResolvedValue({ content: '', format: 'unknown', url: 'https://example.com/sub' });
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=clash&url=https://example.com/sub');
        expect(res.status).toBe(400);
    });

    it('outputs clash yaml for target=clash', async () => {
        fetchSubscriptionWithFormat.mockResolvedValue({
            content: mockNodeList, format: 'unknown', url: 'https://example.com/sub'
        });
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=clash&url=https://example.com/sub');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/yaml');
        const text = await res.text();
        expect(text).toContain('proxies:');
        expect(text).toContain('HK-Node');
    });

    it('treats target=mixed as clash', async () => {
        fetchSubscriptionWithFormat.mockResolvedValue({
            content: mockNodeList, format: 'unknown', url: 'https://example.com/sub'
        });
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=mixed&url=https://example.com/sub');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/yaml');
    });

    it('outputs sing-box json for target=singbox', async () => {
        fetchSubscriptionWithFormat.mockResolvedValue({
            content: mockNodeList, format: 'unknown', url: 'https://example.com/sub'
        });
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=singbox&url=https://example.com/sub');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/json');
        const json = await res.json();
        expect(Array.isArray(json.outbounds)).toBe(true);
    });

    it('accepts target=sing-box (dash form)', async () => {
        fetchSubscriptionWithFormat.mockResolvedValue({
            content: mockNodeList, format: 'unknown', url: 'https://example.com/sub'
        });
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=sing-box&url=https://example.com/sub');
        expect(res.status).toBe(200);
    });

    it('outputs surge ini for target=surge', async () => {
        fetchSubscriptionWithFormat.mockResolvedValue({
            content: mockNodeList, format: 'unknown', url: 'https://example.com/sub'
        });
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=surge&url=https://example.com/sub');
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('[Proxy]');
    });

    it('accepts target with surge ver suffix (surge&ver=4)', async () => {
        fetchSubscriptionWithFormat.mockResolvedValue({
            content: mockNodeList, format: 'unknown', url: 'https://example.com/sub'
        });
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=surge&ver=4&url=https://example.com/sub');
        expect(res.status).toBe(200);
    });

    it('forwards subscription-userinfo header to client', async () => {
        const userinfo = 'upload=1; download=2; total=100; expire=4102329600';
        fetchSubscriptionWithFormat.mockResolvedValue({
            content: mockNodeList, format: 'unknown', url: 'https://example.com/sub', subscriptionUserinfo: userinfo
        });
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=clash&url=https://example.com/sub');
        expect(res.headers.get('subscription-userinfo')).toBe(userinfo);
    });

    it('ignores subconverter-only params (config/emoji/scv) without error', async () => {
        fetchSubscriptionWithFormat.mockResolvedValue({
            content: mockNodeList, format: 'unknown', url: 'https://example.com/sub'
        });
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=clash&url=https://example.com/sub&config=https://example.com/acl.ini&emoji=true&scv=false');
        expect(res.status).toBe(200);
    });
});
