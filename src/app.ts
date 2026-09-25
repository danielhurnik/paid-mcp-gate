import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { GateConfig, LoadedConfig } from "./config.ts";
import { Gate } from "./gate.ts";
import { createHttpServer } from "./http.ts";
import { loadMarkdownDirectory } from "./knowledge/markdown.ts";
import { Store } from "./store.ts";

export interface AppOptions {
  loaded: LoadedConfig;
  overrides?: { host?: string; port?: number; databasePath?: string };
  adminToken?: string;
  now?: () => Date;
}

export interface App {
  config: GateConfig;
  gate: Gate;
  store: Store;
  server: Server;
  /** Starts listening and resolves to the base URL, e.g. http://127.0.0.1:8787 */
  listen(): Promise<string>;
  close(): Promise<void>;
}

export function createApp(options: AppOptions): App {
  const { loaded, overrides = {} } = options;
  const config: GateConfig = {
    ...loaded.config,
    server: {
      ...loaded.config.server,
      ...(overrides.host !== undefined ? { host: overrides.host } : {}),
      ...(overrides.port !== undefined ? { port: overrides.port } : {}),
    },
  };
  const documents = loadMarkdownDirectory(loaded.knowledgeDir);
  const store = new Store(overrides.databasePath ?? loaded.databasePath);
  const gate = new Gate({ config, documents, store, now: options.now });
  const server = createHttpServer({ gate, store, adminToken: options.adminToken });

  return {
    config,
    gate,
    store,
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.server.port, config.server.host, () => {
          const { address, port, family } = server.address() as AddressInfo;
          const host = address === "0.0.0.0" || address === "::" ? "localhost" : family === "IPv6" ? `[${address}]` : address;
          resolve(`http://${host}:${port}`);
        });
      });
    },
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      store.close();
    },
  };
}
