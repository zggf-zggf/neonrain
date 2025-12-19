# Discord User Client with AI Streaming

A Go-based Discord client service that monitors Discord channels and provides AI-powered responses using streaming technology. Messages are intelligently chunked at sentence boundaries for natural, real-time communication.

## Quick Start

**Try the demo (one-liner, no Discord needed):**
```bash
cd /home/mjacniacki/kodzik/neonrain/discord-user-client && source ~/.bashrc && go run ./test/demo/streaming_demo.go
```

This will show you how AI responses are streamed and chunked in real-time!

## Features

- **AI-Powered Responses**: Integrates with OpenAI's GPT-4o model
- **Conversation History**: Automatically tracks and maintains last 50 messages per channel
- **Context-Aware AI**: Uses conversation history to provide relevant, contextual responses
- **Third-Person Prompting**: AI is described as an external participant for natural conversation flow
- **Streaming Responses**: Real-time message streaming with smart chunking
- **Paragraph-Based Chunking**: Automatically splits responses at blank lines (paragraph breaks)
- **Typing Indicators**: Shows "typing..." status in Discord before and between chunks
- **90 WPM Rate Limiting**: Natural typing speed simulation (prevents spam detection)
- **Multi-Channel Monitoring**: Monitor multiple Discord channels simultaneously
- **Dynamic Configuration**: Update channels and prompts without restart
- **HTTP API**: RESTful endpoints for Discord guilds and channels
- **Comprehensive Testing**: Unit tests for all major components

## Project Structure

```
discord-user-client/
├── cmd/
│   └── discord-client/
│       └── main.go              # Application entry point
├── internal/
│   ├── ai/
│   │   ├── streaming.go         # AI streaming & chunking logic
│   │   └── streaming_test.go    # Tests for streaming
│   ├── backend/
│   │   ├── config.go            # Backend API client
│   │   └── config_test.go       # Tests for backend client
│   ├── client/
│   │   ├── discord.go           # Discord client logic
│   │   ├── discord_test.go      # Tests for Discord client
│   │   └── discord_history_test.go # Tests for history integration
│   ├── history/
│   │   ├── message_history.go   # Conversation history management
│   │   └── message_history_test.go # Tests for history manager
│   └── server/
│       ├── http.go              # HTTP server handlers
│       └── http_test.go         # Tests for HTTP server
├── pkg/
│   └── types/
│       └── types.go             # Shared type definitions
├── test/
│   └── demo/
│       └── streaming_demo.go    # Interactive streaming demo
├── bin/                         # Compiled binaries (gitignored)
├── go.mod
├── go.sum
└── README.md
```

## Installation

### Prerequisites

- Go 1.24.0 or higher
- OpenAI API key
- Backend service running (for token management)

### Build

```bash
# Build the main application
go build -o bin/discord-client ./cmd/discord-client

# Build the streaming demo
go build -o bin/streaming-demo ./test/demo

# Run tests
go test ./...
```

## Configuration

Set the following environment variables:

```bash
# Required
export OPENAI_API_KEY="your-openai-api-key"

# Optional (with defaults)
export BACKEND_URL="http://localhost:3000"     # Backend API URL
export INTERNAL_API_KEY="default-internal-key" # Backend API key
export HTTP_PORT="8080"                        # HTTP server port
```

Or create a `.env` file:

```env
OPENAI_API_KEY=your-openai-api-key
BACKEND_URL=http://localhost:3000
INTERNAL_API_KEY=your-internal-key
HTTP_PORT=8080
```

## Usage

### Running the Main Application

```bash
# With environment variables
./bin/discord-client

# Or with .env file
./bin/discord-client
```

The application will:
1. Connect to the backend API to fetch Discord tokens
2. Establish Discord WebSocket connection
3. Monitor selected channels for messages
4. Process messages with AI streaming
5. Send chunked responses back to Discord

### Running the Streaming Demo

Test AI streaming without Discord or backend services.

**Quick start (one-liner):**
```bash
cd /home/mjacniacki/kodzik/neonrain/discord-user-client && source ~/.bashrc && go run ./test/demo/streaming_demo.go
```

Or use the provided script:
```bash
./run-demo.sh
```

Or build and run manually:
```bash
source ~/.bashrc  # Load OPENAI_API_KEY from your bashrc
go build -o bin/streaming-demo ./test/demo
./bin/streaming-demo
```

The demo will:
- Send test prompts to OpenAI
- Stream responses in real-time
- Display chunking behavior
- Show timing and statistics

