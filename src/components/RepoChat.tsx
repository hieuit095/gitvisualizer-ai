import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Database,
  FileCode,
  Loader2,
  MessageCircle,
  Search,
  Send,
  Sparkles,
  User,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AnalysisResult } from "@/types/repo";

type SearchMeta = { method: "vector" | "text" | "none"; chunks: number };
type Message = { role: "user" | "assistant"; content: string; searchMeta?: SearchMeta };

const CHAT_URL = "/api/chat-repo";

const SUGGESTED_QUESTIONS = [
  "What is the main architecture of this project?",
  "What are the key entry points?",
  "How does data flow through the app?",
  "What could be improved in this codebase?",
];

const CITATION_REGEX = /\[([^\]]+?):L(\d+)(?:-L(\d+))?\]/g;

interface RepoChatProps {
  analysisResult: AnalysisResult | null;
  askAboutNode?: string | null;
  onAskHandled?: () => void;
  indexingStatus?: "idle" | "indexing" | "done";
}

function processCitations(children: React.ReactNode): React.ReactNode {
  if (!children) return children;

  if (typeof children === "string") {
    const parts: React.ReactNode[] = [];
    const matcher = new RegExp(CITATION_REGEX.source, "g");
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = matcher.exec(children)) !== null) {
      if (match.index > lastIndex) {
        parts.push(children.slice(lastIndex, match.index));
      }

      const file = match[1];
      const startLine = match[2];
      const endLine = match[3] || startLine;

      parts.push(
        <Badge
          key={`${file}-${startLine}-${endLine}-${match.index}`}
          variant="outline"
          className="mx-0.5 inline-flex cursor-default items-center gap-1 border-primary/30 bg-primary/10 px-1.5 py-0 text-[10px] font-mono text-primary hover:bg-primary/20"
          title={`${file} lines ${startLine}-${endLine}`}
        >
          <FileCode className="h-2.5 w-2.5" />
          {file.split("/").pop()}:L{startLine}
          {endLine !== startLine ? `-L${endLine}` : ""}
        </Badge>,
      );

      lastIndex = matcher.lastIndex;
    }

    if (parts.length === 0) return children;
    if (lastIndex < children.length) {
      parts.push(children.slice(lastIndex));
    }
    return <>{parts}</>;
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <span key={index}>{processCitations(child)}</span>
    ));
  }

  return children;
}

