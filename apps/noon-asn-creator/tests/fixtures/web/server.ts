import { createServer, type Server } from "node:http";

export interface FixtureServerOptions {
  catalogDelayMs?: number;
  loginRedirectOnce?: boolean;
  neverReady?: boolean;
}

export interface FixtureServer {
  url: string;
  submissions: Array<{ items: Array<{ partnerSku: string; quantity: number }> }>;
  close(): Promise<void>;
}

function html(options: FixtureServerOptions): string {
  return `<!doctype html><html><body>
    <main><h1>Create ASN</h1><button id="catalog">Choose from Your Catalog</button><div id="area"></div></main>
    <script>
      setInterval(() => fetch('/ping').catch(() => {}), 100);
      const delay = ${options.catalogDelayMs ?? 0};
      document.querySelector('#catalog').addEventListener('click', () => setTimeout(() => {
        ${options.neverReady ? "return;" : ""}
        document.querySelector('#area').innerHTML = '<table aria-label="Product catalog"><tbody>' +
          ['SKU-A','SKU-B'].map(sku => '<tr><td><input type="checkbox" aria-label="Select '+sku+'"></td><td>'+sku+'</td><td><input type="number" min="1" aria-label="Quantity '+sku+'"></td></tr>').join('') +
          '</tbody></table><button id="continue">Continue</button>';
        document.querySelector('#continue').addEventListener('click', () => {
          const dialog = document.createElement('div'); dialog.setAttribute('role','dialog');
          dialog.innerHTML = '<h2>Penalty Warning</h2><button id="agree">Agree & Proceed</button>';
          document.body.appendChild(dialog);
          document.querySelector('#agree').addEventListener('click', async () => {
            const items = [...document.querySelectorAll('tr')].filter(row => row.querySelector('input[type=checkbox]').checked).map(row => ({
              partnerSku: row.children[1].textContent,
              quantity: Number(row.querySelector('input[type=number]').value)
            }));
            await fetch('/api/create', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({items}) });
            dialog.remove(); document.querySelector('main').innerHTML = '<h1>ASN created</h1><p>ASN-1</p>';
          });
        });
      }, delay));
    </script></body></html>`;
}

export async function startFixtureServer(options: FixtureServerOptions = {}): Promise<FixtureServer> {
  const submissions: FixtureServer["submissions"] = [];
  let redirected = false;
  const server: Server = createServer((request, response) => {
    if (request.url === "/ping") { response.writeHead(204).end(); return; }
    if (request.url === "/login") { response.writeHead(200, { "Content-Type": "text/html" }).end("<h1>Sign in</h1>"); return; }
    if (request.url === "/create" && options.loginRedirectOnce && !redirected) {
      redirected = true; response.writeHead(302, { Location: "/login" }).end(); return;
    }
    if (request.url === "/create") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html(options)); return;
    }
    if (request.url === "/api/create" && request.method === "POST") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        submissions.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as FixtureServer["submissions"][number]);
        response.writeHead(201, { "Content-Type": "application/json" }).end('{"asn_number":"ASN-1"}');
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    submissions,
    close: async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
