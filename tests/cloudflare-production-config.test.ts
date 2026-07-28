import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const wrangler = JSON.parse(
  readFileSync(resolve(root, "wrangler.jsonc"), "utf8"),
);
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const viteConfig = readFileSync(
  resolve(root, "vite.config.ts"),
  "utf8",
);
const serverData = readFileSync(
  resolve(root, "lib/server-data.ts"),
  "utf8",
);
const poolPage = readFileSync(
  resolve(root, "app/pool/page.tsx"),
  "utf8",
);

describe("Cloudflare production configuration", () => {
  it("uses the production Worker identity and runtime settings", () => {
    expect(wrangler.name).toBe("vnd-settlement-os");
    expect(wrangler.main).toBe("./worker/index.ts");
    expect(wrangler.compatibility_flags).toContain("nodejs_compat");
    expect(wrangler.compatibility_date).toMatch(/^2026-\d{2}-\d{2}$/);
    expect(wrangler.observability.enabled).toBe(true);
  });

  it("binds generated assets and the Vinext image transformer", () => {
    expect(wrangler.assets).toMatchObject({
      binding: "ASSETS",
      directory: "./dist/client",
      run_worker_first: false,
    });
    expect(wrangler.images).toEqual({ binding: "IMAGES" });
  });

  it("serves matching CSS and JavaScript before invoking SSR", () => {
    expect(wrangler.assets.run_worker_first).toBe(false);
    expect(wrangler.assets.not_found_handling).toBe("none");
  });

  it("declares the server secret without storing a value", () => {
    expect(wrangler.secrets.required).toEqual([
      "SUPABASE_SECRET_KEY",
    ]);
    expect(JSON.stringify(wrangler)).not.toContain(
      "SUPABASE_SERVICE_ROLE_KEY=",
    );
  });

  it("uses the root Wrangler file as the Vite source of truth", () => {
    expect(viteConfig).not.toContain("localBindingConfig");
    expect(viteConfig).not.toContain("config: localBindingConfig");
  });

  it("provides the generated-config deployment command", () => {
    expect(packageJson.scripts["deploy:cloudflare"]).toBe(
      "wrangler deploy --config dist/server/wrangler.json --keep-vars",
    );
  });
});

describe("Cloudflare SSR failure containment", () => {
  it("classifies configuration failures without exposing secret values", () => {
    expect(serverData).toContain("ServerDataConfigurationError");
    expect(serverData).toContain("SUPABASE_CONFIGURATION_MISSING");
    expect(serverData).not.toContain(
      "throw new Error(\"Supabase server configuration is missing\")",
    );
  });

  it("renders a safe pool response instead of throwing a Worker 1101", () => {
    expect(poolPage).toContain("classifyServerDataFailure");
    expect(poolPage).toContain("资金池数据暂不可用");
    expect(poolPage).toContain("Shadow Mode");
  });
});
