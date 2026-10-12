import "dotenv/config";
import express from "express";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express5";
import { ApolloServerPluginDrainHttpServer } from
  "@apollo/server/plugin/drainHttpServer";
import { CosmosClient } from "@azure/cosmos";
import { GraphQLError } from "graphql";

// Read credentials from the environment, never from frontend code.
for (const name of [
  "COSMOS_ENDPOINT",
  "COSMOS_KEY",
  "COSMOS_DATABASE",
  "COSMOS_CONTAINER"
]) {
  if (!process.env[name]) {
    throw new Error(`Missing ${name} in .env`);
  }
}

const client = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY
});

const container = client
  .database(process.env.COSMOS_DATABASE)
  .container(process.env.COSMOS_CONTAINER);

const typeDefs = readFileSync(
  new URL("./schema.graphql", import.meta.url),
  "utf8"
);

// Keep each list request small for this assessment.
function validateLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new GraphQLError("limit must be between 1 and 50.", {
      extensions: { code: "BAD_USER_INPUT" }
    });
  }
  return limit;
}

// Avoid exposing database details in API errors.
async function readCosmos(operation) {
  try {
    return await operation();
  } catch (error) {
    console.error("Cosmos DB request failed. Code:", error.code);
    throw new GraphQLError("Unable to read papers from Cosmos DB.", {
      extensions: { code: "INTERNAL_SERVER_ERROR" }
    });
  }
}

const resolvers = {
  Query: {
    paper: async (_, { id }) => {
      return readCosmos(async () => {
        try {
          // /id is the partition key, so both values are the paper ID.
          const { resource } = await container.item(id, id).read();
          return resource ?? null;
        } catch (error) {
          if (Number(error.code) === 404) return null;
          throw error;
        }
      });
    },

    papers: async (_, { limit }) => {
      const count = validateLimit(limit);

      return readCosmos(async () => {
        const { resources } = await container.items.query({
          query: "SELECT TOP @limit * FROM c ORDER BY c.id",
          parameters: [{ name: "@limit", value: count }]
        }).fetchAll();

        return resources;
      });
    },

    papersByCategory: async (_, { category, limit }) => {
      const count = validateLimit(limit);
      const value = category.trim();

      if (!value) {
        throw new GraphQLError("category cannot be blank.", {
          extensions: { code: "BAD_USER_INPUT" }
        });
      }

      return readCosmos(async () => {
        const { resources } = await container.items.query({
          query: `
            SELECT TOP @limit *
            FROM c
            WHERE ARRAY_CONTAINS(c.categories, @category)
            ORDER BY c.id
          `,
          parameters: [
            { name: "@limit", value: count },
            { name: "@category", value }
          ]
        }).fetchAll();

        return resources;
      });
    }
  }
};

const app = express();
const httpServer = http.createServer(app);

const server = new ApolloServer({
  typeDefs,
  resolvers,
  includeStacktraceInErrorResponses: false,
  plugins: [
    ApolloServerPluginDrainHttpServer({ httpServer })
  ]
});

await server.start();

// The frontend will use this same server, so no cross-origin setup is needed.
app.use(
  "/graphql",
  express.json({ limit: "100kb" }),
  expressMiddleware(server)
);

// Reserved for the HTML page we will create in Task 4.
app.use(express.static(
  fileURLToPath(new URL("./public/", import.meta.url))
));

app.get("/health", (_, res) => {
  res.json({ status: "running" });
});

const port = Number(process.env.PORT || 4000);

await new Promise((resolve) => {
  httpServer.listen(port, "0.0.0.0", resolve);
});

console.log(`GraphQL server: http://localhost:${port}/graphql`);