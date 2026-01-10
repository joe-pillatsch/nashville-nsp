import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export function Hero() {
  return (
    <div className="relative overflow-hidden py-20 lg:py-28">
      {/* Abstract Background Shapes */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-primary/10 rounded-full blur-3xl opacity-70 animate-pulse" />
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-72 h-72 bg-accent/10 rounded-full blur-3xl opacity-70 animate-pulse delay-1000" />

      <div className="container max-w-7xl mx-auto px-4 relative z-10 text-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-secondary text-secondary-foreground text-sm font-semibold tracking-wide mb-6 border border-secondary-foreground/10">
            AI-Powered Interior Acoustics
          </span>
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 tracking-tight leading-tight">
            Visualize Quiet.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-500 to-accent">
              Design with Sound.
            </span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Upload a photo of your blank wall and let our AI generate stunning acoustic panel layouts that merge form and function.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
