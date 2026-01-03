# Web Chat Feature Specification

## Overview

Add a 1v1 chat interface on the website that allows users to chat with their configured HUMA agent directly, separate from Discord integration. The chat uses the same agent configuration (rules, personality, context, information) as the Discord setup.

---

## Requirements Discovery

### Clarifying Questions & Answers

| # | Question | Answer |
|---|----------|--------|
| 1 | **Authentication & Access** - Should web chat be available to only authenticated users (via Clerk), anonymous visitors, or both? | Only authenticated users (Clerk) |
| 2 | **Agent Configuration Scope** - Should the web chat agent use the same config as Discord, separate config, or hybrid? | Everything the same as Discord configuration |
| 3 | **Conversation Persistence** - How should chat history be handled (ephemeral, persistent, TTL, user-controllable)? | Persistent forever |
| 4 | **Multi-conversation Support** - Can users have multiple parallel conversations or single? | Single conversation that resumes between sessions |
| 5 | **Real-time Communication** - WebSocket, SSE, or REST polling? | WebSocket |
| 6 | **Whose Agent?** - How is the agent scoped? | One agent per Discord server/account scope (same as Discord) |
| 7 | **Website Integration Model** - Embedded widget, full page, both, or API-only? | Separate full page with chat spanning most of the view, responsive, simple |
| 8 | **Who chats with the agent?** - Owner only, public access, or both? | Owner only (chat with your own configured agent) |
| 9 | **Message content features** - Plain text, markdown, or rich content? | Markdown rendering, no attachments/images |

---

## Feature Summary

- **Target Users**: Authenticated users (agent owners) only
- **Purpose**: Chat with your own configured HUMA agent outside of Discord
- **Configuration**: Shares personality, rules, and information with Discord setup
- **Persistence**: Single continuous conversation per user, persisted forever
- **Communication**: Real-time via WebSocket
- **UI**: Full-page responsive chat interface with markdown support

---

## Technical Specification

### Prerequisites

- User must be authenticated via Clerk
- User must have a configured Discord server/agent (selectedGuildId)
- Existing HUMA agent configuration (personality, rules, information) will be reused

### Database Schema Changes

```prisma
model ChatConversation {
  id        String   @id @default(uuid())
  userId    String   @unique  // One conversation per user
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages  ChatMessage[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model ChatMessage {
  id             String           @id @default(uuid())
  conversationId String
  conversation   ChatConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String           // "user" | "assistant"
  content        String           @db.Text
  createdAt      DateTime         @default(now())
}
```

### API Endpoints

#### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/chat/conversation` | Get or create user's conversation with message history |
| `GET` | `/api/chat/conversation/messages` | Get paginated message history (for loading older messages) |
| `DELETE` | `/api/chat/conversation` | Delete conversation and all messages |

#### WebSocket Events

**Client → Server:**

| Event | Payload | Description |
|-------|---------|-------------|
| `chat:message` | `{ content: string }` | User sends a message |
| `chat:cancel` | `{}` | Cancel pending bot response |

**Server → Client:**

| Event | Payload | Description |
|-------|---------|-------------|
| `chat:message` | `{ id, role, content, createdAt }` | New message (user echo or bot response) |
| `chat:typing` | `{ isTyping: boolean }` | Bot typing indicator |
| `chat:error` | `{ message: string }` | Error notification |

### HUMA Integration

The web chat will reuse the existing HUMA integration pattern:

1. **Agent Creation**: Use existing agent per user's selected guild
2. **Context Building**: Same structure as Discord, adapted for 1v1:
   ```go
   context := map[string]interface{}{
     "platform": "web_chat",
     "conversationHistory": string,  // Previous messages
     "newMessage": {
       "author":  "User",
       "content": messageText,
     },
     "userInformation": string,      // From user config
     "customRules": string,          // From user config
     "customPersonality": string,    // From user config
     "importantWebsites": [...],     // Scraped content
   }
   ```
3. **Tool Calling**: Same `send_message` tool pattern
4. **Typing Simulation**: Reuse 90 WPM typing delay logic
5. **Message Cancellation**: Support canceling pending responses

### Architecture

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│   Web Frontend  │◄──────────────────►│  Node.js Backend │
│   (Next.js)     │                    │   (Express)      │
└─────────────────┘                    └────────┬────────┘
                                                │
                                                │ WebSocket
                                                ▼
                                       ┌─────────────────┐
                                       │   HUMA API      │
                                       │ (External)      │
                                       └─────────────────┘
