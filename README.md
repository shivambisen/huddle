# Huddle

A Meet-style voice room where your AI agents are the teammates. Give each agent a job (Strategist, Developer, Intern…), choose which AI account it runs on, then talk to them out loud. **Only the agent you address answers.**

**Download:** [Mac (Apple Silicon)](https://github.com/shivambisen/huddle/releases/latest/download/Huddle-mac-arm64.dmg) · [Mac (Intel)](https://github.com/shivambisen/huddle/releases/latest/download/Huddle-mac-x64.dmg) · [Windows](https://github.com/shivambisen/huddle/releases/latest/download/Huddle-win-x64.exe) · [Website](https://huddle-seven-kappa.vercel.app)

The apps aren't signed with paid Apple/Microsoft certificates yet. On a Mac, right-click Huddle → **Open** the first time; on Windows, **More info** → **Run anyway**.

Or run from source:

```bash
npm install
npm start          # http://localhost:4317
npm run app        # the desktop app, from source
```

The first run walks you through setup: your name → connect your AI accounts → mic and voice check → create your first team → pre-join lobby → call.

## Huddle inside Claude Code

The `claude-plugin/` folder is a Claude Code plugin. It adds a **Huddle row above the prompt** (your team for the current folder, what they're doing, *Join call*), a **live Huddle panel** (who's working, recent lines, a message box), a **status line** entry during calls, and **`/huddle`** (`/huddle Developer, run the tests` messages the team).

Install it from Huddle (Connections → **Add to Claude Code**), or:

```bash
claude plugin marketplace add shivambisen/huddle
claude plugin install huddle@huddle
```

Each agent's own Claude Code / Codex session is also saved under a name like "Huddle · Team · Developer"; open it from the agent's menu in a call.

## Building the apps

`npm run dist:mac` / `npm run dist:win` build locally. Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds Mac (Apple Silicon and Intel) and Windows on GitHub and publishes a release.

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

## Feels like a meeting, not a chat

- **Agents think out loud.** Every reply starts with a short spoken line ("Sure, let me check the code") that plays within ~2 seconds, then brief progress, then a one-to-two sentence outcome. Details go to the chat, not your ears.
- **One live process per agent.** Claude agents keep a Claude Code process open for the whole call (stream-json in and out), so there's no boot time per turn. Processes start while you join and close 10 minutes after everyone leaves.
- **Model and effort per agent, changeable mid-call.** Hover a tile → ⋮, or use the People panel. The agent restarts with the new settings and keeps its memory of the call. Lower effort answers faster; Sonnet/Haiku at Low effort is the snappiest.
- **It waits for you to finish.** If you keep talking before an agent has started using tools, it stops and replies to everything you said.
- **Agents stay quiet when they have nothing to add** to an "everyone" question, and only hand work to a teammate when you asked them to.

## Who answers (no talking over each other)

`lib/router.js` routes every message:

1. **Clicked tile / chat "To:"**: only that agent.
2. **A name or nickname** at the start ("Hey intern, …", "Developer and researcher, …") or `@name` anywhere. It tolerates small speech-to-text slips.
3. **"Everyone / team / all, …"**: the whole room; replies take turns.
4. **"Who here…", "Does anyone…", "any of you"** anywhere in the sentence: everyone.
5. No name at all: if you're still mid-thought (within a few seconds), the same people; if an agent just asked you a question, that agent; otherwise a small fast model (Haiku on your Claude login) reads the last few lines and guesses, falling back to whoever you last talked to after 3 seconds.

Then the floor rules: agents only act on lines addressed to them, one voice speaks at a time (others show ✋), your voice interrupts them, and in open-mic mode without headphones the mic pauses while agents talk so they never hear each other.

Agents can pass work with a line like `@Developer: …` (max 3 hops). While an agent works, its tile shows live tool activity, and it reports back when done.

## Data & safety

- Teams, settings and transcripts live in `data/` (or `HUDDLE_DATA=/some/dir`). Speech models are cached in `data/models`.
- The server listens on `127.0.0.1` only and rejects requests from other websites, since agents can edit files. Each teammate has a permission level: read only, edit files, or full autonomy.
