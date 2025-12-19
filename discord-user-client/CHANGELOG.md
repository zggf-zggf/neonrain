# Changelog

## [v0.4.2] - 2025-10-28

### Added

#### Continuous Typing Indicator Loop
- **Background goroutine**: Sends typing indicator every 8 seconds during AI processing
- **Prevents timeout**: Discord typing indicators last ~10s, loop keeps status active
- **Automatic cleanup**: Stops when response completes
- **Better UX**: Users see continuous "typing..." for long responses (>10s)

### Changed

#### Improved System Prompt for Context Awareness
- **Old**: "The user will provide a Discord conversation" (AI didn't understand it had context)
- **New**: "Below is a Discord group chat conversation" (explicit that context is provided)
- **Added**: "Reference previous messages when relevant"
- **Added**: "based on the conversation context"
- **Result**: AI now properly uses conversation history

#### Required Username Prefix in AI Responses
- **Problem**: AI inconsistently included "username: " prefix
- **Solution**: System prompt now **requires** format: `"BotName: [message]"`
- **Implementation**:
  - `messageSenderWrapper` strips prefix before sending to Discord
  - `stripUsernamePrefix()` function handles prefix removal
  - Ensures consistency across all responses

### Fixed

#### AI Not Accessing Conversation History
- **Issue**: AI said "I can't access previous messages" despite having full history
- **Cause**: Ambiguous prompt wording
- **Fix**: Clearer instructions that conversation IS provided in the prompt
- **Result**: AI now references and uses conversation context properly

#### Inconsistent Username Prefix in Messages
- **Issue**: Messages appearing as "zggf: Hi there!" in Discord
- **Cause**: AI sometimes included username prefix, sometimes didn't
- **Fix**:
  - Always require prefix in AI response
  - Strip before sending to Discord
  - Store with prefix in history for consistency
- **Result**: Clean messages in Discord, consistent history tracking

### Technical Details

**typingIndicatorLoop() (internal/ai/streaming.go:212-239):**
```go
func (sp *StreamProcessor) typingIndicatorLoop(channelID string, stop <-chan struct{}) {
    // Send initial indicator
    sp.sender.SendTypingIndicator(channelID)

    ticker := time.NewTicker(8 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-stop:  // ProcessPrompt done
            return
        case <-ticker.C:  // Refresh every 8s
            sp.sender.SendTypingIndicator(channelID)
        }
    }
}
```

**Lifecycle:**
1. `ProcessPrompt()` creates `stopTyping` channel
2. Launches `typingIndicatorLoop()` in goroutine
3. Loop sends indicator immediately, then every 8s
4. When `ProcessPrompt()` returns, `defer close(stopTyping)` stops loop
5. Clean shutdown, no indicator spam after response

**messageSenderWrapper (internal/client/discord.go:32-45):**
```go
type messageSenderWrapper struct {
    client   *DiscordClient
    username string
}

func (w *messageSenderWrapper) SendMessage(channelID, content string) error {
    cleaned := stripUsernamePrefix(content, w.username)
    return w.client.SendMessage(channelID, cleaned)
}
```

**Log output:**
```
[AI-TYPING] Started typing indicator loop
[AI-STREAM] Received: BotName
[AI-STREAM] Received: :
[AI-STREAM] Received:  Hello
[AI-TYPING] Refreshed typing indicator
[AI-STREAM] Received: ...
[AI-TYPING] Refreshed typing indicator
[AI-CHUNK] Sending: BotName: Hello there!
[AI-TYPING] Stopped typing indicator loop
```

### Testing

**New test: TestStripUsernamePrefix** - 5 test cases:
- ✅ Standard prefix removal
- ✅ No prefix (pass-through)
- ✅ Wrong username (not stripped)
- ✅ Username in content (only prefix stripped)
- ✅ Empty message edge case

All tests passing ✓

### Performance Impact

- **Typing indicator**: +1 Discord API call every 8s during processing
- **Typical response**: 2-4 indicators (16-32s response time)
- **No spam**: Loop stops immediately when response completes
- **Minimal overhead**: Lightweight goroutine, ticker-based

### Benefits

1. **Better UX**: Users always see "typing..." status for long responses
2. **Context-aware AI**: Bot properly references conversation history
3. **Clean messages**: No username prefixes leaking into Discord
4. **Consistency**: All responses follow same format
5. **Professional appearance**: Continuous typing status mimics human behavior

## [v0.4.1] - 2025-10-28

### Fixed

#### Rate Limiting Calculation Bug
- **Issue**: Rate limiting was adding delay on top of streaming time, not accounting for time already spent
- **Example**: 19-word response taking 2s to stream would add 14.9s delay (total 16.9s) instead of just 14.3s
- **Fix**: Changed to track `lastSendTime` instead of `chunkStartTime`, so elapsed time includes streaming
- **Result**: Now correctly delays only `max(0, expected_time - elapsed_time)`

### Changed

#### Increased WPM from 70 to 90
- **Old behavior**: 70 WPM = ~12.8s delay for 15 words
- **New behavior**: 90 WPM = ~10s delay for 15 words
- **Rationale**: Faster, more responsive bot while still appearing human-like
- **Formula**: `(words / 90) * 60 seconds - elapsed_time`

#### Updated Files:
- `internal/ai/streaming.go`:
  - Renamed `chunkStartTime` → `lastSendTime` for clarity
  - Changed `targetWPM` from 70.0 to 90.0
  - Updated log messages to say "90 WPM" instead of "70 WPM"
  - Updated comments to reflect accurate behavior
  - `lastSendTime` now tracks when we last sent a message (including streaming time)

- `README.md`:
  - Updated all references from 70 WPM to 90 WPM
  - Updated example delays
  - Added note: "Accounts for streaming time (only adds delay if needed)"

### Technical Details

**Before (buggy):**
```go
chunkStartTime := time.Now() // Set once before streaming starts
// ... streaming happens (takes 2s) ...
delay := calculateTypingDelay(chunk, chunkStartTime) // Uses old start time
// Result: delay = 16.3s - 0s = 16.3s (wrong! doesn't count streaming time)
```

**After (fixed):**
```go
lastSendTime := time.Now() // Track when we last sent
// ... streaming happens (takes 2s) ...
delay := calculateTypingDelay(chunk, lastSendTime) // Counts elapsed time
// Result: delay = 10.8s - 2s = 8.8s (correct!)
lastSendTime = time.Now() // Reset for next chunk
```

### Example Timing (90 WPM)

**19-word response:**
- Expected time at 90 WPM: `(19 / 90) * 60 = 12.67s`
- Streaming time: `2s`
- Delay added: `12.67 - 2 = 10.67s`
- **Total time: 12.67s** ✓ (matches 90 WPM)

**Before fix (buggy):**
- Delay added: `12.67s` (didn't subtract streaming time)
- **Total time: 14.67s** ✗ (slower than 90 WPM)

## [v0.4.0] - 2025-10-28

### Added

#### 1. Conversation History Tracking
- **Message Storage**: Automatically tracks last 50 messages per channel
- **Channel Initialization**: Fetches historical messages on first interaction
- **Rolling Window**: Maintains most recent messages, drops oldest when limit exceeded
- **Multi-Channel Support**: Independent history for each Discord channel
- **Thread-Safe**: Uses `sync.RWMutex` for concurrent access

**Implementation:**
- New `internal/history` package with `MessageHistoryManager`
- `ChannelHistory` struct tracks messages, initialization state, and limits
- `InitializeChannel()` fetches past messages from Discord API
- `AddMessage()` adds new messages with automatic limit enforcement
- `GetMessages()` retrieves conversation history
- `FormatConversation()` formats history for AI prompting

#### 2. Third-Person Prompting Strategy
- **Perspective Shift**: AI sees bot as external participant, not as itself
- **Conversation Format**: Full chat transcript provided to AI
- **Natural Flow**: Better multi-user conversation understanding
- **Role Clarity**: Reduces AI confusion about its identity
- **Custom Instructions**: User prompts integrated into third-person context

**Prompt Structure:**
```
System: The user will provide a Discord conversation from channel #general.
BotName is a helpful AI assistant in this server. BotName's role is to:
- Provide accurate, helpful responses
- Engage in friendly conversation
- [Custom user instructions]

Conversation:
Alice: What is Go?
Bob: It's a programming language
Alice: Can you tell me more?

Your task: Generate the next message that BotName might send.
```

#### 3. Context-Aware AI Responses
- **Historical Context**: AI receives full conversation history
- **Response Tracking**: Bot's own responses added to history
- **Coherent Conversations**: Bot remembers previous exchanges
- **Multi-Turn Dialogue**: Natural conversation flow across messages

**Benefits:**
- Bot can reference earlier messages
- Understands conversation context and flow
- Provides more relevant, contextual responses
- Maintains topic continuity across turns

### Changed

#### Updated Files:

**`internal/history/message_history.go`** (NEW):
- `MessageHistoryManager` with thread-safe channel tracking
- `ChannelHistory` structure with 50-message limit
- `SessionInterface` for testable Discord API calls
- Message storage with author, content, timestamp
- Conversation formatting for AI prompts

**`internal/history/message_history_test.go`** (NEW):
- 8 comprehensive unit tests
- Tests for initialization, message adding, limits, formatting
- Mock-free testing using public API

**`internal/client/discord.go`**:
- Added `historyManager *history.MessageHistoryManager` field
- Added `botUsername string` field (tracked from Ready event)
- Updated `NewDiscordClient()` to initialize history manager
- Modified Ready handler to capture bot username
- Completely rewrote `processMessageWithAI()`:
  - Initialize channel on first message
  - Add incoming message to history
  - Retrieve conversation history
  - Build third-person prompt
  - Add bot response to history after processing
- Created `buildThirdPersonPrompt()` function:
  - Describes bot in third person
  - Includes conversation history
  - Integrates custom user instructions
  - Instructs AI to generate next message

**`internal/client/discord_history_test.go`** (NEW):
- 8 integration tests for history features
- `MockSession` implementing `SessionInterface`
- Tests for channel initialization, history limits
- Tests for third-person prompt generation
- Tests for conversation formatting
- Tests for multi-channel independence
- Tests for bot response tracking

**`internal/history/message_history.go`**:
- Updated `InitializeChannel()` to use `SessionInterface`
- Enables testing without real Discord session

### Technical Details

#### History Management:
```go
type MessageHistoryManager struct {
    channels map[string]*ChannelHistory
    mu       sync.RWMutex
}

type ChannelHistory struct {
    ChannelID    string
    Messages     []Message
    Initialized  bool
    MaxMessages  int
    mu           sync.RWMutex
}
```

#### Message Flow:
1. New message arrives from Discord
2. Check if channel is initialized
3. If not, fetch last 50 messages via `InitializeChannel()`
4. Add new message to history
5. Format conversation history
6. Build third-person prompt with history
7. Send to AI for processing
8. Add bot's response to history

#### Conversation Formatting:
```
Alice: Hello everyone!
BotHelper: Hi Alice! How can I help?
Bob: What's the weather?
BotHelper: I don't have access to weather data, sorry!
Alice: No worries, thanks anyway.
```

### Testing

All tests passing:
```bash
go test ./...
# ok  	github.com/mjacniacki/neonrain/discord-user-client/internal/ai	0.003s
# ok  	github.com/mjacniacki/neonrain/discord-user-client/internal/backend	0.002s
# ok  	github.com/mjacniacki/neonrain/discord-user-client/internal/client	0.003s
# ok  	github.com/mjacniacki/neonrain/discord-user-client/internal/history	0.002s
# ok  	github.com/mjacniacki/neonrain/discord-user-client/internal/server	0.004s
```

New test coverage:
- **History Manager**: 8 tests (initialization, adding, limits, formatting, stats)
- **Discord Integration**: 8 tests (history integration, prompt generation, tracking)
- **Total**: 16 new tests, all passing

### Breaking Changes

**None** - This is fully backward compatible:
- History tracking is automatic and transparent
- No API changes for existing functionality
- No configuration changes required
- Existing code continues to work unchanged

### Benefits

1. **Context Awareness**: Bot understands conversation flow and history
2. **Natural Conversations**: Third-person prompting enables better multi-user interactions
3. **Coherence**: Bot remembers previous messages and its own responses
4. **Scalability**: Thread-safe design supports concurrent channel access
5. **Testability**: SessionInterface enables comprehensive unit testing
6. **Memory Efficient**: Rolling 50-message window prevents unbounded growth

### Performance Impact

- **Memory**: ~50 messages × ~500 bytes average = ~25KB per channel
- **Initialization**: One-time API call per channel (~100-300ms)
- **Ongoing**: Minimal overhead (in-memory operations)
- **Concurrency**: Lock-based synchronization, negligible contention

### Future Improvements

Potential enhancements:
- Configurable history limit (currently fixed at 50)
- Persistent storage (currently in-memory only)
- Message search and retrieval by time range
- Conversation summarization for very long histories
- Per-user history tracking
- History export/import functionality

## [v0.3.0] - 2025-10-28

### Changed

#### Chunk Separator: Blank Lines Instead of Period-Space
- **Old behavior**: Chunks split at `. ` (period followed by space)
- **New behavior**: Chunks split at `\n\n` (blank line / paragraph break)

**Rationale:**
- More natural paragraph-based chunking
- Preserves multi-sentence paragraphs together
- Better for longer, structured responses
- Allows single newlines within paragraphs
- No issues with decimals (3.14), URLs, or abbreviations

**Examples:**
```
Old (period-space):
"AI is great. It helps people." → 2 chunks: ["AI is great.", "It helps people."]

New (blank lines):
"AI is great. It helps people.\n\nMore info here." → 2 chunks:
  ["AI is great. It helps people.", "More info here."]
```

#### Updated Files:
- `internal/ai/streaming.go`:
  - Changed `extractChunks()` to look for `\n\n` instead of `. `
  - Updated comments to reflect paragraph-based chunking
  - Trims whitespace from extracted chunks

- `internal/ai/streaming_test.go`:
  - Rewrote all test cases for blank line behavior
  - Added tests for multi-line paragraphs
  - Added edge cases: multiple blank lines, Windows line endings

- `test/demo/streaming_demo.go`:
  - Updated prompts to encourage blank line separation
  - Changed from 3 to 2 test prompts (focused on paragraphs)

- `README.md`:
  - Updated "Paragraph-Based Chunking" feature description
  - Changed algorithm step 4 from `. ` to `\n\n`
  - Updated examples to show paragraph behavior
  - Added key behaviors section

### Testing

All tests updated and passing:
```bash
go test ./...
# All packages: PASS
```

Test coverage for chunking logic:
- Single paragraph with blank line
- Multiple paragraphs
- Incomplete paragraph (no trailing blank line)
- Multi-line paragraphs with blank line separator
- Edge cases: multiple blank lines, Windows line endings

### Breaking Changes

**Chunking Behavior:**
- Messages are now split at paragraph breaks, not sentences
- AI responses must include blank lines (`\n\n`) for chunking
- Single sentences won't auto-chunk unless separated by blank lines

**Migration:**
- Update AI prompts to request paragraph formatting
- Example: "Write a response in 3 paragraphs. Separate paragraphs with blank lines."

### Benefits

1. **Better Structure**: Keeps related sentences together in paragraphs
2. **Flexibility**: Works with any content that has paragraph breaks
3. **Cleaner**: No issues with periods in numbers, URLs, or abbreviations
4. **Natural**: Matches how humans write (paragraph-based communication)

## [v0.2.0] - 2025-10-28

### Added

#### 1. Typing Indicators
- **Before AI Request**: Sends typing indicator to Discord before making OpenAI API call
- **Between Chunks**: Sends typing indicator after each chunk (except the last one)
- Creates natural "user is typing..." experience in Discord
- Keeps typing status active throughout the response generation

**Implementation:**
- Extended `MessageSender` interface with `SendTypingIndicator(channelID string) error`
- Discord client implements via `session.ChannelTyping(channelID)`
- Demo implements with console output for testing

#### 2. 70 WPM Rate Limiting
- Simulates natural human typing speed
- Prevents Discord spam detection
- Calculates delay based on word count in each chunk

**Formula:**
```
words_in_chunk / 70 WPM * 60 seconds = delay_in_seconds
```

**Examples:**
- 10 words → ~8.6 seconds delay
- 15 words → ~12.9 seconds delay
- 20 words → ~17.1 seconds delay

**Implementation:**
- `calculateTypingDelay()` function in `internal/ai/streaming.go`
- Uses `strings.Fields()` to count words
- Compares expected time vs elapsed time
- Only delays if needed (won't slow down if already slow)

### Changed

#### Updated Files:
- `internal/ai/streaming.go`:
  - Added `time` import
  - Extended `MessageSender` interface
  - Updated `ProcessPrompt()` with typing indicators and rate limiting
  - Added `calculateTypingDelay()` helper function
  - Added `countWords()` helper function

- `internal/client/discord.go`:
  - Implemented `SendTypingIndicator()` method
  - Uses `session.ChannelTyping()` Discord API call
  - Added logging for typing indicator events

- `test/demo/streaming_demo.go`:
  - Implemented `SendTypingIndicator()` for demo
  - Outputs typing events to console

- `internal/ai/streaming_test.go`:
  - Updated `MockMessageSender` with typing indicator tracking
  - Added `typingIndicators` counter field
  - Implemented `SendTypingIndicator()` method

### Technical Details

#### Typing Indicator Behavior:
- Discord typing indicator lasts ~10 seconds
- Must be re-sent to keep status active
- Sent before each chunk ensures continuous "typing..." status
- Not sent after final chunk (allows status to clear naturally)

#### Rate Limiting Logic:
```go
// For a chunk: "This is a test sentence."
// Words: 5
// Target: 70 WPM
// Expected time: (5 / 70) * 60 = 4.29 seconds
// If AI streamed in 0.5 seconds: delay = 4.29 - 0.5 = 3.79 seconds
```

#### Log Output:
```
[AI] Processing message from #general - user123: What is AI?
[Discord] Typing indicator sent to channel
[AI-STREAM] Received: AI
[AI-STREAM] Received: is
...
[AI-CHUNK] Sending: AI is a transformative technology.
[AI-RATELIMIT] Delaying 12.3s to simulate 70 WPM
[AI] Chunk sent to #general
[Discord] Typing indicator sent to channel
```

### Testing

All existing tests pass:
```bash
go test ./...
# ok  	github.com/mjacniacki/neonrain/discord-user-client/internal/ai	0.003s
# ok  	github.com/mjacniacki/neonrain/discord-user-client/internal/backend	(cached)
# ok  	github.com/mjacniacki/neonrain/discord-user-client/internal/client	0.002s
# ok  	github.com/mjacniacki/neonrain/discord-user-client/internal/server	0.003s
```

Quick test demonstrates features:
```bash
go run ./test/demo/quick_demo.go
# [TYPING] Typing indicator sent
# [AI-STREAM] Received: AI
# [AI-STREAM] Received: is
# ...
# [AI-RATELIMIT] Delaying 14.3s to simulate 70 WPM
# [MESSAGE] AI is a transformative technology...
```

### Benefits

1. **More Human-Like**: Typing indicators and rate limiting make bot behavior indistinguishable from human users
2. **Spam Prevention**: 70 WPM rate limiting prevents Discord from flagging the account
3. **Better UX**: Users see typing status and know response is coming
4. **Chunked Updates**: Long responses appear progressively with typing indicators between chunks

### Breaking Changes

**Interface Change:**
```go
// Old interface
type MessageSender interface {
    SendMessage(channelID, content string) error
}

// New interface
type MessageSender interface {
    SendMessage(channelID, content string) error
    SendTypingIndicator(channelID string) error
}
```

**Migration:** All implementations of `MessageSender` must add the `SendTypingIndicator()` method.

### Performance Impact

- **Typing indicators**: ~50-100ms per API call (negligible)
- **Rate limiting**: Intentional delays (8-20 seconds typical per chunk)
- **Overall**: Responses take longer but appear more natural

### Future Improvements

Potential enhancements:
- Configurable WPM (allow customization)
- Adaptive rate limiting based on message history
- Option to disable rate limiting for urgent responses
- Per-user typing speed profiles
