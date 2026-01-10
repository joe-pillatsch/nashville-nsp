# AcousticAI - AI-Powered Acoustic Panel Visualizer

## Overview

AcousticAI is a web application that allows users to upload photos of their walls and receive AI-generated visualizations of acoustic panel layouts. Users can upload an image, and the system processes it using OpenAI's image generation capabilities to create realistic mockups showing how acoustic felt panels would look in their space.

The application follows a full-stack TypeScript architecture with a React frontend and Express backend, using PostgreSQL for data persistence and OpenAI's API for image generation.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight client-side routing)
- **State Management**: TanStack Query (React Query) for server state and caching
- **Styling**: Tailwind CSS with shadcn/ui component library
- **Animations**: Framer Motion for page transitions and micro-interactions
- **File Upload**: react-dropzone for drag-and-drop image uploads
- **Build Tool**: Vite with path aliases (@/, @shared/, @assets/)

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database ORM**: Drizzle ORM with PostgreSQL
- **File Uploads**: Multer for handling multipart form data
- **Image Processing**: Sharp for image manipulation
- **AI Integration**: OpenAI API via Replit AI Integrations for image generation

### Data Flow
1. User uploads a wall photo through the UploadZone component
2. Image is saved to the server's uploads directory via Multer
3. A design record is created in PostgreSQL with status "pending"
4. Backend sends the image to OpenAI's image generation API with panel set context
5. Generated image URL is stored and status updated to "completed"
6. Frontend polls for status updates using React Query's refetchInterval

### Database Schema
- **designs**: Stores design jobs with original image URL, processed image URL, prompt, status (pending/processing/completed/failed), and timestamps
- **conversations/messages**: Chat functionality for AI conversations (Replit integration)

### Key Design Patterns
- **Storage Interface**: `IStorage` interface in storage.ts allows swapping database implementations
- **API Route Contracts**: Shared route definitions in `shared/routes.ts` with Zod validation
- **Component Composition**: shadcn/ui primitives composed into feature components

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connected via `DATABASE_URL` environment variable
- **Drizzle Kit**: Database migrations stored in `/migrations` directory

### AI Services
- **OpenAI API**: Used for image generation (gpt-image-1 model)
  - `AI_INTEGRATIONS_OPENAI_API_KEY`: API key for authentication
  - `AI_INTEGRATIONS_OPENAI_BASE_URL`: Custom base URL for Replit AI Integrations

### Third-Party Libraries
- **Sharp**: Server-side image processing and optimization
- **Multer**: File upload handling with disk storage
- **connect-pg-simple**: PostgreSQL session store (available but may not be active)

### Replit Integrations
The project includes pre-built Replit integration modules in `server/replit_integrations/`:
- **batch/**: Batch processing utilities with rate limiting and retries
- **chat/**: Conversation and message storage with OpenAI chat completions
- **image/**: Image generation and editing utilities

### Frontend Assets
- Panel set templates stored as static images (panels-3.png, panels-5.png, panels-10.png)
- Example gallery images in attached_assets directory
- Google Fonts: Outfit (display) and Plus Jakarta Sans (body)