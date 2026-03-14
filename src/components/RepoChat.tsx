import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, X, Send, Loader2, Bot, User, Sparkles, FileCode } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { AnalysisResult } from "@/types/repo";

type Message = { role: "user" | "assistant"; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-repo`;

const SUGGESTED_QUESTIONS = [
  "What is the main architecture of this project?",
  "What are the key entry points?",
  "How does data flow through the app?",
  "What could be improved in this codebase?",
];

interface RepoChatProps {
  analysisResult: AnalysisResult | null;
  askAboutNode?: string | null;
  onAskHandled?: () => void;
  indexingStatus?: "idle" | "indexing" | "done";
}

// Citation pattern: [filename:L##-L##] or [filename:L##]
const CITATION_REGEX = /\[([^\]]+?):L(\d+)(?:-L(\d+))?\]/g;

function processCitations(children: React.ReactNode): React.ReactNode {
  if (!children) return children;
  if (typeof children === "string") {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    const regex = new RegExp(CITATION_REGEX.source, "g");
    while ((match = regex.exec(children)) !== null) {
      if (match.index > lastIndex) {
        parts.push(children.slice(lastIndex, match.index));
      }
      const file = match[1];
      const startLine = match[2];
      const endLine = match[3] || startLine;
      parts.push(
        <Badge
          key={`${match.index}`}
          variant="outline"
          className="mx-0.5 inline-flex cursor-default items-center gap-1 border-primary/30 bg-primary/10 px-1.5 py-0 text-[10px] font-mono text-primary hover:bg-primary/20"
          title={`${file} lines ${startLine}-${endLine}`}
        >
          <FileCode className="h-2.5 w-2.5" />
          {file.split("/").pop()}:L{startLine}{endLine !== startLine ? `-L${endLine}` : ""}
        </Badge>
      );
      lastIndex = regex.lastIndex;
    }
    if (parts.length === 0) return children;
    if (lastIndex < children.length) parts.push(children.slice(lastIndex));
    return <>{parts}</>;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => <span key={i}>{processCitations(child)}</span>);
  }
  return children;
}

const RepoChat = ({ analysisResult, askAboutNode, onAskHandled }: RepoChatProps) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Refs to avoid stale closures
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const isStreamingRef = useRef(false);
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

  // Reset chat when analysis changes
  useEffect(() => {
    setMessages([]);
  }, [analysisResult?.repoName]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreamingRef.current || !analysisResult) return;

      const userMsg: Message = { role: "user", content: text.trim() };
      const updatedMessages = [...messagesRef.current, userMsg];
      setMessages(updatedMessages);
      setInput("");
      setIsStreaming(true);

      let assistantSoFar = "";

      try {
        const resp = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
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

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || `Chat failed (${resp.status})`);
        }

        if (!resp.body) throw new Error("No response stream");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";

        const upsertAssistant = (chunk: string) => {
          assistantSoFar += chunk;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, content: assistantSoFar } : m
              );
            }
            return [...prev, { role: "assistant", content: assistantSoFar }];
          });
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          textBuffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
            let line = textBuffer.slice(0, newlineIndex);
            textBuffer = textBuffer.slice(newlineIndex + 1);

            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":") || line.trim() === "") continue;
            if (!line.startsWith("data: ")) continue;

            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") break;

            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content as string | undefined;
              if (content) upsertAssistant(content);
            } catch {
              textBuffer = line + "\n" + textBuffer;
              break;
            }
          }
        }

        // Flush remaining
        if (textBuffer.trim()) {
          for (let raw of textBuffer.split("\n")) {
            if (!raw) continue;
            if (raw.endsWith("\r")) raw = raw.slice(0, -1);
            if (!raw.startsWith("data: ")) continue;
            const jsonStr = raw.slice(6).trim();
            if (jsonStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content as string | undefined;
              if (content) upsertAssistant(content);
            } catch { /* ignore */ }
          }
        }
      } catch (e: any) {
        console.error("Chat error:", e);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `⚠️ ${e.message || "Failed to get a response. Please try again."}` },
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [analysisResult]
  );

  // Handle "ask about node" trigger from diagram clicks
  useEffect(() => {
    if (askAboutNode && analysisResult && !isStreamingRef.current) {
      setOpen(true);
      // Use requestAnimationFrame to ensure panel is rendered
      requestAnimationFrame(() => {
        sendMessage(askAboutNode);
        onAskHandled?.();
      });
    }
  }, [askAboutNode, analysisResult, sendMessage, onAskHandled]);

  if (!analysisResult) return null;

  return (
    <>
      {/* FAB toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/25 transition-transform hover:scale-105 active:scale-95"
        title="Ask about this codebase"
      >
        {open ? (
          <X className="h-6 w-6 text-primary-foreground" />
        ) : (
          <MessageCircle className="h-6 w-6 text-primary-foreground" />
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[520px] w-[400px] flex-col overflow-hidden rounded-2xl border border-border/50 bg-card shadow-2xl shadow-black/40">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border/50 bg-muted/50 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-foreground">Ask about this repo</h3>
              <p className="text-[10px] text-muted-foreground">{analysisResult.repoName}</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="flex flex-col gap-3 pt-4">
                <p className="text-center text-xs text-muted-foreground">
                  Ask anything about <span className="font-medium text-foreground">{analysisResult.repoName}</span>
                </p>
                <div className="flex flex-col gap-2">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:bg-muted/60 hover:text-foreground"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.role === "assistant" && (
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/60 text-foreground"
                      }`}
                    >
                      {msg.role === "assistant" ? (
                        <div className="prose prose-sm prose-invert max-w-none [&_code]:rounded [&_code]:bg-background/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre]:rounded-lg [&_pre]:bg-background/50 [&_pre]:p-2 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0">
                          <ReactMarkdown
                            components={{
                              // Render citation patterns [file:L##-L##] as badges
                              p: ({ children, ...props }) => {
                                const processed = processCitations(children);
                                return <p {...props}>{processed}</p>;
                              },
                              li: ({ children, ...props }) => {
                                const processed = processCitations(children);
                                return <li {...props}>{processed}</li>;
                              },
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        msg.content
                      )}
                    </div>
                    {msg.role === "user" && (
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
                      <span className="text-xs text-muted-foreground">Thinking…</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          {/* Input */}
          <div className="border-t border-border/50 p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage(input);
              }}
              className="flex gap-2"
            >
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about the codebase…"
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
