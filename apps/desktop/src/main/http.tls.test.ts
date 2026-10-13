import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer as createHttpServer, request as httpRequest, type RequestListener, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect, type Socket } from "node:net";
import { createRequest } from "@openapi-collection-studio/core";
import { DEFAULT_SETTINGS } from "../shared/contracts";
import { closeHttpAgents, sendHttpRequest, testConnection } from "./http";
import { fetchWithProxy, ProxyAgentCache } from "./proxy";

const mocks = vi.hoisted(() => ({ loadSettings: vi.fn(), resolveProxy: vi.fn() }));
vi.mock("electron", () => ({ session: { defaultSession: { resolveProxy: mocks.resolveProxy } } }));
vi.mock("./storage", () => ({ loadSettings: mocks.loadSettings }));

// Generated only for these loopback tests; this public fixture is not a production credential.
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCeXnB8cdGzW+ca
DCaxOM10khlkUxvcK2pjBmkvdVob28UzjWW+4KzfgYjd7Fpkt72FPBqYcDGWzYWN
XTuAjZysp25u+FsBEIXdiJ99XVJqboyR4NzCSjIrZdFS7eTVXWvqmlFo0h9wGzjp
N7nx1p5glz8vUHHe38MAEW8IaSiuqA24vP41RGpwc6sNiJ0g3nZRq9gifDHpbuPV
Fatm5Ux3AqPXyrXbibNirtWWXFBLChwjQgzfMNRK3Lhh3hZoar2qfpOrUUjMX/Ou
RXb4UWZnOaqetukZNeh5QNwoLBBkBWd88jV3+dSZnnZYFDaGLD5XUTkYoIRrbpwt
hY8RuPOxAgMBAAECggEAToB1tdodnpDBv7GiRFrpzQzWtVpVBxAmTivRXAsJvaF0
4RcIBlQMnUXyeD8+l4pU0YR3knSawCvkNayvYAvSS+s63JsTUTXFhYjBtjzaK5Pc
7jrOcyigMc7osfjmY7VJVyNjk1gE6Wc1ELXk4DIIk8ylL2jq6RV17cS2iy7FUb2I
XAcrw8Kmhb6ddwzKuf3YG7BJAt+RFSduSNv/1typEBh/bETDfP8xT6Loz3gYqnjg
f7DfgLNw5CS2X44rbzd3rpZ3mGuFKj5uWmGj/nXueOKfDaTeu035hsMBfi5bQMac
KnPiDXhtXSHsiwP7h6ei2hAhaxX1QeQA4nIzvLQ1OQKBgQDMRf+ZpxY47buWGEUu
N9uIlA8NyOFu6mYluXxoBR7qXdUJtahzMNAqGxOSQ7Ibw9/fj1xgMFuIFUwDGSnS
Xw1scarTFzGyAWAxMC/ZOUmdEGTPG7O+kGRd/E0l6lTP/nJx4aL6s7mVlF/H/7Hf
UA6zq2Bq6a4URNepv7x3lkt46wKBgQDGeK9uNZYuCkh4pY9SjPb/QSHB5Kf0JeFM
VFm6AWULzYvavvNf24Op+fvPIe0DceRIhRJEij7NdyoGBgxUEepaJF5hoSoWwWNk
zg3PzRrxrhLgRPaeIygnpbh3NJcsWyhItEIY0sNB/Kkxp8w/cnw2OoDsu9IMGnm8
hiCLydpe0wKBgDZ71RjegAbfIdF+17TkISHkm79JfRdgXa5iMtRryTspm9DjKvLO
ajdQ0X+Jns/ZBrVSP4lIXKGHTKbm50i9IY9zIeT7or2fsFBuUdTWetPxs3GqKd8C
FEMdMFaUkdqIO240iIvls/I5iPKHOKIfcExrwWPCwDOXyQ31ngcnhynRAoGBAMD+
OhkBIrhCZ5Zp56RuTwCHZTwWDPvsmdiPbXDiSk/f4E8lv6NG4hE3dRVF+CORbFrY
i5r6k3dYmRSibPqTMT/WfbCR90uJYg10ERowaDL7An/yj53WsgVbsLS5/way3clU
/7EDwbs45Y3TjVllCkPxP8z0FpyOYjJgeuVzs1ThAoGAOGZeH37JzJcm1VLtBq6g
EZznECMgGjKnlWETkSUyhjkM6fWDxjWbp0BwWn2OiVrHhUjXlNlwN1GMifKVIWuj
OemXlA+hHLprw0v2ENnd7+QWcYzl91krhadiJtNq9y5ISb+xDcoGyfkDQC+1PGbL
nGrDBW3VZFf6Tn5hFbANmzw=
-----END PRIVATE KEY-----`;
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUO6RVLebouyLrcB5hcJ4FtXw6apwwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MTAxMzA4MDQwMFoXDTM2MTAx
MDA4MDQwMFowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAnl5wfHHRs1vnGgwmsTjNdJIZZFMb3CtqYwZpL3VaG9vF
M41lvuCs34GI3exaZLe9hTwamHAxls2FjV07gI2crKdubvhbARCF3YiffV1Sam6M
keDcwkoyK2XRUu3k1V1r6ppRaNIfcBs46Te58daeYJc/L1Bx3t/DABFvCGkorqgN
uLz+NURqcHOrDYidIN52UavYInwx6W7j1RWrZuVMdwKj18q124mzYq7VllxQSwoc
I0IM3zDUSty4Yd4WaGq9qn6Tq1FIzF/zrkV2+FFmZzmqnrbpGTXoeUDcKCwQZAVn
fPI1d/nUmZ52WBQ2hiw+V1E5GKCEa26cLYWPEbjzsQIDAQABo28wbTAdBgNVHQ4E
FgQUYw9MHXtuSeF78znh0l7trgW6rSAwHwYDVR0jBBgwFoAUYw9MHXtuSeF78znh
0l7trgW6rSAwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SH
BH8AAAEwDQYJKoZIhvcNAQELBQADggEBAFlGwe8x80VdmkkUrkKke17z43iLqfC7
DQglQI0gxtCgbIUEvuEO+E4muejinYJDjbHeWyJkm9EWDt9U1HstJIg76N5a2oxn
Dy97CL3hcEjp6QqP5W/luH0ruwg4Ig8K7wKRSNg9BlOhkzHRt30oNIQ106tCJuPf
6N2qIaIAymezYernbGYabiXNZ+IRAOA812AHT4LQJ8Sv2jAfTBgnUGdI+iXmKHQ1
XZUEpOsLbU71ki6kyceAtlMmzqNMSKgtkpdEDZF1ReUPtxTnG6/qcObP9E5EzSXv
U0NPHZihqucSf12TwJZ/XldyNo3GA8ZMi6FQHE+zAmLZgDmu1J0ZtMY=
-----END CERTIFICATE-----`;

