import { motion } from "framer-motion";
import example1 from "@assets/example-1_1768021013988.JPG";
import example2 from "@assets/example-2_1768021009780.jpeg";
import example3 from "@assets/example-5_1768021017623.png";

const inspirations = [
  { id: 1, src: example1, alt: "Modern geometric acoustic layout", title: "Geometric Harmony" },
  { id: 2, src: example2, alt: "Minimalist sound panels", title: "Minimalist Flow" },
  { id: 3, src: example3, alt: "Bold color acoustic design", title: "Bold Statement" },
];

export function InspirationGallery() {
  return (
    <section className="py-20 bg-muted/30">
      <div className="container max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between mb-12">
          <div>
             <h2 className="text-3xl font-bold font-display">Inspiration</h2>
             <p className="text-muted-foreground mt-2">See what's possible with AI-driven design.</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {inspirations.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="group relative aspect-[4/3] rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300"
            >
              <img 
                src={item.src} 
                alt={item.alt}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-6">
                <p className="text-white font-medium text-lg">{item.title}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
