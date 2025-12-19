# Implementation Plan: Message History & Third-Person AI Prompting

## Overview

This document outlines the implementation plan for adding conversation history tracking and third-person AI prompting to the Discord client. This is a major architectural change that will enable context-aware AI responses based on conversation history.

## Current State (v0.3.0)

- ✅ AI streaming with paragraph-based chunking
- ✅ Typing indicators
- ✅ 70 WPM rate limiting
- ❌ No conversation history tracking
- ❌ Each message processed independently
- ❌ AI has no context about previous messages

## Target State (v0.4.0)

- ✅ Track last 50 messages per channel
- ✅ Initialize channel history on first message
- ✅ Third-person AI prompting strategy
- ✅ Context-aware AI responses
- ✅ Bot understands conversation flow

---

## Phase 1: Message History Storage ✅ COMPLETED

### Status: ✅ Done

### What Was Built:
- Created `internal/history/message_history.go`
- Thread-safe message storage with `sync.RWMutex`
- Per-channel history management
- Automatic 50-message limit enforcement
- Conversation formatting for AI

### Components:

#### 1.1 Message Structure
```go
type Message struct {
    ID        string  // Discord message ID
    ChannelID string  // Discord channel ID
    Author    string  // Username for display
    AuthorID  string  // User ID
    Content   string  // Message text
    Timestamp string  // Human-readable timestamp
}
```

#### 1.2 MessageHistoryManager
```go
type MessageHistoryManager struct {
    channels map[string]*ChannelHistory
    mu       sync.RWMutex
}
```

**Methods:**
- `NewMessageHistoryManager()` - Constructor
- `GetOrCreateChannel(channelID)` - Get or create channel history
- `IsChannelInitialized(channelID)` - Check if channel loaded
- `InitializeChannel(session, channelID, limit)` - Fetch history from Discord
- `AddMessage(msg)` - Track new incoming message
- `GetMessages(channelID)` - Get message history copy
- `FormatConversation(channelID, botUsername)` - Format for AI
- `GetChannelStats(channelID)` - Get stats (initialized, count)

#### 1.3 Test Coverage
✅ All 8 tests passing:
- Manager creation
- Channel creation and retrieval
- Initialization status
- Message adding
- 50-message limit enforcement
- Empty channel handling
- Conversation formatting
- Statistics retrieval

---

## Phase 2: Discord Client Integration

### Status: 🔄 In Progress

### Goals:
1. Add `MessageHistoryManager` to `DiscordClient`
2. Initialize channel history on first message
3. Track all incoming messages
4. Provide history to AI processing

### Implementation Steps:

#### 2.1 Update DiscordClient Structure

**File:** `internal/client/discord.go`

**Changes:**
```go
type DiscordClient struct {
    session          *discordgo.Session
    token            string
    userEmail        string
    readyHandled     bool
    selectedChannels []types.ChannelInfo
    userPrompt       string
    streamProcessor  *ai.StreamProcessor
    historyManager   *history.MessageHistoryManager  // NEW
    botUsername      string                          // NEW - track bot's username
}
```

**Constructor Update:**
```go
func NewDiscordClient() *DiscordClient {
    return &DiscordClient{
        historyManager: history.NewMessageHistoryManager(),  // NEW
    }
}
```

#### 2.2 Track Bot Username

**When:** During `Connect()` after session is established

**Location:** `internal/client/discord.go` in `Connect()` method

**Implementation:**
```go
// After session.Open() succeeds:
if session.State.User != nil {
    dc.botUsername = session.State.User.Username
    log.Printf("[Discord] Bot username: %s", dc.botUsername)
}
```

#### 2.3 Initialize Channel on First Message

**When:** In `processMessageWithAI()` before AI processing

**Location:** `internal/client/discord.go` in `processMessageWithAI()` method

