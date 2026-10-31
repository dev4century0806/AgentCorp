import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
export function proxyMcpServer(name, client) {
    const instance = new McpServer({ name, version: '0.1.0' }, { capabilities: { tools: {} } });
    instance.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await client.listTools() }));
    instance.server.setRequestHandler(CallToolRequestSchema, async (req) => {
        try {
            return await client.callTool(req.params.name, req.params.arguments ?? {});
        }
        catch (err) {
            return { content: [{ type: 'text', text: err.message }], isError: true };
        }
    });
    return instance;
}
export async function serveMcpRequest(name, client, req, res, body) {
    const server = proxyMcpServer(name, client);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
        void transport.close();
        void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
}
