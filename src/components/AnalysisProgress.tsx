import { motion, AnimatePresence } from "framer-motion";
import { GitBranch, Search, Brain, LayoutGrid, Check, Filter, FileCode } from "lucide-react";
import type { ProgressEvent } from "@/types/repo";

const defaultSteps = [
  { icon: GitBranch, label: "Fetching repository..." },
  { icon: Filter, label: "Applying smart filters..." },
  { icon: FileCode, label: "Extracting imports & signatures..." },
  { icon: Brain, label: "AI analyzing architecture..." },
  { icon: LayoutGrid, label: "Building diagram..." },
];

interface AnalysisProgressProps {
  currentStep: number;
  progressEvents?: ProgressEvent[];
}

const AnalysisProgress = ({ currentStep, progressEvents = [] }: AnalysisProgressProps) => {
  // Derive step labels from live events when available
  const steps = defaultSteps.map((step, i) => {
    const eventMap: Record<number, string[]> = {
      0: ["fetch", "fetch_done"],
      1: ["filter", "filter_done"],
      2: ["extract", "extract_done"],
      3: ["analyze"],
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
      </div>
    </div>
  );
};

export default AnalysisProgress;
