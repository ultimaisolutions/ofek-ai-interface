# AI Chat Interface

A sophisticated real-time AI chat interface built with React and Vite, featuring webhook integration, message correlation, and multi-protocol communication support.

## ✨ Features

- **Real-time Chat Interface** - Full-featured chat UI with message history and status tracking
- **Multi-protocol Communication** - Supports Server-Sent Events, WebSocket, and polling fallback
- **Message Correlation** - Tracks message lifecycle from send to response with unique IDs
- **Connection Management** - Automatic reconnection with exponential backoff
- **Persistent Storage** - Chat history and settings stored in localStorage
- **Mobile Responsive** - Collapsible sidebar with mobile-first design
- **Health Monitoring** - Webhook endpoint health checks and connection status display

## 🛠️ Tech Stack

### Frontend
- **React 19.1.1** - Modern React with hooks and JSX
- **Vite 7.1.7** - Fast build tool with React plugin
- **CSS3** - Class-based styling with responsive design

### Communication
- **Server-Sent Events (SSE)** - Primary real-time communication method
- **WebSocket** - Secondary fallback for real-time updates
- **HTTP Polling** - Final fallback for maximum compatibility
- **Fetch API** - Modern HTTP client for webhook requests

### Development Tools
- **ESLint 9.36.0** - Code quality and consistency
- **React DevTools** - Development and debugging support
- **TypeScript Types** - Type definitions (development only)

### External Integration
- **n8n.cloud** - Webhook endpoints for AI processing
- **UUID Generation** - Message correlation and tracking
- **localStorage** - Client-side data persistence

## 🚀 Getting Started

### Prerequisites
- **Node.js** (version 16 or higher)
- **npm** (comes with Node.js)

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repository-url>
   ```

2. **Navigate to the project directory**
   ```bash
   cd ai-interface
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   - The application will be available at `http://localhost:5173`
   - Vite will automatically open your default browser
   - Hot reload is enabled for development

## 📜 Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build production bundle for deployment |
| `npm run lint` | Run ESLint to check code quality |
| `npm run preview` | Preview production build locally |

## 📁 Project Architecture

```
src/
├── main.jsx              # Application entry point
├── App.jsx               # Main chat interface component
├── App.css               # Application styles
├── components/           # Reusable React components
│   └── MyComponent.jsx   # Example component (class-based)
└── services/             # Business logic and external integrations
    ├── webhookService.js          # n8n webhook communication
    └── responseListenerService.js # Real-time response handling
```

### Key Components

- **App.jsx** - Main chat interface with 26+ state variables for complex UI management
- **webhookService.js** - Handles communication with n8n.cloud endpoints, retry logic, and health checks
- **responseListenerService.js** - Singleton service managing real-time responses with connection fallback

### Communication Flow

1. **User Input** → Webhook Service → n8n.cloud AI Processing
2. **AI Response** → Response Listener Service → Real-time UI Update
3. **Message Correlation** → UUID tracking throughout the entire flow
4. **Connection Management** → Automatic fallback: SSE → WebSocket → Polling

## ⚙️ Configuration

### Webhook Endpoints
The application connects to n8n.cloud endpoints:
- **Main Webhook**: `https://ultimaisolutions.app.n8n.cloud/webhook-test/interface-chat`
- **Response Endpoint**: `https://ultimaisolutions.app.n8n.cloud/webhook-test/interface-chat/responses`
- **WebSocket**: `wss://ultimaisolutions.app.n8n.cloud/webhook-test/interface-chat/ws`
- **Health Check**: `https://ultimaisolutions.app.n8n.cloud/webhook-test/interface-chat/health`

### Development Configuration
- **Port**: Vite uses port 5173 by default with flexible fallback
- **Hot Reload**: Enabled for all React components and services
- **ESLint**: Configured with modern flat config format
- **Mobile Responsive**: Breakpoint at 768px for mobile/desktop layouts

## 🔧 Development Notes

### State Management
- Uses React hooks (`useState`, `useEffect`) for functional components
- Complex state with Map-based message correlation tracking
- Persistent storage via localStorage for chat history
- Event-driven architecture with custom event listeners

### Error Handling
- Comprehensive try-catch blocks with user-friendly messages
- Connection retry logic with exponential backoff
- Timeout handling for long-running operations
- Health checks with periodic monitoring

### Code Patterns
- Promise-based async/await for HTTP requests
- Event-driven communication between components
- Mobile-first responsive design principles
- Form validation with confirmation dialogs

## 📱 Mobile Support

The interface is fully responsive with:
- Collapsible sidebar for mobile devices
- Touch-friendly interface elements
- Optimized layout for screens < 768px
- Swipe gestures and mobile navigation patterns

## 🤝 Contributing

1. Follow the existing code patterns and conventions
2. Use ESLint for code quality checks
3. Test on both desktop and mobile viewports
4. Ensure all webhook integrations work properly
5. Maintain the event-driven architecture patterns

## 📄 License

This project is part of the IBM Full Stack Development course curriculum.