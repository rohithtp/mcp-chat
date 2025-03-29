import { EventSourcePolyfill as EventSource } from 'event-source-polyfill'

interface MCPClientConfig {
  serverUrl: string
  clientInfo?: {
    name: string
    version: string
  }
  onError?: (error: MCPError) => void
  debug?: boolean
}

interface MCPTool {
  name: string
  inputSchema: {
    type: string
    properties: Record<string, any>
    required: string[]
    additionalProperties: boolean
    $schema: string
  }
}

interface MCPError extends Error {
  code?: number
  data?: any
  type?: 'connection' | 'protocol' | 'timeout' | 'network' | 'parse' | 'sdk'
  source?: string
}

class MCPClient {
  private es: EventSource | null = null
  private sessionId: string | null = null
  private messageCounter = 0
  private readonly config: MCPClientConfig
  private messageHandlers: Map<number, (event: any) => void> = new Map()
  private connectionAttempts = 0
  private isClosing = false
  private reconnectTimeout: NodeJS.Timeout | null = null

  constructor(config: MCPClientConfig) {
    this.config = {
      ...config,
      clientInfo: config.clientInfo || {
        name: "mcp-client",
        version: "1.0.0"
      }
    }

    this.logDebug('constructor', 'Creating new client instance with config:', {
      serverUrl: config.serverUrl,
      clientInfo: this.config.clientInfo
    })
  }

  private createError(message: string, options: Partial<MCPError> = {}): MCPError {
    const error = new Error(message) as MCPError
    error.code = options.code
    error.data = options.data
    error.type = options.type
    error.source = options.source
    return error
  }

  private handleError(error: Error | MCPError, context: string) {
    const mcpError = this.normalizeError(error, context)
    this.logError(mcpError, context)
    
    // Call user error handler if provided
    if (this.config.onError) {
      try {
        this.config.onError(mcpError)
      } catch (err) {
        console.error('MCP Client: Error in user error handler:', err)
      }
    }

    // Handle connection errors
    if (mcpError.type === 'connection' && !this.isClosing) {
      this.handleConnectionError(mcpError)
    }

    return mcpError
  }

  private normalizeError(error: Error | MCPError, context: string): MCPError {
    if ((error as MCPError).type) {
      return error as MCPError
    }

    const mcpError = error as MCPError
    mcpError.source = context

    // Classify error type based on message and context
    if (error.message.includes('timeout')) {
      mcpError.type = 'timeout'
      mcpError.code = -32000
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      mcpError.type = 'network'
      mcpError.code = -32001
    } else if (error.message.includes('parse')) {
      mcpError.type = 'parse'
      mcpError.code = -32700
    } else if (context.includes('SSE') || context.includes('connection')) {
      mcpError.type = 'connection'
      mcpError.code = -32002
    } else if (context.includes('sdk')) {
      mcpError.type = 'sdk'
      mcpError.code = -32099
    } else {
      mcpError.type = 'protocol'
      mcpError.code = -32603
    }

    return mcpError
  }

