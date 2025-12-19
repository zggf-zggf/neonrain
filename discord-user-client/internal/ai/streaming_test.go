package ai

import (
	"testing"
)

// MockMessageSender is a mock implementation of MessageSender for testing
type MockMessageSender struct {
	messages        []string
	typingIndicators int
	errors          []error
}

func (m *MockMessageSender) SendMessage(channelID, content string) error {
	m.messages = append(m.messages, content)
	if len(m.errors) > 0 {
		err := m.errors[0]
		m.errors = m.errors[1:]
		return err
	}
	return nil
}

func (m *MockMessageSender) SendTypingIndicator(channelID string) error {
	m.typingIndicators++
	return nil
}

func TestExtractChunks(t *testing.T) {
	tests := []struct {
		name           string
		input          string
		expectedChunks []string
		expectedBuffer string
	}{
		{
			name:           "Single paragraph with blank line",
			input:          "Hello world\n\n",
			expectedChunks: []string{"Hello world"},
			expectedBuffer: "",
		},
		{
			name:           "Multiple paragraphs",
			input:          "First paragraph\n\nSecond paragraph\n\n",
			expectedChunks: []string{"First paragraph", "Second paragraph"},
			expectedBuffer: "",
		},
		{
			name:           "Incomplete paragraph",
			input:          "Hello world",
			expectedChunks: []string{},
			expectedBuffer: "Hello world",
		},
		{
			name:           "Paragraph with trailing text",
			input:          "Hello world\n\nMore text",
			expectedChunks: []string{"Hello world"},
			expectedBuffer: "More text",
		},
		{
			name:           "Text with single newline (not blank line)",
			input:          "Line one\nLine two\nLine three",
			expectedChunks: []string{},
			expectedBuffer: "Line one\nLine two\nLine three",
		},
		{
			name:           "Multiple paragraphs with incomplete",
			input:          "First\n\nSecond\n\nThird",
			expectedChunks: []string{"First", "Second"},
			expectedBuffer: "Third",
		},
		{
			name:           "Empty string",
			input:          "",
			expectedChunks: []string{},
			expectedBuffer: "",
		},
		{
			name:           "Multi-line paragraph with blank line separator",
			input:          "Line 1\nLine 2\nLine 3\n\nNext paragraph",
			expectedChunks: []string{"Line 1\nLine 2\nLine 3"},
			expectedBuffer: "Next paragraph",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			buffer := tt.input
			chunks := extractChunks(&buffer)

			// Check chunks
			if len(chunks) != len(tt.expectedChunks) {
				t.Errorf("Expected %d chunks, got %d", len(tt.expectedChunks), len(chunks))
			}
			for i, chunk := range chunks {
				if i < len(tt.expectedChunks) && chunk != tt.expectedChunks[i] {
					t.Errorf("Chunk %d: expected '%s', got '%s'", i, tt.expectedChunks[i], chunk)
				}
			}

			// Check remaining buffer
			if buffer != tt.expectedBuffer {
				t.Errorf("Expected buffer '%s', got '%s'", tt.expectedBuffer, buffer)
			}
		})
	}
}

