package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/joho/godotenv"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/ai"
	"go.jetify.com/ai/provider/openai"
)

// DemoMessageSender implements the MessageSender interface for demo purposes
type DemoMessageSender struct {
	channelName string
}

func (d *DemoMessageSender) SendMessage(channelID, content string) error {
	timestamp := time.Now().Format("15:04:05")
	fmt.Printf("\n[%s] Sending to #%s: %s\n", timestamp, d.channelName, content)
	return nil
}

func (d *DemoMessageSender) SendTypingIndicator(channelID string) error {
	timestamp := time.Now().Format("15:04:05")
	fmt.Printf("[%s] Typing indicator sent to #%s\n", timestamp, d.channelName)
	return nil
}

func main() {
	// Load .env file
	_ = godotenv.Load()

	// Check for OpenAI API key
	if os.Getenv("OPENAI_API_KEY") == "" {
		log.Fatal("❌ OPENAI_API_KEY environment variable is required")
	}

	fmt.Println("=== AI Streaming Demo - Discord Message Chunking ===")
	fmt.Println()

	// Initialize AI model
	aiModel := openai.NewLanguageModel("gpt-4o")
	fmt.Println("AI Model initialized: gpt-4o")

	// Create demo message sender
	sender := &DemoMessageSender{channelName: "demo-channel"}

	// Create stream processor
	processor := ai.NewStreamProcessor(aiModel, sender)
	fmt.Println()

	// Test prompts - encourage blank line separation
	prompts := []string{
		"Explain what is AI in 2 paragraphs. Separate paragraphs with a blank line.",
		"List 3 benefits of renewable energy. Put each benefit in its own paragraph separated by blank lines.",
	}

	for i, prompt := range prompts {
		fmt.Printf("\n--- Test %d/%d ---\n", i+1, len(prompts))
		fmt.Printf("Prompt: %s\n", prompt)
		fmt.Println()

		// Process the prompt
		ctx := context.Background()
		startTime := time.Now()

		fmt.Println("Streaming response...")

		result := processor.ProcessPrompt(ctx, prompt, "demo-channel")

		duration := time.Since(startTime)

		if result.Error != nil {
			fmt.Printf("Error: %v\n", result.Error)
		} else {
			fmt.Printf("\nStreaming complete!\n")
			fmt.Printf("  Duration: %v\n", duration)
			fmt.Printf("  Chunks sent: %d\n", len(result.Chunks))
			fmt.Printf("  Total characters: %d\n", len(result.FullResponse))
			fmt.Println()
			fmt.Printf("Full response: %s\n", result.FullResponse)
		}

		// Wait before next prompt
		if i < len(prompts)-1 {
			fmt.Println("\nWaiting 2 seconds before next test...")
			time.Sleep(2 * time.Second)
		}
	}

	fmt.Println("\n=== Demo completed successfully! ===")
	fmt.Println("\nKey observations:")
	fmt.Println("  - Messages are chunked at period-space ('. ') boundaries")
	fmt.Println("  - Each chunk is sent immediately when detected")
	fmt.Println("  - Remaining text is sent as final chunk")
	fmt.Println("  - Numbers like 3.14 are preserved (no space after period)")
	fmt.Println()
}
