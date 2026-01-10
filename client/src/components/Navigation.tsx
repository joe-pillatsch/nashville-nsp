import { Link, useLocation } from "wouter";
import { Layout, Home, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function Navigation() {
  const [location] = useLocation();

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
      <div className="container max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center space-x-2 group">
          <div className="bg-gradient-to-tr from-primary to-accent p-2 rounded-lg group-hover:shadow-lg transition-all duration-300">
            <Layout className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold font-display bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
            AcousticAI
          </span>
        </Link>

        <div className="flex items-center space-x-6">
          <Link href="/" className={cn(
            "text-sm font-medium transition-colors hover:text-primary",
            location === "/" ? "text-primary font-bold" : "text-muted-foreground"
          )}>
            Create
          </Link>
        </div>
      </div>
    </nav>
  );
}
