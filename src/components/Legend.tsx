import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

const nodeItems = [
  { label: "Folder", color: "bg-secondary" },
  { label: "Component", color: "bg-primary" },
  { label: "Utility / Hook", color: "bg-primary" },
  { label: "Entry Point", color: "bg-primary" },
  { label: "Config / Other", color: "bg-primary" },
];

const edgeItems = [
  { label: "Contains", color: "bg-secondary", dashed: false },
  { label: "Imports / Calls", color: "bg-primary", dashed: false },
];

const Legend = () => {
  const [open, setOpen] = useState(true);

  return (
    <div className="absolute bottom-4 left-4 z-40 w-48 rounded-lg border border-border/50 bg-card/90 backdrop-blur-sm shadow-lg">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        Legend
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>

      {open && (
        <div className="space-y-3 px-3 pb-3">
          {/* Nodes */}
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

          {/* Edges */}
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