**Implementation:**
```go
func (dc *DiscordClient) processMessageWithAI(msg *discordgo.MessageCreate) {
    channelID := msg.ChannelID

    // Initialize channel history if needed (first message from this channel)
    if !dc.historyManager.IsChannelInitialized(channelID) {
        log.Printf("[History] Initializing channel %s", channelID)
        if err := dc.historyManager.InitializeChannel(dc.session, channelID, 50); err != nil {
            log.Printf("[History] Warning: Failed to initialize channel: %v", err)
            // Continue anyway - we'll just have less context
        }
    }

    // Add current message to history (BEFORE processing with AI)
    dc.historyManager.AddMessage(msg)

    // Get conversation history
    conversationHistory := dc.historyManager.FormatConversation(channelID, dc.botUsername)

    // Rest of AI processing...
}
```

#### 2.4 Testing Requirements
- Test channel initialization on first message
- Test message tracking on subsequent messages
- Test history retrieval
- Test behavior when initialization fails
- Test concurrent access to multiple channels

---

## Phase 3: Third-Person AI Prompting

### Status: ⏳ Pending

### Goals:
1. Update system prompt to describe bot in third person
2. Format conversation history as single user message
3. Integrate with streaming AI processor

### Specification:

#### 3.1 Third-Person System Prompt

**Concept:** Instead of "You are a helpful assistant...", describe the bot as "User {BotName} is a helpful assistant..."

**Template:**
```
The user will provide a Discord group chat conversation. {BotName} is a helpful AI assistant in this Discord server. {BotName}'s role is to:
- Provide accurate, helpful responses to questions
- Engage in friendly conversation with community members
- Share knowledge and assist with problems
- Maintain a friendly, approachable tone
- Respond naturally to ongoing conversations

{BotName} is knowledgeable, patient, and always tries to provide clear answers. When {BotName} doesn't know something, they admit it honestly.

Your task is to generate the next message that {BotName} might send in response to the conversation.
```

**Dynamic Elements:**
- `{BotName}` - Replace with actual bot username from Discord
- Can be customized per-user via `userPrompt` field

#### 3.2 Conversation History Format

**Format:** Single user message containing full conversation

**Example:**
```
User1: Hey everyone! I'm trying to integrate the new API but getting authentication errors.
User2: I had the same issue yesterday. Did you check your API key format?
User1: Yeah, I copied it directly from the dashboard. Still not working.
BotName: Let me check the status page for you. Can you share the specific error message?
User1: It says 'Invalid authentication credentials' - Error 401.
```

**Implementation:**
```go
func buildThirdPersonPrompt(conversationHistory, botUsername, userCustomPrompt string) string {
    systemPrompt := fmt.Sprintf(`The user will provide a Discord group chat conversation. %s is a helpful AI assistant in this Discord server. %s's role is to:
- Provide accurate, helpful responses to questions
- Engage in friendly conversation with community members
- Share knowledge and assist with problems
- Maintain a friendly, approachable tone
- Respond naturally to ongoing conversations

%s is knowledgeable, patient, and always tries to provide clear answers. When %s doesn't know something, they admit it honestly.`,
        botUsername, botUsername, botUsername, botUsername)

    if userCustomPrompt != "" {
        systemPrompt += "\n\nAdditional instructions:\n" + userCustomPrompt
    }

    systemPrompt += fmt.Sprintf("\n\nYour task is to generate the next message that %s might send in response to the conversation.", botUsername)

    return systemPrompt
}
```

#### 3.3 Integration with AI Streaming

**Current Flow:**
```
User message → Build prompt → Stream AI response → Send chunks
```

**New Flow:**
```
User message → Initialize channel if needed → Add to history →
Get conversation history → Build third-person prompt →
Stream AI response → Send chunks → Add bot response to history
```

**Changes to:** `internal/client/discord.go` in `processMessageWithAI()`

**Before AI Call:**
```go
// Get conversation history
conversationHistory := dc.historyManager.FormatConversation(msg.ChannelID, dc.botUsername)

// Build third-person system prompt
systemPrompt := buildThirdPersonPrompt(conversationHistory, dc.botUsername, dc.userPrompt)

