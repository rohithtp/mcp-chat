"use client"

import type React from "react"

import { cn } from "@/lib/utils"
import { useChat } from "ai/react"
import { ArrowUpIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { AutoResizeTextarea } from "@/components/autoresize-textarea"
import { useState } from "react"

export function ChatForm({ className, ...props }: React.ComponentProps<"form">) {
  const [isLoading, setIsLoading] = useState(false)

  const { messages, input, setInput, append } = useChat({
    api: "/api/chat",
    onResponse: () => {
      console.log('Chat Form: Received response')
      setIsLoading(false)
    },
    onError: (error) => {
      console.error('Chat Form: Error:', error)
      setIsLoading(false)
    }
  })

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!input.trim()) return

    console.log('Chat Form: Sending message:', input)
    setIsLoading(true)
    void append({ content: input, role: "user" })
    setInput("")
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent<HTMLFormElement>)
    }
  }

  const header = (
    <header className="m-auto flex max-w-96 flex-col gap-5 text-center">
      <h1 className="text-2xl font-semibold leading-none tracking-tight">AI Chatbot with MCP Tools</h1>
      <p className="text-muted-foreground text-sm">
        This chatbot is connected to an external MCP server at{" "}
        <a
          href="https://mcp-on-vercel.vercel.app"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline"
        >
          mcp-on-vercel.vercel.app
        </a>
      </p>
      <p className="text-muted-foreground text-sm">
        Send a message to start chatting with the AI that has access to external tools.
      </p>
    </header>
  )

  const messageList = (
    <div className="my-4 flex h-fit min-h-full flex-col gap-4">
      {messages.map((message, index) => (
        <div
          key={index}
          data-role={message.role}
          className="max-w-[80%] rounded-xl px-3 py-2 text-sm data-[role=assistant]:self-start data-[role=user]:self-end data-[role=assistant]:bg-gray-100 data-[role=user]:bg-blue-500 data-[role=assistant]:text-black data-[role=user]:text-white"
        >
          {message.content}
        </div>
      ))}
      {isLoading && (
        <div className="self-start rounded-xl bg-gray-100 px-3 py-2 text-sm">
          <div className="flex gap-1">
            <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400"></div>
            <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: "0.2s" }}></div>
            <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: "0.4s" }}></div>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <TooltipProvider>
      <main
        className={cn(
          "ring-none mx-auto flex h-svh max-h-svh w-full max-w-[35rem] flex-col items-stretch border-none",
          className,
        )}
        {...props}
      >
        <div className="flex-1 content-center overflow-y-auto px-6">{messages.length ? messageList : header}</div>
        <form
          onSubmit={handleSubmit}
          className="border-input bg-background focus-within:ring-ring/10 relative mx-6 mb-6 flex items-center rounded-[16px] border px-3 py-1.5 pr-8 text-sm focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-0"
        >
          <AutoResizeTextarea
            onKeyDown={handleKeyDown}
            onChange={(v) => setInput(v)}
            value={input}
            placeholder="Enter a message"
            className="placeholder:text-muted-foreground flex-1 bg-transparent focus:outline-none"
            disabled={isLoading}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="absolute bottom-1 right-1 size-6 rounded-full"
                disabled={isLoading || !input.trim()}
              >
                <ArrowUpIcon size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent sideOffset={12}>Submit</TooltipContent>
          </Tooltip>
        </form>
      </main>
    </TooltipProvider>
  )
}