```

**Flow:**
1. User opens chat page → WebSocket connection established
2. Backend authenticates via Clerk session
3. User sends message → saved to DB → forwarded to HUMA
4. HUMA processes → calls `send_message` tool
5. Backend receives tool call → simulates typing → sends response
6. Response saved to DB → pushed to client via WebSocket

### Frontend Specification

#### Route
- `/chat` - Full-page chat interface

#### UI Components

```
┌────────────────────────────────────────────────────┐
│  Header (minimal - logo, maybe user avatar)        │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │  Message List (scrollable)                   │  │
│  │                                              │  │
│  │  [Bot] Hello! How can I help?                │  │
│  │                                              │  │
│  │                      [User] What's the API?  │  │
│  │                                              │  │
│  │  [Bot] The API documentation is at...        │  │
│  │                                              │  │
│  │  [Bot is typing...]                          │  │
│  │                                              │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │  [Message input...                     ] [➤] │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

#### Features
- Markdown rendering for bot responses (using react-markdown or similar)
- Auto-scroll to newest messages
- Typing indicator when bot is responding
- Responsive design (mobile-friendly)
- Load more button/infinite scroll for history
- Simple, clean aesthetic matching existing dashboard

#### States to Handle
- Loading (fetching conversation history)
- Empty state (no messages yet)
- Typing state (bot is generating response)
- Error state (connection lost, HUMA unavailable)
- Reconnecting state (WebSocket reconnection)

### Backend Implementation

#### WebSocket Server
- Use `ws` or `socket.io` library
- Authenticate connection using Clerk session/token
- One connection per authenticated user
- Handle reconnection gracefully

#### HUMA Manager Extension
- Extend existing HUMA client for web chat context
- Reuse configuration polling mechanism
- Share agent instances where possible (same guild = same agent config)

#### Message Persistence
- Save all messages immediately (user messages on send, bot messages on receive)
- Support pagination for history retrieval
- Consider indexing on `conversationId` + `createdAt`

### Security Considerations

- All endpoints require Clerk authentication
- WebSocket connections authenticated on handshake
- Rate limiting on message sends (prevent spam)
- Input sanitization for message content
- XSS prevention in markdown rendering (sanitize HTML)

### Error Handling

| Scenario | Handling |
|----------|----------|
| HUMA unavailable | Show error message, allow retry |
| WebSocket disconnect | Auto-reconnect with exponential backoff |
| User not configured | Redirect to dashboard with setup prompt |
| Message send failure | Show error, keep message in input |

---

## Implementation Phases

### Phase 1: Backend Foundation
- [ ] Database schema migration (ChatConversation, ChatMessage)
- [ ] REST endpoints for conversation management
- [ ] WebSocket server setup with Clerk auth

### Phase 2: HUMA Integration
- [ ] Extend HUMA manager for web chat context
- [ ] Implement message flow (user → HUMA → response)
- [ ] Typing simulation and cancellation support

### Phase 3: Frontend
- [ ] Chat page route and layout
- [ ] Message list component with markdown rendering
- [ ] Message input component
- [ ] WebSocket client with reconnection logic
- [ ] Typing indicator

### Phase 4: Polish
- [ ] Error handling and edge cases
- [ ] Loading states and empty states
- [ ] Mobile responsiveness
- [ ] Rate limiting

---

## Open Questions / Future Considerations

- Should there be a way to clear/reset conversation history?
- Should bot responses include timestamps visibly?
- Any analytics/logging requirements?
- Export conversation feature?

---

## Dependencies

### New Packages (Backend)
- `ws` or `socket.io` - WebSocket server

### New Packages (Frontend)
- `react-markdown` - Markdown rendering
- `socket.io-client` or native WebSocket - Client connection

---

## Related Files

### Backend
- `backend/src/routes/chat.ts` (new)
- `backend/src/websocket/` (new directory)
- `backend/prisma/schema.prisma` (update)

### Frontend
- `web/src/app/chat/page.tsx` (new)
- `web/src/components/chat/` (new directory)
- `web/src/lib/websocket.ts` (new)

### Discord Client (Reference)
- `discord-user-client/internal/huma/` - HUMA integration patterns to follow