type Route = "direct" | "http-proxy" | "https-proxy";
const routes: Route[] = ["direct", "http-proxy", "https-proxy"];
const servers: Server[] = [];
const sockets = new Set<Socket>();
const strictLimits = { maxResponseBytes: 4096, timeoutMs: 2000, allowInsecureTls: false, redirect: "error" as const };

beforeEach(() => {
  vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", undefined);
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "NO_PROXY", "no_proxy"]) vi.stubEnv(key, undefined);
  mocks.resolveProxy.mockResolvedValue("DIRECT");
  mocks.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, requestTimeoutMs: 2000 });
});

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await closeHttpAgents();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function track(socket: Socket): void {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
}

async function serve(secure: boolean, handler: RequestListener): Promise<{ server: Server; url: string }> {
  const server = secure ? createHttpsServer({ key: TEST_KEY, cert: TEST_CERT }, handler) : createHttpServer(handler);
  servers.push(server);
  server.on("connection", track);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback port");
  return { server, url: `${secure ? "https" : "http"}://127.0.0.1:${address.port}` };
}

async function fixture(route: Route, secureOrigin = true) {
  const received: string[] = [];
  let held: ServerResponse | undefined;
  let started!: () => void;
  const holding = new Promise<void>((resolve) => { started = resolve; });
  const origin = await serve(secureOrigin, (request, response) => {
    received.push(request.url ?? "");
    response.setHeader("connection", "close");
    if (request.url === "/held") { held = response; started(); }
    else response.end("ok");
  });
  if (route !== "direct") {
    const target = new URL(origin.url);
    const proxy = await serve(route === "https-proxy", (request, response) => {
      const url = new URL(request.url!);
      if (url.origin !== origin.url) { response.writeHead(502); response.end(); return; }
      const forwarded = httpRequest(url, { method: request.method, headers: request.headers }, (upstream) => {
        response.writeHead(upstream.statusCode!, upstream.headers); upstream.pipe(response);
      });
      forwarded.on("socket", track);
      forwarded.on("error", () => { response.writeHead(502); response.end(); });
      request.pipe(forwarded);
    });
    proxy.server.on("connect", (request, client, head) => {
      if (request.url !== target.host) { client.destroy(); return; }
      const upstream = connect(Number(target.port), "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream); upstream.pipe(client);
      });
      track(upstream);
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
      client.on("close", () => upstream.destroy());
    });
    mocks.resolveProxy.mockResolvedValue(`${route === "https-proxy" ? "HTTPS" : "PROXY"} ${new URL(proxy.url).host}`);
  }
  return { url: origin.url, received, holding, release: () => held?.end("ok") };
}

function payload(url: string) {
  const request = createRequest({ name: "TLS fixture", method: "GET", url });
  request.auth = { type: "bearer", token: "synthetic-tls-test-token" };
  return { request };
}

