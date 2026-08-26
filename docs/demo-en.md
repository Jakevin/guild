# English demo — 60s GIF (G6)

**Goal:** one silent English GIF that makes a GitHub visitor understand Guild in 60s and want to clone.

**Success:** they can say the product in one line — *local bench of bots you @mention, not another omniscient chat* — and they saw a live @mention, not a slideshow.

This is the public asset. Record once as **ProRes/MP4**, export **GIF + 15s cut**. Bots cannot record it. Stitched screenshots are out.

Gate file: `docs/demo.gif` (replace the current Chinese 60s take). X/Show HN attach the same file.

---

## Locked choices

| Item | Decision |
|---|---|
| Length | **60s** README / Show HN. **15s** cut for X |
| Language | **English UI + English captions.** No voiceover |
| Picture | Live desktop at `http://127.0.0.1:7420`. 16:9 or 960×600 |
| Size | GIF **<15MB**, silent |
| Channel | New `#demo` (do not record `#general` — it is Chinese history) |
| People on camera | `@pm` and `@rd` only in the channel. Bench still shows all five |
| Model | Already wired. If a reply takes >8s, abort and retake that beat |
| Not in frame | API keys, `oauth.json`, Harness, sandbox promises, desktop app, GitHub URL (Jakevin/guild) |

Non-goals: brand film, logo lockup, RPG tavern art, Product Hunt trailer, CrewAI comparison, fake typed replies.

---

## Pre-roll (not in the GIF)

Do this before you hit record.

1. Open `http://127.0.0.1:7420` → click **EN** (top locale switch). Chrome must read `Channels / Direct / Bar / Skills / Models`.
2. Hide bookmark bar. Capture the Guild window only (no personal desktop clutter).
3. Create channel `demo`. Invite **only** `@pm` and `@rd`.
4. Confirm a model is selected and a 3-word DM to `@pm` returns. Then delete that test DM from the take — do not record it.
5. Open Bar once so `@pm`’s `SOUL.md` is one click away.
6. Keep this pasteboard ready (three clips). Do not improvise copy on camera.

---

## Pasteboard (type these exact lines)

**Channel.md** (channel icon → Channel.md → Save):

```md
# demo
Job: explain Guild in one minute.
Most important thing: @mention the person you want. Do not start a new feature.
```

**@pm (beat 3):**

```
@pm what is the one most important thing now?
```

**@rd (beat 4):**

```
@rd look at the current repo. Tell me what it is. Do not start a new feature.
```

**SOUL.md — add this as the first line under Voice** (beat 5). Do not rewrite the whole file:

```
Start every reply with "Ship it:" then exactly two short sentences. No bullets.
```

**@pm again (beat 6):** same string as beat 3.

---

## 60s shot list + captions

Captions: 4–8 words, lower-third, English only. Leave them on screen 3–4s. Do not narrate.

| Time | Picture | You do | Caption |
|---|---|---|---|
| 0:00–0:08 | Bar (`/studio`). Pan the five seats `@infra @pm @rd @design @marketing` | Slow pan, no click-spam | Staff a local bench. @mention one. |
| 0:08–0:16 | Chat → `#demo`. Open Channel.md, paste, Save. Close dialog | Channel.md must be readable | A channel has a job. |
| 0:16–0:28 | Composer. Type the @pm line. Send. Wait for the live reply | Cursor visible. Do not scroll away | @pm scopes. Only they reply. |
| 0:28–0:42 | Type the @rd line. Send. Wait. `@rd` should talk about *this repo*, not a new feature | If they start implementing, retake | @rd reads the repo. |
| 0:42–0:52 | Bar → `@pm` → `SOUL.md`. Add the Voice line. Save | The added line must be readable | People are markdown. Edit SOUL.md. |
| 0:52–1:00 | Back to `#demo`. Send the same @pm question. Hold on the new reply (`Ship it:`) | Freeze 2s on the second answer | Same person. Different voice. |

End frame: the second `@pm` reply. No logo card. No URL.

### 15s X cut (from the same take)

| Time | Keep |
|---|---|
| 0:00–0:03 | Five seats |
| 0:03–0:08 | @pm mention + first reply |
| 0:08–0:12 | SOUL.md one-line save |
| 0:12–0:15 | Second @pm reply + caption *Not another omniscient chat.* |

---

## Capture on this Mac

Daemon is already on `:7420`. Chrome and ffmpeg are installed.

```bash
# 1. Record the window (QuickTime → New Screen Recording)
#    or: screencapture -v -T 0 demo-en.mov
# 2. Trim to 60.0s, then:

ffmpeg -i demo-en.mov -t 60 -vf "fps=10,scale=960:-1:flags=lanczos" -loop 0 docs/demo.gif

# size check — must be <15MB
ls -lh docs/demo.gif
```

If GIF >15MB: drop to 8 fps or scale 800px, do not cut the SOUL beat.

X cut:

```bash
ffmpeg -i demo-en.mov -ss 0 -t 15 -c:v libx264 -pix_fmt yuv420p -an docs/demo-15s.mp4
```

---

## Acceptance ( @pm signs )

- [ ] UI chrome is English (`Channels`, `Bar`, `Models`)
- [ ] Five default seats visible in the first 8s
- [ ] Channel.md text is readable
- [ ] `@pm` reply is live (not a pasted screenshot)
- [ ] `@rd` reply is live and about current code
- [ ] One-line `SOUL.md` edit is readable
- [ ] Same `@pm` question, tone visibly changes (`Ship it:`)
- [ ] No Chinese chrome, no `#general` history, no keys
- [ ] Silent, captions English, GIF <15MB
- [ ] File is `docs/demo.gif` (README slot)

Fail → retake the beat. Do not stitch.

---

## Owners

| Who | Does |
|---|---|
| **You** | Record the live session. Only human can. |
| **@pm** | This script + accept against the checklist. |
| **@marketing** | Do not rewrite positioning. Attach the accepted GIF to X / Show HN copy already in `docs/github-launch.md`. |
| **@rd** | Nothing. Do not slip Harness for this. |
| **Bots** | Cannot hit record. Cannot fake the tone change. |

After a pass: drop GIF in the README comment slot, then G7 (`Jakevin` + nod + `git init`) can move. No English GIF → marketing stays in the trusted circle.