Example output:
```
=== AI Streaming Demo - Discord Message Chunking ===

AI Model initialized: gpt-4o

--- Test 1/3 ---
Prompt: Explain what is AI in 2-3 sentences.

Streaming response...
[AI-STREAM] Received: AI
[AI-STREAM] Received: ,
[AI-STREAM] Received:  or
[AI-STREAM] Received:  artificial
[AI-STREAM] Received:  intelligence
...
[AI-CHUNK] Sending: AI, or artificial intelligence, refers to the simulation of human intelligence.

[17:19:00] Sending to #demo-channel: AI, or artificial intelligence, refers to the simulation of human intelligence.

[AI-CHUNK] Sending: It involves the development of algorithms and models.

[17:19:01] Sending to #demo-channel: It involves the development of algorithms and models.

Streaming complete!
  Duration: 2.3s
  Chunks sent: 2
  Total characters: 124

Full response: AI, or artificial intelligence, refers to the simulation of human intelligence. It involves the development of algorithms and models.
```

## Conversation History & Context-Aware AI

### How History Tracking Works

The bot automatically maintains conversation context to provide relevant, coherent responses:

**Initialization:**
1. When a new message arrives from an untracked channel, the bot fetches the last 50 messages
2. These messages are stored in memory for that channel
3. The channel is marked as "initialized"

**Ongoing Tracking:**
1. Each new message (from users and the bot) is added to the history
2. The bot maintains a rolling window of the last 50 messages per channel
3. Oldest messages are dropped when the limit is exceeded

**Context Usage:**
1. When processing a message, the bot retrieves the full conversation history
2. The history is formatted as a conversation transcript
3. The transcript is included in the AI prompt for contextual awareness

### Third-Person Prompting Strategy

The bot uses a unique "third-person perspective" approach for more natural conversations:

**Traditional approach (first-person):**
```
System: You are BotHelper, a helpful AI assistant...
User: What is Go?
Assistant: [Bot responds as "I"]
```

**Our approach (third-person):**
```
System: The user will provide a Discord conversation. BotHelper is a helpful AI assistant in this server...

Conversation:
Alice: What is Go?
Bob: It's a programming language
Alice: Can you tell me more?

Your task: Generate the next message that BotHelper might send.
```

**Benefits:**
- More natural conversation flow
- Bot sees itself as a participant, not the entire conversation
- Better understanding of multi-user dynamics
- Reduces AI confusion about its role
- Enables more natural turn-taking in group chats

### Example Conversation with History

```
# First message (channel initialized with 50 past messages)
User1: Hey BotHelper, what's the weather like?
Bot: [Responds using context from previous 50 messages]

# Second message (bot remembers first exchange)
User2: Can you also tell me the time?
Bot: [Responds knowing both questions, understands conversation flow]

# Third message (bot tracks its own responses)
User1: Thanks! That's helpful.
Bot: [Responds naturally, remembering what it said before]
```

## How Streaming Works

### Smart Chunking Algorithm with Typing Indicators

1. **Initial Typing Indicator**: Show "typing..." in Discord before AI request
2. **Stream Reception**: Receive text deltas from AI model in real-time
3. **Buffer Accumulation**: Accumulate incoming text in a buffer
4. **Boundary Detection**: Search for `\n\n` (blank line / paragraph break)
5. **Chunk Extraction**: Extract complete paragraphs when blank lines found
6. **Rate Limiting**: Calculate delay to simulate 70 WPM typing speed
7. **Chunk Sending**: Send chunk to Discord after appropriate delay
8. **Continue Typing**: Send typing indicator after each chunk (keeps status active)
9. **Final Flush**: Send remaining buffer when stream completes

### Typing Indicator & Rate Limiting

**Typing Indicators:**
- Sent before making AI request
- Sent after each chunk (except the last)
- Creates natural "user is typing..." experience
- Lasts ~10 seconds per indicator in Discord

**90 WPM Rate Limiting:**
- Calculates words in each chunk
- Delays sending based on formula: `(words / 90) * 60 seconds`
- Accounts for streaming time (only adds delay if needed)
- Prevents Discord spam detection
- Example: 15-word sentence = ~10 second delay
- Makes bot behavior appear more human-like

### Example

Given streaming response with blank lines:
```
First paragraph about AI.
It's a transformative technology.

Second paragraph explaining benefits.
AI helps automate tasks.

Final thoughts.
```

**Discord receives 3 separate messages:**
1. `"First paragraph about AI.\nIt's a transformative technology."`
2. `"Second paragraph explaining benefits.\nAI helps automate tasks."`
3. `"Final thoughts."`

**Key behaviors:**
- Blank lines (`\n\n`) act as paragraph separators
- Single newlines within paragraphs are preserved
- Multiple blank lines are treated as one separator
- Whitespace is trimmed from chunks
- Multi-line paragraphs stay together

## API Endpoints