// Build full prompt for AI
fullPrompt := systemPrompt + "\n\nConversation:\n" + conversationHistory
```

**After AI Response:**
```go
// Add bot's response to history
if result.Error == nil && result.FullResponse != "" {
    botMessage := &discordgo.MessageCreate{
        Message: &discordgo.Message{
            ID:        "bot_" + time.Now().Format("20060102150405"),  // Synthetic ID
            ChannelID: msg.ChannelID,
            Content:   result.FullResponse,
            Author: &discordgo.User{
                ID:       dc.session.State.User.ID,
                Username: dc.botUsername,
            },
            Timestamp: time.Now(),
        },
    }
    dc.historyManager.AddMessage(botMessage)
}
```

---

## Phase 4: Update AI Streaming Package

### Status: ⏳ Pending

### Goals:
1. Support system prompt + user message format (third-person)
2. Return full response for history tracking
3. Maintain streaming and chunking behavior

### Implementation:

#### 4.1 Update StreamProcessor

**File:** `internal/ai/streaming.go`

**Current:**
```go
func (sp *StreamProcessor) ProcessPrompt(ctx context.Context, prompt string, channelID string) *ChunkResult
```

**New Signature:**
```go
func (sp *StreamProcessor) ProcessPromptWithHistory(
    ctx context.Context,
    systemPrompt string,    // NEW - third-person system prompt
    conversationHistory string,  // NEW - formatted conversation
    channelID string,
) *ChunkResult
```

**Implementation:**
```go
func (sp *StreamProcessor) ProcessPromptWithHistory(
    ctx context.Context,
    systemPrompt string,
    conversationHistory string,
    channelID string,
) *ChunkResult {
    result := &ChunkResult{
        Chunks: []string{},
    }

    // Send typing indicator before making AI request
    if sp.sender != nil && channelID != "" {
        if err := sp.sender.SendTypingIndicator(channelID); err != nil {
            log.Printf("[AI] Error sending typing indicator: %v", err)
        }
    }

    // Build messages in third-person format
    messages := []ai.Message{
        {Role: "system", Content: systemPrompt},
        {Role: "user", Content: conversationHistory},
    }

    // Call AI with streaming enabled
    streamResp, err := ai.StreamText(
        ctx,
        messages,
        ai.WithModel(sp.model),
        ai.WithMaxOutputTokens(500),
    )

    if err != nil {
        result.Error = fmt.Errorf("error getting AI response: %w", err)
        return result
    }

    // Rest of streaming logic remains the same...
    // (buffering, chunking, rate limiting, typing indicators)
}
```

**Note:** Need to check if `go.jetify.com/ai` supports message array format. If not, concatenate system + user into single prompt.

#### 4.2 Maintain Backward Compatibility

Keep existing `ProcessPrompt` for simple cases:
```go
func (sp *StreamProcessor) ProcessPrompt(ctx context.Context, prompt string, channelID string) *ChunkResult {
    // Simple wrapper for backward compatibility
    return sp.ProcessPromptWithHistory(ctx, "", prompt, channelID)
}
```

---

## Phase 5: Testing & Validation

### Status: ⏳ Pending

### Test Categories:

#### 5.1 Unit Tests

**New Test File:** `internal/client/discord_history_test.go`

**Test Cases:**
- ✅ History manager initialization
- ✅ Channel initialization on first message
- ✅ Message tracking
- ✅ Bot username tracking
- ✅ Third-person prompt generation
- ✅ Conversation formatting

#### 5.2 Integration Tests

**Test Scenarios:**
1. **Cold Start:**
   - Bot receives first message in channel
   - Verify channel initialization (50 messages fetched)
   - Verify AI gets conversation context

2. **Ongoing Conversation:**
   - Multiple users exchange messages
   - Verify each message added to history
   - Verify AI responses reference previous context

3. **Multiple Channels:**
   - Messages from different channels
   - Verify histories kept separate
   - Verify concurrent access safety

4. **History Limit:**
   - Send >50 messages
   - Verify oldest messages dropped
   - Verify only last 50 kept

5. **Bot's Own Messages:**
   - Verify bot's responses added to history
   - Verify AI sees its own previous responses
   - Verify proper attribution (bot username)

#### 5.3 Demo Updates

**File:** `test/demo/streaming_demo.go`

**Updates Needed:**
- Mock conversation history
- Show third-person prompting
- Demonstrate context-aware responses

**New Demo:** `test/demo/conversation_demo.go`
- Simulate multi-user conversation
- Show how AI references previous messages
- Demonstrate third-person perspective

---

## Phase 6: Documentation Updates

### Status: ⏳ Pending

### Files to Update:

#### 6.1 README.md

**New Section: "Conversation History & Context"**

```markdown
## Conversation History & Context

