import { EventSourcePolyfill as EventSource } from 'event-source-polyfill'

async function testConnection() {
  console.log('Starting MCP connection test...')
  
  const es = new EventSource('http://localhost:3000/sse', {
    headers: {
      'Accept': 'text/event-stream',
      'Accept-Language': '*',
      'User-Agent': 'node'
    }
  })

  // Create a promise that will resolve with the session ID
  const sessionIdPromise = new Promise<string>((resolve) => {
    es.addEventListener('endpoint', (event: any) => {
      const sessionId = new URL(event.data, 'http://localhost:3000').searchParams.get('sessionId')
      if (sessionId) {
        resolve(sessionId)
      }
    })
  })

  es.onopen = () => {
    console.log('SSE Connection opened')
  }

  es.onerror = () => {
    console.error('SSE Connection error')
  }

  es.onmessage = (event: any) => {
    console.log('Received message:', event.data)
  }

  // Wait for the session ID
  console.log('Waiting for session ID...')
  const sessionId = await sessionIdPromise
  console.log('Got session ID:', sessionId)

  // Send initialize message
  console.log('Sending initialize message...')
  let response = await fetch(`http://localhost:3000/message?sessionId=${sessionId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'Accept-Language': '*',
      'User-Agent': 'node'
    },
    body: JSON.stringify({
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          prompts: {},
          resources: {},
          tools: {}
        },
        clientInfo: {
          name: 'example-client',
          version: '1.0.0'
        }
      },
      jsonrpc: '2.0',
      id: 0
    })
  })

  console.log('Initialize response:', await response.text())

  // List available tools
  console.log('\nListing available tools...')
  response = await fetch(`http://localhost:3000/message?sessionId=${sessionId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'Accept-Language': '*',
      'User-Agent': 'node'
    },
    body: JSON.stringify({
      method: 'tools/list',
      jsonrpc: '2.0',
      id: 1
    })
  })

  console.log('Tools list response:', await response.text())

  // Keep the connection open for a bit
  await new Promise(resolve => setTimeout(resolve, 5000))
  es.close()
}

// Run the test
testConnection() 