import { motion } from "framer-motion";
import { GitBranch, Search, Brain, LayoutGrid, Check } from "lucide-react";

const steps = [
  { icon: GitBranch, label: "Fetching repository..." },
  { icon: Search, label: "Scanning file tree..." },
  { icon: Brain, label: "AI analyzing architecture..." },
  { icon: LayoutGrid, label: "Building diagram..." },
];

interface AnalysisProgressProps {
  currentStep: number;
}

const AnalysisProgress = ({ currentStep }: AnalysisProgressProps) => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <div className="animated-grid absolute inset-0 opacity-40" />
      <div className="relative z-10 w-full max-w-md space-y-6 px-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-8 text-center"
        >
          <h2 className="font-mono text-xl font-bold text-foreground">Analyzing Repository</h2>
          <p className="mt-1 text-sm text-muted-foreground">This may take a moment...</p>
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
              transition={{ delay: i * 0.15 }}
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
              <span className={`text-sm font-medium ${isActive ? "text-foreground" : isDone ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                {step.label}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default AnalysisProgress;
