# Huddle

A Meet-style voice room where your AI agents are the teammates. Create a project, give each agent a role (Strategist, Developer, Intern…), choose what each one runs on, then talk to them. **Only the agent you address answers.**

```bash
npm install
npm start          # http://localhost:4317
```

## Bring your own AI (no API keys)

Huddle never holds a key. Each role runs through a tool you've already signed in to on this machine:

| Provider | Sign in |
|---|---|
| Claude Code | `claude`, then `/login` with your Claude account (Pro/Max plan works) |
| Codex | `codex login` → Sign in with ChatGPT |
| Gemini CLI | run `gemini` and log in with Google (free tier) |
| Ollama | local models, free: `ollama pull llama3.2` |

You can mix them in one room, e.g. Developer on Claude Code and Researcher on Gemini.

## Who answers (the fix for agents talking over each other)

`lib/router.js` routes every message:

1. **Clicked tile / chat "To:"**: only that agent.
2. **A name or nickname** at the start of the sentence ("Hey intern, …", "Developer and researcher, …") or `@name` anywhere. It tolerates one-letter speech-to-text slips.
3. **"Everyone / team / all, …"**: the whole room; replies take turns.
4. Otherwise the conversation **stays with whoever you last addressed** (or the project lead).

The agents also follow floor rules: they only act on lines marked "(to you)", one voice speaks at a time (others show ✋), your voice interrupts them, and in open-mic mode the mic pauses while agents talk so they never hear each other.

Agents can pass work along with a line like `@Developer: …` (max 3 hops). Long-running work shows live tool activity on the agent's tile, and the agent reports back when it's done.

## Voice

Free and keyless: the browser's built-in SpeechRecognition and speechSynthesis. Voice input needs Chrome or Edge (Chrome sends audio to Google's speech service; Safari and Firefox can use chat). Hold **Space** or the mic button to talk, or switch to open mic.

## Safety

The server listens on `127.0.0.1` only and rejects requests from other web origins, since agents can edit files in the project folder. Each role has a permission level: read-only, edit files, or full autonomy.
