import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud, Loader2, ImageIcon, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface UploadZoneProps {
  onFileSelect: (file: File) => void;
  isUploading: boolean;
}

export function UploadZone({ onFileSelect, isUploading }: UploadZoneProps) {
  const [preview, setPreview] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setPreview(URL.createObjectURL(file));
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp']
    },
    maxFiles: 1,
    disabled: isUploading
  });

  return (
    <div className="w-full max-w-2xl mx-auto">
      <motion.div
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        <div
          {...getRootProps()}
          className={cn(
            "relative group cursor-pointer overflow-hidden rounded-3xl border-2 border-dashed transition-all duration-300 min-h-[400px] flex items-center justify-center bg-card shadow-sm hover:shadow-md",
            isDragActive ? "border-primary bg-primary/5 scale-[1.02]" : "border-border hover:border-primary/50",
            preview ? "border-solid border-transparent" : "",
            isUploading && "opacity-70 cursor-not-allowed"
          )}
        >
          <input {...getInputProps()} />

          <AnimatePresence mode="wait">
            {preview ? (
              <motion.div
                key="preview"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 w-full h-full"
              >
                <img src={preview} alt="Upload preview" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <p className="text-white font-medium flex items-center gap-2">
                    <ImageIcon className="w-5 h-5" /> Click to change image
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="placeholder"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-center p-8"
              >
                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300">
                  <UploadCloud className="w-10 h-10 text-primary" />
                </div>
                <h3 className="text-2xl font-bold mb-2 font-display">Upload your wall photo</h3>
                <p className="text-muted-foreground max-w-xs mx-auto mb-6">
                  Drag and drop an image here, or click to browse.
                  Supports JPG, PNG, WEBP.
                </p>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary text-secondary-foreground text-sm font-medium">
                   <Sparkles className="w-4 h-4" /> AI Ready
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {isUploading && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <p className="text-lg font-semibold animate-pulse">Uploading & Analyzing...</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
