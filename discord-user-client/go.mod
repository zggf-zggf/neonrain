module github.com/mjacniacki/neonrain/discord-user-client

go 1.24.0

toolchain go1.24.9

require (
	github.com/bwmarrin/discordgo v0.29.0
	github.com/gorilla/websocket v1.5.0
	github.com/joho/godotenv v1.5.1
	go.jetify.com/ai v0.5.0
)

require (
	github.com/google/jsonschema-go v0.3.0 // indirect
	github.com/openai/openai-go/v2 v2.7.1 // indirect
	github.com/tidwall/gjson v1.18.0 // indirect
	github.com/tidwall/match v1.2.0 // indirect
	github.com/tidwall/pretty v1.2.1 // indirect
	github.com/tidwall/sjson v1.2.5 // indirect
	golang.org/x/crypto v0.32.0 // indirect
	golang.org/x/sys v0.38.0 // indirect
)

replace github.com/bwmarrin/discordgo => github.com/beeper/discordgo v0.0.0-20251017213536-db36e39690f0
