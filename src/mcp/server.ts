/**
 * Minimal MCP server for qimg.
 * Tools:
 *   hsearch(query, limit?, collection?, image_path?) → SearchHit[]
 *   get(path) → ImageRow
 *   status() → counts
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Store } from "../store.js";
import type { SearchHit } from "../store.js";
import { embedText, embedImage } from "../embed.js";
import { resolve } from "path";

export interface McpOptions {}

export async function startMcp(opts: McpOptions = {}): Promise<void> {
  const server = new Server(
    { name: "qimg", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const store = new Store();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "hsearch",
        description:
          "Hybrid image search (BM25 over captions + SigLIP 2 vector). Provide `query` for text search or `image_path` for image-similarity search.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Text query for semantic + keyword search" },
            image_path: { type: "string", description: "Absolute path to an image for image-similarity search (mutually exclusive with query)" },
            limit: { type: "number", description: "Maximum number of results to return (default: 20)" },
            collection: { type: "string", description: "Restrict search to a specific collection name" },
            after: { type: "string", description: "Only return images taken on or after this date (YYYY-MM-DD)" },
            before: { type: "string", description: "Only return images taken on or before this date (YYYY-MM-DD)" },
          },
        },
      },
      {
        name: "get",
        description: "Fetch metadata and caption for an image by path",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
      {
        name: "status",
        description: "Index status: collections, images, vectors",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: a } = req.params;
    const args = (a ?? {}) as Record<string, unknown>;

    if (name === "hsearch") {
      const limit = typeof args.limit === "number" ? args.limit : 20;
      const imagePath = typeof args.image_path === "string" ? args.image_path : undefined;
      const query = typeof args.query === "string" ? args.query : "";

      const filters: { collection?: string; after?: number; before?: number } = {};
      if (typeof args.collection === "string") filters.collection = args.collection;
      if (typeof args.after === "string") {
        const d = new Date(args.after);
        if (!isNaN(d.getTime())) filters.after = d.getTime();
      }
      if (typeof args.before === "string") {
        const d = new Date(args.before);
        if (!isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); filters.before = d.getTime(); }
      }

      let vecHits: SearchHit[] = [];
      let ftsHits: SearchHit[] = [];
      if (imagePath) {
        const v = await embedImage(resolve(imagePath));
        vecHits = store.searchVec(v, limit * 2, filters);
      } else if (query) {
        ftsHits = store.searchFts(query, limit * 2, filters);
        const v = await embedText(query);
        vecHits = store.searchVec(v, limit * 2, filters);
      }
      const fused = store.hybridQuery(ftsHits, vecHits, limit);
      return { content: [{ type: "text", text: JSON.stringify(fused, null, 2) }] };
    }

    if (name === "get") {
      const path = typeof args.path === "string" ? args.path : "";
      const all = store.listImages();
      const row = all.find((r) => r.path === path || `${r.collection}/${r.path}` === path);
      return {
        content: [{ type: "text", text: row ? JSON.stringify(row, null, 2) : "not found" }],
      };
    }

    if (name === "status") {
      return { content: [{ type: "text", text: JSON.stringify(store.status(), null, 2) }] };
    }

    return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
