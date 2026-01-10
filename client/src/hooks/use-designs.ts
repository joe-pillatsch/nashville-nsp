import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type InsertDesign } from "@shared/routes";

// GET /api/designs
export function useDesigns() {
  return useQuery({
    queryKey: [api.designs.list.path],
    queryFn: async () => {
      const res = await fetch(api.designs.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch designs");
      return api.designs.list.responses[200].parse(await res.json());
    },
  });
}

// GET /api/designs/:id
export function useDesign(id: number) {
  return useQuery({
    queryKey: [api.designs.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.designs.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch design");
      return api.designs.get.responses[200].parse(await res.json());
    },
    // Poll while processing (every 2 seconds)
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.status === 'pending' || data.status === 'processing')) {
        return 2000; 
      }
      return false;
    }
  });
}

// POST /api/designs
export function useCreateDesign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertDesign) => {
      // Validate with schema first
      const validated = api.designs.create.input.parse(data);
      
      const res = await fetch(api.designs.create.path, {
        method: api.designs.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      
      if (!res.ok) {
        if (res.status === 400) {
           const error = api.designs.create.responses[400].parse(await res.json());
           throw new Error(error.message);
        }
        throw new Error("Failed to create design");
      }
      return api.designs.create.responses[201].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.designs.list.path] }),
  });
}

// Helper hook for uploading file
export function useUploadFile() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      return data.url as string;
    }
  });
}
