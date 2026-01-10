import { useState } from "react";
import { useLocation } from "wouter";
import { Hero } from "@/components/Hero";
import { UploadZone } from "@/components/UploadZone";
import { InspirationGallery } from "@/components/InspirationGallery";
import { useUploadFile, useCreateDesign } from "@/hooks/use-designs";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";

export default function Home() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const uploadFile = useUploadFile();
  const createDesign = useCreateDesign();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFileSelect = async (file: File) => {
    try {
      setIsProcessing(true);
      
      // 1. Upload file
      const url = await uploadFile.mutateAsync(file);
      
      // 2. Create design job
      const design = await createDesign.mutateAsync({
        originalImageUrl: url,
        prompt: "Modern aesthetic acoustic panels, minimalist geometric layout, balanced sound absorption",
      });

      // 3. Redirect to result page
      setLocation(`/design/${design.id}`);
      
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "Failed to process image. Please try again.",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Hero />
      
      <div className="container max-w-7xl mx-auto px-4 -mt-10 relative z-20 pb-20">
        <div className="bg-card rounded-[2rem] shadow-xl shadow-primary/5 border p-8 md:p-12 max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold font-display mb-2">Start Your Transformation</h2>
            <p className="text-muted-foreground">Upload a photo to generate a custom acoustic layout in seconds.</p>
          </div>
          
          <UploadZone 
            onFileSelect={handleFileSelect} 
            isUploading={isProcessing} 
          />
          
          {isProcessing && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-6 text-center text-sm text-muted-foreground"
            >
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              Uploading image and initializing AI engine...
            </motion.div>
          )}
        </div>
      </div>

      <InspirationGallery />
      
      <footer className="py-12 border-t bg-white">
        <div className="container mx-auto px-4 text-center text-muted-foreground">
          <p>© 2024 AcousticAI. Visualize silence.</p>
        </div>
      </footer>
    </div>
  );
}