describe("request-scoped TLS policy", () => {
  it.each(routes)("keeps the explicit insecure opt-in working over %s without weakening a later strict send", async (route) => {
    const target = await fixture(route);
    expect((await sendHttpRequest(payload(`${target.url}/strict`), -1, strictLimits)).status).toBe(0);
    expect(target.received).toEqual([]);
    mocks.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, allowInsecureTls: true, requestTimeoutMs: 2000 });
    expect((await sendHttpRequest(payload(`${target.url}/ordinary`))).status).toBe(200);
    expect((await testConnection(`${target.url}/probe`)).ok).toBe(true);
    expect((await sendHttpRequest(payload(`${target.url}/strict-again`), -1, strictLimits)).status).toBe(0);
    expect(target.received).toEqual(["/ordinary", "/probe"]);
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  for (const operation of ["send", "connection test"] as const) {
    it.each(routes)(`keeps agent TLS strict while an insecure ${operation} is in flight over %s`, async (route) => {
      const target = await fixture(route);
      mocks.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, allowInsecureTls: true, requestTimeoutMs: 2000 });
      const pending = operation === "send" ? sendHttpRequest(payload(`${target.url}/held`)) : testConnection(`${target.url}/held`);
      try {
        await Promise.race([target.holding, pending.then(() => { throw new Error("Insecure control did not stay in flight"); })]);
        const strict = await sendHttpRequest(payload(`${target.url}/agent`), -1, strictLimits);
        expect(strict.error).toBeTruthy();
        expect(target.received).toEqual(["/held"]);
        expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
      } finally {
        target.release();
        const result = await pending;
        expect("ok" in result ? result.ok : result.status === 200).toBe(true);
      }
    });
  }

  it.each(routes)("rejects an invalid certificate over %s even with an inherited insecure Node environment", async (route) => {
    const target = await fixture(route);
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    expect((await sendHttpRequest(payload(`${target.url}/agent`), -1, strictLimits)).status).toBe(0);
    expect(target.received).toEqual([]);
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("0");
  });

  it("validates the HTTPS proxy's certificate even for a plain HTTP destination", async () => {
    const target = await fixture("https-proxy", false);
    mocks.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, allowInsecureTls: true, requestTimeoutMs: 2000 });
    expect((await sendHttpRequest(payload(`${target.url}/ordinary`))).status).toBe(200);
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    expect((await sendHttpRequest(payload(`${target.url}/agent`), -1, strictLimits)).status).toBe(0);
    expect(target.received).toEqual(["/ordinary"]);
  });

  it("preserves ordinary direct HTTP requests", async () => {
    const target = await fixture("direct", false);
    expect((await sendHttpRequest(payload(`${target.url}/ordinary`))).status).toBe(200);
    expect((await sendHttpRequest(payload(`${target.url}/agent`), -1, strictLimits)).status).toBe(200);
    expect(target.received).toEqual(["/ordinary", "/agent"]);
  });

  it("preserves native multipart text, binary bytes and the selected filename", async () => {
    const target = await serve(false, (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        response.setHeader("connection", "close");
        response.end(JSON.stringify({ contentType: request.headers["content-type"], bytes: Buffer.concat(chunks).toString("base64") }));
      });
    });
    const agents = new ProxyAgentCache();
    try {
      const binary = new Uint8Array([0, 1, 2, 255, 10, 20]);
      const body = new FormData();
      body.append("title", "Multipart compatibility");
      body.append("document", new Blob([binary], { type: "application/octet-stream" }), "fixture.bin");
      const response = await fetchWithProxy(target.url, { method: "POST", body }, mocks.resolveProxy, agents);
      expect(response.status).toBe(200);
      const received = await response.json() as { contentType: string; bytes: string };
      expect(received.contentType).toMatch(/^multipart\/form-data; boundary=/);
      const bytes = Buffer.from(received.bytes, "base64");
      expect(bytes.includes(Buffer.from('name="title"'))).toBe(true);
      expect(bytes.includes(Buffer.from("Multipart compatibility"))).toBe(true);
      expect(bytes.includes(Buffer.from('name="document"; filename="fixture.bin"'))).toBe(true);
      expect(bytes.includes(Buffer.from(binary))).toBe(true);
    } finally { await agents.closeAll(); }
  });

  it("does not send when the caller canceled before transport", async () => {
    const target = await fixture("direct", false);
    const controller = new AbortController();
    controller.abort();
    const limits = { ...strictLimits, signal: controller.signal };
    expect((await sendHttpRequest(payload(`${target.url}/canceled`), -1, limits)).status).toBe(0);
    expect(target.received).toEqual([]);
  });

  it.each(["direct", "http-proxy"] as const)("cancels an in-flight request over %s when the caller disconnects", async (route) => {
    const target = await fixture(route, false);
    const controller = new AbortController();
    const limits = { ...strictLimits, signal: controller.signal };
    const pending = sendHttpRequest(payload(`${target.url}/held`), -1, limits);
    try {
      await Promise.race([target.holding, pending.then(() => { throw new Error("Request did not reach the fixture"); })]);
      controller.abort();
      const result = await pending;
      expect(result.status).toBe(0);
      expect(result.statusText).toBe("Request canceled");
      expect(target.received).toEqual(["/held"]);
    } finally { target.release(); }
  });
});
