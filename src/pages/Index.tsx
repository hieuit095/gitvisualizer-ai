import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { GitBranch, Sparkles, ArrowRight, Github, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

const GITHUB_URL_REGEX = /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/;

const Index = () => {
  const [url, setUrl] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const navigate = useNavigate();

  const handleAnalyze = async () => {
    if (!url.trim()) {
      toast({ title: "Please enter a GitHub URL", variant: "destructive" });
      return;
    }
    if (!GITHUB_URL_REGEX.test(url.trim())) {
      toast({ title: "Invalid GitHub URL", description: "Please enter a valid public repo URL (e.g. https://github.com/user/repo)", variant: "destructive" });
      return;
    }
    setIsValidating(true);
    navigate(`/visualize?repo=${encodeURIComponent(url.trim())}`);
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background">
      <div className="animated-grid absolute inset-0 opacity-60" />

      <motion.div
        className="absolute left-1/4 top-1/4 h-64 w-64 rounded-full bg-primary/5 blur-3xl"
        animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-1/4 right-1/4 h-80 w-80 rounded-full bg-secondary/5 blur-3xl"
        animate={{ x: [0, -20, 0], y: [0, 30, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-8 flex items-center justify-center gap-3"
        >
          <div className="glow-cyan rounded-xl bg-primary/10 p-3">
            <GitBranch className="h-8 w-8 text-primary" />
          </div>
          <h1 className="font-mono text-2xl font-bold tracking-tight text-foreground">
            GitVisualizer<span className="text-primary"> AI</span>
          </h1>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mb-4 text-4xl font-bold leading-tight tracking-tight text-foreground md:text-5xl"
        >
          Visualize any GitHub repo{" "}
          <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            in seconds
          </span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mb-10 text-lg text-muted-foreground"
        >
          AI-powered architecture diagrams. Understand data flows, dependencies,
          and module relationships — without reading a single line of code.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mx-auto flex max-w-xl items-center gap-3"
        >
          <div className="relative flex-1">
            <Github className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isValidating && handleAnalyze()}
              placeholder="https://github.com/user/repo"
              disabled={isValidating}
              className="h-12 border-border/50 bg-card pl-11 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-primary"
            />
          </div>
          <Button
            onClick={handleAnalyze}
            disabled={isValidating}
            className="h-12 gap-2 bg-primary px-6 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {isValidating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isValidating ? "Loading…" : "Analyze"}
            {!isValidating && <ArrowRight className="h-4 w-4" />}
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          {["Interactive diagrams", "AI summaries", "Dependency mapping", "Zero setup"].map((feat) => (
            <span
              key={feat}
              className="rounded-full border border-border/50 bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground"
            >
              {feat}
            </span>
          ))}
        </motion.div>
      </div>
    </div>
  );
};

export default Index;
