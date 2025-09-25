# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build production bundle
- `npm run lint` - Run ESLint to check code quality
- `npm run preview` - Preview production build locally

## Architecture

This is a React + Vite application for building a real-time AI chat interface with webhook integration. The application provides a sophisticated chat experience with message correlation, connection monitoring, and persistent storage.

### Project Structure

- **Entry Point**: `src/main.jsx` renders the main `App` component into `index.html`
- **Main App**: `src/App.jsx` contains the complex chat interface with real-time communication
- **Components**: `src/components/` contains reusable React components
  - Mix of class-based (`MyComponent.jsx`) and functional components
  - Class components use `this.state` for state management
- **Services**: `src/services/` contains business logic and external integrations
  - `webhookService.js` - Webhook communication with retry logic and correlation
  - `responseListenerService.js` - Real-time response handling via SSE/WebSocket/polling
- **Styling**: Uses CSS files (`App.css`, `index.css`) with class-based styling
- **Build Tool**: Vite 7.1.7 with React plugin and flexible port configuration

### Core Features

- **Real-time Chat Interface**: Full-featured chat UI with message history and status tracking
- **Multi-protocol Communication**: Supports Server-Sent Events, WebSocket, and polling fallback
- **Message Correlation**: Tracks message lifecycle from send to response with unique IDs
- **Connection Management**: Automatic reconnection with exponential backoff
- **Persistent Storage**: Chat history and settings stored in localStorage
- **Mobile Responsive**: Collapsible sidebar with mobile-first design
- **Health Monitoring**: Webhook endpoint health checks and connection status display

## Services Architecture

### Webhook Service (`src/services/webhookService.js`)
- Handles communication with n8n.cloud webhook endpoints
- Implements retry logic with exponential backoff
- Generates UUIDs for message correlation
- Manages session tracking and user identification
- Health check functionality for endpoint monitoring

### Response Listener Service (`src/services/responseListenerService.js`)
- Singleton service for managing real-time responses
- Connection fallback hierarchy: SSE → WebSocket → Polling
- Event-driven architecture with custom event listeners
- Message timeout handling and retry logic
- Connection status management and error handling

## External Dependencies

- **n8n.cloud Integration**:
  - Main webhook: `https://ultimaisolutions.app.n8n.cloud/webhook-test/interface-chat`
  - Response endpoint: `https://ultimaisolutions.app.n8n.cloud/webhook-test/interface-chat/responses`
  - WebSocket: `wss://ultimaisolutions.app.n8n.cloud/webhook-test/interface-chat/ws`
  - Health check: `https://ultimaisolutions.app.n8n.cloud/webhook-test/interface-chat/health`

## Key Technologies

- React 19.1.1 with JSX and hooks
- Vite 7.1.7 for build tooling with React plugin
- ESLint 9.36.0 with modern configuration and React plugins
- TypeScript types for React (development only - pure JavaScript runtime)
- No testing framework currently configured
- Native browser APIs: EventSource, WebSocket, fetch

## Code Patterns

### State Management
- Complex state management with 26+ state variables in main App
- React hooks (`useState`, `useEffect`) for functional components
- Class-based components use `this.state` and lifecycle methods
- State persistence via localStorage for chat history
- Map-based state tracking for message correlation

### Communication Patterns
- Event-driven architecture with custom event listeners
- Promise-based async/await patterns for HTTP requests
- Message correlation using UUIDs for request/response tracking
- Retry mechanisms with exponential backoff
- Graceful fallback between communication protocols

### Error Handling
- Comprehensive try-catch blocks with user-friendly error messages
- Connection retry logic with configurable limits
- Timeout handling for long-running operations
- Health checks with periodic monitoring

### UI/UX Patterns
- Mobile-first responsive design with collapsible sidebar
- Real-time status indicators for connection and message states
- Typing indicators and loading states for better UX
- Form validation with confirmation dialogs
- CSS class-based styling with conditional rendering

### Configuration
- ESLint configured with modern flat config format
- Unused variables ignored for uppercase patterns (constants)
- Vite configured with flexible port handling for development