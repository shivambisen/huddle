# Huddle

A Meet-style voice room where your AI agents are the teammates. Give each agent a job (Strategist, Developer, Intern…), choose which AI account it runs on, then talk to them out loud. **Only the agent you address answers.**

```bash
npm install
npm start          # http://localhost:4317
```

The first run walks you through setup: your name → connect your AI accounts → mic and voice check → create your first team → pre-join lobby → call.

## Bring your own AI (no API keys)

Huddle never stores a key or password. Each teammate runs through an official tool you sign in to with an account you already have. The **Connections** page finds them, installs missing ones, opens sign-in, and has a **Test** button that does a real round-trip.

| Account | Tool Huddle drives | How sign-in works |
|---|---|---|
| Claude (Pro/Max) | Claude Code | `claude auth login` in a Terminal window Huddle opens |
| ChatGPT (Plus/Pro/Team) | Codex (also found inside ChatGPT.app) | `codex login` |
| Google (free tier) | Gemini CLI | `gemini`, then "Login with Google" |
| None: local models | Ollama | download from ollama.com |

You can mix accounts in one team, e.g. Developer on Claude and Intern on ChatGPT.

## Voice: free, local, any browser

- **Your voice → text:** Whisper (`Xenova/whisper-base.en`) runs on the Huddle server. It works in Brave, Safari, Firefox and Chrome. Brave can't use Chrome's built-in recognizer, which is why this is the default. Downloaded once (~75 MB).
- **Agents' replies → voice:** Kokoro-82M, an open neural TTS model, runs locally with 14 natural voices (American/British, female/male). Each teammate gets a distinct voice by default, and you can pick and preview one per teammate. Audio is made sentence by sentence as soon as a reply arrives, so it's usually ready before that agent's turn to speak. Downloaded once (~330 MB). System voices remain as an instant fallback in Settings.
- Hold **Space** (or the mic button) to talk, or switch to open mic.

## Who answers (no talking over each other)

`lib/router.js` routes every message:

1. **Clicked tile / chat "To:"**: only that agent.
2. **A name or nickname** at the start ("Hey intern, …", "Developer and researcher, …") or `@name` anywhere. It tolerates small speech-to-text slips.
3. **"Everyone / team / all, …"**: the whole room; replies take turns.
4. Otherwise the conversation **stays with whoever you last addressed** (or the team lead).

Then the floor rules: agents only act on lines addressed to them, one voice speaks at a time (others show ✋), your voice interrupts them, and in open-mic mode without headphones the mic pauses while agents talk so they never hear each other.

Agents can pass work with a line like `@Developer: …` (max 3 hops). While an agent works, its tile shows live tool activity, and it reports back when done.

## Data & safety

- Teams, settings and transcripts live in `data/` (or `HUDDLE_DATA=/some/dir`). Speech models are cached in `data/models`.
- The server listens on `127.0.0.1` only and rejects requests from other websites, since agents can edit files. Each teammate has a permission level: read only, edit files, or full autonomy.