### Health Check

```bash
GET /health
```

Response:
```json
{
  "status": "connected"  // or "disconnected"
}
```

### List Guilds

```bash
GET /guilds
```

Response:
```json
{
  "success": true,
  "guilds": [
    {
      "id": "123456789",
      "name": "My Server",
      "icon": "icon_hash"
    }
  ]
}
```

### List Channels

```bash
GET /channels?guild_id=123456789
```

Response:
```json
{
  "success": true,
  "channels": [
    {
      "id": "987654321",
      "name": "general",
      "type": 0
    }
  ]
}
```

## Testing

### Run All Tests

```bash
go test ./...
```

### Run Specific Package Tests

```bash
# Test AI streaming logic
go test ./internal/ai

# Test backend client
go test ./internal/backend

# Test Discord client
go test ./internal/client

# Test HTTP server
go test ./internal/server
```

### Test Coverage

```bash
go test -cover ./...
```

## Architecture

### Package Responsibilities

- **cmd/discord-client**: Application entry point and orchestration
- **internal/ai**: AI streaming logic and message chunking
- **internal/backend**: Backend API communication
- **internal/client**: Discord connection and message handling
- **internal/history**: Conversation history tracking and management
- **internal/server**: HTTP API endpoints
- **pkg/types**: Shared data structures
- **test/demo**: Interactive demonstrations

### Key Interfaces

```go
// MessageSender - Interface for sending messages and typing indicators
type MessageSender interface {
    SendMessage(channelID, content string) error
    SendTypingIndicator(channelID string) error
}

// SessionInterface - Interface for Discord session operations (used by history manager)
type SessionInterface interface {
    ChannelMessages(channelID string, limit int, beforeID, afterID, aroundID string, options ...discordgo.RequestOption) ([]*discordgo.Message, error)
}
```

**MessageSender benefits:**
- Easy testing with mock senders
- Swapping Discord for other platforms
- Demo mode without actual Discord connection

**SessionInterface benefits:**
- Testable history initialization
- Decoupled from concrete Discord session type
- Enables unit testing without Discord API calls

## Development

### Adding New Features

1. **New AI Provider**: Implement in `internal/ai/`
2. **New Message Platform**: Implement `MessageSender` interface
3. **New API Endpoints**: Add to `internal/server/http.go`
4. **Configuration Options**: Update `pkg/types/types.go`

### Code Style

- Follow Go conventions and idiomatic patterns
- Write tests for all new functionality
- Document exported functions and types
- Keep packages focused and cohesive

## Troubleshooting

### Common Issues

**"OPENAI_API_KEY environment variable is required"**
- Ensure OpenAI API key is set in environment or .env file

**"No Discord session active"**
- Check backend service is running
- Verify Discord token is valid
- Check logs for connection errors

**Messages not chunking properly**
- Verify the AI model outputs sentences with proper punctuation
- Check logs for `[AI-STREAM]` and `[AI-CHUNK]` entries
- Test with the demo application first

### Debug Logging

The application provides detailed logging:
- `[AI]` - Main AI processing events
- `[AI-STREAM]` - Individual streaming tokens received
- `[AI-CHUNK]` - Chunks being sent to Discord
- `[AI-RATELIMIT]` - Rate limiting delays
- `[HISTORY]` - Conversation history operations
- `[Discord]` - Discord API operations

Example logs:
```
[HISTORY] Initializing channel channel123
[HISTORY] Channel channel123 initialized with 50 messages
[AI] Processing message from #general - user123: What is AI?
[Discord] Typing indicator sent to channel
[AI-STREAM] Received: AI
[AI-STREAM] Received: stands
[AI-STREAM] Received: for
[AI-STREAM] Received: Artificial
[AI-STREAM] Received: Intelligence.
[AI-STREAM] Received:
[AI-CHUNK] Sending: AI stands for Artificial Intelligence.
[AI-RATELIMIT] Delaying 6.7s to simulate 90 WPM
[AI] Chunk sent to #general
[HISTORY] Added message to channel123 (total: 51)
```

## Performance Considerations

- **Streaming Latency**: First chunk typically arrives within 1-2 seconds
- **Chunk Size**: Average 10-30 words per chunk (sentence-dependent)
- **Memory**: Minimal buffering (only incomplete sentence)
- **Concurrency**: Message processing is handled asynchronously

## Security Notes

- **Never commit your `.env` file**
- **Never share your Discord user token**
- Your token gives full access to your Discord account
- Using user tokens for automation may violate Discord's Terms of Service
- Consider this for educational/testing purposes only

## License

See parent project license.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## Support

For issues and questions:
- Check troubleshooting section
- Review test examples
- Run the demo application
- Check application logs
