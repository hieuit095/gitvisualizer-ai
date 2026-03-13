import { useState, useCallback, useRef, useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

const NodeSearch = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; type: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { getNodes, fitView, setNodes } = useReactFlow();

  // Keyboard shortcut: Ctrl/Cmd + K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        setResults([]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      if (!value.trim()) {
        setResults([]);
        // Reset all node opacity
        setNodes((nds) =>
          nds.map((n) => ({ ...n, style: { ...n.style, opacity: 1 } }))
        );
        return;
      }

      const q = value.toLowerCase();
      const nodes = getNodes();
      const matches = nodes.filter((n) => {
        const data = n.data as Record<string, unknown>;
        const name = (data.name as string) || "";
        const path = (data.path as string) || "";
        return name.toLowerCase().includes(q) || path.toLowerCase().includes(q);
      });

      setResults(
        matches.slice(0, 8).map((n) => ({
          id: n.id,
          name: (n.data as Record<string, unknown>).name as string,
          type: n.type || "",
        }))
      );

      // Dim non-matching nodes
      const matchIds = new Set(matches.map((n) => n.id));
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          style: { ...n.style, opacity: matchIds.has(n.id) ? 1 : 0.15 },
        }))
      );
    },
    [getNodes, setNodes]
  );

  const focusNode = useCallback(
    (nodeId: string) => {
      fitView({ nodes: [{ id: nodeId }], duration: 400, padding: 0.5 });
      setOpen(false);
      setQuery("");
      setResults([]);
      // Reset opacity
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          style: { ...n.style, opacity: 1 },
        }))
      );
    },
    [fitView, setNodes]
  );

  const close = () => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setNodes((nds) =>
      nds.map((n) => ({ ...n, style: { ...n.style, opacity: 1 } }))
    );
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Search className="h-3 w-3" />
        <span>Search</span>
        <kbd className="ml-1 rounded border border-border/50 bg-background px-1 py-0.5 font-mono text-[10px]">
          ⌘K
        </kbd>
      </button>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search files & folders…"
          className="h-7 w-52 border-border/50 bg-muted/50 text-xs placeholder:text-muted-foreground/60"
        />
        <button onClick={close} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {results.length > 0 && (
        <div className="absolute left-0 top-full mt-1 w-64 rounded-lg border border-border/50 bg-card/95 py-1 shadow-xl backdrop-blur-sm">
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => focusNode(r.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted"
            >
              <span
                className={`h-2 w-2 rounded-sm ${
                  r.type === "folderNode" ? "bg-secondary" : "bg-primary"
                }`}
              />
              <span className="truncate text-foreground">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default NodeSearch;