The bot maintains context of ongoing conversations by tracking message history.

### How It Works

1. **Channel Initialization**: When bot receives first message from a channel, it fetches the last 50 messages
2. **Continuous Tracking**: All new messages (including bot's own) are added to history
3. **Rolling Window**: Only last 50 messages kept per channel
4. **Context-Aware**: AI receives full conversation context for better responses

### Third-Person Prompting

The bot uses a unique "third-person" prompting strategy:
- Bot is described as "User {BotName} is a helpful assistant..."
- Entire conversation provided as context
- AI generates next message bot would send
- More natural multi-user conversation handling

### Example

```
User1: What's the weather like?
User2: It's sunny here!
Bot: Great weather for outdoor activities!
User1: @Bot what about tomorrow?
Bot: [Sees conversation history, knows "tomorrow" refers to weather forecast]
```
```

#### 6.2 CHANGELOG.md

**New Version: v0.4.0**

```markdown
## [v0.4.0] - 2025-10-28

### Added

#### 1. Conversation History Tracking
- Track last 50 messages per channel
- Automatic channel initialization on first message
- Thread-safe concurrent access
- Rolling window (oldest messages dropped)

#### 2. Third-Person AI Prompting
- Bot described in third person in system prompt
- Full conversation context provided
- More natural multi-user conversation handling
- Context-aware responses

### Changed
- AI now receives conversation history
- Prompting strategy changed to third-person
- Bot responses include context from previous messages

### Technical Details
- New package: `internal/history`
- `MessageHistoryManager` for history tracking
- `ChannelHistory` per-channel storage
- Thread-safe with `sync.RWMutex`
```

#### 6.3 ARCHITECTURE.md (New File)

Document the complete architecture including history management.

---

## Implementation Checklist

### Phase 1: Message History Storage ✅
- [x] Create `internal/history/message_history.go`
- [x] Implement `MessageHistoryManager`
- [x] Implement `ChannelHistory`
- [x] Add thread-safety with mutexes
- [x] Create comprehensive tests
- [x] All tests passing

### Phase 2: Discord Client Integration
- [ ] Add `historyManager` to `DiscordClient`
- [ ] Track `botUsername` during connection
- [ ] Initialize channel on first message
- [ ] Add messages to history as they arrive
- [ ] Handle initialization errors gracefully
- [ ] Add unit tests for integration

### Phase 3: Third-Person AI Prompting
- [ ] Create `buildThirdPersonPrompt()` function
- [ ] Format conversation history
- [ ] Replace current prompt with third-person version
- [ ] Add bot's responses to history after sending
- [ ] Test prompt generation

### Phase 4: Update AI Streaming
- [ ] Create `ProcessPromptWithHistory()` method
- [ ] Support system + user message format
- [ ] Maintain backward compatibility
- [ ] Update tests for new method
- [ ] Verify streaming still works

### Phase 5: Testing & Validation
- [ ] Write unit tests for new features
- [ ] Create integration test scenarios
- [ ] Update demo applications
- [ ] Test with real Discord conversations
- [ ] Performance testing (50+ messages)

### Phase 6: Documentation
- [ ] Update README.md
- [ ] Update CHANGELOG.md
- [ ] Create ARCHITECTURE.md
- [ ] Update QUICKSTART.md
- [ ] Document third-person prompting strategy

---

## Risk Analysis & Mitigation

### Risk 1: Performance Impact
**Risk:** Fetching 50 messages on every new channel could be slow

**Mitigation:**
- Fetch happens only once per channel
- Asynchronous initialization (don't block message processing)
- Error handling (continue with empty history if fetch fails)

### Risk 2: Memory Usage
**Risk:** Storing 50 messages × many channels = high memory

**Mitigation:**
- 50 messages is reasonable (~50KB per channel)
- Most servers have <10 active channels
- Can adjust limit via configuration if needed

### Risk 3: Context Window Limits
**Risk:** 50 messages might exceed AI model's context window

**Mitigation:**
- GPT-4 supports ~8K tokens
- 50 messages ≈ 2-3K tokens (well within limit)
- Can implement token counting and truncation if needed

### Risk 4: Third-Person Prompting Quality
**Risk:** Third-person might produce worse responses than first-person

**Mitigation:**
- Thoroughly test with various conversation types
- Compare quality with first-person baseline
- Keep ability to switch back if needed
- User feedback collection

### Risk 5: Race Conditions
**Risk:** Concurrent message processing could corrupt history

**Mitigation:**
- Thread-safe implementation with `sync.RWMutex`
- Comprehensive concurrency tests
- Proper locking in all methods

---

## Success Criteria

### Functional Requirements
✅ Bot tracks last 50 messages per channel
✅ Bot initializes channel history on first message
✅ Bot uses third-person prompting strategy
✅ Bot provides context-aware responses
✅ All existing features still work (streaming, typing, rate limiting)

### Non-Functional Requirements
✅ Thread-safe for concurrent access
✅ Performance: <100ms overhead for history operations
✅ Memory: <1MB per active channel
✅ All tests passing (>90% coverage)
✅ Documentation complete and accurate

### User Experience
✅ Bot understands conversation context
✅ Bot references previous messages appropriately
✅ Bot handles multi-user conversations naturally
✅ No noticeable latency increase

---

## Timeline Estimate

- **Phase 1:** ✅ Completed (2 hours)
- **Phase 2:** 2-3 hours (Discord integration)
- **Phase 3:** 1-2 hours (Third-person prompting)
- **Phase 4:** 1-2 hours (AI streaming updates)
- **Phase 5:** 2-3 hours (Testing)
- **Phase 6:** 1 hour (Documentation)

**Total:** ~10-13 hours

---

## Next Steps

1. Continue with Phase 2: Discord Client Integration
2. Add history manager to DiscordClient struct
3. Implement channel initialization logic
4. Test with mock Discord messages
5. Proceed to Phase 3 once integration is stable

---

## Questions & Decisions

### Q1: How many messages to fetch initially?
**Decision:** 50 messages (good balance between context and performance)

### Q2: First-person vs Third-person prompting?
**Decision:** Third-person (as specified in requirements)

### Q3: Store bot's own messages?
**Decision:** Yes (AI needs to see its own responses for context)

### Q4: What if channel initialization fails?
**Decision:** Log warning and continue with empty history (graceful degradation)

### Q5: Handle message edits/deletes?
**Decision:** Future enhancement (not in v0.4.0 scope)

---

## Appendix A: Code Structure

```
discord-user-client/
├── internal/
│   ├── history/              # NEW
│   │   ├── message_history.go
│   │   └── message_history_test.go
│   ├── client/
│   │   ├── discord.go        # MODIFIED - add history integration
│   │   ├── discord_test.go
│   │   └── discord_history_test.go  # NEW
│   └── ai/
│       ├── streaming.go      # MODIFIED - add third-person support
│       └── streaming_test.go # MODIFIED
├── test/demo/
│   ├── streaming_demo.go     # MODIFIED
│   └── conversation_demo.go  # NEW
├── IMPLEMENTATION_PLAN.md    # This file
├── ARCHITECTURE.md           # NEW
├── README.md                 # MODIFIED
└── CHANGELOG.md              # MODIFIED
```

---

## Appendix B: Example Third-Person Conversation

**Input to AI:**
```
System: The user will provide a Discord group chat conversation. BotHelper is a helpful AI assistant in this Discord server. BotHelper's role is to provide accurate responses, engage in friendly conversation, and assist with problems. Your task is to generate the next message that BotHelper might send.

User: Alice: Hey everyone! I'm trying to deploy my app but getting errors.
Bob: What kind of errors?
Alice: It says "port 3000 already in use"
BotHelper: That usually means another process is using port 3000. Try running 'lsof -i :3000' to find it.
Alice: Thanks! Found it and killed the process.
Bob: @BotHelper is there a way to automatically pick an available port?
```

**Expected Output:**
```
Yes! You can use environment variables or let your framework auto-assign ports. For example, in Node.js: const PORT = process.env.PORT || 3000
```

