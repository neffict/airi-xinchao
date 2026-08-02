const { Server } = require("@modelcontextprotocol/sdk/dist/cjs/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/dist/cjs/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/dist/cjs/types.js");
const fs = require("fs");

const DB_PATH = process.env.HOME + "/.airi-memory.json";

function readDb() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
  catch { return { entities: {}, relations: [] }; }
}
function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const server = new Server(
  { name: "memory", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "create_entities", description: "Create entities in knowledge graph", inputSchema: { type: "object", properties: { entities: { type: "array" } }, required: ["entities"] } },
    { name: "create_relations", description: "Create relations between entities", inputSchema: { type: "object", properties: { relations: { type: "array" } }, required: ["relations"] } },
    { name: "add_observations", description: "Add observations to entities", inputSchema: { type: "object", properties: { observations: { type: "array", items: { entityName: { type: "string" }, contents: { type: "array", items: { type: "string" } } } }, required: ["observations"] } } },
    { name: "delete_entities", description: "Delete entities", inputSchema: { type: "object", properties: { entityNames: { type: "array", items: { type: "string" } } }, required: ["entityNames"] } },
    { name: "delete_observations", description: "Delete observations", inputSchema: { type: "object", properties: { deletions: { type: "array", items: { entityName: { type: "string" }, observations: { type: "array", items: { type: "string" } } } }, required: ["deletions"] } } },
    { name: "delete_relations", description: "Delete relations", inputSchema: { type: "object", properties: { relations: { type: "array", items: { from: { type: "string" }, to: { type: "string" }, relationType: { type: "string" } } }, required: ["relations"] } } },
    { name: "read_graph", description: "Read entire knowledge graph", inputSchema: { type: "object" } },
    { name: "search_nodes", description: "Search entities by name or observation", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "open_nodes", description: "Open specific entities by name", inputSchema: { type: "object", properties: { names: { type: "array", items: { type: "string" } } }, required: ["names"] } },
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const db = readDb();
  const { name, arguments: args } = req.params;

  if (name === "create_entities") {
    for (const e of args.entities) db.entities[e.name] = { entityType: e.entityType || "entity", observations: e.observations || [] };
    writeDb(db);
    return { content: [{ type: "text", text: `Created ${args.entities.length} entities.` }] };
  }
  if (name === "create_relations") {
    db.relations.push(...args.relations.map(r => ({ from: r.from, to: r.to, relationType: r.relationType })));
    writeDb(db);
    return { content: [{ type: "text", text: `Created ${args.relations.length} relations.` }] };
  }
  if (name === "add_observations") {
    for (const o of args.observations) {
      if (db.entities[o.entityName]) db.entities[o.entityName].observations.push(...o.contents);
    }
    writeDb(db);
    return { content: [{ type: "text", text: "Observations added." }] };
  }
  if (name === "delete_entities") {
    for (const n of args.entityNames) delete db.entities[n];
    db.relations = db.relations.filter(r => !args.entityNames.includes(r.from) && !args.entityNames.includes(r.to));
    writeDb(db);
    return { content: [{ type: "text", text: "Entities deleted." }] };
  }
  if (name === "delete_observations") {
    for (const d of args.deletions) {
      if (db.entities[d.entityName]) db.entities[d.entityName].observations = db.entities[d.entityName].observations.filter(o => !d.observations.includes(o));
    }
    writeDb(db);
    return { content: [{ type: "text", text: "Observations deleted." }] };
  }
  if (name === "delete_relations") {
    for (const r of args.relations) db.relations = db.relations.filter(rel => !(rel.from === r.from && rel.to === r.to && rel.relationType === r.relationType));
    writeDb(db);
    return { content: [{ type: "text", text: "Relations deleted." }] };
  }
  if (name === "read_graph") return { content: [{ type: "text", text: JSON.stringify(db, null, 2) }] };
  if (name === "search_nodes") {
    const q = args.query.toLowerCase();
    const results = [];
    for (const [name, ent] of Object.entries(db.entities)) {
      if (name.toLowerCase().includes(q) || ent.observations.some(o => o.toLowerCase().includes(q))) results.push({ name, ...ent });
    }
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
  if (name === "open_nodes") {
    const results = args.names.map(n => ({ name: n, ...db.entities[n] })).filter(e => e.entityType);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
  return { content: [{ type: "text", text: "Unknown tool" }], isError: true };
});

const transport = new StdioServerTransport();
server.connect(transport);
