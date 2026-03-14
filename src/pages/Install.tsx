import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Download, Share2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const Install = () => {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => setInstalled(true);

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferredPrompt(null);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md text-center"
      >
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Smartphone className="h-8 w-8 text-primary" />
        </div>

        <h1 className="mb-3 font-mono text-2xl font-bold text-foreground">
          Install GitVisualizer AI
        </h1>
        <p className="mb-8 text-sm text-muted-foreground">
          Add it to your home screen for quick access, offline support, and a
          more app-like experience.
        </p>

        {installed ? (
          <div className="flex items-center justify-center gap-2 text-primary">
            <Check className="h-5 w-5" />
            <span className="font-medium">App installed</span>
          </div>
        ) : deferredPrompt ? (
          <Button
            onClick={handleInstall}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Download className="h-4 w-4" />
            Install App
          </Button>
        ) : isIOS ? (
          <div className="rounded-lg border border-border/50 bg-card p-4 text-left">
            <p className="mb-2 text-sm font-medium text-foreground">
              To install on iOS:
            </p>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  1
                </span>
                Tap the <Share2 className="inline h-4 w-4" /> share button in
                Safari.
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  2
                </span>
                Scroll down and tap "Add to Home Screen".
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  3
                </span>
                Tap "Add" to confirm.
              </li>
            </ol>
          </div>
        ) : (
          <div className="rounded-lg border border-border/50 bg-card p-4 text-left">
            <p className="mb-2 text-sm font-medium text-foreground">
              To install:
            </p>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  1
                </span>
                Open the browser menu.
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  2
                </span>
                Choose "Install app" or "Add to Home Screen".
              </li>
            </ol>
          </div>
        )}

        <a href="/" className="mt-6 inline-block text-sm text-primary hover:underline">
          Back to home
        </a>
      </motion.div>
    </div>
  );
};

export default Install;
