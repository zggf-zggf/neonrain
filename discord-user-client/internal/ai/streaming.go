package ai

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"go.jetify.com/ai"
	"go.jetify.com/ai/api"
	"go.jetify.com/ai/provider/openai"
)

// MessageSender defines the interface for sending messages
type MessageSender interface {
	SendMessage(channelID, content string) error
	SendTypingIndicator(channelID string) error
}

// StreamProcessor handles AI streaming and message chunking
type StreamProcessor struct {
	model  *openai.LanguageModel
	sender MessageSender
}

// NewStreamProcessor creates a new stream processor
func NewStreamProcessor(model *openai.LanguageModel, sender MessageSender) *StreamProcessor {
	return &StreamProcessor{
		model:  model,
		sender: sender,
	}
}

// ChunkResult represents the result of processing a stream
type ChunkResult struct {
	Chunks       []string
	FullResponse string
	Error        error
}

// ProcessPrompt processes a prompt with streaming and sends chunks to the sender
// with typing indicators and 90 WPM rate limiting
func (sp *StreamProcessor) ProcessPrompt(ctx context.Context, prompt string, channelID string) *ChunkResult {
	result := &ChunkResult{
		Chunks: []string{},
	}

	// Log the complete prompt being sent to AI
	log.Printf("[AI-PROMPT] Sending to AI:\n%s", prompt)
	log.Printf("[AI-PROMPT] ---END OF PROMPT---")

	// Start typing indicator loop in background
	// Discord typing indicator lasts ~10s, so we refresh every 8s
	stopTyping := make(chan struct{})
	defer close(stopTyping)

	if sp.sender != nil && channelID != "" {
		go sp.typingIndicatorLoop(channelID, stopTyping)
	}

	// Call AI with streaming enabled
	streamResp, err := ai.StreamTextStr(
		ctx,
		prompt,
		ai.WithModel(sp.model),
		ai.WithMaxOutputTokens(500),
	)

	if err != nil {
		result.Error = fmt.Errorf("error getting AI response: %w", err)
		return result
	}

	// Process the stream and send chunks
	buffer := ""
	lastSendTime := time.Now() // Track when we last sent a message

	for event := range streamResp.Stream {
		// Extract text from the event
		eventText := extractTextFromEvent(event)

		// Accumulate streamed text (no per-token logging to reduce noise)
		if eventText != "" {
			buffer += eventText
			result.FullResponse += eventText

			// Check if buffer contains blank line (paragraph separator)
			chunks := extractChunks(&buffer)
			for _, chunk := range chunks {
				if chunk != "" {
					log.Printf("[AI-CHUNK] Sending: %s", chunk)
					result.Chunks = append(result.Chunks, chunk)

					// Send chunk via sender with rate limiting
					if sp.sender != nil && channelID != "" {
						// Calculate delay to simulate 90 WPM typing speed
						// Time since last message includes streaming time
						delay := calculateTypingDelay(chunk, lastSendTime)
						if delay > 0 {
							log.Printf("[AI-RATELIMIT] Delaying %v to simulate 90 WPM", delay)
							time.Sleep(delay)
						}

						if err := sp.sender.SendMessage(channelID, chunk); err != nil {
							log.Printf("[AI] Error sending chunk: %v", err)
						}

						// Track when we sent this message
						lastSendTime = time.Now()
					}
				}
			}
		}
	}

	// Send any remaining buffer content as the final message
	if buffer != "" {
		log.Printf("[AI-CHUNK] Sending final chunk: %s", buffer)
		result.Chunks = append(result.Chunks, buffer)

		if sp.sender != nil && channelID != "" {
			// Calculate delay for final chunk
			delay := calculateTypingDelay(buffer, lastSendTime)
			if delay > 0 {
				log.Printf("[AI-RATELIMIT] Delaying %v to simulate 90 WPM", delay)
				time.Sleep(delay)
			}

			if err := sp.sender.SendMessage(channelID, buffer); err != nil {
				log.Printf("[AI] Error sending final chunk: %v", err)
			}
			// No typing indicator after final chunk
		}
	}

	log.Printf("[AI] Full response: %s", result.FullResponse)
	return result
}

// extractTextFromEvent extracts text content from a stream event
func extractTextFromEvent(event api.StreamEvent) string {
	if textDelta, ok := event.(*api.TextDeltaEvent); ok {
		return textDelta.TextDelta
	}
	return ""
}

// extractChunks extracts complete chunks separated by blank lines from the buffer
// A blank line is defined as two consecutive newlines (\n\n)
// and updates the buffer to contain only the remaining text
func extractChunks(buffer *string) []string {
	var chunks []string

	for {
		// Look for blank line separator: \n\n
		idx := strings.Index(*buffer, "\n\n")
		if idx == -1 {
			// No blank line found, stop extraction
			break
		}

		// Extract the chunk up to (but not including) the blank line
		chunk := strings.TrimSpace((*buffer)[:idx])
		// Remove the chunk and the blank line from buffer
		*buffer = (*buffer)[idx+2:]

		// Only add non-empty chunks
		if chunk != "" {
			chunks = append(chunks, chunk)
		}
	}

	return chunks
}

// calculateTypingDelay calculates the delay needed to simulate 90 WPM typing
// 90 WPM = 90 words per 60 seconds = 1.5 words per second
// Takes into account time already elapsed (e.g., streaming time)
func calculateTypingDelay(text string, lastSendTime time.Time) time.Duration {
	const targetWPM = 90.0
	const secondsPerMinute = 60.0

	// Count words in the text (split by whitespace)
	words := strings.Fields(text)
	wordCount := float64(len(words))

	// Calculate expected time to type this many words at 90 WPM
	expectedSeconds := (wordCount / targetWPM) * secondsPerMinute
	expectedDuration := time.Duration(expectedSeconds * float64(time.Second))

	// Calculate how much time has already elapsed since last send
	// This includes streaming time, so we only delay if needed
	elapsed := time.Since(lastSendTime)

	// If we need more time to match 90 WPM, return the difference
	if expectedDuration > elapsed {
		return expectedDuration - elapsed
	}

	// No delay needed - we're already slow enough
	return 0
}

// countWords counts the number of words in a string
func countWords(text string) int {
	return len(strings.Fields(text))
}

// ProcessPromptWithoutSending processes a prompt with streaming but only returns chunks without sending
func (sp *StreamProcessor) ProcessPromptWithoutSending(ctx context.Context, prompt string) *ChunkResult {
	return sp.ProcessPrompt(ctx, prompt, "")
}

// typingIndicatorLoop sends typing indicators every 8 seconds to keep Discord "typing..." status active
// Discord typing indicators last ~10 seconds, so we refresh before timeout
func (sp *StreamProcessor) typingIndicatorLoop(channelID string, stop <-chan struct{}) {
	// Send initial typing indicator immediately
	if err := sp.sender.SendTypingIndicator(channelID); err != nil {
		log.Printf("[AI-TYPING] Error sending initial typing indicator: %v", err)
		return
	}
	log.Printf("[AI-TYPING] Started typing indicator loop")

	ticker := time.NewTicker(8 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			log.Printf("[AI-TYPING] Stopped typing indicator loop")
			return
		case <-ticker.C:
			if err := sp.sender.SendTypingIndicator(channelID); err != nil {
				log.Printf("[AI-TYPING] Error sending typing indicator: %v", err)
				// Continue loop even on error
			} else {
				log.Printf("[AI-TYPING] Refreshed typing indicator")
			}
		}
	}
}
