import { type CoreMessage, streamText } from "ai"
import { openai } from "@ai-sdk/openai"
import { getMcpTools } from "@/lib/mcp-client"
import type { ToolSet } from "ai"
import OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionUserMessageParam, ChatCompletionAssistantMessageParam } from 'openai/resources/chat/completions'

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set')
}

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  console.log('Chat API: Received request')
  try {
    const { messages }: { messages: CoreMessage[] } = await req.json()
    console.log('Chat API: Parsed messages:', JSON.stringify(messages, null, 2))

    // Get tools from the MCP server
    console.log('Chat API: Fetching MCP tools...')
    const mcpTools = await getMcpTools()
    console.log('Chat API: Retrieved tools:', JSON.stringify(mcpTools, null, 2))

    // Convert MCP tools array to ToolSet object
    const tools: ToolSet = mcpTools.reduce((acc, tool) => ({
      ...acc,
      [tool.name]: {
        parameters: tool.inputSchema,
        description: `Use the ${tool.name} tool`
      }
    }), {})

    // Get the OpenAI model from environment variable or use a default
    const model = process.env.OPENAI_API_MODEL || 'gpt-4'
    console.log('Chat API: Using OpenAI model:', model)

    // Create the chat completion with streaming
    const systemMessage: ChatCompletionMessageParam = {
      role: 'system',
      content: `You are a helpful assistant with access to external tools. Available tools:
${Object.entries(tools).map(([name, tool]) => `- ${name}: ${tool.description}`).join('\n')}`
    }

    const chatMessages: ChatCompletionMessageParam[] = messages.map(msg => {
      if (msg.role === 'user') {
        return {
          role: 'user',
          content: msg.content
        } as ChatCompletionUserMessageParam
      }
      return {
        role: 'assistant',
        content: msg.content
      } as ChatCompletionAssistantMessageParam
    })

    const completion = await openaiClient.chat.completions.create({
      model,
      messages: [systemMessage, ...chatMessages],
      temperature: 0.7,
      stream: true,
      tools: Object.entries(tools).map(([name, tool]) => ({
        type: 'function' as const,
        function: {
          name,
          description: tool.description,
          parameters: tool.parameters,
        }
      })),
    })

    // Convert the completion to a readable stream
    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunk of completion) {
          const content = chunk.choices[0]?.delta?.content
          if (content) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ content })}\n\n`))
          }
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Chat API Error:', error)
    // Log the full error details in development
    if (process.env.NODE_ENV === 'development' && error instanceof Error) {
      console.error('Full error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause
      })
    }
    return new Response(JSON.stringify({ 
      error: 'Internal Server Error', 
      details: error instanceof Error ? error.message : 'An unknown error occurred',
      stack: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.stack : undefined) : undefined
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

