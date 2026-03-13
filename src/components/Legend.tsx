import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

const nodeItems = [
  { label: "Folder", color: "bg-secondary" },
  { label: "Component", color: "bg-primary" },
  { label: "Entry Point", color: "bg-green-400" },
  { label: "Utility", color: "bg-yellow-400" },
  { label: "Hook", color: "bg-primary" },
  { label: "Style", color: "bg-pink-400" },
  { label: "Test", color: "bg-orange-400" },
  { label: "Database / Model", color: "bg-secondary" },
  { label: "Config / Other", color: "bg-muted-foreground" },
];

const edgeItems = [
  { label: "Contains", color: "bg-secondary" },
  { label: "Imports / Calls", color: "bg-primary" },
];

const Legend = () => {
  const [open, setOpen] = useState(true);

  return (
    <div className="absolute bottom-4 left-4 z-40 w-48 rounded-lg border border-border/50 bg-card/90 shadow-lg backdrop-blur-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        Legend
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>

      {open && (
        <div className="space-y-3 px-3 pb-3">
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Nodes
            </p>
            <div className="space-y-1">
              {nodeItems.map((n) => (
                <div key={n.label} className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-sm ${n.color}`} />
                  <span className="text-xs text-foreground/80">{n.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Edges
            </p>
            <div className="space-y-1">
              {edgeItems.map((e) => (
                <div key={e.label} className="flex items-center gap-2">
                  <span className={`h-0.5 w-4 ${e.color} rounded-full`} />
                  <span className="text-xs text-foreground/80">{e.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Legend;
