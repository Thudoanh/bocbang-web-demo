# Bóc Băng AI — UI State Specification

This document translates the BA's business states and interaction rules into frontend presentation requirements.

## 1. Meeting / job lifecycle states

| State | BA meaning | UI treatment | Allowed behavior |
|---|---|---|---|
| `Created` | Meeting/job has been created but processing has not started. | Neutral badge; no success styling. | Start recording/upload processing when applicable. |
| `Recording` | Realtime recording is active. | Active recording indicator, timer, clear pause/end controls if supported. | Receive/display partial and final transcript. |
| `Processing` | File is processing or remaining audio/transcript is being finalized. | Processing badge; spinner/progress when real progress exists. | Prevent false Completed state; allow navigation if safe. |
| `Completed` | Result is available for viewing/editing. | Restrained success badge. | Open transcript, edit, translate, summarize, export/share as permissions/capabilities allow. |
| `Failed` | Processing failed. | Clear danger/error badge and error notice. | Retry only when backend/provider indicates retry is appropriate. |

If the backend uses `queued`, treat it as a real pre-processing state rather than mapping it to success. It may be displayed separately or grouped visually with Created/Processing, but its semantic value must be preserved.

## 2. Realtime transcript states

### Partial transcript
- Temporary.
- May change as STT provider refines recognition.
- Visually distinguish from persisted/final segments with a subtle active/draft treatment.
- Must not be treated as final stored transcript.

### Final transcript
- Confirmed by Cloud STT and eligible for persistence.
- Display with normal transcript styling.

### Connection degraded / lost
- Show explicit warning.
- Show reconnect/retry state when supported.
- Do not silently continue as if data is guaranteed.

### Finishing recording
When user ends recording but remaining audio is still processing:
- keep meeting in Processing/finishing state;
- disable actions that require completed transcript if necessary;
- transition to Completed only after backend confirms completion.

## 3. Upload states

### Idle
Dropzone/file picker available.

### Validating
Indicate file is being checked for supported format/size/duration/processability.

### Validation failed
- Show clear reason when provided.
- Do not create or visually imply a valid processing job.

### Uploading
- Show actual upload progress if measurable.
- If progress is unavailable, use indeterminate state rather than fake percentage.

### Queued / Processing
- Display backend job state.
- Keep open/view result actions unavailable until meaningful.

### Completed
- Show open transcript/result action.

### Failed
- Show error and retry if allowed.

## 4. Transcript editing states

### Read-only/viewing
Standard transcript segment display.

### Editing
- Editable text/timing/speaker controls for the active segment.
- Save/cancel clearly visible.

### Saving
- Prevent duplicate submission.
- Indicate pending save.

### Saved
- Return to stable segment display.
- Current transcript version should reflect the saved change according to backend behavior.

### Save failed
- Keep user's unsaved content when practical.
- Show error and retry path.

### Delete confirmation
Segment deletion must request confirmation when the operation risks irreversible data loss.

## 5. Speaker states

### Auto-detected / unassigned
- May show generic Speaker 1, Speaker 2, etc.
- Must not imply confirmed real-world identity.

### Assigned/edited
- Display user-reviewed speaker profile information.
- Changes should propagate to related segments after successful backend update.

### Sample unavailable
Do not display a working "listen" interaction if no sample/media source exists.

## 6. Translation states

### Unavailable
No valid transcript or unsupported language pair/capability.

### Ready
Valid transcript and provider capability available.

### Generating
Show async processing state.

### Completed
Show original and translated segments side-by-side/paired.

### Failed
Show provider/API failure clearly and retry if permitted.

Translation must remain separate from the source transcript.

## 7. Summary states

### Unavailable
Transcript is empty/invalid.

### Ready to generate
Show template controls if supported.

### Generating
Async processing state.

### Completed
Display structured summary sections.

### Regenerating
Keep existing result visible where possible and indicate new version is being generated if versioning is implemented.

### Failed
Show explicit LLM/provider failure. Never replace the prior valid result with fake success content.

## 8. Export states

### Format available
Selectable only if backend export supports it.

### Generating
Show pending export state/job.

### Ready
Provide real download action/URL.

### Failed
Show error and retry where supported.

Do not expose formats solely because they appear in BA if they are not implemented.

## 9. Sharing and permission states

BA/system design recognizes meeting access levels such as read, comment, and edit.

### Rules
- Current user's available actions must reflect actual permission.
- Read-only users cannot be presented with working edit controls.
- Comment permission does not imply transcript editing.
- Edit permission may include transcript and speaker editing according to backend policy.
- Owner-only operations such as managing sharing/deleting a meeting must not appear enabled to unauthorized users.

## 10. Data retention / media availability states

If audio has been removed while transcript remains:
- transcript stays accessible if policy allows;
- audio player/download actions become unavailable;
- show a clear explanatory state rather than a broken player.

If an entire meeting is deleted, related dependent data/share links should not remain represented as available.

## 11. Generic UI states

### Loading
Use skeleton/spinner/indeterminate progress appropriate to the component. Avoid blocking the entire app when only one panel is loading.

### Empty
Use concise text and one relevant next action. Avoid decorative oversized empty-state artwork.

### Error
State what failed, preserve user work when possible, and show retry only if meaningful.

### Disabled
Disabled controls must explain capability/permission constraints where non-obvious.

### Success
Use restrained confirmation. Do not use persistent celebratory treatment.

## 12. State precedence
When multiple conditions apply, prioritize truthfulness and safety:
1. permission/access restriction;
2. destructive-data confirmation;
3. real backend/API failure;
4. active processing/recording;
5. completed/success state;
6. cosmetic/secondary state.
