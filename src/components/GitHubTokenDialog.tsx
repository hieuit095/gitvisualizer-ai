import { useState } from "react";
import { KeyRound, ExternalLink, Eye, EyeOff, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TOKEN_KEY = "gh_pat";

export function getStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function storeToken(token: string) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch { /* noop */ }
}

interface GitHubTokenDialogProps {
  trigger?: React.ReactNode;
}

const GitHubTokenDialog = ({ trigger }: GitHubTokenDialogProps) => {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(() => getStoredToken());
  const [showToken, setShowToken] = useState(false);
  const hasToken = !!getStoredToken();

  const handleSave = () => {
    storeToken(token.trim());
    setOpen(false);
  };

  const handleClear = () => {
    setToken("");
    storeToken("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {hasToken ? "Token configured" : "Private repos"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="border-border/50 bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-foreground">
            <Lock className="h-5 w-5 text-primary" />
            GitHub Access Token
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Add a Personal Access Token to analyze private repositories.
            Your token is stored locally in your browser and never sent to our servers — only to GitHub's API.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="gh-token" className="text-sm text-foreground">
              Personal Access Token
            </Label>
            <div className="relative">
              <Input
                id="gh-token"
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="border-border/50 bg-background pr-10 font-mono text-sm text-foreground placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">How to create a token:</p>
            <ol className="list-inside list-decimal space-y-1">
              <li>Go to GitHub → Settings → Developer settings</li>
              <li>Select "Personal access tokens" → "Fine-grained tokens"</li>
              <li>Create a token with <code className="rounded bg-muted px-1 text-primary">Contents: Read-only</code> access</li>
              <li>Select the repositories you want to analyze</li>
            </ol>
            <a
              href="https://github.com/settings/tokens?type=beta"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open GitHub token settings
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {hasToken && (
            <Button variant="ghost" onClick={handleClear} className="text-destructive hover:text-destructive">
              Remove token
            </Button>
          )}
          <Button onClick={handleSave} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {token.trim() ? "Save token" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default GitHubTokenDialog;