  private handleConnectionError(error: MCPError) {
    // Clear existing connection
    if (this.es) {
      this.es.close()
      this.es = null
    }
    this.sessionId = null
    
    // Clear any pending handlers with the error
    this.messageHandlers.forEach((handler) => {
      handler({ error })
    })
    this.messageHandlers.clear()

    // Schedule reconnection if appropriate
    if (this.connectionAttempts < 3 && !this.isClosing) {
      const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 10000)
      this.logDebug('reconnect', `Scheduling reconnection attempt in ${delay}ms`)
      
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout)
      }
      
      this.reconnectTimeout = setTimeout(() => {
        if (!this.isClosing) {
          this.ensureConnection().catch(err => {
            this.handleError(err, 'reconnect')
          })
        }
      }, delay)
    }
  }

  private logError(error: MCPError, context: string) {
    const errorDetails = {
      context,
      type: error.type,
      name: error.name,
      message: error.message,
      code: error.code,
      source: error.source,
      data: error.data,
      stack: error.stack,
      connectionState: this.es ? {
        readyState: this.es.readyState,
        url: this.es.url,
        withCredentials: this.es.withCredentials
      } : 'no connection',
      sessionId: this.sessionId,
      pendingHandlers: Array.from(this.messageHandlers.keys()),
      connectionAttempts: this.connectionAttempts
    }

    console.error('MCP Client Error:', JSON.stringify(errorDetails, null, 2))
  }

  private logDebug(context: string, ...args: any[]) {
    if (this.config.debug) {
      const timestamp = new Date().toISOString()
      console.log(`[${timestamp}] MCP Client [${context}]:`, ...args)
    }
  }

  private async ensureConnection(): Promise<void> {
    this.logDebug('ensureConnection', {
      existingConnection: this.es ? {
        readyState: this.es.readyState,
        url: this.es.url
      } : 'none',
      sessionId: this.sessionId,
      pendingHandlers: this.messageHandlers.size,
      connectionAttempts: this.connectionAttempts
    })

    if (this.es?.readyState === EventSource.OPEN) {
      this.logDebug('ensureConnection', 'Reusing existing connection')
      return
    }

    // Close any existing connection
    if (this.es) {
      this.logDebug('ensureConnection', 'Closing existing connection')
      this.es.close()
      this.es = null
      this.sessionId = null
      // Clear any pending message handlers
      const pendingHandlers = this.messageHandlers.size
      this.messageHandlers.clear()
      this.logDebug('ensureConnection', `Cleared ${pendingHandlers} pending handlers`)
    }

    this.connectionAttempts++
    this.logDebug('ensureConnection', `Attempt ${this.connectionAttempts} to connect to ${this.config.serverUrl}`)
    
    try {
      // Create SSE connection
      this.es = new EventSource(`${this.config.serverUrl}/sse`, {
        headers: {
          'Accept': 'text/event-stream',
          'Accept-Language': '*',
          'User-Agent': 'node'
        }
      })

      // Set up general message and error handlers
      this.es.onopen = () => {
        this.logDebug('SSE', 'Connection opened', {
          url: this.es?.url,
          readyState: this.es?.readyState
        })
      }

      this.es.onerror = (event: any) => {
        this.logDebug('SSE', 'Connection error', {
          event,
          readyState: this.es?.readyState,
          pendingHandlers: this.messageHandlers.size
        })

        // Reject any pending promises
        this.messageHandlers.forEach((handler, id) => {
          const error = new Error('SSE Connection error') as MCPError
          error.code = -32000
          error.data = { event, readyState: this.es?.readyState }
          handler({ error })
          this.logDebug('SSE', `Rejected handler for message ${id} due to connection error`)
        })
        this.messageHandlers.clear()
      }

      // Set up message handler
      this.es.onmessage = (event: any) => {
        this.logDebug('SSE', 'Received raw message:', event.data)
        
        try {
          const data = JSON.parse(event.data)
          this.logDebug('SSE', 'Parsed message:', {
            id: data.id,
            method: data.method,
            hasError: !!data.error,
            hasResult: !!data.result
          })
          
          if (data.id !== undefined) {
            const handler = this.messageHandlers.get(data.id)
            if (handler) {
              handler(data)
              this.messageHandlers.delete(data.id)
              this.logDebug('SSE', `Handled message ${data.id}, ${this.messageHandlers.size} handlers remaining`)
            } else {
              this.logDebug('SSE', `No handler found for message ${data.id}`)
            }
          }
        } catch (err) {
          this.logDebug('SSE', 'Failed to parse message:', {
            data: event.data,
            error: err
          })
        }
      }

      // Wait for session ID
      this.sessionId = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout after 30 seconds'))
        }, 30000)

        this.es!.addEventListener('endpoint', (event: any) => {
          this.logDebug('SSE', 'Received endpoint event:', event.data)
          const sessionId = new URL(event.data, this.config.serverUrl).searchParams.get('sessionId')
          if (sessionId) {
            clearTimeout(timeout)
            resolve(sessionId)
          }
        })
      })

      this.logDebug('connection', 'Got session ID:', this.sessionId)

      // Initialize the connection
      this.logDebug('connection', 'Sending initialize message')
      
      // Set up listener for initialization response first
      const initResponsePromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Initialization response timeout after 30 seconds'))
        }, 30000)

        const id = this.messageCounter++
        this.messageHandlers.set(id, (data) => {
          clearTimeout(timeout)
          if (data.error) {
            this.logDebug('initialization', 'Failed:', data.error)
            reject(new Error(data.error.message))
          } else if (data.result?.protocolVersion) {
            this.logDebug('initialization', 'Succeeded:', data.result)
            resolve()
          }
        })

        // Send the initialize message
        const initMessage = {
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {
              prompts: {},
              resources: {},
              tools: {}
            },
            clientInfo: this.config.clientInfo
          },
          jsonrpc: '2.0',
          id
        }

        this.logDebug('initialization', 'Sending message:', initMessage)

        fetch(`${this.config.serverUrl}/message?sessionId=${this.sessionId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': '*/*',
            'Accept-Language': '*',
            'User-Agent': 'node'
          },
          body: JSON.stringify(initMessage)
        }).then(async response => {
          const text = await response.text()
          this.logDebug('initialization', 'HTTP response:', {
            status: response.status,
            text
          })
          if (text !== 'Accepted') {
            reject(new Error(`Unexpected initialization response: ${text}`))
          }
        }).catch(reject)
      })

      await initResponsePromise
      this.logDebug('connection', 'Successfully initialized')
    } catch (err) {
      const error = err as Error
      this.handleError(error, 'ensureConnection')
      throw error
    }
  }

  private async sendRequest(method: string, params?: any): Promise<any> {
    try {
      this.logDebug('request', `Sending ${method}`, {
        params,
        sessionId: this.sessionId,
        connectionState: this.es?.readyState
      })

      await this.ensureConnection()

      // Generate the request ID first
      const id = this.messageCounter++

      // Set up response promise
      const responsePromise = new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.messageHandlers.delete(id)
          this.logDebug('request', `Timeout for message ${id}`)
          reject(new Error('Response timeout after 30 seconds'))
        }, 30000)

        this.messageHandlers.set(id, (data) => {
          clearTimeout(timeout)
          if (data.error) {
            this.logDebug('request', `Error response for message ${id}:`, data.error)
            const error = new Error(data.error.message) as MCPError
            error.code = data.error.code
            error.data = data.error.data
            reject(error)
          } else {
            this.logDebug('request', `Success response for message ${id}:`, data.result)
            resolve(data.result)
          }
        })
      })

      // Send the request
      const requestMessage = {
        method,
        params,
        jsonrpc: '2.0',
        id
      }

      this.logDebug('request', `Sending message ${id}:`, requestMessage)

      const response = await fetch(`${this.config.serverUrl}/message?sessionId=${this.sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': '*/*',
          'Accept-Language': '*',
          'User-Agent': 'node'
        },
        body: JSON.stringify(requestMessage)
      })

      const text = await response.text()
      this.logDebug('request', `HTTP response for message ${id}:`, {
        status: response.status,
        text
      })

      if (text !== 'Accepted') {
        throw new Error(`Unexpected response: ${text}`)
      }

      return responsePromise
    } catch (err) {
      const error = err as Error
      this.handleError(error, `sendRequest(${method})`)
      throw error
    }
  }

  async listTools(): Promise<MCPTool[]> {
    this.logDebug('tools', 'Fetching tools list')
    try {
      const result = await this.sendRequest('tools/list')
      this.logDebug('tools', 'Received tools:', result.tools)
      return result.tools
    } catch (err) {
      const error = err as Error
      this.handleError(error, 'listTools')
      throw error
    }
  }

  async close(): Promise<void> {
    this.isClosing = true
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.es) {
      this.logDebug('lifecycle', 'Closing connection', {
        sessionId: this.sessionId,
        pendingHandlers: this.messageHandlers.size
      })
      this.es.close()
      this.es = null
      this.sessionId = null
      this.messageHandlers.clear()
    }
    this.isClosing = false
  }
}

// Create a singleton MCP client to avoid multiple connections
let mcpClient: MCPClient | null = null

export async function getMcpClient(): Promise<MCPClient> {
  if (!mcpClient) {
    if (!process.env.NEXT_PUBLIC_MCP_SERVER_URL) {
      throw new Error('MCP server URL not configured. Please set NEXT_PUBLIC_MCP_SERVER_URL in your .env file.')
    }

    mcpClient = new MCPClient({
      serverUrl: process.env.NEXT_PUBLIC_MCP_SERVER_URL,
      debug: process.env.NODE_ENV !== 'production',
      onError: (error) => {
        // Log SDK-specific errors to help diagnose AI SDK integration issues
        if (error.type === 'sdk') {
          console.error('AI SDK Integration Error:', {
            message: error.message,
            code: error.code,
            data: error.data
          })
        }
      }
    })
  }
  return mcpClient
}

export async function getMcpTools() {
  const client = await getMcpClient()
  return client.listTools()
}

// Ensure client is properly closed when the app is shutting down
process.on("beforeExit", async () => {
  if (mcpClient) {
    await mcpClient.close()
    mcpClient = null
  }
})

// Handle browser unload events
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (mcpClient) {
      mcpClient.close()
      mcpClient = null
    }
  })
}