const RepoChat = ({
  analysisResult,
  askAboutNode,
  onAskHandled,
  indexingStatus = "idle",
}: RepoChatProps) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<Message[]>(messages);
  const isStreamingRef = useRef(false);

  messagesRef.current = messages;
  isStreamingRef.current = isStreaming;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    setMessages([]);
  }, [analysisResult?.repoName]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreamingRef.current || !analysisResult) return;

      const userMessage: Message = { role: "user", content: text.trim() };
      const updatedMessages = [...messagesRef.current, userMessage];
      setMessages(updatedMessages);
      setInput("");
      setIsStreaming(true);

      let assistantSoFar = "";
      let currentSearchMeta: SearchMeta | undefined;

      try {
        const response = await fetch(CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: updatedMessages,
            repoContext: {
              repoName: analysisResult.repoName,
              repoUrl: analysisResult.repoUrl,
              nodes: analysisResult.nodes,
              edges: analysisResult.edges,
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Chat failed (${response.status})`);
        }

        if (!response.body) {
          throw new Error("No response stream");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";

        const upsertAssistant = (chunk: string) => {
          assistantSoFar += chunk;
          setMessages((previous) => {
            const last = previous[previous.length - 1];
            if (last?.role === "assistant") {
              return previous.map((message, index) =>
                index === previous.length - 1
                  ? {
                      ...message,
                      content: assistantSoFar,
                      searchMeta: currentSearchMeta,
                    }
                  : message,
              );
            }

            return [
              ...previous,
              {
                role: "assistant",
                content: assistantSoFar,
                searchMeta: currentSearchMeta,
              },
            ];
          });
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          textBuffer += decoder.decode(value, { stream: true });
          let newlineIndex = textBuffer.indexOf("\n");

          while (newlineIndex !== -1) {
            let line = textBuffer.slice(0, newlineIndex);
            textBuffer = textBuffer.slice(newlineIndex + 1);

            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":") || line.trim() === "") {
              newlineIndex = textBuffer.indexOf("\n");
              continue;
            }
            if (!line.startsWith("data: ")) {
              newlineIndex = textBuffer.indexOf("\n");
              continue;
            }

            const jsonString = line.slice(6).trim();
            if (jsonString === "[DONE]") {
              newlineIndex = -1;
              break;
            }

            try {
              const parsed = JSON.parse(jsonString);
              if (parsed.searchMeta) {
                currentSearchMeta = parsed.searchMeta as SearchMeta;
                newlineIndex = textBuffer.indexOf("\n");
                continue;
              }

              const content = parsed.choices?.[0]?.delta?.content as
                | string
                | undefined;
              if (content) {
                upsertAssistant(content);
              }
            } catch {
              textBuffer = `${line}\n${textBuffer}`;
              break;
            }

            newlineIndex = textBuffer.indexOf("\n");
          }
        }

        if (textBuffer.trim()) {
          for (let rawLine of textBuffer.split("\n")) {
            if (!rawLine) continue;
            if (rawLine.endsWith("\r")) rawLine = rawLine.slice(0, -1);
            if (!rawLine.startsWith("data: ")) continue;
            const jsonString = rawLine.slice(6).trim();
            if (jsonString === "[DONE]") continue;
            try {
              const parsed = JSON.parse(jsonString);
              const content = parsed.choices?.[0]?.delta?.content as
                | string
                | undefined;
              if (content) {
                upsertAssistant(content);
              }
            } catch {
              // Ignore trailing partial chunks.
            }
          }
        }
      } catch (error: unknown) {
        console.error("Chat error:", error);
        const message =
          error instanceof Error
            ? error.message
            : "Failed to get a response. Please try again.";
        setMessages((previous) => [
          ...previous,
          { role: "assistant", content: `Warning: ${message}` },
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [analysisResult],
  );

  useEffect(() => {
    if (!askAboutNode || !analysisResult || isStreamingRef.current) return;

    setOpen(true);
    requestAnimationFrame(() => {
      sendMessage(askAboutNode);
      onAskHandled?.();
    });
  }, [analysisResult, askAboutNode, onAskHandled, sendMessage]);

  if (!analysisResult) return null;

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => setOpen((current) => !current)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/25 transition-transform hover:scale-105 active:scale-95"
          title="Ask about this codebase"
        >
          {open ? (
            <X className="h-6 w-6 text-primary-foreground" />
          ) : (
            <MessageCircle className="h-6 w-6 text-primary-foreground" />
          )}
        </button>

        {!open && indexingStatus === "indexing" && (
          <div className="absolute -left-2 -top-2 flex items-center gap-1 rounded-full border border-border/50 bg-card px-2 py-0.5 shadow-md">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            <span className="whitespace-nowrap text-[9px] font-medium text-muted-foreground">
              Indexing...
            </span>
          </div>
        )}

        {!open && indexingStatus === "done" && (
          <div className="absolute -left-2 -top-2 flex animate-in fade-in slide-in-from-bottom-1 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 shadow-md">
            <FileCode className="h-3 w-3 text-primary" />
            <span className="whitespace-nowrap text-[9px] font-medium text-primary">
              Indexed
            </span>
          </div>
        )}
      </div>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[520px] w-[400px] flex-col overflow-hidden rounded-2xl border border-border/50 bg-card shadow-2xl shadow-black/40">
          <div className="flex items-center gap-2 border-b border-border/50 bg-muted/50 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-foreground">
                Ask about this repo
              </h3>
              <p className="text-[10px] text-muted-foreground">
                {analysisResult.repoName}
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="flex flex-col gap-3 pt-4">
                <p className="text-center text-xs text-muted-foreground">
                  Ask anything about{" "}
                  <span className="font-medium text-foreground">
                    {analysisResult.repoName}
                  </span>
                </p>
                <div className="flex flex-col gap-2">
                  {SUGGESTED_QUESTIONS.map((question) => (
                    <button
                      key={question}
                      onClick={() => sendMessage(question)}
                      className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:bg-muted/60 hover:text-foreground"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {messages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={`flex gap-2 ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {message.role === "assistant" && (
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/60 text-foreground"
                      }`}
                    >
                      {message.role === "assistant" ? (
                        <div>
                          {message.searchMeta &&
                            message.searchMeta.method !== "none" && (
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <Badge
                                  variant="outline"
                                  className="gap-1 border-primary/20 bg-primary/5 px-1.5 py-0 text-[9px] font-medium text-primary/70"
                                >
                                  {message.searchMeta.method === "vector" ? (
                                    <Database className="h-2.5 w-2.5" />
                                  ) : (
                                    <Search className="h-2.5 w-2.5" />
                                  )}
                                  {message.searchMeta.method === "vector"
                                    ? "Vector"
                                    : "Text"}{" "}
                                  search - {message.searchMeta.chunks} chunks
                                </Badge>
                              </div>
                            )}
                          <div className="prose prose-sm prose-invert max-w-none [&_code]:rounded [&_code]:bg-background/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_li]:my-0 [&_ol]:my-1 [&_p]:my-1 [&_pre]:rounded-lg [&_pre]:bg-background/50 [&_pre]:p-2 [&_ul]:my-1">
                            <ReactMarkdown
                              components={{
                                p: ({ children, ...props }) => (
                                  <p {...props}>{processCitations(children)}</p>
                                ),
                                li: ({ children, ...props }) => (
                                  <li {...props}>{processCitations(children)}</li>
                                ),
                              }}
                            >
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        </div>
                      ) : (
                        message.content
                      )}
                    </div>
                    {message.role === "user" && (
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary/15">
                        <User className="h-3.5 w-3.5 text-secondary" />
                      </div>
                    )}
                  </div>
                ))}
                {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
                  <div className="flex gap-2">
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="flex items-center gap-1 rounded-xl bg-muted/60 px-3 py-2">
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        Thinking...
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          <div className="border-t border-border/50 p-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                sendMessage(input);
              }}
              className="flex gap-2"
            >
              <Input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about the codebase..."
                disabled={isStreaming}
                className="h-9 flex-1 border-border/50 bg-background text-sm text-foreground placeholder:text-muted-foreground"
              />
              <Button
                type="submit"
                size="icon"
                disabled={isStreaming || !input.trim()}
                className="h-9 w-9 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default RepoChat;
