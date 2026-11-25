# Huddle

A Meet-style voice room where your AI agents are the teammates. Give each agent a job (Strategist, Developer, Intern…), choose which AI account it runs on, then talk to them out loud. **Only the agent you address answers.**

**Install on a Mac** (recommended: the apps aren't signed with an Apple certificate yet, so a browser download gets blocked as "damaged"/"corrupted"):

```bash
curl -fsSL https://huddle-seven-kappa.vercel.app/install.sh | bash
```

Or, with the Claude Code plugin installed, press **Install Huddle** in the Huddle row.

**Download:** [Mac (Apple Silicon)](https://github.com/shivambisen/huddle/releases/latest/download/Huddle-mac-arm64.dmg) · [Mac (Intel)](https://github.com/shivambisen/huddle/releases/latest/download/Huddle-mac-x64.dmg) · [Windows](https://github.com/shivambisen/huddle/releases/latest/download/Huddle-win-x64.exe) · [Website](https://huddle-seven-kappa.vercel.app)

The apps aren't signed with paid Apple/Microsoft certificates yet. On a Mac, right-click Huddle → **Open** the first time; on Windows, **More info** → **Run anyway**.

Or run from source:

```bash
npm install
npm start          # http://localhost:4317
npm run app        # the desktop app, from source
```

The first run walks you through setup: your name → connect your AI accounts → mic and voice check → create your first team → pre-join lobby → call.

## Huddle inside Claude Code (the easiest way in)

Install the Huddle app once, then the plugin:

```bash
claude plugin marketplace add shivambisen/huddle
claude plugin install huddle@huddle
```

From then on you don't open Huddle yourself:

- **It starts by itself.** Each Claude Code session wakes the Huddle app in the background (no window, no Dock icon; a small ◐ in the menu bar / tray).
- **A Huddle row above the prompt** shows this folder's team and what they're doing, with *Join call*, and *Bring them in* when someone asks for help.
- **The Huddle panel** (`/huddle`) starts a team for the folder, shows who's working and what was said, and has a message box.
- **Calls float.** *Join call* opens a small always-on-top window in the corner of the screen, like Meet's floating call. Expand it for the full call; minimise the full call to float it again.
- **Claude can ask the team.** The plugin gives Claude a `huddle` tool: say *"ask the researcher which DXF libraries are maintained"* in a normal chat and Claude asks, waits for the answer, and uses it.
- **`/huddle Developer, run the tests`** messages the team without joining.

Each agent's own Claude Code / Codex session is saved under a name like "Huddle · Team · Developer"; open it from the agent's menu in a call.

## Teams: three ways to start, no manager

1. **Describe the work.** One quick, cheap model call (Haiku on your Claude login, or ChatGPT) proposes the *smallest* team that fits, often just one person, with a reason for each. You approve, change or remove anyone.
2. **Just an all-rounder.** One capable teammate. When the work needs a specialist it asks (*"✋ can I bring in a Designer?"*) and you approve with a click or *"yes, bring them in"*.
3. **Build it myself.** Pick each teammate, AI, model, effort, voice and skills by hand.

During any call: *"bring in a security reviewer"* adds someone (named after the job, so you can call on them), *"Reviewer, you can drop off"* removes them (they keep their memory on the bench for next time). Nobody leads or manages: everyone talks to you directly, and the casting step is a one-off invite, not a participant.

**Skills:** each Claude teammate gets up to three matching skills from [Anthropic's skills library](https://github.com/anthropics/skills) (frontend-design and webapp-testing for a developer, docx and doc-coauthoring for a writer, …), chosen when the team is assembled. They load only into that teammate's Claude Code session, never into your own setup. Add or remove them on the team page.

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
