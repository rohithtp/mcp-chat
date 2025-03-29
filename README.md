# MCP Chat Interface

A chat interface for interacting with MCP (Model Control Protocol) tools.

## Overview
This application provides two ways to interact with MCP tools:
1. Through the chat interface
2. Directly using the MCP SDK

## Setup and Running

### Prerequisites
- Node.js
- pnpm
- Local MCP server

### Steps
1. Ensure your local MCP server is running on `http://localhost:3000`
2. Start the Next.js application:
   ```bash
   pnpm dev
   ```
3. Access the chat interface at `http://localhost:3001` (or whatever port is available)

## Environment Configuration
```env
# MCP Configuration
NEXT_PUBLIC_MCP_SERVER_URL=http://localhost:3000
```

## Documentation
For detailed usage instructions, tool listings, and SDK integration examples, please refer to the [Chat Interface Usage Guide](chat_usage.md).

## License
[Add your license information here]