import { createDreams, Logger, output, TaskRunner } from "@daydreamsai/core";
import { createMcpExtension } from "@daydreamsai/mcp";
import { LogLevel } from "@daydreamsai/core";
import path from "path";
import { groq } from "@ai-sdk/groq";
import { cliExtension } from "@daydreamsai/cli";
import { Output } from "ai";

/**
 * This example demonstrates how to create an agent that connects to an MCP server
 * and uses its resources through the MCP extension.
 *
 * It sets up a connection to a local MCP server that provides access to resources
 * like application logs.
 */

// Create an agent with the MCP extension
createDreams({
  model: groq("deepseek-r1-distill-llama-70b"),
  taskRunner: new TaskRunner(1),
  logger: new Logger({ level: LogLevel.INFO }),
  contexts: [],
  // Add the MCP extension with the example server configuration
  extensions: [
    cliExtension,
    createMcpExtension([
      {
        id: "example-server",
        name: "Example Resource Server",
        transport: {
          type: "stdio",
          command: "bun",
          args: [path.join(__dirname, "mcp-server-example.ts")],
        },
      },
    ]),
  ],
  outputs: {
    test: output({}),
  },
}).start();