func TestExtractChunks_Iterative(t *testing.T) {
	// Simulate streaming: add text incrementally
	buffer := ""
	var allChunks []string

	// Stream 1: "Good"
	buffer += "Good"
	chunks := extractChunks(&buffer)
	allChunks = append(allChunks, chunks...)

	if len(chunks) != 0 {
		t.Errorf("Expected 0 chunks after 'Good', got %d", len(chunks))
	}
	if buffer != "Good" {
		t.Errorf("Expected buffer 'Good', got '%s'", buffer)
	}

	// Stream 2: " question"
	buffer += " question"
	chunks = extractChunks(&buffer)
	allChunks = append(allChunks, chunks...)

	if len(chunks) != 0 {
		t.Errorf("Expected 0 chunks after 'Good question', got %d", len(chunks))
	}

	// Stream 3: "\n\n"
	buffer += "\n\n"
	chunks = extractChunks(&buffer)
	allChunks = append(allChunks, chunks...)

	if len(chunks) != 1 || chunks[0] != "Good question" {
		t.Errorf("Expected chunk 'Good question', got %v", chunks)
	}
	if buffer != "" {
		t.Errorf("Expected empty buffer, got '%s'", buffer)
	}

	// Stream 4: "Let me"
	buffer += "Let me"
	chunks = extractChunks(&buffer)
	allChunks = append(allChunks, chunks...)

	if len(chunks) != 0 {
		t.Errorf("Expected 0 chunks after 'Let me', got %d", len(chunks))
	}

	// Stream 5: " think\n\n"
	buffer += " think\n\n"
	chunks = extractChunks(&buffer)
	allChunks = append(allChunks, chunks...)

	if len(chunks) != 1 || chunks[0] != "Let me think" {
		t.Errorf("Expected chunk 'Let me think', got %v", chunks)
	}

	// Stream 6: "Done"
	buffer += "Done"
	chunks = extractChunks(&buffer)
	allChunks = append(allChunks, chunks...)

	// Final buffer should contain "Done"
	if buffer != "Done" {
		t.Errorf("Expected buffer 'Done', got '%s'", buffer)
	}

	// Verify all chunks
	expectedAllChunks := []string{"Good question", "Let me think"}
	if len(allChunks) != len(expectedAllChunks) {
		t.Errorf("Expected %d total chunks, got %d", len(expectedAllChunks), len(allChunks))
	}
}

func TestExtractChunks_EdgeCases(t *testing.T) {
	t.Run("Multiple blank lines", func(t *testing.T) {
		buffer := "Hello\n\n\n\nWorld"
		chunks := extractChunks(&buffer)

		// Should extract first chunk at first blank line, and continue processing
		// \n\n extracts "Hello", leaves "\n\nWorld"
		// \n\n in "\n\nWorld" extracts "", leaves "World"
		if len(chunks) != 1 || chunks[0] != "Hello" {
			t.Errorf("Expected 1 chunk 'Hello', got %v", chunks)
		}
		// After processing all blank lines, buffer should just contain "World"
		if buffer != "World" {
			t.Errorf("Expected buffer 'World', got '%s'", buffer)
		}
	})

	t.Run("Blank line at end without trailing text", func(t *testing.T) {
		buffer := "Hello\n\n"
		chunks := extractChunks(&buffer)

		if len(chunks) != 1 || chunks[0] != "Hello" {
			t.Errorf("Expected 1 chunk 'Hello', got %v", chunks)
		}
		if buffer != "" {
			t.Errorf("Expected empty buffer, got '%s'", buffer)
		}
	})

	t.Run("Text with Windows line endings", func(t *testing.T) {
		buffer := "First\r\n\r\nSecond"
		chunks := extractChunks(&buffer)

		// Should NOT match because looking for \n\n, not \r\n\r\n
		if len(chunks) != 0 {
			t.Errorf("Expected 0 chunks (Windows line endings not supported), got %d", len(chunks))
		}
	})
}

func TestProcessPromptWithoutSending_MockSender(t *testing.T) {
	// This test verifies the mock sender works, but doesn't test actual AI
	// since we can't mock the AI SDK easily without dependency injection

	mockSender := &MockMessageSender{}

	// Test that mock sender collects messages
	err := mockSender.SendMessage("channel1", "Test message 1")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	err = mockSender.SendMessage("channel1", "Test message 2")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if len(mockSender.messages) != 2 {
		t.Errorf("Expected 2 messages, got %d", len(mockSender.messages))
	}

	if mockSender.messages[0] != "Test message 1" {
		t.Errorf("Expected first message 'Test message 1', got '%s'", mockSender.messages[0])
	}

	if mockSender.messages[1] != "Test message 2" {
		t.Errorf("Expected second message 'Test message 2', got '%s'", mockSender.messages[1])
	}
}
