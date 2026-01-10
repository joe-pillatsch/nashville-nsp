import { useRoute, useLocation } from "wouter";
import { useDesign, useCreateDesign } from "@/hooks/use-designs";
import { Loader2, ArrowLeft, RefreshCcw, Download, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export default function DesignResult() {
  const [, params] = useRoute("/design/:id");
  const [, setLocation] = useLocation();
  const id = parseInt(params?.id || "0");
  const { data: design, isLoading, error } = useDesign(id);
  const createDesign = useCreateDesign();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <h2 className="text-2xl font-bold font-display">Loading Design...</h2>
        </div>
      </div>
    );
  }

  if (error || !design) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Design Not Found</h2>
          <p className="text-muted-foreground mb-8">We couldn't find the design you're looking for. It might have been deleted or never existed.</p>
          <Button onClick={() => setLocation('/')} size="lg">Back to Home</Button>
        </div>
      </div>
    );
  }

  const isProcessing = design.status === 'pending' || design.status === 'processing';

  const handleRegenerate = async () => {
    // Re-use original image for a new design
    try {
      const newDesign = await createDesign.mutateAsync({
        originalImageUrl: design.originalImageUrl,
        prompt: design.prompt || undefined
      });
      setLocation(`/design/${newDesign.id}`);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20 pt-24 px-4">
      <div className="container max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation('/')} className="rounded-full">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold font-display">Design Result</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn(
                  "w-2 h-2 rounded-full animate-pulse",
                  isProcessing ? "bg-amber-500" : "bg-green-500"
                )} />
                <span className="text-sm text-muted-foreground capitalize">{design.status}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleRegenerate} disabled={isProcessing}>
              <RefreshCcw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
            {design.processedImageUrl && (
              <Button onClick={() => window.open(design.processedImageUrl!, '_blank')}>
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[600px]">
          
          {/* Original */}
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="relative rounded-3xl overflow-hidden border bg-card shadow-sm group"
          >
            <div className="absolute top-4 left-4 z-10 px-3 py-1 bg-black/50 backdrop-blur-md rounded-full text-white text-xs font-medium">
              Original Wall
            </div>
            <img 
              src={design.originalImageUrl} 
              alt="Original wall" 
              className="w-full h-full object-cover"
            />
          </motion.div>

          {/* Generated Result */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="relative rounded-3xl overflow-hidden border bg-card shadow-lg ring-1 ring-border/50"
          >
            <div className="absolute top-4 left-4 z-10 px-3 py-1 bg-primary/90 backdrop-blur-md rounded-full text-white text-xs font-medium flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              AI Generated Layout
            </div>

            {isProcessing ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/20 backdrop-blur-sm p-6 text-center">
                <div className="relative">
                   <div className="w-20 h-20 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-6" />
                   <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-primary animate-pulse" />
                </div>
                <h3 className="text-2xl font-bold font-display mb-2">Designing Your Space...</h3>
                <p className="text-muted-foreground max-w-sm">
                  Our AI is analyzing your wall geometry and calculating optimal acoustic coverage. This usually takes about 10-20 seconds.
                </p>
              </div>
            ) : design.status === 'failed' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-50 p-6 text-center">
                <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
                <h3 className="text-xl font-bold text-red-700 mb-2">Generation Failed</h3>
                <p className="text-red-600/80 mb-6">Something went wrong while generating the design. Please try again.</p>
                <Button variant="destructive" onClick={handleRegenerate}>Try Again</Button>
              </div>
            ) : (
              <img 
                src={design.processedImageUrl!} 
                alt="Generated design" 
                className="w-full h-full object-cover"
              />
            )}
          </motion.div>
        </div>

        {/* Prompt info */}
        {design.prompt && (
          <div className="mt-8 p-6 bg-secondary/50 rounded-2xl border border-secondary">
             <h4 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-2">Design Prompt</h4>
             <p className="text-foreground font-medium">{design.prompt}</p>
          </div>
        )}

      </div>
    </div>
  );
}
