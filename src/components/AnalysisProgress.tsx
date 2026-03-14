import { motion, AnimatePresence } from "framer-motion";
import { GitBranch, Search, Brain, LayoutGrid, Check, Filter, FileCode, Zap } from "lucide-react";
import type { ProgressEvent } from "@/types/repo";

const defaultSteps = [
  { icon: GitBranch, label: "Fetching repository..." },
  { icon: Filter, label: "Applying smart filters..." },
  { icon: FileCode, label: "Running Tree-sitter static analysis..." },
  { icon: Brain, label: "AI analyzing architecture..." },
  { icon: LayoutGrid, label: "Building diagram..." },
];

interface AnalysisProgressProps {
  currentStep: number;
  progressEvents?: ProgressEvent[];
}

const AnalysisProgress = ({ currentStep, progressEvents = [] }: AnalysisProgressProps) => {
  // Extract token usage from events
  const usageEvent = progressEvents.find(e => e.step === "usage");

  // Derive step labels from live events when available
  const steps = defaultSteps.map((step, i) => {
    const eventMap: Record<number, string[]> = {
      0: ["fetch", "fetch_done"],
      1: ["filter", "filter_done"],
      2: ["extract", "extract_done"],
      3: ["analyze", "usage"],
      4: ["done"],
    };
    const relevantEvents = progressEvents.filter(e => eventMap[i]?.includes(e.step));
    const lastEvent = relevantEvents[relevantEvents.length - 1];
    return {
      ...step,
      liveLabel: lastEvent?.message || null,
    };
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <div className="animated-grid absolute inset-0 opacity-40" />
      <div className="relative z-10 w-full max-w-md space-y-4 px-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-8 text-center"
        >
          <h2 className="font-mono text-xl font-bold text-foreground">Analyzing Repository</h2>
          <p className="mt-1 text-sm text-muted-foreground">Smart filtering & AI analysis in progress...</p>
        </motion.div>

        {steps.map((step, i) => {
          const Icon = step.icon;
          const isActive = i === currentStep;
          const isDone = i < currentStep;

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className={`flex items-center gap-4 rounded-lg border px-4 py-3 transition-all ${
                isActive
                  ? "border-primary/50 bg-primary/5 glow-cyan"
                  : isDone
                  ? "border-border/50 bg-muted/30"
                  : "border-border/30 bg-card/30"
              }`}
            >
              <div className={`rounded-lg p-2 ${isActive ? "bg-primary/10" : isDone ? "bg-muted" : "bg-card"}`}>
                {isDone ? (
                  <Check className="h-4 w-4 text-primary" />
                ) : (
                  <Icon className={`h-4 w-4 ${isActive ? "animate-pulse text-primary" : "text-muted-foreground"}`} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className={`block text-sm font-medium ${isActive ? "text-foreground" : isDone ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                  {step.label}
                </span>
                <AnimatePresence mode="wait">
                  {(isActive || isDone) && step.liveLabel && (
                    <motion.span
                      key={step.liveLabel}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="block truncate text-xs text-primary/70 mt-0.5"
                    >
                      {step.liveLabel}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}

        {/* Token Usage Metrics Card */}
        <AnimatePresence>
          {usageEvent && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="mt-6 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
            >
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">Token Usage</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="text-lg font-bold font-mono text-primary">
                    {usageEvent.promptTokens?.toLocaleString() ?? "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Input</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold font-mono text-primary">
                    {usageEvent.completionTokens?.toLocaleString() ?? "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Output</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold font-mono text-foreground">
                    {usageEvent.totalTokens?.toLocaleString() ?? "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default AnalysisProgress;
